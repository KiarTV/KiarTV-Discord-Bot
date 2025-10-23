import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel, ThreadChannel, AttachmentBuilder, PermissionsBitField, MessageFlags } from 'discord.js';
import fetch from 'node-fetch';
import { fetchSpots } from '../services/apiService';
import { logger } from '../utils/logger';
import { getAllGuildChannels, getChannelConfig } from '../services/channelStore';

// Valid maps (from serverMapSelector.tsx)
const validMaps = [
  "The Island",
  "The Center",
  "Scorched Earth",
  "Ragnarok",
  "Aberration",
  "Extinction",
  "Valguero",
  "Genesis: Part 1",
  "Crystal Isles",
  "Genesis: Part 2",
  "Lost Island",
  "Fjordur",
];

const validServers = ["INX", "Fusion", "Mesa"];

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

function formatCaveText(spot: any, idx: number): string {
  const caveDamageText = spot.caveDamage?.trim();
  const showCaveDamage = caveDamageText && caveDamageText.toLowerCase() !== 'nothing' && caveDamageText !== '';
  
  return [
    `## ** ${idx + 1}. ${spot.name || 'Unnamed Cave'}**`,
    `- Coords: ${spot.y}, ${spot.x}`,
    showCaveDamage ? `- Cave Damage: ${caveDamageText}` : undefined,
    spot.description ? `\nDescription:\n\`\`\`\n${spot.description}\n\`\`\`\n` : undefined,
    spot.videoUrl ? `Video:\n ${spot.videoUrl}\n` : undefined,
  ].filter(Boolean).join('\n');
}

function isVideoFile(url: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(url);
}

function isSupabasePublicUrl(url: string): boolean {
  try {
    const configuredBaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    if (configuredBaseUrl) {
      const configuredHost = new URL(configuredBaseUrl).hostname;
      return url.includes(configuredHost) && /\/storage\/v1\/object\/public\//i.test(url);
    }
  } catch {
    // ignore URL parse errors and fall through to generic check
  }
  return /supabase\.(co|in)\/storage\/v1\/object\/public\//i.test(url);
}

function parseServerAndMapFromHeader(headerText: string): { server: string | null; map: string | null } {
  // Parse header format: __***# {server} - {map}***__
  const match = headerText.match(/__\*\*\*#\s*([^-]+)\s*-\s*([^*]+)\*\*\*__/);
  if (match) {
    const server = match[1].trim();
    const map = match[2].trim();
    
    // Validate server and map
    if (validServers.includes(server) && validMaps.includes(map)) {
      return { server, map };
    }
  }
  return { server: null, map: null };
}

async function safeEditReply(interaction: ChatInputCommandInteraction, content: string): Promise<boolean> {
  try {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content });
      return true;
    }
    return false;
  } catch (error) {
    logger.warn('Failed to edit reply:', error);
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
    )
  ]);
}

