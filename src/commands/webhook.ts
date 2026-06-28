import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  ThreadChannel,
  PermissionsBitField,
  MessageFlags,
  ChannelType,
} from 'discord.js';
import { logger } from '../utils/logger';
import { withTimeout, requireAdmin } from '../utils/commandUtils';

export const webhookCommand = new SlashCommandBuilder()
  .setName('webhook')
  .setDescription('Create a webhook in this channel for external messaging')
  .addStringOption(option =>
    option.setName('name')
      .setDescription('Custom name for the webhook (defaults to bot name)')
      .setRequired(false)
  );

export async function executeWebhookCommand(interaction: ChatInputCommandInteraction) {
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

    const channel = interaction.channel;
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.PublicThread)) {
      await interaction.editReply({ content: 'This command can only be used in text channels or threads.' });
      return;
    }

    const isThread = channel.type === ChannelType.PublicThread;
    const textChannel = isThread
      ? (channel as ThreadChannel).parent as TextChannel
      : channel as TextChannel;
    const webhookTargetChannel = textChannel;

    logger.info(`Channel type: ${channel.type}, isThread: ${isThread}, channel name: ${channel.name || 'unnamed'}`);

    const botMember = interaction.guild?.members.me;
    if (!botMember) {
      await interaction.editReply({ content: 'Unable to verify bot permissions. Please ensure the bot has the required permissions.' });
      return;
    }

    const permissions = webhookTargetChannel.permissionsFor(botMember);
    if (!permissions) {
      await interaction.editReply({ content: 'Unable to verify permissions for this channel.' });
      return;
    }

    const requiredPermissions = [
      PermissionsBitField.Flags.ManageWebhooks,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
    ];
    const missingPermissions = requiredPermissions.filter(p => !permissions.has(p));
    if (missingPermissions.length > 0) {
      const names = missingPermissions.map(p => {
        switch (p) {
          case PermissionsBitField.Flags.ManageWebhooks: return 'Manage Webhooks';
          case PermissionsBitField.Flags.SendMessages: return 'Send Messages';
          case PermissionsBitField.Flags.ReadMessageHistory: return 'Read Message History';
          default: return 'Unknown Permission';
        }
      }).join(', ');
      await interaction.editReply({
        content: `Missing required permissions in this channel: ${names}. Please ensure the bot has these permissions.`,
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

    const customName = interaction.options.getString('name');
    const webhookName = customName || interaction.client.user?.username || 'Bot Webhook';

    logger.info(`Webhook command executed for channel: ${channel.name || 'unnamed'}, webhook name: ${webhookName}`);

    await interaction.editReply({ content: 'Creating webhook...' });

    try {
      const webhook = await webhookTargetChannel.createWebhook({
        name: webhookName,
        avatar: interaction.client.user?.avatarURL() || undefined,
        reason: `Webhook created by ${interaction.user.tag} via /webhook command`,
      });

      const successMessage = `✅ **Webhook created successfully!**

**Webhook URL:**
\`\`\`
${webhook.url}
\`\`\`

**Usage Instructions:**
• Use this URL to send messages to this ${isThread ? 'thread' : 'channel'} from external applications
• Send a POST request to the URL with JSON body: \`{"content": "Your message here"}\`
• The webhook will appear as "${webhookName}" when sending messages
• Keep this URL private - anyone with it can send messages to this ${isThread ? 'thread' : 'channel'}

**Channel:** ${webhookTargetChannel.name || 'unnamed'}${isThread ? ` (webhook will post to parent channel, not this thread)` : ''}
**Created by:** ${interaction.user.tag}`;

      await interaction.editReply({ content: successMessage });
      logger.info(`Webhook created successfully: ${webhookName} (ID: ${webhook.id}) in channel ${webhookTargetChannel.name || 'unnamed'}`);

    } catch (webhookError) {
      logger.error('Error creating webhook:', webhookError);
      await interaction.editReply({
        content: 'Failed to create webhook. Please ensure the bot has the "Manage Webhooks" permission and try again.',
      });
    }

  } catch (error) {
    logger.error('Error executing webhook command:', error);
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
        await interaction.editReply({ content: 'An error occurred while creating the webhook. Please try again later.' });
      } catch (editError) {
        logger.warn('Failed to edit reply:', editError);
      }
    }
  }
}
