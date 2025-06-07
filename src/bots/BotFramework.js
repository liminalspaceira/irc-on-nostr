import { nostrService } from '../services/NostrService';
import { nostrUtils } from '../utils/nostrUtils';
import { EVENT_KINDS, MESSAGE_TYPES, BOT_RESPONSE_TYPES } from '../utils/constants';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';

export class BotFramework {
  constructor() {
    this.bots = new Map();
    this.commands = new Map();
    this.subscriptions = new Map();
    this.channelBots = new Map(); // channelId -> Set of botIds
    this.botChannels = new Map(); // botId -> Set of channelIds
    this.isRunning = false;
    this.startTime = Date.now();
    this.botStartTimestamp = Math.floor(Date.now() / 1000); // Timestamp when bot framework started
    this.processingCommands = new Set(); // Track commands being processed to prevent duplicates
  }

  // Register a bot with the framework
  registerBot(botInstance, channelIds = []) {
    const botId = botInstance.getId();
    
    // Check if bot is already registered
    if (this.bots.has(botId)) {
      console.warn(`⚠️ Bot ${botId} is already registered, skipping duplicate registration`);
      return;
    }
    
    this.bots.set(botId, botInstance);
    
    // Register bot's commands
    const botCommands = botInstance.getCommands();
    botCommands.forEach(command => {
      if (this.commands.has(command)) {
        console.warn(`⚠️ Command !${command} is already registered by bot ${this.commands.get(command)}, overriding with ${botId}`);
      }
      this.commands.set(command, botId);
    });
    
    // Initialize bot channel tracking
    if (!this.botChannels.has(botId)) {
      this.botChannels.set(botId, new Set());
    }
    
    // Register bot for specific channels, or all channels if none specified
    if (channelIds.length > 0) {
      channelIds.forEach(channelId => {
        this.addBotToChannel(botId, channelId);
      });
      console.log(`Bot registered: ${botId} for channels: ${channelIds.join(', ')} with commands: ${botCommands.join(', ')}`);
    } else {
      console.log(`Bot registered: ${botId} globally with commands: ${botCommands.join(', ')}`);
    }
  }

  // Add a bot to a specific channel
  addBotToChannel(botId, channelId) {
    // Add channel to bot's channel set
    if (!this.botChannels.has(botId)) {
      this.botChannels.set(botId, new Set());
    }
    this.botChannels.get(botId).add(channelId);
    
    // Add bot to channel's bot set
    if (!this.channelBots.has(channelId)) {
      this.channelBots.set(channelId, new Set());
    }
    this.channelBots.get(channelId).add(botId);
    
    console.log(`Added bot ${botId} to channel ${channelId}`);
  }

  // Remove a bot from a specific channel
  removeBotFromChannel(botId, channelId) {
    // Remove channel from bot's channel set
    if (this.botChannels.has(botId)) {
      this.botChannels.get(botId).delete(channelId);
    }
    
    // Remove bot from channel's bot set
    if (this.channelBots.has(channelId)) {
      this.channelBots.get(channelId).delete(botId);
    }
    
    console.log(`Removed bot ${botId} from channel ${channelId}`);
  }

  // Check if a bot is active in a specific channel
  isBotActiveInChannel(botId, channelId) {
    // If bot has no specific channels, it's active globally
    const botChannels = this.botChannels.get(botId);
    if (!botChannels || botChannels.size === 0) {
      return true; // Global bot
    }
    
    return botChannels.has(channelId);
  }

