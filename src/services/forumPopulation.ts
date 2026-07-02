import {
  AttachmentBuilder,
  ChannelFlagsBitField,
  ChannelType,
  Client,
  ForumChannel,
  PermissionsBitField,
  ThreadChannel,
} from 'discord.js';
import { VALID_MAPS, VALID_SERVERS, MAX_MESSAGES, MAX_VIDEO_BYTES } from '../constants';
import { fetchPortalSpots } from './apiService';
import { upsertChannelConfig } from './channelStore';
import {
  formatCaveText,
  isSupabasePublicUrl,
  isVideoFile,
} from '../utils/commandUtils';
import { logger } from '../utils/logger';
import type { Spot } from '../types';

const activePopulations = new Set<string>();
const DISCORD_CONTENT_LIMIT = 2_000;
const VIDEO_FETCH_TIMEOUT_MS = 15_000;

type PopulationInput = {
  client: Client;
  guildId: string;
  forumId: string;
  previousForumId?: string;
  server: string;
};

export type ForumPopulationResult = {
  forumId: string;
  forumName: string;
  mapsCreated: number;
  messagesCreated: number;
  oldPostsRemoved: number;
  warnings: string[];
};

export class ForumPopulationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'BUSY'
      | 'INVALID_SERVER'
      | 'BOT_NOT_READY'
      | 'GUILD_NOT_FOUND'
      | 'FORUM_NOT_FOUND'
      | 'FORUM_WRONG_GUILD'
      | 'MISSING_PERMISSIONS'
      | 'NO_LOCATIONS'
      | 'SYNC_FAILED',
  ) {
    super(message);
    this.name = 'ForumPopulationError';
  }
}

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fitDiscordContent(content: string): string {
  if (content.length <= DISCORD_CONTENT_LIMIT) return content;
  return `${content.slice(0, DISCORD_CONTENT_LIMIT - 1)}…`;
}

async function sendText(thread: ThreadChannel, content: string): Promise<void> {
  await thread.send({
    content: fitDiscordContent(content),
    allowedMentions: { parse: [] },
  });
}

function sortSpots(spots: Spot[]): Spot[] {
  return [...spots].sort((a, b) => {
    if (a.type === 'farm' && b.type !== 'farm') return 1;
    if (a.type !== 'farm' && b.type === 'farm') return -1;
    if (a.type === b.type) return (a.name || '').localeCompare(b.name || '');
    return (a.type || '').localeCompare(b.type || '');
  });
}

