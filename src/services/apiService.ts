import { logger } from '../utils/logger';

const API_BASE_URL = process.env.API_BASE_URL;

export interface Spot {
  id: string;
  name: string;
  x: number;
  y: number;
  type: string;
  map: string;
  server: string;
  caveDamage: string;
  createdAt?: string;
  updatedAt?: string;
  description?: string;
  videoUrl?: string;
  videoFile?: string;
  category?: string;
}

export async function fetchSpots(server: string, map: string, category?: string): Promise<Spot[]> {
  try {
    const params = new URLSearchParams({
      map: map,
      server: server,
    });
    
    if (category) {
      params.append('category', category);
    }
    
    const url = `${API_BASE_URL}/spots?${params.toString()}`;
    
    logger.info(`Fetching spots from: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Add API key if needed
        ...(process.env.API_KEY && { 'Authorization': `Bearer ${process.env.API_KEY}` })
      }
    });

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

export async function fetchServers(): Promise<any[]> {
  try {
    const url = `${API_BASE_URL}/servers`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.API_KEY && { 'Authorization': `Bearer ${process.env.API_KEY}` })
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json() as any[];
  } catch (error) {
    logger.error('Error fetching servers:', error);
    throw error;
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/servers`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.API_KEY && { 'Authorization': `Bearer ${process.env.API_KEY}` })
      }
    });

    return response.ok;
  } catch (error) {
    logger.error('API connection test failed:', error);
    return false;
  }
} 