import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel, ThreadChannel, AttachmentBuilder, PermissionsBitField, MessageFlags } from 'discord.js';
import fetch from 'node-fetch';
import { fetchSpots } from '../services/apiService';
import { logger } from '../utils/logger';

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
  .setDescription('Update cave spots for the last server/map found in this channel');

function formatCaveText(spot: any, idx: number): string {
  return [
    `** ${idx + 1}. ${spot.name || 'Unnamed Cave'}**`,
    `- Coords: ${spot.y}, ${spot.x}\n`,
    `- Cave Damage: ${spot.caveDamage || 'Unknown'}\n`,
    spot.description ? `Description:\n\`\`\`\n${spot.description}\n\`\`\`\n` : undefined,
    spot.videoUrl ? `Video:\n ${spot.videoUrl}\n` : undefined,
  ].filter(Boolean).join('');
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

    // Update the deferred reply to show progress
    try {
      await interaction.editReply({ content: 'Searching for last server/map header...' });
    } catch (error) {
      logger.warn('Failed to update progress:', error);
    }

    // Fetch recent messages to find the last server/map header
    let lastServer: string | null = null;
    let lastMap: string | null = null;
    
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

    if (!lastServer || !lastMap) {
      try {
        await interaction.editReply({ content: 'No valid server/map header found in recent messages. Use `/caves` first to create a header.' });
      } catch (error) {
        logger.warn('Failed to edit reply:', error);
      }
      return;
    }

    logger.info(`Update command executed for server: ${lastServer}, map: ${lastMap}`);

    // Update the deferred reply to show progress
    try {
      await interaction.editReply({ content: `Found header for **${lastServer}** on **${lastMap}**. Fetching updated spots...` });
    } catch (error) {
      logger.warn('Failed to update progress:', error);
    }

    const spots = await fetchSpots(lastServer, lastMap, 'modded');

    if (!spots || spots.length === 0) {
      try {
        await interaction.editReply({ content: `No modded cave spots found for server **${lastServer}** on map **${lastMap}**` });
      } catch (error) {
        logger.warn('Failed to edit reply:', error);
      }
      return;
    }

    // Update the deferred reply to show processing
    try {
      await interaction.editReply({ content: 'Processing cave spots and clearing channel...' });
    } catch (error) {
      logger.warn('Failed to update progress:', error);
    }

    // Sort spots (farm spots last)
    spots.sort((a, b) => {
      // Farm spots should always be last
      if (a.type === 'farm' && b.type !== 'farm') {
        return 1; // a comes after b
      }
      if (a.type !== 'farm' && b.type === 'farm') {
        return -1; // a comes before b
      }
      
      // If both are farm or both are not farm, sort by type then name
      if (a.type === b.type) {
        return (a.name || '').localeCompare(b.name || '');
      }
      return (a.type || '').localeCompare(b.type || '');
    });

    // Delete all messages in the channel/thread
    try {
      let deletedCount = 0;
      let hasMoreMessages = true;
      
      while (hasMoreMessages) {
        const messages = await targetChannel.messages.fetch({ limit: 100 });
        if (messages.size === 0) {
          hasMoreMessages = false;
          break;
        }
        
        // Filter out messages older than 14 days (Discord's bulk delete limit)
        const deletableMessages = messages.filter(msg => {
          const messageAge = Date.now() - msg.createdTimestamp;
          return messageAge < 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds
        });
        
        if (deletableMessages.size > 0) {
          await targetChannel.bulkDelete(deletableMessages);
          deletedCount += deletableMessages.size;
        }
        
        // If we got less than 100 messages, we've reached the end
        if (messages.size < 100) {
          hasMoreMessages = false;
        }
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      logger.info(`Deleted ${deletedCount} messages from ${isThread ? 'thread' : 'channel'}`);
    } catch (error) {
      logger.error('Error deleting messages:', error);
      try {
        await interaction.editReply({ content: 'Failed to clear channel/thread messages. Please try again.' });
      } catch (editError) {
        logger.warn('Failed to edit reply:', editError);
      }
      return;
    }

    // Send the final response to the interaction
    try {
      await interaction.editReply({ content: `Found ${spots.length} modded cave spots for **${lastServer}** on **${lastMap}**. Sending updated details to the channel...` });
    } catch (error) {
      logger.warn('Failed to update final status:', error);
    }

    // Send server and map header
    await targetChannel.send({ content: `__***# ${lastServer} - ${lastMap}***__\n` });
    
    // Now send the detailed information to the channel/thread
    let lastType: string | null = null;
    let idx = 0;
    let messageCount = 1; // Start at 1 since we already sent the header
    const maxMessages = 50; // Limit to prevent spam

    for (const spot of spots) {
      if (messageCount >= maxMessages) {
        await targetChannel.send({ content: `... and ${spots.length - messageCount} more spots. Use the command again with more specific parameters to see all spots.` });
        break;
      }

      if (spot.type !== lastType) {
        await targetChannel.send({ content: `__***# ${spot.type || 'Unknown'}***__\n` });
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
          await targetChannel.send({ content: formatCaveText(spot, idx), files: [attachment] });
          await targetChannel.send({ content: '--------------------------------' });
          messageCount += 2;
        } catch (err) {
          logger.error('Failed to attach video file:', err);
          await targetChannel.send({ content: formatCaveText(spot, idx) + '\n[Failed to attach video file]\n--------------------------------' });
          messageCount++;
        }
      } else {
        const baseContent = formatCaveText(spot, idx);
        const hasExternalVideoLink = typeof spot.videoUrl === 'string' && spot.videoUrl.length > 0 && !isSupabasePublicUrl(spot.videoUrl);
        const contentToSend = hasExternalVideoLink ? baseContent : `${baseContent}\n--------------------------------`;
        await targetChannel.send({ content: contentToSend });
        messageCount++;
      }
      idx++;
    }

    // Final update to the interaction
    try {
      await interaction.editReply({ content: `✅ Successfully updated and sent ${spots.length} modded cave spots for **${lastServer}** on **${lastMap}** to the ${isThread ? 'thread' : 'channel'}.` });
    } catch (error) {
      logger.warn('Failed to send final confirmation:', error);
    }

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
