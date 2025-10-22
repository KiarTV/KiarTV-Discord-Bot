import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface SavedChannelConfig {
  server: string;
  map: string;
}

type GuildStore = Record<string, SavedChannelConfig>;
type Store = Record<string, GuildStore>;

const DATA_FILE = path.resolve(__dirname, '../../channel-store.json');

async function readStore(): Promise<Store> {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object') {
      return parsed as Store;
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      logger.warn('channelStore read failed, recreating file:', error);
    }
  }
  return {};
}

async function writeStore(store: Store): Promise<void> {
  try {
    const dir = path.dirname(DATA_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    logger.error('channelStore write failed:', error);
  }
}

export async function upsertChannelConfig(guildId: string, channelId: string, config: SavedChannelConfig): Promise<void> {
  const store = await readStore();
  if (!store[guildId]) store[guildId] = {};
  // Enforce uniqueness per (server,map) within the guild
  for (const [savedChannelId, savedCfg] of Object.entries(store[guildId])) {
    if (savedCfg.server === config.server && savedCfg.map === config.map && savedChannelId !== channelId) {
      delete store[guildId][savedChannelId];
    }
  }
  store[guildId][channelId] = config;
  await writeStore(store);
}

export async function getChannelConfig(guildId: string, channelId: string): Promise<SavedChannelConfig | null> {
  const store = await readStore();
  return store[guildId]?.[channelId] ?? null;
}

export async function getAllGuildChannels(guildId: string): Promise<Record<string, SavedChannelConfig>> {
  const store = await readStore();
  return store[guildId] ?? {};
}

export async function removeChannelConfig(guildId: string, channelId: string): Promise<void> {
  const store = await readStore();
  if (store[guildId] && store[guildId][channelId]) {
    delete store[guildId][channelId];
    await writeStore(store);
  }
}


