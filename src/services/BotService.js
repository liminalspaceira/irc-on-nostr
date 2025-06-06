import { botFramework } from '../bots/BotFramework';
import StatsBot from '../bots/StatsBot';
import WeatherBot from '../bots/WeatherBot';
import GameBot from '../bots/GameBot';
import HelperBot from '../bots/HelperBot';

class BotService {
  constructor() {
    this.initialized = false;
    this.bots = {};
  }

  async initialize() {
    if (this.initialized) {
      console.log('BotService already initialized');
      return;
    }

    try {
      console.log('Initializing BotService...');
      
      // Create bot instances
      this.bots.statsBot = new StatsBot();
      this.bots.weatherBot = new WeatherBot();
      this.bots.gameBot = new GameBot();
      this.bots.helperBot = new HelperBot();
      
      // Register bots with the framework
      botFramework.registerBot(this.bots.statsBot);
      botFramework.registerBot(this.bots.weatherBot);
      botFramework.registerBot(this.bots.gameBot);
      botFramework.registerBot(this.bots.helperBot);
      
      // Start the bot framework
      await botFramework.start();
      
      this.initialized = true;
      console.log('BotService initialized successfully');
      
      // Log registered bots and commands
      const registeredBots = botFramework.getBots();
      const availableCommands = botFramework.getCommands();
      
      console.log(`Registered ${registeredBots.length} bots:`);
      registeredBots.forEach(bot => {
        console.log(`- ${bot.name} (${bot.id}): ${bot.commands.join(', ')}`);
      });
      
      console.log(`Available commands: ${availableCommands.map(cmd => '!' + cmd.command).join(', ')}`);
      
    } catch (error) {
      console.error('Failed to initialize BotService:', error);
      this.initialized = false;
      throw error;
    }
  }

  async shutdown() {
    if (!this.initialized) {
      console.log('BotService not initialized');
      return;
    }

    try {
      console.log('Shutting down BotService...');
      
      // Stop the bot framework
      await botFramework.stop();
      
      this.initialized = false;
      console.log('BotService shut down successfully');
      
    } catch (error) {
      console.error('Error shutting down BotService:', error);
      throw error;
    }
  }

  // Get framework status
  getStatus() {
    return {
      initialized: this.initialized,
      frameworkStats: this.initialized ? botFramework.getStats() : null,
      registeredBots: this.initialized ? botFramework.getBots() : [],
      availableCommands: this.initialized ? botFramework.getCommands() : []
    };
  }

  // Get specific bot instance
  getBot(botId) {
    return this.bots[botId] || null;
  }

  // Track message for statistics (called by ChannelScreen)
  trackMessage(channelId, userId, timestamp) {
    if (this.initialized && this.bots.statsBot) {
      this.bots.statsBot.trackMessage(channelId, userId, timestamp);
    }
  }

  // Check if bot system is ready
  isReady() {
    return this.initialized && botFramework.isRunning;
  }

  // Get help information
  getHelpInfo() {
    if (!this.initialized) {
      return 'Bot system not initialized';
    }

    const commands = botFramework.getCommands();
    const commandList = commands.map(cmd => `!${cmd.command} - ${cmd.description}`);
    
    return [
      '🤖 Available Bot Commands:',
      '',
      ...commandList,
      '',
      'Use !help for detailed information'
    ].join('\n');
  }

  // Manually send bot command (for testing)
  async sendBotCommand(channelId, command, args = [], userId = 'test-user') {
    if (!this.initialized) {
      throw new Error('Bot system not initialized');
    }

    // Create mock context
    const context = {
      channelId,
      userId,
      timestamp: Math.floor(Date.now() / 1000)
    };

    // Find bot that handles this command
    const commands = botFramework.getCommands();
    const commandInfo = commands.find(cmd => cmd.command === command);
    
    if (!commandInfo) {
      throw new Error(`Unknown command: ${command}`);
    }

    const bot = botFramework.bots.get(commandInfo.bot);
    if (!bot) {
      throw new Error(`Bot ${commandInfo.bot} not found`);
    }

    return await bot.executeCommand(command, args, context);
  }
}

export const botService = new BotService();
export default botService;