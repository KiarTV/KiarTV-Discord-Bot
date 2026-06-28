import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { cavesCommand } from './commands/caves';
import { updateCommand } from './commands/update';
import { webhookCommand } from './commands/webhook';
import { logger } from './utils/logger';
import { populateThreadCommand } from './commands/populateThread';

config();

const commands = [
  cavesCommand.toJSON(),
  updateCommand.toJSON(),
  populateThreadCommand.toJSON(),
  webhookCommand.toJSON(),
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
    // "both" = instant on the dev guild AND global for every other server.
    // Note: Discord lists guild + global commands separately, so the dev guild
    // will show each command twice until one set is cleared.
    const forceBoth = argv.includes('--both') || scopeFromEnv === 'both';

    if (!clientId) {
      throw new Error('DISCORD_CLIENT_ID is not set');
    }

    // Decide deployment scope.
    // Priority: CLI flag / DEPLOY_SCOPE > legacy behavior (guild if guildId set, else global).
    let deployGuild: boolean;
    let deployGlobal: boolean;
    if (forceBoth) {
      deployGuild = true;
      deployGlobal = true;
    } else if (forceGuild) {
      deployGuild = true;
      deployGlobal = false;
    } else if (forceGlobal) {
      deployGuild = false;
      deployGlobal = true;
    } else {
      deployGuild = !!guildId;
      deployGlobal = !guildId;
    }

    if (deployGuild) {
      // Deploy to the dev guild (instant — good for live testing).
      if (!guildId) {
        throw new Error('Cannot deploy to guild: DISCORD_GUILD_ID is not set');
      }
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands },
      );
      logger.info(`Successfully reloaded application (/) commands for guild ${guildId}.`);
    }

    if (deployGlobal) {
      // Deploy globally (takes up to an hour to propagate the first time).
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands },
      );
      logger.info('Successfully reloaded application (/) commands globally.');
    }
  } catch (error) {
    logger.error('Error deploying commands', error);
  }
} 