import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { cavesCommand } from './commands/caves';
import { updateCommand } from './commands/update';
import { logger } from './utils/logger';

config();

const commands = [
  cavesCommand.toJSON(),
  updateCommand.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

export async function deployCommands() {
  try {
    logger.info('Started refreshing application (/) commands.');

    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.DISCORD_GUILD_ID;

    if (!clientId) {
      throw new Error('DISCORD_CLIENT_ID is not set');
    }

    if (guildId) {
      // Deploy to specific guild (faster for development)
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