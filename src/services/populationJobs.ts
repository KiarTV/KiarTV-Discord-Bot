import { randomUUID } from 'crypto';
import type { Client } from 'discord.js';
import {
  ForumPopulationError,
  ForumPopulationResult,
  populateForum,
} from './forumPopulation';
import { logger } from '../utils/logger';

const JOB_TTL_MS = 30 * 60 * 1_000;

export type ForumPopulationJob =
  | {
      id: string;
      guildId: string;
      forumId: string;
      previousForumId?: string;
      server: string;
      status: 'running';
      startedAt: string;
    }
  | {
      id: string;
      guildId: string;
      forumId: string;
      previousForumId?: string;
      server: string;
      status: 'succeeded';
      startedAt: string;
      finishedAt: string;
      result: ForumPopulationResult;
    }
  | {
      id: string;
      guildId: string;
      forumId: string;
      previousForumId?: string;
      server: string;
      status: 'failed';
      startedAt: string;
      finishedAt: string;
      error: string;
      errorCode?: string;
    };

const jobs = new Map<string, ForumPopulationJob>();
const activeJobIds = new Map<string, string>();

function jobKey(guildId: string, forumId: string, server: string): string {
  return `${guildId}:${forumId}:${server}`;
}

function scheduleCleanup(jobId: string): void {
  const timer = setTimeout(() => {
    jobs.delete(jobId);
  }, JOB_TTL_MS);
  timer.unref();
}

export function startForumPopulationJob(
  client: Client,
  input: {
    guildId: string;
    forumId: string;
    previousForumId?: string;
    server: string;
  },
): ForumPopulationJob {
  const key = jobKey(input.guildId, input.forumId, input.server);
  const activeId = activeJobIds.get(key);
  if (activeId) {
    const active = jobs.get(activeId);
    if (active?.status === 'running') return active;
    activeJobIds.delete(key);
  }

  const job: ForumPopulationJob = {
    id: randomUUID(),
    ...input,
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  activeJobIds.set(key, job.id);

  void populateForum({ client, ...input })
    .then(result => {
      jobs.set(job.id, {
        ...job,
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        result,
      });
      logger.info(
        `Portal forum refresh ${job.id} created ${result.mapsCreated} map posts in ${input.guildId}.`,
      );
    })
    .catch(error => {
      const message =
        error instanceof ForumPopulationError
          ? error.message
          : 'The forum refresh failed unexpectedly.';
      jobs.set(job.id, {
        ...job,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: message,
        ...(error instanceof ForumPopulationError ? { errorCode: error.code } : {}),
      });
      if (error instanceof ForumPopulationError) {
        logger.warn(`Portal forum refresh ${job.id} failed (${error.code}): ${error.message}`);
      } else {
        logger.error(`Portal forum refresh ${job.id} failed unexpectedly:`, error);
      }
    })
    .finally(() => {
      activeJobIds.delete(key);
      scheduleCleanup(job.id);
    });

  return job;
}

export function getForumPopulationJob(jobId: string): ForumPopulationJob | null {
  return jobs.get(jobId) ?? null;
}
