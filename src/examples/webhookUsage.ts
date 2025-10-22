import { sendWebhookMessage, sendSimpleWebhookMessage, sendEmbedWebhookMessage } from '../services/webhookService';
import { logger } from '../utils/logger';

/**
 * Example usage of the webhook service
 * This file demonstrates how your bot can send messages using webhooks
 */

// Example 1: Send a simple text message
export async function sendSimpleMessage(webhookUrl: string) {
  const result = await sendSimpleWebhookMessage(
    webhookUrl,
    'Hello from the bot via webhook!',
    'Bot Webhook', // Custom username
    'https://example.com/avatar.png' // Custom avatar
  );

  if (result.success) {
    logger.info(`Message sent successfully: ${result.messageId}`);
  } else {
    logger.error(`Failed to send message: ${result.error}`);
  }
}

// Example 2: Send a message with embed
export async function sendEmbedMessage(webhookUrl: string) {
  const embed = {
    title: 'Bot Notification',
    description: 'This is a message sent by the bot using a webhook',
    color: 0x00ff00, // Green color
    fields: [
      {
        name: 'Status',
        value: 'Success',
        inline: true
      },
      {
        name: 'Time',
        value: new Date().toISOString(),
        inline: true
      }
    ],
    footer: {
      text: 'Sent via webhook'
    }
  };

  const result = await sendEmbedWebhookMessage(
    webhookUrl,
    embed,
    'Additional content here', // Optional additional content
    'Bot Webhook',
    'https://example.com/avatar.png'
  );

  if (result.success) {
    logger.info(`Embed message sent successfully: ${result.messageId}`);
  } else {
    logger.error(`Failed to send embed message: ${result.error}`);
  }
}

// Example 3: Send a complex message with multiple options
export async function sendComplexMessage(webhookUrl: string) {
  const result = await sendWebhookMessage(webhookUrl, {
    content: 'Complex webhook message',
    username: 'Custom Bot Name',
    avatar_url: 'https://example.com/custom-avatar.png',
    embeds: [
      {
        title: 'System Status',
        description: 'All systems operational',
        color: 0x00ff00,
        timestamp: new Date().toISOString()
      }
    ],
    tts: false // Text-to-speech disabled
  });

  if (result.success) {
    logger.info(`Complex message sent successfully: ${result.messageId}`);
  } else {
    logger.error(`Failed to send complex message: ${result.error}`);
  }
}

// Example 4: Send a message from your existing commands
export async function sendCavesUpdateNotification(webhookUrl: string, server: string, map: string, spotCount: number) {
  const embed = {
    title: 'Cave Spots Updated',
    description: `Updated cave spots for ${server} on ${map}`,
    color: 0x0099ff,
    fields: [
      {
        name: 'Server',
        value: server,
        inline: true
      },
      {
        name: 'Map',
        value: map,
        inline: true
      },
      {
        name: 'Spots Found',
        value: spotCount.toString(),
        inline: true
      }
    ],
    footer: {
      text: 'Automated update via webhook'
    },
    timestamp: new Date().toISOString()
  };

  const result = await sendEmbedWebhookMessage(
    webhookUrl,
    embed,
    `🔄 **Cave spots have been updated!**`,
    'Cave Bot',
    undefined // Use default avatar
  );

  return result;
}

// Example 5: Send error notifications
export async function sendErrorNotification(webhookUrl: string, error: string, context: string) {
  const embed = {
    title: 'Bot Error',
    description: 'An error occurred in the bot',
    color: 0xff0000, // Red color
    fields: [
      {
        name: 'Error',
        value: `\`\`\`${error}\`\`\``,
        inline: false
      },
      {
        name: 'Context',
        value: context,
        inline: false
      }
    ],
    footer: {
      text: 'Error notification'
    },
    timestamp: new Date().toISOString()
  };

  const result = await sendEmbedWebhookMessage(
    webhookUrl,
    embed,
    '🚨 **Bot Error Alert**',
    'Error Bot',
    undefined
  );

  return result;
}
