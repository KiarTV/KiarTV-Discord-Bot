import type { Client, Guild } from 'discord.js';
import { getSupabase } from './supabase';
import { testConnection } from './apiService';
import { logger } from '../utils/logger';

/**
 * Mirrors the bot's live state into the Supabase tables the web portal reads:
 *   - guilds                  → which servers the bot is in (name + icon)
 *   - bot_heartbeats          → per-guild online status / ping / api health
 *   - guild_channel_bindings  → channel → server/map bindings
 *
 * Every function is a no-op when Supabase is not configured, and never throws —
 * portal sync must never take the bot down.
 */

const API_CACHE_TTL_MS = 20_000;
export const PORTAL_FORUM_MAP = 'ALL';
let apiCache = { value: false, ts: 0 };

async function isApiConnected(): Promise<boolean> {
  if (Date.now() - apiCache.ts <= API_CACHE_TTL_MS) return apiCache.value;
  try {
    apiCache = { value: await testConnection(), ts: Date.now() };
  } catch {
    apiCache = { value: false, ts: Date.now() };
  }
  return apiCache.value;
}

/** Upsert a single guild's identity row. Called on ready and on guildCreate. */
export async function registerGuild(guild: Guild): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('guilds')
      .upsert(
        {
          discord_guild_id: guild.id,
          discord_guild_name: guild.name,
          discord_guild_icon: guild.icon,
        },
        { onConflict: 'discord_guild_id' },
      );
    if (error) logger.warn(`registerGuild failed for ${guild.id}:`, error.message);
  } catch (err) {
    logger.warn('registerGuild threw:', err);
  }
}

/** Register every guild the bot is currently in. */
export async function registerAllGuilds(client: Client): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await Promise.all(client.guilds.cache.map((g) => registerGuild(g)));
}

/** Write a fresh heartbeat row for every guild the bot is in. */
export async function syncHeartbeats(client: Client): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  if (!client.isReady()) return;

  const apiConnected = await isApiConnected();
  let pingMs: number | null = null;
  try {
    pingMs = client.ws.ping >= 0 ? Math.round(client.ws.ping) : null;
  } catch {
    pingMs = null;
  }

  const now = new Date().toISOString();
  const rows = client.guilds.cache.map((g) => ({
    discord_guild_id: g.id,
    is_online: true,
    last_seen_at: now,
    discord_ping_ms: pingMs,
    api_connected: apiConnected,
    bot_tag: client.user?.tag ?? null,
    updated_at: now,
  }));

  if (rows.length === 0) return;

  try {
    const { error } = await supabase
      .from('bot_heartbeats')
      .upsert(rows, { onConflict: 'discord_guild_id' });
    if (error) logger.warn('syncHeartbeats failed:', error.message);
  } catch (err) {
    logger.warn('syncHeartbeats threw:', err);
  }
}

/** Flip a single guild offline (e.g. the bot was kicked). */
export async function markGuildOffline(guildId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase
      .from('bot_heartbeats')
      .update({ is_online: false, updated_at: new Date().toISOString() })
      .eq('discord_guild_id', guildId);
  } catch (err) {
    logger.warn('markGuildOffline threw:', err);
  }
}

/** Flip every guild offline. Called on graceful shutdown. */
export async function markAllOffline(client: Client): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const ids = client.guilds.cache.map((g) => g.id);
  if (ids.length === 0) return;
  try {
    await supabase
      .from('bot_heartbeats')
      .update({ is_online: false, updated_at: new Date().toISOString() })
      .in('discord_guild_id', ids);
  } catch (err) {
    logger.warn('markAllOffline threw:', err);
  }
}

/** Mirror a /caves channel binding into the portal. */
export async function upsertBinding(
  guildId: string,
  channelId: string,
  channelName: string | null,
  server: string,
  map: string,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('guild_channel_bindings')
      .upsert(
        {
          discord_guild_id: guildId,
          channel_id: channelId,
          channel_name: channelName,
          server,
          map,
        },
        { onConflict: 'discord_guild_id,channel_id' },
      );
    if (error) logger.warn('upsertBinding failed:', error.message);
  } catch (err) {
    logger.warn('upsertBinding threw:', err);
  }
}

/** Store one authoritative cave forum for the guild and remove legacy channel rows. */
export async function upsertForumBinding(
  guildId: string,
  forumId: string,
  forumName: string | null,
  server: string,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('guild_channel_bindings')
      .upsert(
        {
          discord_guild_id: guildId,
          channel_id: forumId,
          channel_name: forumName,
          server,
          map: PORTAL_FORUM_MAP,
        },
        { onConflict: 'discord_guild_id,channel_id' },
      )
      .select('id')
      .single();
    if (error || !data) {
      logger.warn('upsertForumBinding failed:', error?.message ?? 'No row returned');
      return;
    }

    const { error: cleanupError } = await supabase
      .from('guild_channel_bindings')
      .delete()
      .eq('discord_guild_id', guildId)
      .neq('id', data.id);
    if (cleanupError) {
      logger.warn('upsertForumBinding legacy cleanup failed:', cleanupError.message);
    }
  } catch (err) {
    logger.warn('upsertForumBinding threw:', err);
  }
}

/** Remove a channel binding from the portal. */
export async function removeBinding(guildId: string, channelId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase
      .from('guild_channel_bindings')
      .delete()
      .eq('discord_guild_id', guildId)
      .eq('channel_id', channelId);
  } catch (err) {
    logger.warn('removeBinding threw:', err);
  }
}

export interface PortalForumBinding {
  channelId: string;
  channelName: string | null;
  server: string;
}

/** Read the single portal-managed cave forum for a guild. */
export async function getPortalForumBinding(
  guildId: string,
): Promise<PortalForumBinding | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('guild_channel_bindings')
      .select('channel_id, channel_name, server')
      .eq('discord_guild_id', guildId)
      .eq('map', PORTAL_FORUM_MAP)
      .limit(1);
    if (error) {
      logger.warn('getPortalForumBinding failed:', error.message);
      return null;
    }
    const binding = data?.[0];
    return binding
      ? {
          channelId: binding.channel_id as string,
          channelName: (binding.channel_name as string | null) ?? null,
          server: binding.server as string,
        }
      : null;
  } catch (err) {
    logger.warn('getPortalForumBinding threw:', err);
    return null;
  }
}

export interface PortalBinding {
  channelId: string;
  server: string;
  map: string;
}

/** Read all portal-managed bindings for a guild (used by /update all). */
export async function getPortalBindings(guildId: string): Promise<PortalBinding[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('guild_channel_bindings')
      .select('channel_id, server, map')
      .eq('discord_guild_id', guildId);
    if (error) {
      logger.warn('getPortalBindings failed:', error.message);
      return null;
    }
    return (data ?? [])
      .filter((b) => b.map !== PORTAL_FORUM_MAP)
      .map((b) => ({
        channelId: b.channel_id as string,
        server: b.server as string,
        map: b.map as string,
      }));
  } catch (err) {
    logger.warn('getPortalBindings threw:', err);
    return null;
  }
}
