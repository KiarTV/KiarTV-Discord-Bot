import { Interaction, Events, AutocompleteInteraction, MessageFlags } from 'discord.js';
import { executeCavesCommand, handleCavesAutocomplete } from '../commands/caves';
import { executeUpdateCommand } from '../commands/update';
import { logger } from '../utils/logger';

export async function handleInteraction(interaction: Interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // Check if interaction is still valid
      if (!interaction.isRepliable()) {
        logger.warn(`Interaction is not repliable, skipping`);
        return;
      }

      switch (commandName) {
        case 'caves':
          await executeCavesCommand(interaction);
          break;
        case 'update':
          await executeUpdateCommand(interaction);
          break;
        default:
          logger.warn(`Unknown command: ${commandName}`);
          if (!interaction.replied && !interaction.deferred) {
            try {
              await interaction.reply({
                content: 'Unknown command!',
                flags: MessageFlags.Ephemeral
              });
            } catch (error) {
              logger.warn('Failed to reply to unknown command:', error);
            }
          }
      }
    } else if (interaction.isButton()) {
      // Handle button interactions (for embed navigation)
      const { customId } = interaction;
      
      switch (customId) {
        case 'prev_embed':
        case 'next_embed':
          // TODO: Implement embed navigation
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: 'Embed navigation not implemented yet.',
              flags: MessageFlags.Ephemeral
            });
          }
          break;
        default:
          logger.warn(`Unknown button interaction: ${customId}`);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: 'Unknown button!',
              flags: MessageFlags.Ephemeral
            });
          }
      }
    } else if (interaction.isAutocomplete()) {
      const { commandName } = interaction;
      
      // Check if this autocomplete interaction has already been responded to
      if (interaction.responded) {
        logger.warn(`Autocomplete interaction ${interaction.id} already responded to, skipping`);
        return;
      }
      
      if (commandName === 'caves') {
        await handleCavesAutocomplete(interaction as AutocompleteInteraction);
      } else {
        if (!interaction.responded) {
          await interaction.respond([]);
        }
      }
    }
  } catch (error) {
    logger.error('Error handling interaction:', error);
    
    const errorMessage = 'An error occurred while processing your request.';
    
    if (interaction.isRepliable()) {
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content: errorMessage });
        } else {
          await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
        }
      } catch (responseError) {
        logger.error('Failed to send error response:', responseError);
      }
    }
  }
} 