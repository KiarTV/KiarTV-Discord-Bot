import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

let cached: SupabaseClient | null | undefined;

/**
 * Returns a service-role Supabase client for the portal database, or null when
 * the integration is not configured. The service role bypasses RLS, which is
 * what a trusted backend (this bot) needs to write guilds/heartbeats/bindings.
 *
 * Safe to call anywhere — every caller treats a null return as "portal sync
 * disabled" so the bot keeps working without Supabase configured.
 */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    logger.warn(
      'Supabase portal sync disabled (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set).',
    );
    cached = null;
    return cached;
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  logger.info('Supabase portal sync enabled.');
  return cached;
}
