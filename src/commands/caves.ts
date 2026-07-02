import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  TextChannel,
  ThreadChannel,
  AttachmentBuilder,
  PermissionsBitField,
  MessageFlags,
  ChannelType,
} from 'discord.js';
import { fetchSpots } from '../services/apiService';
import { upsertChannelConfig } from '../services/channelStore';
import { logger } from '../utils/logger';
import {
  formatCaveText,
  isVideoFile,
  isSupabasePublicUrl,
  withTimeout,
  requireAdmin,
} from '../utils/commandUtils';
import { VALID_MAPS, VALID_SERVERS, MAX_MESSAGES, MAX_VIDEO_BYTES } from '../constants';

export const cavesCommand = new SlashCommandBuilder()
  .setName('caves')
  .setDescription('Get all modded cave spots for a specific server and map')
  .addStringOption(option =>
    option.setName('server')
      .setDescription('The server name (INX, Fusion, Mesa)')
      .setRequired(true)
      .addChoices(
        { name: 'INX', value: 'INX' },
        { name: 'Fusion', value: 'Fusion' },
        { name: 'Mesa', value: 'Mesa' },
      )
  )
  .addStringOption(option =>
    option.setName('map')
      .setDescription('The map name')
      .setRequired(true)
      .setAutocomplete(true)
  );

