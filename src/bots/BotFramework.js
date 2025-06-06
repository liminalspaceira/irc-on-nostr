import { nostrService } from '../services/NostrService';
import { nostrUtils } from '../utils/nostrUtils';
import { EVENT_KINDS, MESSAGE_TYPES, BOT_RESPONSE_TYPES } from '../utils/constants';

export class BotFramework {
  constructor() {
    this.bots = new Map();
    this.commands = new Map();
    this.subscriptions = new Map();
    this.isRunning = false;
    this.startTime = Date.now();
  }

  // Register a bot with the framework
  registerBot(botInstance) {
    const botId = botInstance.getId();
    this.bots.set(botId, botInstance);
    
    // Register bot's commands
    const botCommands = botInstance.getCommands();
    botCommands.forEach(command => {
      this.commands.set(command, botId);
    });
    
    console.log(`Bot registered: ${botId} with commands: ${botCommands.join(', ')}`);
  }

  // Unregister a bot
  unregisterBot(botId) {
    const bot = this.bots.get(botId);
    if (bot) {
      // Remove bot's commands
      const botCommands = bot.getCommands();
      botCommands.forEach(command => {
        this.commands.delete(command);
      });
      
      this.bots.delete(botId);
      console.log(`Bot unregistered: ${botId}`);
    }
  }

  // Start the bot framework
  async start() {
    if (this.isRunning) {
      console.log('Bot framework already running');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();
    
    // Subscribe to bot command events
    this.subscribeToCommands();
    
    console.log('Bot framework started');
  }

  // Stop the bot framework
  async stop() {
    if (!this.isRunning) {
      console.log('Bot framework not running');
      return;
    }

    this.isRunning = false;
    
    // Unsubscribe from all events
    this.subscriptions.forEach((subscription, channelId) => {
      nostrService.unsubscribe(subscription);
    });
    this.subscriptions.clear();
    
    console.log('Bot framework stopped');
  }

  // Subscribe to bot commands in all channels
  subscribeToCommands() {
    // Subscribe to all channel messages to catch bot commands
    const subscription = nostrService.subscribe(
      {
        kinds: [EVENT_KINDS.CHANNEL_MESSAGE],
        since: Math.floor(Date.now() / 1000)
      },
      this.handleBotCommand.bind(this)
    );
    
    this.subscriptions.set('global', subscription);
  }

  // Handle incoming bot commands
  async handleBotCommand(event) {
    try {
      const message = nostrUtils.parseChannelMessage(event);
      
      // Check if this is a bot command
      const botCommand = nostrUtils.parseBotCommandFromMessage(message.content);
      if (!botCommand) {
        return;
      }

      // Find the bot that handles this command
      const botId = this.commands.get(botCommand.command);
      if (!botId) {
        // Unknown command - let the default helper handle it
        await this.sendBotResponse(
          message.channelId,
          `❓ Unknown command: !${botCommand.command}. Try !help for available commands.`,
          BOT_RESPONSE_TYPES.ERROR
        );
        return;
      }

      const bot = this.bots.get(botId);
      if (!bot) {
        console.error(`Bot ${botId} not found for command ${botCommand.command}`);
        return;
      }

      // Execute the command
      console.log(`Executing bot command: !${botCommand.command} for bot: ${botId}`);
      const response = await bot.executeCommand(botCommand.command, botCommand.args, {
        channelId: message.channelId,
        userId: message.author,
        timestamp: message.timestamp
      });

      // Send the response
      if (response) {
        await this.sendBotResponse(
          message.channelId,
          response.content || response,
          response.type || BOT_RESPONSE_TYPES.TEXT,
          response.data
        );
      }

    } catch (error) {
      console.error('Error handling bot command:', error);
    }
  }

  // Send a bot response to a channel
  async sendBotResponse(channelId, content, type = BOT_RESPONSE_TYPES.TEXT, data = null) {
    try {
      // Create bot response event
      const response = {
        content,
        type,
        data,
        timestamp: Math.floor(Date.now() / 1000)
      };

      // Send as a channel message with bot response type
      // Ensure data is serializable by removing any Sets or other non-serializable objects
      const serializableResponse = {
        ...response,
        data: response.data ? JSON.parse(JSON.stringify(response.data, (key, value) => {
          if (value instanceof Set) {
            return Array.from(value);
          }
          return value;
        })) : null
      };
      await nostrService.sendChannelMessage(channelId, JSON.stringify(serializableResponse), MESSAGE_TYPES.BOT_RESPONSE);
      
      console.log(`Bot response sent to channel ${channelId}: ${content.substring(0, 50)}...`);
    } catch (error) {
      console.error('Error sending bot response:', error);
    }
  }

  // Get list of registered bots
  getBots() {
    return Array.from(this.bots.values()).map(bot => ({
      id: bot.getId(),
      name: bot.getName(),
      description: bot.getDescription(),
      commands: bot.getCommands(),
      status: bot.isEnabled() ? 'active' : 'inactive'
    }));
  }

  // Get list of available commands
  getCommands() {
    const commandList = [];
    this.bots.forEach(bot => {
      if (bot.isEnabled()) {
        bot.getCommands().forEach(command => {
          commandList.push({
            command,
            bot: bot.getId(),
            description: bot.getCommandDescription(command)
          });
        });
      }
    });
    return commandList;
  }

  // Get framework statistics
  getStats() {
    const uptime = Date.now() - this.startTime;
    return {
      isRunning: this.isRunning,
      uptime: uptime,
      uptimeFormatted: this.formatUptime(uptime),
      registeredBots: this.bots.size,
      availableCommands: this.commands.size,
      activeSubscriptions: this.subscriptions.size
    };
  }

  // Format uptime in human readable format
  formatUptime(uptime) {
    const seconds = Math.floor(uptime / 1000);
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
}

// Base class for all bots
export class BaseBot {
  constructor(id, name, description) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.enabled = true;
    this.commands = [];
    this.commandDescriptions = new Map();
  }

  // Bot identification
  getId() {
    return this.id;
  }

  getName() {
    return this.name;
  }

  getDescription() {
    return this.description;
  }

  // Enable/disable bot
  isEnabled() {
    return this.enabled;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  // Command management
  addCommand(command, description) {
    this.commands.push(command);
    this.commandDescriptions.set(command, description);
  }

  getCommands() {
    return [...this.commands];
  }

  getCommandDescription(command) {
    return this.commandDescriptions.get(command) || 'No description available';
  }

  // Execute command - to be overridden by specific bots
  async executeCommand(command, args, context) {
    throw new Error(`Command ${command} not implemented in ${this.id}`);
  }

  // Helper method to create responses
  createResponse(content, type = BOT_RESPONSE_TYPES.TEXT, data = null) {
    return {
      content,
      type,
      data,
      bot: this.id
    };
  }

  // Helper method to format error responses
  createErrorResponse(message) {
    return this.createResponse(`❌ ${message}`, BOT_RESPONSE_TYPES.ERROR);
  }

  // Helper method to format success responses
  createSuccessResponse(message, data = null) {
    return this.createResponse(`✅ ${message}`, BOT_RESPONSE_TYPES.TEXT, data);
  }
}

// Global bot framework instance
export const botFramework = new BotFramework();
export default botFramework;