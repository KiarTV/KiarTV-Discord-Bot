import { logger } from '../utils/logger';
import type { Spot } from '../types';

export type { Spot };

function getApiBaseUrl(): string {
  const url = process.env.API_BASE_URL;
  if (!url) throw new Error('API_BASE_URL environment variable is not set.');
  return url;
}

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

function apiHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(process.env.API_KEY && { Authorization: `Bearer ${process.env.API_KEY}` }),
  };
}

export async function fetchSpots(server: string, map: string, category?: string): Promise<Spot[]> {
  try {
    const params = new URLSearchParams({ map, server });
    if (category) params.append('category', category);

    const url = `${getApiBaseUrl()}/spots?${params.toString()}`;
    logger.info(`Fetching spots for server=${server} map=${map}`);

    const response = await fetchWithTimeout(url, { method: 'GET', headers: apiHeaders() });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const spots = await response.json() as Spot[];
    logger.info(`Fetched ${spots.length} spots for server: ${server}, map: ${map}`);
    return spots;
  } catch (error) {
    logger.error('Error fetching spots:', error);
    throw error;
  }
}

interface ServerRecord {
  name: string;
  [key: string]: unknown;
}

export async function fetchServers(): Promise<ServerRecord[]> {
  try {
    const url = `${getApiBaseUrl()}/servers`;
    const response = await fetchWithTimeout(url, { method: 'GET', headers: apiHeaders() });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json() as ServerRecord[];
  } catch (error) {
    logger.error('Error fetching servers:', error);
    throw error;
  }
}

export async function fetchModdedMapsForServer(server: string): Promise<string[]> {
  try {
    const params = new URLSearchParams({ server, category: 'modded', distinct: 'map' });
    const url = `${getApiBaseUrl()}/spots?${params.toString()}`;
    const response = await fetchWithTimeout(url, { method: 'GET', headers: apiHeaders() });
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const maps: string[] = Array.isArray(data)
      ? data
          .map((item: unknown) =>
            typeof item === 'string' ? item : (item as Record<string, unknown>)?.map,
          )
          .filter((m): m is string => typeof m === 'string')
      : [];
    const unique = Array.from(new Set(maps));
    if (unique.length > 0) {
      logger.info(`Derived ${unique.length} modded maps from API for server ${server}`);
      return unique;
    }
  } catch (error) {
    logger.warn('fetchModdedMapsForServer failed, will fallback to default maps:', error);
  }
  return [
    'The Island', 'The Center', 'Scorched Earth', 'Ragnarok', 'Aberration', 'Extinction',
    'Valguero', 'Genesis: Part 1', 'Crystal Isles', 'Genesis: Part 2', 'Lost Island', 'Fjordur',
  ];
}

export async function testConnection(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${getApiBaseUrl()}/servers`,
      { method: 'GET', headers: apiHeaders() },
    );
    return response.ok;
  } catch (error) {
    logger.error('API connection test failed:', error);
    return false;
  }
}
