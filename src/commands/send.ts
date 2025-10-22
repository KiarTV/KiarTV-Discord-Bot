import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionsBitField, MessageFlags } from 'discord.js';
import { sendWebhookMessage, sendSimpleWebhookMessage, sendEmbedWebhookMessage } from '../services/webhookService';
import { logger } from '../utils/logger';

export const sendCommand = new SlashCommandBuilder()
  .setName('send')
  .setDescription('Send a message using a webhook URL')
  .addStringOption(option =>
    option.setName('webhook_url')
      .setDescription('The webhook URL to send the message to')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('message')
      .setDescription('The message content to send')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('username')
      .setDescription('Custom username for the webhook message')
      .setRequired(false)
  )
  .addStringOption(option =>
    option.setName('avatar_url')
      .setDescription('Custom avatar URL for the webhook message')
      .setRequired(false)
  );

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

export async function executeSendCommand(interaction: ChatInputCommandInteraction) {
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

    const webhookUrl = interaction.options.getString('webhook_url', true);
    const message = interaction.options.getString('message', true);
    const username = interaction.options.getString('username');
    const avatarUrl = interaction.options.getString('avatar_url');

    logger.info(`Send command executed by ${interaction.user.tag} for webhook: ${webhookUrl.substring(0, 50)}...`);

    // Update the deferred reply to show progress
    try {
      await interaction.editReply({ content: 'Sending webhook message...' });
    } catch (error) {
      logger.warn('Failed to update progress:', error);
    }

    try {
      // Send the webhook message
      const result = await sendSimpleWebhookMessage(webhookUrl, message, username || undefined, avatarUrl || undefined);

      if (result.success) {
        const successMessage = `✅ **Message sent successfully!**

**Message ID:** ${result.messageId || 'Unknown'}
**Webhook URL:** \`${webhookUrl.substring(0, 50)}...\`
**Message:** ${message}
${username ? `**Username:** ${username}` : ''}
${avatarUrl ? `**Avatar:** ${avatarUrl}` : ''}

The message has been sent via webhook and should appear in the target channel.`;

        try {
          await interaction.editReply({ content: successMessage });
        } catch (error) {
          logger.warn('Failed to send success message:', error);
        }

        logger.info(`Webhook message sent successfully by ${interaction.user.tag}: ${result.messageId}`);
      } else {
        const errorMessage = `❌ **Failed to send webhook message**

**Error:** ${result.error || 'Unknown error'}
**Webhook URL:** \`${webhookUrl.substring(0, 50)}...\`

Please check that the webhook URL is valid and the webhook hasn't been deleted.`;

        try {
          await interaction.editReply({ content: errorMessage });
        } catch (error) {
          logger.warn('Failed to send error message:', error);
        }

        logger.error(`Webhook send failed for ${interaction.user.tag}: ${result.error}`);
      }

    } catch (error) {
      logger.error('Error executing send command:', error);
      
      try {
        await interaction.editReply({ 
          content: 'An error occurred while sending the webhook message. Please try again later.' 
        });
      } catch (editError) {
        logger.warn('Failed to edit reply:', editError);
      }
    }

  } catch (error) {
    logger.error('Error executing send command:', error);
    
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
        await interaction.editReply({ content: 'An error occurred while sending the message. Please try again later.' });
      } catch (editError) {
        logger.warn('Failed to edit reply:', editError);
      }
    }
  }
}
