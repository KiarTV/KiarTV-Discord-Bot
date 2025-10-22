import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel, ThreadChannel, PermissionsBitField, MessageFlags } from 'discord.js';
import { logger } from '../utils/logger';

export const webhookCommand = new SlashCommandBuilder()
  .setName('webhook')
  .setDescription('Create a webhook in this channel for external messaging')
  .addStringOption(option =>
    option.setName('name')
      .setDescription('Custom name for the webhook (defaults to bot name)')
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

export async function executeWebhookCommand(interaction: ChatInputCommandInteraction) {
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
    
    // For webhook creation, we need to use the text channel (not thread)
    // Threads don't support webhooks directly, but we can create them on the parent channel
    const webhookTargetChannel = textChannel;

    // Log channel information for debugging
    logger.info(`Channel type: ${channel.type}, isThread: ${isThread}, channel name: ${channel.name || 'unnamed'}`);

    // Check if the bot has the required permissions
    const botMember = interaction.guild?.members.me;
    if (!botMember) {
      try {
        await interaction.editReply({ content: 'Unable to verify bot permissions. Please ensure the bot has the required permissions.' });
      } catch (error) {
        logger.warn('Failed to edit reply:', error);
      }
      return;
    }

    // Check permissions for the webhook target channel (parent text channel)
    const permissions = webhookTargetChannel.permissionsFor(botMember);
    if (!permissions) {
      try {
        await interaction.editReply({ content: 'Unable to verify permissions for this channel.' });
      } catch (error) {
        logger.warn('Failed to edit reply:', error);
      }
      return;
    }

    // Check if bot has required permissions
    const requiredPermissions = [
      PermissionsBitField.Flags.ManageWebhooks,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory
    ];

    const missingPermissions = requiredPermissions.filter(permission => !permissions.has(permission));
    if (missingPermissions.length > 0) {
      const permissionNames = missingPermissions.map(p => {
        switch (p) {
          case PermissionsBitField.Flags.ManageWebhooks: return 'Manage Webhooks';
          case PermissionsBitField.Flags.SendMessages: return 'Send Messages';
          case PermissionsBitField.Flags.ReadMessageHistory: return 'Read Message History';
          default: return 'Unknown Permission';
        }
      }).join(', ');

      try {
        await interaction.editReply({ 
          content: `Missing required permissions in this channel: ${permissionNames}. Please ensure the bot has these permissions.` 
        });
      } catch (error) {
        logger.warn('Failed to edit reply:', error);
      }
      return;
    }

    // Additional check for thread-specific permissions
    if (isThread) {
      const threadChannel = channel as ThreadChannel;
      
      // Check if thread is archived
      if (threadChannel.archived) {
        try {
          await interaction.editReply({ 
            content: 'This thread is archived. Please unarchive it first or use the command in an active thread.' 
          });
        } catch (error) {
          logger.warn('Failed to edit reply:', error);
        }
        return;
      }

      // Check if thread is locked
      if (threadChannel.locked) {
        try {
          await interaction.editReply({ 
            content: 'This thread is locked. Please unlock it first or use the command in an unlocked thread.' 
          });
        } catch (error) {
          logger.warn('Failed to edit reply:', error);
        }
        return;
      }

      // Check if bot can send messages in this specific thread
      const threadPermissions = threadChannel.permissionsFor(botMember);
      if (!threadPermissions?.has(PermissionsBitField.Flags.SendMessages)) {
        try {
          await interaction.editReply({ 
            content: 'The bot does not have permission to send messages in this thread. Please check the thread permissions.' 
          });
        } catch (error) {
          logger.warn('Failed to edit reply:', error);
        }
        return;
      }
    }

    const customName = interaction.options.getString('name');
    const webhookName = customName || interaction.client.user?.username || 'Bot Webhook';

    logger.info(`Webhook command executed for channel: ${channel.name || 'unnamed'}, webhook name: ${webhookName}`);

    // Update the deferred reply to show progress
    try {
      await interaction.editReply({ content: 'Creating webhook...' });
    } catch (error) {
      logger.warn('Failed to update progress:', error);
    }

    try {
      // Create the webhook on the parent text channel
      const webhook = await webhookTargetChannel.createWebhook({
        name: webhookName,
        avatar: interaction.client.user?.avatarURL() || undefined,
        reason: `Webhook created by ${interaction.user.tag} via /webhook command`
      });

      // Get the webhook URL
      const webhookUrl = `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}`;

      // Send success message with webhook URL and usage instructions
      const successMessage = `✅ **Webhook created successfully!**

**Webhook URL:**
\`\`\`
${webhookUrl}
\`\`\`

**Usage Instructions:**
• Use this URL to send messages to this ${isThread ? 'thread' : 'channel'} from external applications
• Send a POST request to the URL with JSON body: \`{"content": "Your message here"}\`
• The webhook will appear as "${webhookName}" when sending messages
• Keep this URL private - anyone with it can send messages to this ${isThread ? 'thread' : 'channel'}

**Channel:** ${webhookTargetChannel.name || 'unnamed'}${isThread ? ` (webhook will post to parent channel, not this thread)` : ''}
**Created by:** ${interaction.user.tag}`;

      try {
        await interaction.editReply({ content: successMessage });
      } catch (error) {
        logger.warn('Failed to send success message:', error);
      }

      logger.info(`Webhook created successfully: ${webhookName} (ID: ${webhook.id}) in channel ${webhookTargetChannel.name || 'unnamed'}`);

    } catch (webhookError) {
      logger.error('Error creating webhook:', webhookError);
      
      try {
        await interaction.editReply({ 
          content: 'Failed to create webhook. Please ensure the bot has the "Manage Webhooks" permission and try again.' 
        });
      } catch (error) {
        logger.warn('Failed to edit reply:', error);
      }
    }

  } catch (error) {
    logger.error('Error executing webhook command:', error);
    
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
        await interaction.editReply({ content: 'An error occurred while creating the webhook. Please try again later.' });
      } catch (editError) {
        logger.warn('Failed to edit reply:', editError);
      }
    }
  }
}
