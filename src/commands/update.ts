import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  ThreadChannel,
  AttachmentBuilder,
  PermissionsBitField,
  MessageFlags,
  ChannelType,
} from 'discord.js';
import { fetchSpots } from '../services/apiService';
import { logger } from '../utils/logger';
import { getAllGuildChannels, getChannelConfig } from '../services/channelStore';
import { getPortalBindings, getPortalForumBinding } from '../services/portalSync';
import {
  formatCaveText,
  isVideoFile,
  isSupabasePublicUrl,
  withTimeout,
  requireAdmin,
  safeEditReply,
} from '../utils/commandUtils';
import { VALID_MAPS, VALID_SERVERS, MAX_MESSAGES, MAX_VIDEO_BYTES } from '../constants';

export const updateCommand = new SlashCommandBuilder()
  .setName('update')
  .setDescription('Update cave spots (default: here). Optionally update all saved channels.')
  .addStringOption(opt =>
    opt.setName('mode')
      .setDescription('Update mode: leave empty for here; set to all for all saved channels')
      .setRequired(false)
      .addChoices(
        { name: 'all', value: 'all' },
      )
  );

function parseServerAndMapFromHeader(headerText: string): { server: string | null; map: string | null } {
  const match = headerText.match(/__\*\*\*#\s*([^-]+)\s*-\s*([^*]+)\*\*\*__/);
  if (match) {
    const server = match[1].trim();
    const map = match[2].trim();
    if (
      VALID_SERVERS.includes(server as typeof VALID_SERVERS[number]) &&
      VALID_MAPS.includes(map as typeof VALID_MAPS[number])
    ) {
      return { server, map };
    }
  }
  return { server: null, map: null };
}

export async function executeUpdateCommand(interaction: ChatInputCommandInteraction) {
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

    const mode = interaction.options.getString('mode') || 'here';
    const channel = interaction.channel;
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.PublicThread)) {
      await safeEditReply(interaction, 'This command can only be used in text channels or threads.');
      return;
    }

    const isThread = channel.type === ChannelType.PublicThread;
    const targetChannel = channel as TextChannel | ThreadChannel;

    logger.info(`Channel type: ${channel.type}, isThread: ${isThread}, channel name: ${channel.name || 'unnamed'}`);

    const botMember = interaction.guild?.members.me;
    if (!botMember) {
      await safeEditReply(interaction, 'Unable to verify bot permissions. Please ensure the bot has the required permissions.');
      return;
    }

    const permissions = targetChannel.permissionsFor(botMember);
    if (!permissions) {
      await safeEditReply(interaction, 'Unable to verify permissions for this channel/thread.');
      return;
    }

    const requiredPermissions = [
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ManageMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
    ];
    const missingPermissions = requiredPermissions.filter(p => !permissions.has(p));
    if (missingPermissions.length > 0) {
      const names = missingPermissions.map(p => {
        switch (p) {
          case PermissionsBitField.Flags.SendMessages: return 'Send Messages';
          case PermissionsBitField.Flags.ManageMessages: return 'Manage Messages';
          case PermissionsBitField.Flags.ReadMessageHistory: return 'Read Message History';
          default: return 'Unknown Permission';
        }
      }).join(', ');
      await safeEditReply(interaction, `Missing required permissions in this ${isThread ? 'thread' : 'channel'}: ${names}. Please ensure the bot has these permissions.`);
      return;
    }

    if (isThread) {
      const threadChannel = channel as ThreadChannel;
      if (threadChannel.archived) {
        await safeEditReply(interaction, 'This thread is archived. Please unarchive it first or use the command in an active thread.');
        return;
      }
      if (threadChannel.locked) {
        await safeEditReply(interaction, 'This thread is locked. Please unlock it first or use the command in an unlocked thread.');
        return;
      }
      if (!threadChannel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.SendMessages)) {
        await safeEditReply(interaction, 'The bot does not have permission to send messages in this thread. Please check the thread permissions.');
        return;
      }
    }

    if (mode === 'all') {
      await interaction.editReply({ content: 'Loading saved channels for this guild...' });
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a guild.' });
        return;
      }
      const forumBinding = await getPortalForumBinding(guildId);
      if (forumBinding) {
        await interaction.editReply({
          content: `This guild uses one cave forum for all maps. Run \`/populatethread server:${forumBinding.server}\` to rebuild every forum post.`,
        });
        return;
      }
      // The portal is authoritative when configured, so deleting a portal binding
      // actually removes it from /update all. Fall back to local storage only when
      // portal sync is unavailable.
      const portalBindings = await getPortalBindings(guildId);
      const merged: Record<string, { server: string; map: string }> =
        portalBindings === null ? await getAllGuildChannels(guildId) : {};
      for (const b of portalBindings ?? []) {
        merged[b.channelId] = { server: b.server, map: b.map };
      }
      const entries = Object.entries(merged);
      if (entries.length === 0) {
        await interaction.editReply({ content: 'No saved channels found. Use `/caves` in channels (or add a binding in the portal) first.' });
        return;
      }
      let success = 0;
      let failed = 0;
      for (const [savedChannelId, cfg] of entries) {
        try {
          if (
            !VALID_SERVERS.includes(cfg.server as typeof VALID_SERVERS[number]) ||
            !VALID_MAPS.includes(cfg.map as typeof VALID_MAPS[number])
          ) {
            logger.warn(`Skipping invalid portal binding ${savedChannelId}: ${cfg.server} / ${cfg.map}`);
            failed++;
            continue;
          }
          const target = await interaction.client.channels.fetch(savedChannelId);
          if (!target || (target.type !== ChannelType.GuildText && target.type !== ChannelType.PublicThread)) {
            failed++;
            continue;
          }
          if (target.guildId !== guildId) {
            logger.warn(`Rejected cross-guild binding ${savedChannelId}: expected ${guildId}, got ${target.guildId}`);
            failed++;
            continue;
          }
          await updateChannel(target as TextChannel | ThreadChannel, cfg.server, cfg.map);
          success++;
          await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
          logger.warn('Failed updating saved channel', e);
          failed++;
        }
      }
      await interaction.editReply({ content: `✅ Update complete. Success: ${success}, Failed: ${failed}.` });
      return;
    }

    // mode === 'here': prefer saved config; fallback to header scan
    let lastServer: string | null = null;
    let lastMap: string | null = null;

    await interaction.editReply({ content: 'Resolving server/map for this channel...' });

    const savedCfg = interaction.guildId
      ? await getChannelConfig(interaction.guildId, interaction.channelId)
      : null;
    if (savedCfg) {
      lastServer = savedCfg.server;
      lastMap = savedCfg.map;
      logger.info(`Using saved config for channel ${interaction.channelId}: ${lastServer} - ${lastMap}`);
    } else {
      try {
        const messages = await targetChannel.messages.fetch({ limit: 100 });
        for (const [, message] of messages) {
          const { server, map } = parseServerAndMapFromHeader(message.content);
          if (server && map) {
            lastServer = server;
            lastMap = map;
            break;
          }
        }
      } catch (error) {
        logger.error('Error fetching messages:', error);
      }
    }

    if (!lastServer || !lastMap) {
      await interaction.editReply({ content: 'No server/map could be resolved. Use `/caves` first in this channel.' });
      return;
    }

    await updateChannel(targetChannel, lastServer, lastMap, async (msg) => {
      try { await interaction.editReply({ content: msg }); } catch { /* ignore stale interaction */ }
    });

  } catch (error) {
    logger.error('Error executing update command:', error);
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
        await interaction.editReply({ content: 'An error occurred while updating the spots. Please try again later.' });
      } catch (editError) {
        logger.warn('Failed to edit reply:', editError);
      }
    }
  }
}

