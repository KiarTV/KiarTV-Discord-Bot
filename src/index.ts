import './load-env';
import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import { deployCommands } from './deploy-commands';
import { handleInteraction } from './handlers/interactionHandler';
import { logger } from './utils/logger';

// Extend the Client type to include commands
declare module 'discord.js' {
  export interface Client {
    commands: Collection<string, any>;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Command collection
client.commands = new Collection();

// Bot ready event
client.once(Events.ClientReady, () => {
  logger.info(`Bot is ready! Logged in as ${client.user?.tag}`);
  
  // Deploy commands
  deployCommands().catch(console.error);
});

// Interaction handler
client.on(Events.InteractionCreate, handleInteraction);

// Error handling
client.on('error', (error) => {
  logger.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection:', error);
});

// Login
const token = process.env.DISCORD_TOKEN;
if (!token) {
  logger.error('DISCORD_TOKEN is not set in environment variables');
  process.exit(1);
}

client.login(token); 