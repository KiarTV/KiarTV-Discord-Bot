import { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction, TextChannel, AttachmentBuilder, PermissionsBitField, MessageFlags } from 'discord.js';
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
        { name: 'Mesa', value: 'Mesa' }
      )
  )
  .addStringOption(option =>
    option.setName('map')
      .setDescription('The map name')
      .setRequired(true)
      .setAutocomplete(true)
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
  } catch {
    // ignore URL parse errors and fall through to generic check
  }
  return /supabase\.(co|in)\/storage\/v1\/object\/public\//i.test(url);
}

export async function executeCavesCommand(interaction: ChatInputCommandInteraction) {
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

    // Defer the reply immediately to prevent timeout
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (error) {
      logger.warn('Failed to defer reply, interaction may have expired:', error);
      return;
    }

    const server = interaction.options.getString('server');
    const map = interaction.options.getString('map');

    const channel = interaction.channel;
    if (!channel || channel.type !== 0) {
      try {
        await interaction.editReply({ content: 'This command can only be used in text channels.' });
      } catch (error) {
        logger.warn('Failed to edit reply:', error);
      }
      return;
    }
    const textChannel = channel as TextChannel;

    if (!validServers.includes(server!)) {
      try {
        await interaction.editReply({ content: `Invalid server. Allowed: ${validServers.join(", ")}` });
      } catch (error) {
        logger.warn('Failed to edit reply:', error);
      }
      return;
    }
    if (!validMaps.includes(map!)) {
      try {
        await interaction.editReply({ content: `Invalid map. Allowed: ${validMaps.join(", ")}` });
      } catch (error) {
        logger.warn('Failed to edit reply:', error);
      }
      return;
    }

    logger.info(`Caves command executed for server: ${server}, map: ${map}`);

    // Update the deferred reply to show progress
    try {
      await interaction.editReply({ content: 'Fetching cave spots...' });
    } catch (error) {
      logger.warn('Failed to update progress:', error);
    }

    const spots = await fetchSpots(server!, map!, 'modded');

    if (!spots || spots.length === 0) {
      try {
        await interaction.editReply({ content: `No modded cave spots found for server **${server}** on map **${map}**` });
      } catch (error) {
        logger.warn('Failed to edit reply:', error);
      }
      return;
    }

    // Update the deferred reply to show processing
    try {
      await interaction.editReply({ content: 'Processing cave spots...' });
    } catch (error) {
      logger.warn('Failed to update progress:', error);
    }

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

    // Send the final response to the interaction
    try {
      await interaction.editReply({ content: `Found ${spots.length} modded cave spots for **${server}** on **${map}**. Sending details to the channel...` });
    } catch (error) {
      logger.warn('Failed to update final status:', error);
    }

    // Send server and map header
    await textChannel.send({ content: `__***# ${server} - ${map}***__\n` });
    
    // Now send the detailed information to the channel
    let lastType: string | null = null;
    let idx = 0;
    let messageCount = 1; // Start at 1 since we already sent the header
    const maxMessages = 50; // Limit to prevent spam

    for (const spot of spots) {
      if (messageCount >= maxMessages) {
        await textChannel.send({ content: `... and ${spots.length - messageCount} more spots. Use the command again with more specific parameters to see all spots.` });
        break;
      }

      if (spot.type !== lastType) {
        await textChannel.send({ content: `__***# ${spot.type || 'Unknown'}***__\n` });
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
          await textChannel.send({ content: formatCaveText(spot, idx), files: [attachment] });
          await textChannel.send({ content: '--------------------------------' });
          messageCount += 2;
        } catch (err) {
          logger.error('Failed to attach video file:', err);
          await textChannel.send({ content: formatCaveText(spot, idx) + '\n[Failed to attach video file]\n--------------------------------' });
          messageCount++;
        }
      } else {
        const baseContent = formatCaveText(spot, idx);
        const hasExternalVideoLink = typeof spot.videoUrl === 'string' && spot.videoUrl.length > 0 && !isSupabasePublicUrl(spot.videoUrl);
        const contentToSend = hasExternalVideoLink ? baseContent : `${baseContent}\n--------------------------------`;
        await textChannel.send({ content: contentToSend });
        messageCount++;
      }
      idx++;
    }

    // Final update to the interaction
    try {
      await interaction.editReply({ content: `✅ Successfully sent ${Math.min(messageCount, maxMessages)} messages with modded cave spots for **${server}** on **${map}** to the channel.` });
    } catch (error) {
      logger.warn('Failed to send final confirmation:', error);
    }

  } catch (error) {
    logger.error('Error executing caves command:', error);
    
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
        await interaction.editReply({ content: 'An error occurred while fetching the spots. Please try again later.' });
      } catch (editError) {
        logger.warn('Failed to edit reply:', editError);
      }
    }
  }
}

export async function handleCavesAutocomplete(interaction: AutocompleteInteraction) {
  try {
    // Check if interaction is already responded to
    if (interaction.responded) {
      logger.warn('Autocomplete interaction already responded to, skipping');
      return;
    }

    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === 'map') {
      const filtered = validMaps.filter(m => m.toLowerCase().includes(focusedOption.value.toLowerCase()));
      await interaction.respond(filtered.map(m => ({ name: m, value: m })));
    } else {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.warn('Error handling caves autocomplete (likely expired interaction):', error);
    // Don't try to respond again if there's an error - just log it
  }
}