async function updateChannel(
  targetChannel: TextChannel | ThreadChannel,
  server: string,
  map: string,
  progress?: (msg: string) => Promise<void> | void,
) {
  const isThread = targetChannel.type === ChannelType.PublicThread;
  if (progress) await progress(`Fetching updated spots for **${server}** on **${map}**...`);
  const spots = await fetchSpots(server, map, 'modded');
  if (!spots || spots.length === 0) {
    if (progress) await progress(`No modded cave spots found for **${server}** on **${map}**`);
    return;
  }
  if (progress) await progress('Processing cave spots and clearing channel...');

  spots.sort((a, b) => {
    if (a.type === 'farm' && b.type !== 'farm') return 1;
    if (a.type !== 'farm' && b.type === 'farm') return -1;
    if (a.type === b.type) return (a.name || '').localeCompare(b.name || '');
    return (a.type || '').localeCompare(b.type || '');
  });

  try {
    let hasMoreMessages = true;
    while (hasMoreMessages) {
      const messages = await targetChannel.messages.fetch({ limit: 100 });
      if (messages.size === 0) { hasMoreMessages = false; break; }
      const deletableMessages = messages.filter(
        msg => (Date.now() - msg.createdTimestamp) < 14 * 24 * 60 * 60 * 1000,
      );
      if (deletableMessages.size > 0) {
        await targetChannel.bulkDelete(deletableMessages);
      }
      if (messages.size < 100) { hasMoreMessages = false; }
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (error) {
    logger.error('Error deleting messages:', error);
    if (progress) await progress('Failed to clear channel/thread messages. Please ensure I have Manage Messages.');
    return;
  }

  if (progress) await progress(`Found ${spots.length} spots. Sending to channel...`);
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

  if (progress) {
    await progress(
      `✅ Successfully updated and sent ${Math.min(messageCount, MAX_MESSAGES)} messages for **${server}** on **${map}** to the ${isThread ? 'thread' : 'channel'}.`,
    );
  }
}