async function sendSpot(
  thread: ThreadChannel,
  spot: Spot,
  index: number,
  warnings: string[],
): Promise<number> {
  const formatted = fitDiscordContent(formatCaveText(spot, index));
  const canAttachVideo =
    typeof spot.videoFile === 'string' &&
    isVideoFile(spot.videoFile) &&
    isSupabasePublicUrl(spot.videoFile);

  if (!canAttachVideo) {
    const hasExternalVideoLink =
      typeof spot.videoUrl === 'string' &&
      spot.videoUrl.length > 0 &&
      !isSupabasePublicUrl(spot.videoUrl);
    await sendText(
      thread,
      hasExternalVideoLink ? formatted : `${formatted}\n--------------------------------`,
    );
    return 1;
  }

  try {
    const response = await fetch(spot.videoFile!, {
      signal: AbortSignal.timeout(VIDEO_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Video request returned ${response.status}`);

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_VIDEO_BYTES) {
      warnings.push(`Skipped oversized video for ${spot.name || 'an unnamed location'}.`);
      await sendText(thread, `${formatted}\n[Video file too large to attach]\n--------------------------------`);
      return 1;
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_VIDEO_BYTES) {
      warnings.push(`Skipped oversized video for ${spot.name || 'an unnamed location'}.`);
      await sendText(thread, `${formatted}\n[Video file too large to attach]\n--------------------------------`);
      return 1;
    }

    const pathname = new URL(spot.videoFile!).pathname;
    const rawFilename = pathname.split('/').pop() || 'video.mp4';
    const filename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const attachment = new AttachmentBuilder(Buffer.from(bytes), { name: filename });
    await thread.send({
      content: formatted,
      files: [attachment],
      allowedMentions: { parse: [] },
    });
    await sendText(thread, '--------------------------------');
    return 2;
  } catch (error) {
    logger.warn(`Failed to attach video for ${spot.name || 'unnamed location'}:`, error);
    warnings.push(`A video could not be attached for ${spot.name || 'an unnamed location'}.`);
    await sendText(thread, `${formatted}\n[Video attachment unavailable]\n--------------------------------`);
    return 1;
  }
}

async function createMapPost(
  forum: ForumChannel,
  server: string,
  map: string,
  spots: Spot[],
  warnings: string[],
): Promise<{ thread: ThreadChannel; messageCount: number }> {
  const requiresTag = forum.flags.has(ChannelFlagsBitField.Flags.RequireTag);
  const requiredTag = requiresTag ? forum.availableTags[0] : null;
  if (requiresTag && !requiredTag) {
    throw new Error('This forum requires a tag but has no available tags.');
  }
  if (requiredTag) {
    const warning = `Discord requires a tag, so "${requiredTag.name}" was applied to every map post.`;
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  const thread = await forum.threads.create({
    name: `${server} - ${map}`,
    ...(requiredTag ? { appliedTags: [requiredTag.id] } : {}),
    message: {
      content: `${server} - ${map}`,
      allowedMentions: { parse: [] },
    },
  });

  let messageCount = 1;
  let lastType: string | null = null;
  let typeIndex = 0;

  for (const spot of sortSpots(spots)) {
    if (messageCount >= MAX_MESSAGES) {
      await sendText(thread, 'More locations are available in the portal.');
      messageCount++;
      break;
    }

    if (spot.type !== lastType) {
      await sendText(thread, `# *————— ${spot.type || 'Unknown'} —————*\n`);
      lastType = spot.type ?? null;
      typeIndex = 0;
      messageCount++;
    }

    if (messageCount >= MAX_MESSAGES) {
      await sendText(thread, 'More locations are available in the portal.');
      messageCount++;
      break;
    }

    messageCount += await sendSpot(thread, spot, typeIndex, warnings);
    typeIndex++;
  }

  return { thread, messageCount };
}

async function rollbackThreads(threads: ThreadChannel[]): Promise<void> {
  await Promise.all(
    threads.map(thread =>
      thread.delete().catch(error => {
        logger.warn(`Failed to roll back forum post ${thread.id}:`, error);
      }),
    ),
  );
}

async function getManagedThreads(
  forum: ForumChannel,
  botUserId: string | undefined,
  server: string,
): Promise<ThreadChannel[]> {
  const activeThreads = await forum.threads.fetchActive();
  const archivedThreads = await forum.threads.fetchArchived({
    type: 'public',
    fetchAll: true,
  });
  const managedNames = new Set(VALID_MAPS.map(map => `${server} - ${map}`));
  return Array.from(
    new Map([
      ...activeThreads.threads,
      ...archivedThreads.threads,
    ]).values(),
  ).filter(
    thread => thread.ownerId === botUserId && managedNames.has(thread.name),
  );
}

async function runPopulation({
  client,
  guildId,
  forumId,
  previousForumId,
  server,
}: PopulationInput): Promise<ForumPopulationResult> {
  if (!VALID_SERVERS.includes(server as (typeof VALID_SERVERS)[number])) {
    throw new ForumPopulationError(
      `Invalid server. Allowed: ${VALID_SERVERS.join(', ')}`,
      'INVALID_SERVER',
    );
  }
  if (!client.isReady()) {
    throw new ForumPopulationError('The Discord bot is still starting.', 'BOT_NOT_READY');
  }

  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    throw new ForumPopulationError('The Discord server is not available to the bot.', 'GUILD_NOT_FOUND');
  }

  const channel = await client.channels.fetch(forumId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildForum) {
    throw new ForumPopulationError(
      'The configured channel was not found or is not a Discord forum.',
      'FORUM_NOT_FOUND',
    );
  }
  const forum = channel as ForumChannel;
  if (forum.guildId !== guildId) {
    throw new ForumPopulationError(
      'The configured forum belongs to a different Discord server.',
      'FORUM_WRONG_GUILD',
    );
  }

  const botMember = guild.members.me;
  if (!botMember) {
    throw new ForumPopulationError('The bot membership could not be verified.', 'BOT_NOT_READY');
  }
  const permissions = forum.permissionsFor(botMember);
  const requiredPermissions = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.CreatePublicThreads,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.SendMessagesInThreads,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.ManageThreads,
  ];
  if (!permissions || !requiredPermissions.every(permission => permissions.has(permission))) {
    throw new ForumPopulationError(
      'The bot needs View Channel, Create Public Threads, Send Messages in Threads, Read Message History, and Manage Threads in this forum.',
      'MISSING_PERMISSIONS',
    );
  }

  const mapData: Array<{ map: string; spots: Spot[] }> = [];
  for (const map of VALID_MAPS) {
    const spots = await fetchPortalSpots(server, map);
    if (spots.length > 0) mapData.push({ map, spots });
  }
  if (mapData.length === 0) {
    throw new ForumPopulationError(
      `No portal cave locations were found for ${server}.`,
      'NO_LOCATIONS',
    );
  }

  const botUserId = client.user?.id;
  const existingManagedThreads = await getManagedThreads(forum, botUserId, server);

  const createdPosts: Array<{ thread: ThreadChannel; map: string }> = [];
  const warnings: string[] = [];
  let messagesCreated = 0;

  try {
    for (const { map, spots } of mapData) {
      const created = await createMapPost(forum, server, map, spots, warnings);
      createdPosts.push({ thread: created.thread, map });
      messagesCreated += created.messageCount;
      await pause(1_000);
    }
  } catch (error) {
    await rollbackThreads(createdPosts.map(post => post.thread));
    logger.error('Forum population failed; newly created posts were rolled back:', error);
    throw new ForumPopulationError(
      'Discord could not build every map post. Existing posts were left unchanged.',
      'SYNC_FAILED',
    );
  }

  for (const post of createdPosts) {
    await upsertChannelConfig(guildId, post.thread.id, {
      server,
      map: post.map,
    });
  }

  let oldPostsRemoved = 0;
  for (const thread of existingManagedThreads) {
    try {
      await thread.delete();
      oldPostsRemoved++;
      await pause(300);
    } catch (error) {
      logger.warn(`Failed to remove old forum post ${thread.name}:`, error);
      warnings.push(`An older ${thread.name} post could not be removed.`);
    }
  }

  if (previousForumId && previousForumId !== forumId) {
    try {
      const previousChannel = await client.channels.fetch(previousForumId);
      if (
        previousChannel?.type === ChannelType.GuildForum &&
        previousChannel.guildId === guildId
      ) {
        const previousPosts = await getManagedThreads(
          previousChannel as ForumChannel,
          botUserId,
          server,
        );
        for (const thread of previousPosts) {
          try {
            await thread.delete();
            oldPostsRemoved++;
            await pause(300);
          } catch (error) {
            logger.warn(`Failed to remove old forum post ${thread.name}:`, error);
            warnings.push(`An older ${thread.name} post could not be removed.`);
          }
        }
      } else {
        warnings.push('The previous forum could not be accessed for cleanup.');
      }
    } catch (error) {
      logger.warn(`Failed to clean previous forum ${previousForumId}:`, error);
      warnings.push('The previous forum could not be accessed for cleanup.');
    }
  }

  return {
    forumId: forum.id,
    forumName: forum.name,
    mapsCreated: createdPosts.length,
    messagesCreated,
    oldPostsRemoved,
    warnings,
  };
}

export async function populateForum(input: PopulationInput): Promise<ForumPopulationResult> {
  const key = `${input.guildId}:${input.forumId}:${input.server}`;
  if (activePopulations.has(key)) {
    throw new ForumPopulationError(
      'This forum is already being refreshed.',
      'BUSY',
    );
  }

  activePopulations.add(key);
  try {
    return await runPopulation(input);
  } finally {
    activePopulations.delete(key);
  }
}
