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

/** Match the focused INX portal dataset: modded locations plus the named INX bunker. */
export function isPortalLocation(spot: Spot): boolean {
  const type = spot.type?.trim().toLowerCase() ?? '';
  const category = spot.category?.trim().toLowerCase() ?? '';
  const name = spot.name?.trim().toLowerCase() ?? '';
  const isInxBunker = type === 'bp caves' && name.includes('inx-bunker');

  return isInxBunker || (category === 'modded' && type !== 'bp caves' && type !== '4x notes');
}

export async function fetchPortalSpots(server: string, map: string): Promise<Spot[]> {
  const spots = await fetchSpots(server, map);
  return spots.filter(isPortalLocation);
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
