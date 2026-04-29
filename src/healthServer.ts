import http from 'http';
import type { Client } from 'discord.js';
import { logger } from './utils/logger';
import { testConnection } from './services/apiService';

const PORT = Number(process.env.BOT_HEALTH_PORT) || 3589;
const SECRET = process.env.BOT_HEALTH_SECRET?.trim();
const SKIP_AUTH = process.env.BOT_HEALTH_SKIP_AUTH === 'true';

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

export function startHealthServer(client: Client): http.Server {
  const server = http.createServer(async (req, res) => {
    const path = req.url?.split('?')[0] ?? '';
    if (req.method !== 'GET' || path !== '/health') {
      res.statusCode = 404;
      res.end();
      return;
    }

    if (!SKIP_AUTH) {
      if (!SECRET) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'BOT_HEALTH_SECRET is not configured' }));
        return;
      }
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${SECRET}`) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    const ready = client.isReady();
    let discordPingMs = -1;
    try {
      discordPingMs = ready ? client.ws.ping : -1;
    } catch {
      discordPingMs = -1;
    }

    let apiConnected = false;
    try {
      apiConnected = await testConnection();
    } catch {
      apiConnected = false;
    }

    const uptimeMs =
      ready && client.readyAt
        ? Date.now() - client.readyAt.getTime()
        : Math.floor(process.uptime() * 1000);

    const payload: HealthPayload = {
      isOnline: ready,
      uptime: uptimeMs,
      guildCount: ready ? client.guilds.cache.size : 0,
      lastPing: discordPingMs >= 0 ? discordPingMs : 0,
      apiConnected,
    };

    if (discordPingMs >= 0) {
      payload.discordPingMs = discordPingMs;
    }

    if (client.user) {
      payload.botTag = client.user.tag;
      payload.botUserId = client.user.id;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`Health HTTP listening on 0.0.0.0:${PORT}`);
  });

  server.on('error', (err) => {
    logger.error('Health HTTP server error:', err);
  });

  return server;
}
