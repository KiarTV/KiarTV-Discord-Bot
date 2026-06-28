/**
 * One-shot script: clears ALL globally registered slash commands for this
 * Discord application, then re-registers only the bot's current 4 commands.
 *
 * Run once: npx ts-node src/clear-global-commands.ts
 */
import './load-env';
import { REST, Routes } from 'discord.js';
import { cavesCommand } from './commands/caves';
import { updateCommand } from './commands/update';
import { webhookCommand } from './commands/webhook';
import { populateThreadCommand } from './commands/populateThread';
import { logger } from './utils/logger';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  logger.error('DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function main() {
  // Clear guild-specific commands first (removes duplicates from prior guild deploys)
  const guildId = process.env.DISCORD_GUILD_ID;
  if (guildId) {
    logger.info(`Step 1: Clearing guild commands for guild ${guildId}…`);
    await rest.put(Routes.applicationGuildCommands(clientId!, guildId), { body: [] });
    logger.info('Guild commands cleared.');
  }

  logger.info('Step 2: Clearing all globally registered commands…');
  await rest.put(Routes.applicationCommands(clientId!), { body: [] });
  logger.info('Global command list cleared.');

  const commands = [
    cavesCommand.toJSON(),
    updateCommand.toJSON(),
    populateThreadCommand.toJSON(),
    webhookCommand.toJSON(),
  ];

  logger.info(`Step 3: Re-registering ${commands.length} commands globally…`);
  await rest.put(Routes.applicationCommands(clientId!), { body: commands });
  logger.info('Done. New global commands: /caves /update /populatethread /webhook');
  logger.info('Note: global commands can take up to 1 hour to propagate across Discord.');
}

main().catch(err => {
  logger.error('clear-global-commands failed:', err);
  process.exit(1);
});
