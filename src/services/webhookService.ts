import fetch from 'node-fetch';
import { logger } from '../utils/logger';

export interface WebhookMessage {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: any[];
  files?: any[];
  tts?: boolean;
}

export interface WebhookSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a message using a Discord webhook URL
 * @param webhookUrl - The webhook URL (https://discord.com/api/webhooks/ID/TOKEN)
 * @param message - The message content and options
 * @returns Promise<WebhookSendResult>
 */
export async function sendWebhookMessage(
  webhookUrl: string, 
  message: WebhookMessage
): Promise<WebhookSendResult> {
  try {
    // Validate webhook URL format
    if (!webhookUrl.includes('discord.com/api/webhooks/')) {
      return {
        success: false,
        error: 'Invalid webhook URL format'
      };
    }

    // Prepare the payload
    const payload: any = {
      content: message.content,
      username: message.username,
      avatar_url: message.avatar_url,
      tts: message.tts || false
    };

    // Add embeds if provided
    if (message.embeds && message.embeds.length > 0) {
      payload.embeds = message.embeds;
    }

    // Add files if provided (for file attachments)
    if (message.files && message.files.length > 0) {
      payload.files = message.files;
    }

    // Remove undefined values
    Object.keys(payload).forEach(key => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });

    // Send the webhook request
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Webhook send failed: ${response.status} ${response.statusText} - ${errorText}`);
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const responseData = await response.json();
    
    logger.info(`Webhook message sent successfully: ${responseData.id}`);
    
    return {
      success: true,
      messageId: responseData.id
    };

  } catch (error) {
    logger.error('Error sending webhook message:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Send a simple text message via webhook
 * @param webhookUrl - The webhook URL
 * @param content - The message content
 * @param username - Optional custom username
 * @param avatarUrl - Optional custom avatar URL
 */
export async function sendSimpleWebhookMessage(
  webhookUrl: string,
  content: string,
  username?: string,
  avatarUrl?: string
): Promise<WebhookSendResult> {
  return sendWebhookMessage(webhookUrl, {
    content,
    username,
    avatar_url: avatarUrl
  });
}

/**
 * Send an embed message via webhook
 * @param webhookUrl - The webhook URL
 * @param embed - The embed object
 * @param content - Optional additional content
 * @param username - Optional custom username
 * @param avatarUrl - Optional custom avatar URL
 */
export async function sendEmbedWebhookMessage(
  webhookUrl: string,
  embed: any,
  content?: string,
  username?: string,
  avatarUrl?: string
): Promise<WebhookSendResult> {
  return sendWebhookMessage(webhookUrl, {
    content,
    username,
    avatar_url: avatarUrl,
    embeds: [embed]
  });
}

/**
 * Test if a webhook URL is valid and accessible
 * @param webhookUrl - The webhook URL to test
 * @returns Promise<boolean>
 */
export async function testWebhookUrl(webhookUrl: string): Promise<boolean> {
  try {
    const result = await sendSimpleWebhookMessage(webhookUrl, 'Webhook test message');
    return result.success;
  } catch (error) {
    logger.error('Webhook test failed:', error);
    return false;
  }
}
