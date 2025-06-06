import { BaseBot } from './BotFramework';
import { BOT_RESPONSE_TYPES } from '../utils/constants';

export class StatsBot extends BaseBot {
  constructor() {
    super('stats-bot', 'StatsBot', 'Provides channel statistics and uptime information');
    
    // Add supported commands
    this.addCommand('stats', 'Show channel activity statistics');
    this.addCommand('uptime', 'Show bot uptime information');
    
    // Statistics tracking
    this.channelStats = new Map(); // channelId -> stats
    this.startTime = Date.now();
    this.messageCount = 0;
    this.commandCount = 0;
  }

  async executeCommand(command, args, context) {
    this.commandCount++;
    
    switch (command) {
      case 'stats':
        return await this.getChannelStats(context.channelId);
      
      case 'uptime':
        return await this.getUptimeInfo();
      
      default:
        return this.createErrorResponse(`Unknown command: ${command}`);
    }
  }

  async getChannelStats(channelId) {
    try {
      const stats = this.channelStats.get(channelId) || {
        messageCount: 0,
        userCount: 0,
        lastActivity: null,
        createdAt: Date.now()
      };

      const uptime = Date.now() - (stats.createdAt || Date.now());
      const uptimeFormatted = this.formatDuration(uptime);
      
      const messagesPerHour = stats.messageCount > 0 ? 
        Math.round((stats.messageCount / uptime) * (1000 * 60 * 60)) : 0;

      const statsContent = [
        '📊 **Channel Statistics**',
        '',
        `💬 Messages: ${stats.messageCount}`,
        `👥 Unique Users: ${stats.userCount}`,
        `⏱️ Activity: ${messagesPerHour} msgs/hour`,
        `🕒 Tracking: ${uptimeFormatted}`,
        `📅 Last Activity: ${stats.lastActivity ? 
          new Date(stats.lastActivity).toLocaleString() : 'No recent activity'}`
      ].join('\n');

      return this.createResponse(statsContent, BOT_RESPONSE_TYPES.TEXT, {
        messageCount: stats.messageCount,
        userCount: stats.userCount,
        messagesPerHour,
        uptime: uptimeFormatted
      });

    } catch (error) {
      console.error('Error getting channel stats:', error);
      return this.createErrorResponse('Failed to retrieve channel statistics');
    }
  }

  async getUptimeInfo() {
    try {
      const uptime = Date.now() - this.startTime;
      const uptimeFormatted = this.formatDuration(uptime);
      
      const uptimeContent = [
        '⏰ **Bot Uptime Information**',
        '',
        `🚀 Started: ${new Date(this.startTime).toLocaleString()}`,
        `⏱️ Uptime: ${uptimeFormatted}`,
        `📊 Commands Processed: ${this.commandCount}`,
        `💫 Status: Online and operational`
      ].join('\n');

      return this.createResponse(uptimeContent, BOT_RESPONSE_TYPES.TEXT, {
        startTime: this.startTime,
        uptime: uptime,
        uptimeFormatted,
        commandCount: this.commandCount
      });

    } catch (error) {
      console.error('Error getting uptime info:', error);
      return this.createErrorResponse('Failed to retrieve uptime information');
    }
  }

  // Track channel activity (called by framework)
  trackMessage(channelId, userId, timestamp) {
    if (!this.channelStats.has(channelId)) {
      this.channelStats.set(channelId, {
        messageCount: 0,
        userCount: 0,
        users: new Set(),
        lastActivity: null,
        createdAt: Date.now()
      });
    }

    const stats = this.channelStats.get(channelId);
    stats.messageCount++;
    stats.users.add(userId);
    stats.userCount = stats.users.size;
    stats.lastActivity = timestamp;
    
    this.messageCount++;
  }

  // Helper method to format duration
  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // Get current statistics for a channel
  getChannelStats(channelId) {
    return this.channelStats.get(channelId) || null;
  }

  // Get global statistics
  getGlobalStats() {
    return {
      totalChannels: this.channelStats.size,
      totalMessages: this.messageCount,
      totalCommands: this.commandCount,
      uptime: Date.now() - this.startTime,
      startTime: this.startTime
    };
  }
}

export default StatsBot;