  // Get all bots active in a specific channel
  getChannelBots(channelId) {
    const channelSpecificBots = this.channelBots.get(channelId) || new Set();
    const globalBots = new Set();
    
    // Add global bots (bots with no specific channels)
    for (const [botId, channels] of this.botChannels) {
      if (channels.size === 0) {
        globalBots.add(botId);
      }
    }
    
    return new Set([...channelSpecificBots, ...globalBots]);
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
      
      // Remove bot from all channels
      const botChannels = this.botChannels.get(botId) || new Set();
      botChannels.forEach(channelId => {
        this.removeBotFromChannel(botId, channelId);
      });
      this.botChannels.delete(botId);
      
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
    this.botStartTimestamp = Math.floor(Date.now() / 1000); // Update timestamp when starting
    
    // Subscribe to bot command events
    this.subscribeToCommands();
    
    console.log(`Bot framework started at timestamp: ${this.botStartTimestamp}`);
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
      try {
        nostrService.unsubscribe(subscription);
      } catch (error) {
        console.warn('Error unsubscribing:', error);
      }
    });
    this.subscriptions.clear();
    
    // Clear all bots and commands
    this.bots.clear();
    this.commands.clear();
    
    console.log('Bot framework stopped and cleaned up');
  }

  // Subscribe to bot commands in all channels
  subscribeToCommands() {
    console.log('🤖 Bot framework subscribing to commands...');
    console.log('🤖 Nostr service available:', !!nostrService);
    console.log('🤖 Nostr service connected:', nostrService?.isConnected);
    
    // Subscribe to all channel messages to catch bot commands
    // Use a timestamp slightly in the future to avoid any historical messages
    const futureTimestamp = Math.floor(Date.now() / 1000) + 5; // 5 seconds in the future
    const subscription = nostrService.subscribe(
      {
        kinds: [EVENT_KINDS.CHANNEL_MESSAGE],
        since: futureTimestamp
      },
      this.handleBotCommand.bind(this)
    );
    
    console.log(`🤖 Bot framework only processing messages after timestamp: ${futureTimestamp}`);
    
    console.log('🤖 Bot framework subscription created:', !!subscription);
    this.subscriptions.set('global', subscription);
  }

  // Handle incoming bot commands
  async handleBotCommand(event) {
    let commandKey = null;
    let message = null;
    let botCommand = null;
    
    try {
      console.log('🤖 Bot framework received event:', event);
      message = nostrUtils.parseChannelMessage(event);
      console.log('🤖 Parsed message:', message);
      console.log(`🤖 Framework instance ID: ${this.startTime}`);
      
      // Double-check: ignore messages sent before bot framework started
      if (message.timestamp < this.botStartTimestamp) {
        console.log(`🚫 Ignoring historical message from ${message.timestamp} (bot started at ${this.botStartTimestamp})`);
        return;
      }
      
      // Check if this is a bot command
      botCommand = nostrUtils.parseBotCommandFromMessage(message.content);
      if (!botCommand) {
        console.log('🤖 Not a bot command, ignoring:', message.content);
        return;
      }
      
      // Create a unique key for this command execution to prevent duplicates
      commandKey = `${event.id}-${botCommand.command}-${message.channelId}`;
      if (this.processingCommands.has(commandKey)) {
        console.log(`🤖 Command ${commandKey} already being processed, skipping duplicate`);
        return;
      }
      
      // Mark command as being processed
      this.processingCommands.add(commandKey);
      
      // Clean up after 10 seconds to prevent memory leak
      setTimeout(() => {
        this.processingCommands.delete(commandKey);
      }, 10000);
      
      console.log('🤖 Processing bot command:', botCommand);

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

      // Check if bot is active in this channel
      if (!this.isBotActiveInChannel(botId, message.channelId)) {
        console.log(`🤖 Bot ${botId} not active in channel ${message.channelId}, ignoring command`);
        return;
      }

      // Execute the command
      console.log(`🤖 Framework ${this.startTime}: Executing bot command: !${botCommand.command} for bot: ${botId}`);
      const response = await bot.executeCommand(botCommand.command, botCommand.args, {
        channelId: message.channelId,
        userId: message.author,
        timestamp: message.timestamp
      });

      // Send the response using the bot's own identity
      if (response) {
        try {
          await this.sendBotResponseAsBot(
            bot,
            message.channelId,
            response.content || response,
            response.type || BOT_RESPONSE_TYPES.TEXT,
            response.data
          );
        } catch (error) {
          console.warn('⚠️ Bot response via Nostr failed, creating local response:', error.message);
          // Fallback to local response when Nostr fails
          this.createLocalBotResponse(message.channelId, {
            content: response.content || response,
            type: response.type || BOT_RESPONSE_TYPES.TEXT,
            data: response.data,
            timestamp: Math.floor(Date.now() / 1000)
          });
        }
      }

    } catch (error) {
      console.error('Error handling bot command:', error);
      // Clean up command key on error
      if (commandKey) {
        this.processingCommands.delete(commandKey);
      }
    }
  }

  // Send a bot response using the bot's own Nostr identity
  async sendBotResponseAsBot(bot, channelId, content, type = BOT_RESPONSE_TYPES.TEXT, data = null) {
    try {
      console.log(`🤖 ${bot.displayName} sending response to channel ${channelId}`);
      
      // Create a regular channel message event
      const eventTemplate = {
        kind: EVENT_KINDS.CHANNEL_MESSAGE,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', channelId, '', 'root'],
          ['message_type', 'bot_response'], // Mark as bot response for enhanced delivery
          ['bot_id', bot.id],
          ['bot_name', bot.displayName]
        ],
        content: content
      };
      
      // Use enhanced publishing through NostrService with bot's identity
      // Temporarily store current user keys
      const originalPrivateKey = nostrService.privateKey;
      const originalPublicKey = nostrService.publicKey;
      
      try {
        // Use bot's keys for this message
        nostrService.privateKey = bot.privateKeyHex;
        nostrService.publicKey = bot.publicKey;
        
        // Use enhanced publishing with rate-limiting, retries, and proof-of-work
        const publishOptions = {
          useProofOfWork: true,
          proofOfWorkDifficulty: 16 // Moderate difficulty for bot responses
        };
        
        console.log(`🔄 Publishing bot response with enhanced delivery from ${bot.displayName}...`);
        const publishedEvent = await nostrService.publishEvent(eventTemplate, 0, publishOptions);
        console.log(`✅ Bot response sent successfully from ${bot.displayName} with enhanced delivery`);
        
        // Restore original user keys
        nostrService.privateKey = originalPrivateKey;
        nostrService.publicKey = originalPublicKey;
        
        return publishedEvent;
        
      } catch (relayError) {
        console.error('❌ Enhanced relay publishing failed for bot response:', relayError.message);
        
        // Restore original user keys in case of error
        nostrService.privateKey = originalPrivateKey;
        nostrService.publicKey = originalPublicKey;
        
        // For bot responses, try a simplified approach without proof-of-work as fallback
        console.log('🔄 Attempting simplified publishing without proof-of-work...');
        try {
          const simplifiedEvent = {
            kind: EVENT_KINDS.CHANNEL_MESSAGE,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['e', channelId, '', 'root'],
              ['message_type', 'bot_response'],
              ['bot_id', bot.id]
            ],
            content: content
          };
          
          // Use bot's keys for simplified publishing
          nostrService.privateKey = bot.privateKeyHex;
          nostrService.publicKey = bot.publicKey;
          
          const fallbackEvent = await nostrService.publishEvent(simplifiedEvent, 0, { useProofOfWork: false });
          console.log('✅ Bot response published with simplified approach');
          
          // Restore original user keys
          nostrService.privateKey = originalPrivateKey;
          nostrService.publicKey = originalPublicKey;
          
          return fallbackEvent;
          
        } catch (fallbackError) {
          console.error('❌ Even simplified publishing failed:', fallbackError.message);
          
          // Restore original user keys
          nostrService.privateKey = originalPrivateKey;
          nostrService.publicKey = originalPublicKey;
          
          // As last resort, still throw the error
          throw relayError;
        }
      }
    } catch (error) {
      console.error('❌ Error sending bot response as bot:', error);
    }
  }

  // Send a bot response to a channel (legacy method, keeping for compatibility)
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
      
      try {
        await nostrService.sendChannelMessage(channelId, JSON.stringify(serializableResponse), MESSAGE_TYPES.BOT_RESPONSE);
        console.log(`✅ Bot response sent to channel ${channelId}: ${content.substring(0, 50)}...`);
      } catch (relayError) {
        console.error('❌ Relay publishing failed for bot response:', relayError.message);
        
        // Do NOT create local response - bot must publish to Nostr network
        console.log('🚫 Bot response failed to publish to Nostr network - no local fallback');
        throw relayError; // Re-throw to ensure the error is known
      }
    } catch (error) {
      console.error('❌ Error sending bot response:', error);
    }
  }

  // Create a local bot response when relay publishing fails
  createLocalBotResponse(channelId, response) {
    try {
      // Create a synthetic message event that looks like it came from Nostr
      const localMessage = {
        id: `local_bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        content: JSON.stringify(response),
        author: 'bot',
        channelId: channelId,
        timestamp: response.timestamp,
        tags: [['message_type', MESSAGE_TYPES.BOT_RESPONSE]],
        type: MESSAGE_TYPES.BOT_RESPONSE,
        isLocal: true // Flag to indicate this is a local message
      };

      // Emit this message to any registered listeners
      if (typeof window !== 'undefined' && window.nostrLocalBotResponse) {
        window.nostrLocalBotResponse(localMessage);
      }
      
      console.log('📱 Created local bot response:', response.content.substring(0, 50) + '...');
    } catch (error) {
      console.error('❌ Error creating local bot response:', error);
    }
  }

  // Get list of registered bots (optionally filtered by channel)
  getBots(channelId = null) {
    if (channelId) {
      // Return only bots active in the specified channel
      const activeBotIds = this.getChannelBots(channelId);
      return Array.from(this.bots.values())
        .filter(bot => activeBotIds.has(bot.getId()))
        .map(bot => ({
          id: bot.getId(),
          name: bot.getName(),
          description: bot.getDescription(),
          commands: bot.getCommands(),
          status: bot.isEnabled() ? 'active' : 'inactive',
          channels: Array.from(this.botChannels.get(bot.getId()) || [])
        }));
    } else {
      // Return all bots
      return Array.from(this.bots.values()).map(bot => ({
        id: bot.getId(),
        name: bot.getName(),
        description: bot.getDescription(),
        commands: bot.getCommands(),
        status: bot.isEnabled() ? 'active' : 'inactive',
        channels: Array.from(this.botChannels.get(bot.getId()) || [])
      }));
    }
  }

  // Get list of available commands (optionally filtered by channel)
  getCommands(channelId = null) {
    const commandList = [];
    
    if (channelId) {
      // Return only commands from bots active in the specified channel
      const activeBotIds = this.getChannelBots(channelId);
      this.bots.forEach(bot => {
        if (bot.isEnabled() && activeBotIds.has(bot.getId())) {
          bot.getCommands().forEach(command => {
            commandList.push({
              command,
              bot: bot.getId(),
              description: bot.getCommandDescription(command)
            });
          });
        }
      });
    } else {
      // Return all commands from all bots
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
    }
    
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
    
    // Generate unique Nostr identity for this bot
    this.generateBotIdentity();
  }

  // Generate a unique Nostr identity for this bot
  generateBotIdentity() {
    this.privateKey = generateSecretKey(); // Uint8Array format
    this.privateKeyHex = Array.from(this.privateKey).map(b => b.toString(16).padStart(2, '0')).join(''); // Hex format
    this.publicKey = getPublicKey(this.privateKey);
    this.displayName = `🤖 ${this.name}`;
    
    console.log(`Generated Nostr identity for ${this.name}:`, {
      pubkey: this.publicKey.substring(0, 16) + '...',
      displayName: this.displayName
    });
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