export async function executeCavesCommand(interaction: ChatInputCommandInteraction) {
  try {
    if (!await requireAdmin(interaction)) return;

    if (interaction.replied || interaction.deferred) {
      logger.warn('Interaction already handled, skipping execution');
      return;
    }
    if (!interaction.isRepliable()) {
      logger.warn('Interaction is not repliable, skipping execution');
      return;
    }

    try {
      await withTimeout(interaction.deferReply({ flags: MessageFlags.Ephemeral }), 2000);
    } catch (error) {
      logger.warn('Failed to defer reply, interaction may have expired:', error);
    }

    const server = interaction.options.getString('server', true);
    const map = interaction.options.getString('map', true);

    const channel = interaction.channel;
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.PublicThread)) {
      await interaction.editReply({ content: 'This command can only be used in text channels or threads.' });
      return;
    }

    const isThread = channel.type === ChannelType.PublicThread;
    const targetChannel = channel as TextChannel | ThreadChannel;

    logger.info(`Channel type: ${channel.type}, isThread: ${isThread}, channel name: ${channel.name || 'unnamed'}`);

    const botMember = interaction.guild?.members.me;
    if (!botMember) {
      await interaction.editReply({ content: 'Unable to verify bot permissions. Please ensure the bot has the required permissions.' });
      return;
    }

    const permissions = targetChannel.permissionsFor(botMember);
    if (!permissions) {
      await interaction.editReply({ content: 'Unable to verify permissions for this channel/thread.' });
      return;
    }

    const requiredPermissions = [
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
    ];
    const missingPermissions = requiredPermissions.filter(p => !permissions.has(p));
    if (missingPermissions.length > 0) {
      const names = missingPermissions.map(p => {
        switch (p) {
          case PermissionsBitField.Flags.SendMessages: return 'Send Messages';
          case PermissionsBitField.Flags.ReadMessageHistory: return 'Read Message History';
          default: return 'Unknown Permission';
        }
      }).join(', ');
      await interaction.editReply({
        content: `Missing required permissions in this ${isThread ? 'thread' : 'channel'}: ${names}. Please ensure the bot has these permissions.`,
      });
      return;
    }

    if (isThread) {
      const threadChannel = channel as ThreadChannel;
      if (threadChannel.archived) {
        await interaction.editReply({ content: 'This thread is archived. Please unarchive it first or use the command in an active thread.' });
        return;
      }
      if (threadChannel.locked) {
        await interaction.editReply({ content: 'This thread is locked. Please unlock it first or use the command in an unlocked thread.' });
        return;
      }
      if (!threadChannel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.SendMessages)) {
        await interaction.editReply({ content: 'The bot does not have permission to send messages in this thread. Please check the thread permissions.' });
        return;
      }
    }

    if (!VALID_SERVERS.includes(server as typeof VALID_SERVERS[number])) {
      await interaction.editReply({ content: `Invalid server. Allowed: ${VALID_SERVERS.join(', ')}` });
      return;
    }
    if (!VALID_MAPS.includes(map as typeof VALID_MAPS[number])) {
      await interaction.editReply({ content: `Invalid map. Allowed: ${VALID_MAPS.join(', ')}` });
      return;
    }

    logger.info(`Caves command executed for server: ${server}, map: ${map}`);

    try {
      const guildId = interaction.guildId;
      const channelId = interaction.channelId;
      if (guildId && channelId) {
        await upsertChannelConfig(guildId, channelId, { server, map });
        logger.info(`Saved channel config for guild ${guildId}, channel ${channelId}: ${server} - ${map}`);
      }
    } catch (saveErr) {
      logger.warn('Failed to save channel config:', saveErr);
    }

    await interaction.editReply({ content: 'Fetching cave spots...' });

    const spots = await fetchSpots(server, map, 'modded');

    if (!spots || spots.length === 0) {
      await interaction.editReply({ content: `No modded cave spots found for server **${server}** on map **${map}**` });
      return;
    }

    await interaction.editReply({ content: 'Processing cave spots...' });

    spots.sort((a, b) => {
      if (a.type === 'farm' && b.type !== 'farm') return 1;
      if (a.type !== 'farm' && b.type === 'farm') return -1;
      if (a.type === b.type) return (a.name || '').localeCompare(b.name || '');
      return (a.type || '').localeCompare(b.type || '');
    });

    await interaction.editReply({
      content: `Found ${spots.length} modded cave spots for **${server}** on **${map}**. Sending details to the channel...`,
    });

    await targetChannel.send({ content: `__***# ${server} - ${map}***__\n` });

    let lastType: string | null = null;
    let idx = 0;
    let messageCount = 1;

    for (const spot of spots) {
      if (messageCount >= MAX_MESSAGES) {
        await targetChannel.send({ content: `... and ${spots.length - messageCount} more spots. Use the command again with more specific parameters to see all spots.` });
        break;
      }

      if (spot.type !== lastType) {
        await targetChannel.send({ content: `# *————— ${spot.type || 'Unknown'} —————*\n` });
        lastType = spot.type ?? null;
        idx = 0;
        messageCount++;
      }

      if (spot.videoFile && typeof spot.videoFile === 'string' && isVideoFile(spot.videoFile)) {
        try {
          const response = await fetch(spot.videoFile);
          if (!response.ok) throw new Error('Failed to fetch video file');
          const contentLength = Number(response.headers.get('content-length') ?? 0);
          if (contentLength > MAX_VIDEO_BYTES) {
            logger.warn(`Video file too large (${contentLength} bytes), skipping attachment`);
            await targetChannel.send({ content: formatCaveText(spot, idx) + '\n[Video file too large to attach]\n--------------------------------' });
            messageCount++;
          } else {
            const buffer = Buffer.from(await response.arrayBuffer());
            const filename = spot.videoFile.split('/').pop() || 'video.mp4';
            const attachment = new AttachmentBuilder(buffer, { name: filename });
            await targetChannel.send({ content: formatCaveText(spot, idx), files: [attachment] });
            await targetChannel.send({ content: '--------------------------------' });
            messageCount += 2;
          }
        } catch (err) {
          logger.error('Failed to attach video file:', err);
          await targetChannel.send({ content: formatCaveText(spot, idx) + '\n[Failed to attach video file]\n--------------------------------' });
          messageCount++;
        }
      } else {
        const baseContent = formatCaveText(spot, idx);
        const hasExternalVideoLink =
          typeof spot.videoUrl === 'string' &&
          spot.videoUrl.length > 0 &&
          !isSupabasePublicUrl(spot.videoUrl);
        const contentToSend = hasExternalVideoLink ? baseContent : `${baseContent}\n--------------------------------`;
        await targetChannel.send({ content: contentToSend });
        messageCount++;
      }
      idx++;
    }

    await interaction.editReply({
      content: `✅ Successfully sent ${Math.min(messageCount, MAX_MESSAGES)} messages with modded cave spots for **${server}** on **${map}** to the ${isThread ? 'thread' : 'channel'}.`,
    });

  } catch (error) {
    logger.error('Error executing caves command:', error);
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: 'An error occurred while processing the command. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      } catch (replyError) {
        logger.warn('Failed to reply to interaction:', replyError);
      }
    } else if (interaction.deferred) {
      try {
        await interaction.editReply({ content: 'An error occurred while fetching the spots. Please try again later.' });
      } catch (editError) {
        logger.warn('Failed to edit reply:', editError);
      }
    }
  }
}

export async function handleCavesAutocomplete(interaction: AutocompleteInteraction) {
  try {
    if (interaction.responded) {
      logger.warn('Autocomplete interaction already responded to, skipping');
      return;
    }
    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === 'map') {
      const filtered = VALID_MAPS.filter(m =>
        m.toLowerCase().includes(focusedOption.value.toLowerCase()),
      );
      await interaction.respond(filtered.map(m => ({ name: m, value: m })));
    } else {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.warn('Error handling caves autocomplete (likely expired interaction):', error);
  }
}