export async function executeUpdateCommand(interaction: ChatInputCommandInteraction) {
  try {
    // Restrict to users with Administrator permission
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({ 
            content: 'You must be a server admin to use this command.', 
            flags: MessageFlags.Ephemeral 
          });
        } catch (error) {
          logger.warn('Failed to send permission error:', error);
        }
      }
      return;
    }

    // Check if interaction is already handled
    if (interaction.replied || interaction.deferred) {
      logger.warn('Interaction already handled, skipping execution');
      return;
    }

    // Check if interaction is still valid
    if (!interaction.isRepliable()) {
      logger.warn('Interaction is not repliable, skipping execution');
      return;
    }

    // Defer the reply immediately to prevent timeout
    try {
      await withTimeout(interaction.deferReply({ flags: MessageFlags.Ephemeral }), 2000);
    } catch (error) {
      logger.warn('Failed to defer reply, interaction may have expired:', error);
      // Don't return here, try to handle the interaction anyway
      // The interaction might still be valid for a brief moment
    }

    const mode = interaction.options.getString('mode') || 'here';
    const channel = interaction.channel;
    if (!channel || (channel.type !== 0 && channel.type !== 11)) {
      try {
        await interaction.editReply({ content: 'This command can only be used in text channels or threads.' });
      } catch (error) {
        logger.warn('Failed to edit reply:', error);
      }
      return;
    }
    
    // Handle both text channels and threads
    const isThread = channel.type === 11;
    const textChannel = isThread ? (channel as ThreadChannel).parent as TextChannel : channel as TextChannel;
    const targetChannel = channel as TextChannel | ThreadChannel;

    // Log channel information for debugging
    logger.info(`Channel type: ${channel.type}, isThread: ${isThread}, channel name: ${channel.name || 'unnamed'}`);

    // Check if the bot has the required permissions
    const botMember = interaction.guild?.members.me;
    if (!botMember) {
      await safeEditReply(interaction, 'Unable to verify bot permissions. Please ensure the bot has the required permissions.');
      return;
    }

    // Check permissions for the target channel/thread
    const permissions = targetChannel.permissionsFor(botMember);
    if (!permissions) {
      await safeEditReply(interaction, 'Unable to verify permissions for this channel/thread.');
      return;
    }

    // Check if bot has required permissions
    const requiredPermissions = [
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ManageMessages,
      PermissionsBitField.Flags.ReadMessageHistory
    ];

    const missingPermissions = requiredPermissions.filter(permission => !permissions.has(permission));
    if (missingPermissions.length > 0) {
      const permissionNames = missingPermissions.map(p => {
        switch (p) {
          case PermissionsBitField.Flags.SendMessages: return 'Send Messages';
          case PermissionsBitField.Flags.ManageMessages: return 'Manage Messages';
          case PermissionsBitField.Flags.ReadMessageHistory: return 'Read Message History';
          default: return 'Unknown Permission';
        }
      }).join(', ');

      await safeEditReply(interaction, `Missing required permissions in this ${isThread ? 'thread' : 'channel'}: ${permissionNames}. Please ensure the bot has these permissions.`);
      return;
    }

    // Additional check for thread-specific permissions
    if (isThread) {
      const threadChannel = channel as ThreadChannel;
      
      // Check if thread is archived
      if (threadChannel.archived) {
        await safeEditReply(interaction, 'This thread is archived. Please unarchive it first or use the command in an active thread.');
        return;
      }

      // Check if thread is locked
      if (threadChannel.locked) {
        await safeEditReply(interaction, 'This thread is locked. Please unlock it first or use the command in an unlocked thread.');
        return;
      }

      // Check if bot can send messages in this specific thread
      const threadPermissions = threadChannel.permissionsFor(botMember);
      if (!threadPermissions?.has(PermissionsBitField.Flags.SendMessages)) {
        await safeEditReply(interaction, 'The bot does not have permission to send messages in this thread. Please check the thread permissions.');
        return;
      }
    }

    if (mode === 'all') {
      try {
        await interaction.editReply({ content: 'Loading saved channels for this guild...' });
      } catch {}
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.editReply({ content: 'This command can only be used in a guild.' });
        return;
      }
      const saved = await getAllGuildChannels(guildId);
      const entries = Object.entries(saved);
      if (entries.length === 0) {
        await interaction.editReply({ content: 'No saved channels found. Use `/caves` in channels to save server/map first.' });
        return;
      }
      let success = 0;
      let failed = 0;
      for (const [savedChannelId, cfg] of entries) {
        try {
          const target = await interaction.client.channels.fetch(savedChannelId);
          if (!target || (target.type !== 0 && target.type !== 11)) {
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

    // subcommand here: prefer saved config; fallback to header scan
    let lastServer: string | null = null;
    let lastMap: string | null = null;

    try {
      await interaction.editReply({ content: 'Resolving server/map for this channel...' });
    } catch {}

    const savedCfg = interaction.guildId ? await getChannelConfig(interaction.guildId, interaction.channelId) : null;
    if (savedCfg) {
      lastServer = savedCfg.server;
      lastMap = savedCfg.map;
      logger.info(`Using saved config for channel ${interaction.channelId}: ${lastServer} - ${lastMap}`);
    } else {
      try {
        const messages = await targetChannel.messages.fetch({ limit: 100 });
        for (const [_, message] of messages) {
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
      try { await interaction.editReply({ content: msg }); } catch {}
    });

  } catch (error) {
    logger.error('Error executing update command:', error);
    
    // Check if interaction is still valid before trying to respond
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ 
          content: 'An error occurred while processing the command. Please try again later.', 
          flags: MessageFlags.Ephemeral 
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

async function updateChannel(targetChannel: TextChannel | ThreadChannel, server: string, map: string, progress?: (msg: string) => Promise<void> | void) {
  const isThread = targetChannel.type === 11;
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
      const deletableMessages = messages.filter(msg => (Date.now() - msg.createdTimestamp) < 14 * 24 * 60 * 60 * 1000);
      if (deletableMessages.size > 0) {
        await (targetChannel as TextChannel | ThreadChannel).bulkDelete(deletableMessages);
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

  await (targetChannel as TextChannel | ThreadChannel).send({ content: `__***# ${server} - ${map}***__\n` });

  let lastType: string | null = null;
  let idx = 0;
  let messageCount = 1;
  const maxMessages = 50;

  for (const spot of spots) {
    if (messageCount >= maxMessages) {
      await (targetChannel as TextChannel | ThreadChannel).send({ content: `... and ${spots.length - messageCount} more spots. Use the command again with more specific parameters to see all spots.` });
      break;
    }
    if (spot.type !== lastType) {
      await (targetChannel as TextChannel | ThreadChannel).send({ content: `# *————— ${spot.type || 'Unknown'} —————*\n` });
      lastType = spot.type;
      idx = 0;
      messageCount++;
    }
    if (spot.videoFile && typeof spot.videoFile === 'string' && isVideoFile(spot.videoFile)) {
      try {
        const response = await fetch(spot.videoFile);
        if (!response.ok) throw new Error('Failed to fetch video file');
        const buffer = await response.buffer();
        const filename = spot.videoFile.split('/').pop() || 'video.mp4';
        const attachment = new AttachmentBuilder(buffer, { name: filename });
        await (targetChannel as TextChannel | ThreadChannel).send({ content: formatCaveText(spot, idx), files: [attachment] });
        await (targetChannel as TextChannel | ThreadChannel).send({ content: '--------------------------------' });
        messageCount += 2;
      } catch (err) {
        logger.error('Failed to attach video file:', err);
        await (targetChannel as TextChannel | ThreadChannel).send({ content: formatCaveText(spot, idx) + '\n[Failed to attach video file]\n--------------------------------' });
        messageCount++;
      }
    } else {
      const baseContent = formatCaveText(spot, idx);
      const hasExternalVideoLink = typeof spot.videoUrl === 'string' && spot.videoUrl.length > 0 && !isSupabasePublicUrl(spot.videoUrl);
      const contentToSend = hasExternalVideoLink ? baseContent : `${baseContent}\n--------------------------------`;
      await (targetChannel as TextChannel | ThreadChannel).send({ content: contentToSend });
      messageCount++;
    }
    idx++;
  }
  if (progress) await progress(`✅ Successfully updated and sent ${Math.min(messageCount, maxMessages)} messages for **${server}** on **${map}** to the ${isThread ? 'thread' : 'channel'}.`);
}
