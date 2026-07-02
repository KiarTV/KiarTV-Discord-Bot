import http, { IncomingMessage, ServerResponse } from 'http';
import { timingSafeEqual } from 'crypto';
import {
  ChannelType,
  PermissionsBitField,
  type Client,
  type ForumChannel,
} from 'discord.js';
import { VALID_SERVERS } from './constants';
import { testConnection } from './services/apiService';
import {
  getForumPopulationJob,
  startForumPopulationJob,
} from './services/populationJobs';
import { logger } from './utils/logger';

const PORT = Number(process.env.BOT_HEALTH_PORT) || 3589;
const HEALTH_SECRET = process.env.BOT_HEALTH_SECRET?.trim();
const PORTAL_SECRET = process.env.BOT_PORTAL_SECRET?.trim();
const SKIP_HEALTH_AUTH = process.env.BOT_HEALTH_SKIP_AUTH === 'true';
const API_CACHE_TTL_MS = 15_000;
const MAX_REQUEST_BYTES = 4_096;
const DISCORD_SNOWFLAKE = /^\d{17,20}$/;
const JOB_ID = /^[0-9a-f-]{36}$/i;
const FORUM_PERMISSION_REQUIREMENTS = [
  [PermissionsBitField.Flags.ViewChannel, 'View Channel'],
  [PermissionsBitField.Flags.CreatePublicThreads, 'Create Public Threads'],
  [PermissionsBitField.Flags.SendMessages, 'Send Messages'],
  [PermissionsBitField.Flags.SendMessagesInThreads, 'Send Messages in Threads'],
  [PermissionsBitField.Flags.ReadMessageHistory, 'Read Message History'],
  [PermissionsBitField.Flags.ManageThreads, 'Manage Threads'],
] as const;

let apiCacheResult = false;
let apiCacheTs = 0;

export type HealthPayload = {
  isOnline: boolean;
  uptime: number;
  guildCount: number;
  lastPing: number;
  apiConnected: boolean;
  discordPingMs?: number;
  botTag?: string;
  botUserId?: string;
};

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function bearerMatches(req: IncomingMessage, secret: string | undefined): boolean {
  if (!secret) return false;
  const received = req.headers.authorization ?? '';
  const expected = `Bearer ${secret}`;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

async function readJsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;

    req.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_REQUEST_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        resolve(
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null,
        );
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

async function healthPayload(client: Client): Promise<HealthPayload> {
  const ready = client.isReady();
  let discordPingMs = -1;
  try {
    discordPingMs = ready ? client.ws.ping : -1;
  } catch {
    discordPingMs = -1;
  }

  let apiConnected = false;
  try {
    if (Date.now() - apiCacheTs > API_CACHE_TTL_MS) {
      apiCacheResult = await testConnection();
      apiCacheTs = Date.now();
    }
    apiConnected = apiCacheResult;
  } catch {
    apiConnected = false;
  }

  const uptimeSec =
    ready && client.readyAt
      ? Math.floor((Date.now() - client.readyAt.getTime()) / 1_000)
      : Math.floor(process.uptime());

  return {
    isOnline: ready,
    uptime: uptimeSec,
    guildCount: ready ? client.guilds.cache.size : 0,
    lastPing: discordPingMs >= 0 ? discordPingMs : 0,
    apiConnected,
    ...(discordPingMs >= 0 ? { discordPingMs } : {}),
    ...(client.user
      ? { botTag: client.user.tag, botUserId: client.user.id }
      : {}),
  };
}

async function sendGuildForums(
  client: Client,
  guildId: string,
  res: ServerResponse,
): Promise<void> {
  if (!client.isReady()) {
    sendJson(res, 503, { error: 'The Discord bot is still starting.' });
    return;
  }

  const guild =
    client.guilds.cache.get(guildId) ??
    await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    sendJson(res, 404, { error: 'The bot is not installed in this Discord server.' });
    return;
  }

  const botMember =
    guild.members.me ??
    await guild.members.fetchMe().catch(() => null);
  if (!botMember) {
    sendJson(res, 503, { error: 'The bot permissions could not be verified.' });
    return;
  }

  const channels = await guild.channels.fetch();
  const forums = [...channels.values()]
    .filter(
      (channel): channel is ForumChannel =>
        channel !== null && channel.type === ChannelType.GuildForum,
    )
    .map(channel => {
      const permissions = channel.permissionsFor(botMember);
      const missingPermissions = FORUM_PERMISSION_REQUIREMENTS
        .filter(([permission]) => !permissions?.has(permission))
        .map(([, label]) => label);

      return {
        id: channel.id,
        name: channel.name,
        parentName: channel.parent?.name ?? null,
        canPopulate: missingPermissions.length === 0,
        missingPermissions,
      };
    })
    .sort((a, b) => {
      const categoryOrder = (a.parentName ?? '').localeCompare(b.parentName ?? '');
      return categoryOrder || a.name.localeCompare(b.name);
    });

  sendJson(res, 200, { forums });
}

