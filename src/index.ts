import './load-env';
import { Client, GatewayIntentBits, Events, Guild } from 'discord.js';
import { deployCommands } from './deploy-commands';
import { handleInteraction } from './handlers/interactionHandler';
import { startHealthServer } from './healthServer';
import {
  registerGuild,
  registerAllGuilds,
  syncHeartbeats,
  markGuildOffline,
  markAllOffline,
} from './services/portalSync';
import { logger } from './utils/logger';

const HEARTBEAT_INTERVAL_MS = 30_000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

startHealthServer(client);

let heartbeatTimer: NodeJS.Timeout | null = null;

client.once(Events.ClientReady, async () => {
  logger.info(`Bot is ready! Logged in as ${client.user?.tag}`);
  deployCommands().catch(err => logger.error('Failed to deploy commands:', err));

  // Mirror current state into the portal, then keep heartbeats flowing.
  await registerAllGuilds(client);
  await syncHeartbeats(client);
  heartbeatTimer = setInterval(() => {
    syncHeartbeats(client).catch(err => logger.warn('Heartbeat sync failed:', err));
  }, HEARTBEAT_INTERVAL_MS);
});

// Bot added to a new server → register it and push an immediate heartbeat so it
// shows up as online in the portal right away.
client.on(Events.GuildCreate, async (guild: Guild) => {
  logger.info(`Joined guild ${guild.name} (${guild.id})`);
  await registerGuild(guild);
  await syncHeartbeats(client);
});

// Bot removed from a server → mark it offline in the portal.
client.on(Events.GuildDelete, async (guild: Guild) => {
  logger.info(`Removed from guild ${guild.name ?? 'unknown'} (${guild.id})`);
  await markGuildOffline(guild.id);
});

client.on(Events.InteractionCreate, handleInteraction);

client.on('error', (error) => {
  logger.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection:', error);
});

let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down…`);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  try {
    await markAllOffline(client);
  } catch (err) {
    logger.warn('Failed to mark guilds offline on shutdown:', err);
  }
  try {
    await client.destroy();
  } catch { /* ignore */ }
  process.exit(0);
}

process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

const token = process.env.DISCORD_TOKEN;
if (!token) {
  logger.error('DISCORD_TOKEN is not set in environment variables');
  process.exit(1);
}

client.login(token);
