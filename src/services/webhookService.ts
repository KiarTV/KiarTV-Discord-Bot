import { logger } from '../utils/logger';

const DISCORD_WEBHOOK_RE = /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\//;

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
}

export interface WebhookMessage {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
  tts?: boolean;
}

interface WebhookPayload {
  content?: string;
  username?: string;
  avatar_url?: string;
  tts?: boolean;
  embeds?: DiscordEmbed[];
}

export interface WebhookSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendWebhookMessage(
  webhookUrl: string,
  message: WebhookMessage,
): Promise<WebhookSendResult> {
  try {
    if (!DISCORD_WEBHOOK_RE.test(webhookUrl)) {
      return { success: false, error: 'Invalid webhook URL format' };
    }

    const payload: WebhookPayload = {
      content: message.content,
      username: message.username,
      avatar_url: message.avatar_url,
      tts: message.tts ?? false,
    };

    if (message.embeds && message.embeds.length > 0) {
      payload.embeds = message.embeds;
    }

    (Object.keys(payload) as (keyof WebhookPayload)[]).forEach(key => {
      if (payload[key] === undefined) delete payload[key];
    });

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Webhook send failed: ${response.status} ${response.statusText} - ${errorText}`);
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const responseData = await response.json() as { id?: string };
    logger.info(`Webhook message sent successfully: ${responseData.id}`);
    return { success: true, messageId: responseData.id };

  } catch (error) {
    logger.error('Error sending webhook message:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function sendSimpleWebhookMessage(
  webhookUrl: string,
  content: string,
  username?: string,
  avatarUrl?: string,
): Promise<WebhookSendResult> {
  return sendWebhookMessage(webhookUrl, { content, username, avatar_url: avatarUrl });
}

export async function sendEmbedWebhookMessage(
  webhookUrl: string,
  embed: DiscordEmbed,
  content?: string,
  username?: string,
  avatarUrl?: string,
): Promise<WebhookSendResult> {
  return sendWebhookMessage(webhookUrl, { content, username, avatar_url: avatarUrl, embeds: [embed] });
}

/** Validates a webhook URL is accessible without posting a visible message. */
export async function testWebhookUrl(webhookUrl: string): Promise<boolean> {
  try {
    if (!DISCORD_WEBHOOK_RE.test(webhookUrl)) return false;
    const response = await fetch(webhookUrl, { method: 'GET' });
    return response.ok;
  } catch (error) {
    logger.error('Webhook test failed:', error);
    return false;
  }
}
