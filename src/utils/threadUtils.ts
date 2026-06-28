import {
  TextChannel,
  ThreadChannel,
  Message,
  ThreadAutoArchiveDuration,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { logger } from './logger';

export async function createThreadWithoutMessage(
  channel: TextChannel,
  threadName: string,
  autoArchiveDuration: ThreadAutoArchiveDuration = ThreadAutoArchiveDuration.OneHour,
): Promise<ThreadChannel | null> {
  try {
    const thread = await channel.threads.create({
      name: threadName,
      autoArchiveDuration,
      type: ChannelType.PublicThread,
      reason: 'Cave spots discussion thread',
    });
    logger.info(`Created thread without message: ${threadName} in channel: ${channel.name}`);
    return thread;
  } catch (error) {
    logger.error('Failed to create thread without message:', error);
    return null;
  }
}

export async function sendMessageToChannel(
  channel: TextChannel | ThreadChannel,
  content: string,
  files?: unknown[],
): Promise<Message | null> {
  try {
    const message = await channel.send({ content, files: files as never[] });
    logger.info(`Sent message to ${channel.type === ChannelType.PublicThread ? 'thread' : 'channel'}: ${channel.name}`);
    return message;
  } catch (error) {
    logger.error('Failed to send message to channel/thread:', error);
    return null;
  }
}

export function canCreateThreads(channel: TextChannel): boolean {
  const permissions = channel.permissionsFor(channel.guild.members.me!);
  return permissions?.has([
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.SendMessages,
  ]) ?? false;
}

export function canSendInThreads(channel: ThreadChannel): boolean {
  const permissions = channel.permissionsFor(channel.guild.members.me!);
  return permissions?.has(PermissionFlagsBits.SendMessages) ?? false;
}

export async function getOrCreateCaveThread(
  channel: TextChannel,
  server: string,
  map: string,
): Promise<ThreadChannel | null> {
  const threadName = `Cave Spots - ${server} - ${map}`;
  const existingThread = channel.threads.cache.find(
    thread => thread.name === threadName && !thread.archived,
  );
  if (existingThread) {
    logger.info(`Found existing thread: ${threadName}`);
    return existingThread;
  }
  if (!canCreateThreads(channel)) {
    logger.warn('Bot does not have permission to create threads');
    return null;
  }
  return createThreadWithoutMessage(channel, threadName);
}

export function formatThreadName(server: string, map: string, type?: string): string {
  return type ? `Cave Spots - ${server} - ${map} - ${type}` : `Cave Spots - ${server} - ${map}`;
}

export function isThread(channel: TextChannel | ThreadChannel): boolean {
  return channel.type === ChannelType.PublicThread;
}

export function getParentChannel(channel: TextChannel | ThreadChannel): TextChannel {
  return isThread(channel) ? (channel as ThreadChannel).parent as TextChannel : channel as TextChannel;
}
