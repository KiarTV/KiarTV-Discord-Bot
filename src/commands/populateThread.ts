import { SlashCommandBuilder, ChatInputCommandInteraction, ForumChannel, ThreadChannel, AttachmentBuilder, PermissionsBitField, MessageFlags } from 'discord.js';
import fetch from 'node-fetch';
import { fetchSpots, fetchMapsForServer } from '../services/apiService';
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

export const populateThreadCommand = new SlashCommandBuilder()
  .setName('populatethread')
  .setDescription('Create forum posts for all maps of a server with cave messages')
  .addStringOption(option =>
    option.setName('server')
      .setDescription('The server name (INX, Fusion, Mesa)')
      .setRequired(true)
      .addChoices(
        { name: 'INX', value: 'INX' },
        { name: 'Fusion', value: 'Fusion' },
        { name: 'Mesa', value: 'Mesa' }
      )
  )
  .addStringOption(option =>
    option.setName('forum_id')
      .setDescription('The target forum channel ID')
      .setRequired(true)
  );

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
  } catch {}
  return /supabase\.(co|in)\/storage\/v1\/object\/public\//i.test(url);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Operation timed out')), timeoutMs))
  ]);
}

export async function executePopulateThreadCommand(interaction: ChatInputCommandInteraction) {
  try {
    // Admin check
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({ content: 'You must be a server admin to use this command.', flags: MessageFlags.Ephemeral });
        } catch (error) { logger.warn('Failed to send permission error:', error); }
      }
      return;
    }

    // Defer reply
    try { await withTimeout(interaction.deferReply({ flags: MessageFlags.Ephemeral }), 2000); } catch (e) { logger.warn('Failed to defer reply', e); }

    const server = interaction.options.getString('server', true);
    const forumId = interaction.options.getString('forum_id', true);

    if (!validServers.includes(server)) { await interaction.editReply({ content: `Invalid server. Allowed: ${validServers.join(', ')}` }); return; }

    // Fetch forum
    let forum: ForumChannel | null = null;
    try {
      const ch = await interaction.client.channels.fetch(forumId);
      if (ch && ch.type === 15) { // Forum channel type
        forum = ch as ForumChannel;
      }
    } catch (err) {
      logger.error('Failed to fetch forum:', err);
    }
    if (!forum) { await interaction.editReply({ content: 'Forum not found or not a forum. Provide a valid forum channel ID.' }); return; }

    // Validate permissions and state
    const botMember = interaction.guild?.members.me;
    if (!botMember) { await interaction.editReply({ content: 'Unable to verify bot permissions.' }); return; }
    const perms = forum.permissionsFor(botMember);
    const required = [PermissionsBitField.Flags.CreatePublicThreads, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory];
    if (!perms || !required.every(p => perms.has(p))) {
      await interaction.editReply({ content: 'Missing required permissions in the target forum (Create Threads, Send Messages, Read History).' });
      return;
    }

    await interaction.editReply({ content: 'Creating forum posts for all maps...' });

    let totalMessageCount = 0;
    let mapsWithSpots = 0;
    const createdThreads: ThreadChannel[] = [];

    // Derive maps from API, fallback to validMaps
    const mapsToProcess = await fetchMapsForServer(server).catch(() => validMaps);
    // Process each map for the server
    for (const map of mapsToProcess) {
      try {
        const spots = await fetchSpots(server, map, 'modded');
        if (!spots || spots.length === 0) continue;

        mapsWithSpots++;
        
        // Sort spots (farm last)
        spots.sort((a, b) => {
          if (a.type === 'farm' && b.type !== 'farm') return 1;
          if (a.type !== 'farm' && b.type === 'farm') return -1;
          if (a.type === b.type) return (a.name || '').localeCompare(b.name || '');
          return (a.type || '').localeCompare(b.type || '');
        });

        // Create forum post for this map
        const thread = await forum.threads.create({
          name: `${server} - ${map}`,
          message: {
            content: `${server} - ${map}`
          }
        });

        createdThreads.push(thread);

        let lastType: string | null = null;
        let idx = 0;
        let messageCount = 1;
        const maxMessages = 50;

        for (const spot of spots) {
          if (messageCount >= maxMessages) {
            await thread.send({ content: `... and ${spots.length - messageCount} more spots. Use more specific parameters to see all.` });
            break;
          }
          if (spot.type !== lastType) {
            await thread.send({ content: `${spot.type || 'Unknown'}` });
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
              await thread.send({ content: formatCaveText(spot, idx), files: [attachment] });
              await thread.send({ content: '--------------------------------' });
              messageCount += 2;
            } catch (err) {
              logger.error('Failed to attach video file:', err);
              await thread.send({ content: formatCaveText(spot, idx) + '\n[Failed to attach video file]\n--------------------------------' });
              messageCount++;
            }
          } else {
            const baseContent = formatCaveText(spot, idx);
            const hasExternalVideoLink = typeof spot.videoUrl === 'string' && spot.videoUrl.length > 0 && !isSupabasePublicUrl(spot.videoUrl);
            const contentToSend = hasExternalVideoLink ? baseContent : `${baseContent}\n--------------------------------`;
            await thread.send({ content: contentToSend });
            messageCount++;
          }
          idx++;
        }

        totalMessageCount += Math.min(messageCount, maxMessages);
        
        // Small delay between maps to avoid rate limits
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        logger.error(`Error processing map ${map} for server ${server}:`, err);
        // Continue with next map
      }
    }

    if (mapsWithSpots === 0) {
      await interaction.editReply({ content: `No modded cave spots found for **${server}** on any map.` });
      return;
    }

    await interaction.editReply({ content: `✅ Created ${mapsWithSpots} forum posts for **${server}** with ${totalMessageCount} total messages.` });
  } catch (error) {
    logger.error('Error executing populatethread command:', error);
    if (!interaction.replied && !interaction.deferred) {
      try { await interaction.reply({ content: 'An error occurred. Please try again later.', flags: MessageFlags.Ephemeral }); } catch {}
    } else if (interaction.deferred) {
      try { await interaction.editReply({ content: 'An error occurred while populating the thread.' }); } catch {}
    }
  }
}

export async function handlePopulateThreadAutocomplete(interaction: any) {
  try {
    // No autocomplete needed since we removed the map option
    await interaction.respond([]);
  } catch (error) {
    logger.warn('Error handling populatethread autocomplete:', error);
  }
}


