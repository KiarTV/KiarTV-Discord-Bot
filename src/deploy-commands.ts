import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { cavesCommand } from './commands/caves';
import { updateCommand } from './commands/update';
import { webhookCommand } from './commands/webhook';
import { sendCommand } from './commands/send';
import { logger } from './utils/logger';
import { populateThreadCommand } from './commands/populateThread';

config();

const commands = [
  cavesCommand.toJSON(),
  updateCommand.toJSON(),
  populateThreadCommand.toJSON(),
  webhookCommand.toJSON(),
  sendCommand.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

export async function deployCommands() {
  try {
    logger.info('Started refreshing application (/) commands.');

    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.DISCORD_GUILD_ID;
    const argv = process.argv.slice(2);
    const scopeFromEnv = (process.env.DEPLOY_SCOPE || '').toLowerCase();
    const forceGlobal = argv.includes('--global') || scopeFromEnv === 'global';
    const forceGuild = argv.includes('--guild') || scopeFromEnv === 'guild';

    if (!clientId) {
      throw new Error('DISCORD_CLIENT_ID is not set');
    }

    // Decide deployment scope:
    // Priority: CLI flag > DEPLOY_SCOPE env > legacy behavior (guild if guildId present else global)
    const shouldDeployToGuild = forceGuild || (!forceGlobal && !!guildId);

    if (shouldDeployToGuild) {
      // Deploy to specific guild (faster for development)
      if (!guildId) {
        throw new Error('Cannot deploy to guild: DISCORD_GUILD_ID is not set');
      }
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands },
      );
      logger.info(`Successfully reloaded application (/) commands for guild ${guildId}.`);
    } else {
      // Deploy globally (takes up to an hour to propagate)
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands },
      );
      logger.info('Successfully reloaded application (/) commands globally.');
    }
  } catch (error) {
    logger.error('Error deploying commands:', error);
  }
} 