export function startHealthServer(client: Client): http.Server {
  const server = http.createServer(async (req, res) => {
    const path = req.url?.split('?')[0] ?? '';

    if (req.method === 'GET' && path === '/health') {
      if (!SKIP_HEALTH_AUTH) {
        if (!HEALTH_SECRET) {
          sendJson(res, 503, { error: 'BOT_HEALTH_SECRET is not configured' });
          return;
        }
        if (!bearerMatches(req, HEALTH_SECRET)) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }
      }

      sendJson(res, 200, await healthPayload(client));
      return;
    }

    const isPopulationStart =
      req.method === 'POST' && path === '/portal/forum/populate';
    const populationJobMatch =
      req.method === 'GET'
        ? path.match(/^\/portal\/forum\/populate\/([0-9a-f-]{36})$/i)
        : null;
    const guildForumsMatch =
      req.method === 'GET'
        ? path.match(/^\/portal\/guilds\/(\d{17,20})\/forums$/)
        : null;

    if (isPopulationStart || populationJobMatch || guildForumsMatch) {
      if (!PORTAL_SECRET) {
        sendJson(res, 503, { error: 'BOT_PORTAL_SECRET is not configured' });
        return;
      }
      if (!bearerMatches(req, PORTAL_SECRET)) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      if (populationJobMatch) {
        const jobId = populationJobMatch[1];
        if (!JOB_ID.test(jobId)) {
          sendJson(res, 400, { error: 'Invalid job ID.' });
          return;
        }
        const job = getForumPopulationJob(jobId);
        if (!job) {
          sendJson(res, 404, { error: 'Refresh job not found or expired.' });
          return;
        }
        sendJson(res, 200, { job });
        return;
      }

      if (guildForumsMatch) {
        await sendGuildForums(client, guildForumsMatch[1], res);
        return;
      }

      try {
        const body = await readJsonBody(req);
        const guildId = typeof body?.guildId === 'string' ? body.guildId.trim() : '';
        const forumId = typeof body?.forumId === 'string' ? body.forumId.trim() : '';
        const previousForumId =
          typeof body?.previousForumId === 'string'
            ? body.previousForumId.trim()
            : '';
        const targetServer = typeof body?.server === 'string' ? body.server.trim() : '';

        if (
          !DISCORD_SNOWFLAKE.test(guildId) ||
          !DISCORD_SNOWFLAKE.test(forumId) ||
          (previousForumId !== '' && !DISCORD_SNOWFLAKE.test(previousForumId)) ||
          !VALID_SERVERS.includes(targetServer as (typeof VALID_SERVERS)[number])
        ) {
          sendJson(res, 400, { error: 'Valid guildId, forumId, and server are required.' });
          return;
        }

        const job = startForumPopulationJob(client, {
          guildId,
          forumId,
          ...(previousForumId && previousForumId !== forumId
            ? { previousForumId }
            : {}),
          server: targetServer,
        });
        sendJson(res, 202, { job });
      } catch (error) {
        logger.warn('Portal population request failed:', error);
        if (!res.headersSent) {
          sendJson(res, 400, { error: 'Invalid request body.' });
        }
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`Health and portal action HTTP listening on 0.0.0.0:${PORT}`);
  });

  server.on('error', err => {
    logger.error('Bot HTTP server error:', err);
  });

  return server;
}
