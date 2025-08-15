import { 
  TextChannel, 
  ThreadChannel, 
  Message, 
  ThreadAutoArchiveDuration,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import { logger } from './logger';

/**
 * Creates a new thread in a channel
 */
export async function createThread(
  channel: TextChannel,
  message: Message,
  threadName: string,
  autoArchiveDuration: ThreadAutoArchiveDuration = ThreadAutoArchiveDuration.OneHour
): Promise<ThreadChannel | null> {
  try {
    const thread = await message.startThread({
      name: threadName,
      autoArchiveDuration,
      reason: 'Cave spots discussion thread'
    });
    
    logger.info(`Created thread: ${threadName} in channel: ${channel.name}`);
    return thread;
  } catch (error) {
    logger.error('Failed to create thread:', error);
    return null;
  }
}

/**
 * Creates a new thread without requiring a message (Discord.js v14+)
 */
export async function createThreadWithoutMessage(
  channel: TextChannel,
  threadName: string,
  autoArchiveDuration: ThreadAutoArchiveDuration = ThreadAutoArchiveDuration.OneHour
): Promise<ThreadChannel | null> {
  try {
    const thread = await channel.threads.create({
      name: threadName,
      autoArchiveDuration,
      type: ChannelType.PublicThread,
      reason: 'Cave spots discussion thread'
    });
    
    logger.info(`Created thread without message: ${threadName} in channel: ${channel.name}`);
    return thread;
  } catch (error) {
    logger.error('Failed to create thread without message:', error);
    return null;
  }
}

/**
 * Sends a message to either a channel or thread
 */
export async function sendMessageToChannel(
  channel: TextChannel | ThreadChannel,
  content: string,
  files?: any[]
): Promise<Message | null> {
  try {
    const message = await channel.send({ content, files });
    logger.info(`Sent message to ${channel.type === ChannelType.PublicThread ? 'thread' : 'channel'}: ${channel.name}`);
    return message;
  } catch (error) {
    logger.error('Failed to send message to channel/thread:', error);
    return null;
  }
}

/**
 * Checks if the bot has permission to create threads
 */
export function canCreateThreads(channel: TextChannel): boolean {
  const permissions = channel.permissionsFor(channel.guild.members.me!);
  return permissions?.has([
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.SendMessages
  ]) ?? false;
}

/**
 * Checks if the bot has permission to send messages in threads
 */
export function canSendInThreads(channel: ThreadChannel): boolean {
  const permissions = channel.permissionsFor(channel.guild.members.me!);
  return permissions?.has(PermissionFlagsBits.SendMessages) ?? false;
}

/**
 * Gets or creates a thread for cave spots discussion
 */
export async function getOrCreateCaveThread(
  channel: TextChannel,
  server: string,
  map: string
): Promise<ThreadChannel | null> {
  const threadName = `Cave Spots - ${server} - ${map}`;
  
  // First, try to find an existing thread with this name
  const existingThread = channel.threads.cache.find(
    thread => thread.name === threadName && !thread.archived
  );
  
  if (existingThread) {
    logger.info(`Found existing thread: ${threadName}`);
    return existingThread;
  }
  
  // Check if we can create threads
  if (!canCreateThreads(channel)) {
    logger.warn('Bot does not have permission to create threads');
    return null;
  }
  
  // Create a new thread
  return await createThreadWithoutMessage(channel, threadName);
}

/**
 * Formats a thread name for cave spots
 */
export function formatThreadName(server: string, map: string, type?: string): string {
  if (type) {
    return `Cave Spots - ${server} - ${map} - ${type}`;
  }
  return `Cave Spots - ${server} - ${map}`;
}

/**
 * Checks if a channel is a thread
 */
export function isThread(channel: any): boolean {
  return channel.type === 11; // ChannelType.PublicThread
}

/**
 * Gets the parent channel of a thread, or returns the channel itself if it's not a thread
 */
export function getParentChannel(channel: any): any {
  return isThread(channel) ? channel.parent : channel;
}

/**
 * Archives a thread
 */
export async function archiveThread(thread: ThreadChannel): Promise<boolean> {
  try {
    await thread.setArchived(true);
    logger.info(`Archived thread: ${thread.name}`);
    return true;
  } catch (error) {
    logger.error('Failed to archive thread:', error);
    return false;
  }
}

/**
 * Unarchives a thread
 */
export async function unarchiveThread(thread: ThreadChannel): Promise<boolean> {
  try {
    await thread.setArchived(false);
    logger.info(`Unarchived thread: ${thread.name}`);
    return true;
  } catch (error) {
    logger.error('Failed to unarchive thread:', error);
    return false;
  }
}
