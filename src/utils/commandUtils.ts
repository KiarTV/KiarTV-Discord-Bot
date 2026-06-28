import { ChatInputCommandInteraction, PermissionsBitField, MessageFlags } from 'discord.js';
import { logger } from './logger';
import type { Spot } from '../types';

export function formatCaveText(spot: Spot, idx: number): string {
  const caveDamageText = spot.caveDamage?.trim();
  const showCaveDamage =
    caveDamageText &&
    caveDamageText.toLowerCase() !== 'nothing' &&
    caveDamageText !== '';

  return [
    `## ** ${idx + 1}. ${spot.name || 'Unnamed Cave'}**`,
    `- Coords: ${spot.y}, ${spot.x}`,
    showCaveDamage ? `- Cave Damage: ${caveDamageText}` : undefined,
    spot.description ? `\nDescription:\n\`\`\`\n${spot.description}\n\`\`\`\n` : undefined,
    spot.videoUrl ? `Video:\n ${spot.videoUrl}\n` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

export function isVideoFile(url: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(url);
}

export function isSupabasePublicUrl(url: string): boolean {
  try {
    const configuredBaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    if (configuredBaseUrl) {
      const configuredHost = new URL(configuredBaseUrl).hostname;
      return (
        url.includes(configuredHost) &&
        /\/storage\/v1\/object\/public\//i.test(url)
      );
    }
  } catch {}
  return /supabase\.(co|in)\/storage\/v1\/object\/public\//i.test(url);
}

export async function safeEditReply(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<boolean> {
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

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Operation timed out')), timeoutMs),
    ),
  ]);
}

/**
 * Checks admin permission and sends an ephemeral denial reply if missing.
 * Returns true when the caller should proceed, false when it should return early.
 */
export async function requireAdmin(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }
  if (!interaction.replied && !interaction.deferred) {
    try {
      await interaction.reply({
        content: 'You must be a server admin to use this command.',
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.warn('Failed to send permission error:', error);
    }
  }
  return false;
}
