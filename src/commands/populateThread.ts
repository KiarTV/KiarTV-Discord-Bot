import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { VALID_SERVERS } from '../constants';
import { populateForum, ForumPopulationError } from '../services/forumPopulation';
import { getPortalForumBinding, upsertForumBinding } from '../services/portalSync';
import { requireAdmin, withTimeout } from '../utils/commandUtils';
import { logger } from '../utils/logger';

export const populateThreadCommand = new SlashCommandBuilder()
  .setName('populatethread')
  .setDescription('Refresh every map post in the connected cave forum')
  .addStringOption(option =>
    option
      .setName('server')
      .setDescription('The server name (INX, Fusion, Mesa)')
      .setRequired(true)
      .addChoices(
        { name: 'INX', value: 'INX' },
        { name: 'Fusion', value: 'Fusion' },
        { name: 'Mesa', value: 'Mesa' },
      ),
  )
  .addStringOption(option =>
    option
      .setName('forum_id')
      .setDescription('Optional fallback; normal forum management happens in the portal')
      .setRequired(false),
  );

export async function executePopulateThreadCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    if (!await requireAdmin(interaction)) return;

    try {
      await withTimeout(
        interaction.deferReply({ flags: MessageFlags.Ephemeral }),
        2_000,
      );
    } catch (error) {
      logger.warn('Failed to defer populate reply:', error);
    }

    const server = interaction.options.getString('server', true);
    if (!VALID_SERVERS.includes(server as (typeof VALID_SERVERS)[number])) {
      await interaction.editReply({
        content: `Invalid server. Allowed: ${VALID_SERVERS.join(', ')}`,
      });
      return;
    }

    const explicitForumId = interaction.options.getString('forum_id', false);
    const savedForum = interaction.guildId
      ? await getPortalForumBinding(interaction.guildId)
      : null;
    const forumId = explicitForumId ?? savedForum?.channelId ?? null;

    if (!interaction.guildId || !forumId) {
      await interaction.editReply({
        content: 'No cave forum is connected. Connect one from the portal first.',
      });
      return;
    }

    await interaction.editReply({
      content: 'Refreshing the portal-managed map posts…',
    });

    const result = await populateForum({
      client: interaction.client,
      guildId: interaction.guildId,
      forumId,
      server,
    });

    if (explicitForumId) {
      await upsertForumBinding(
        interaction.guildId,
        result.forumId,
        result.forumName,
        server,
      );
    }

    const warningText = result.warnings.length
      ? ` ${result.warnings.length} non-blocking warning${result.warnings.length === 1 ? '' : 's'} occurred.`
      : '';
    await interaction.editReply({
      content:
        `Created ${result.mapsCreated} map posts with ` +
        `${result.messagesCreated} messages for **${server}**.${warningText}`,
    });
  } catch (error) {
    logger.error('Error executing populatethread command:', error);
    const message =
      error instanceof ForumPopulationError
        ? error.message
        : 'The forum could not be refreshed. Try again from the portal.';

    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral,
        });
      } catch {
        // Interaction already expired.
      }
    } else if (interaction.deferred) {
      try {
        await interaction.editReply({ content: message });
      } catch {
        // Interaction already expired.
      }
    }
  }
}
