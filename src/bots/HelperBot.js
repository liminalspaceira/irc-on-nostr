import { BaseBot } from './BotFramework';
import { BOT_RESPONSE_TYPES } from '../utils/constants';

export class HelperBot extends BaseBot {
  constructor() {
    super('helper-bot', 'HelperBot', 'Provides help and command information for the IRC on Nostr system');
    
    // Add supported commands
    this.addCommand('help', 'Show available bot commands and IRC commands');
    this.addCommand('commands', 'List all available bot commands');
    this.addCommand('about', 'Show information about the IRC on Nostr system');
    this.addCommand('time', 'Show current server time');
    
    // Help content
    this.ircCommands = [
      { command: '/help', description: 'Show IRC commands help' },
      { command: '/users', description: 'List channel users' },
      { command: '/topic <text>', description: 'Set channel topic (ops only)' },
      { command: '/kick <user> [reason]', description: 'Kick user (ops only)' },
      { command: '/ban <user> [reason]', description: 'Ban user (ops only)' },
      { command: '/op <user>', description: 'Grant operator status (ops only)' },
      { command: '/deop <user>', description: 'Remove operator status (ops only)' }
    ];
  }

  async executeCommand(command, args, context) {
    switch (command) {
      case 'help':
        return await this.showHelp(args, context);
      
      case 'commands':
        return await this.listCommands(context);
      
      case 'about':
        return await this.showAbout(context);
      
      case 'time':
        return await this.showTime(context);
      
      default:
        return this.createErrorResponse(`Unknown command: ${command}`);
    }
  }

  async showHelp(args, context) {
    try {
      // If specific command is requested
      if (args.length > 0) {
        const requestedCommand = args[0].toLowerCase();
        return this.getSpecificCommandHelp(requestedCommand);
      }

      // Show general help
      const helpContent = [
        '🤖 **IRC on Nostr - Bot Help**',
        '',
        '**📋 IRC Commands (start with /)**',
        ...this.ircCommands.map(cmd => `\`${cmd.command}\` - ${cmd.description}`),
        '',
        '**🤖 Bot Commands (start with !)**',
        '`!help [command]` - Show this help or help for specific command',
        '`!commands` - List all bot commands',
        '`!stats` - Show channel statistics',
        '`!uptime` - Show bot uptime',
        '`!weather <location>` - Get weather information',
        '`!roll [dice]` - Roll dice (e.g., 2d6, d20)',
        '`!flip` - Flip a coin',
        '`!8ball <question>` - Ask the magic 8-ball',
        '`!about` - About IRC on Nostr',
        '`!time` - Show current time',
        '',
        '**ℹ️ Examples:**',
        '• `!weather New York` - Get weather for New York',
        '• `!roll 2d10+5` - Roll 2 ten-sided dice with +5 modifier',
        '• `!help weather` - Get help for weather command',
        '',
        '💡 **Tip:** Try different commands to explore the system!'
      ].join('\n');

      return this.createResponse(helpContent, BOT_RESPONSE_TYPES.TEXT, {
        type: 'general_help',
        commandCount: this.ircCommands.length + 10 // approximate bot commands
      });

    } catch (error) {
      console.error('Error showing help:', error);
      return this.createErrorResponse('Failed to show help information');
    }
  }

  async listCommands(context) {
    try {
      // This would ideally get the actual registered commands from the framework
      const botCommands = [
        '!help', '!commands', '!about', '!time',
        '!stats', '!uptime', '!users',
        '!weather', '!forecast',
        '!roll', '!flip', '!8ball', '!rps', '!number'
      ];

      const commandsContent = [
        '📋 **Available Bot Commands**',
        '',
        '**🤖 Bot Commands:**',
        ...botCommands.map(cmd => `• \`${cmd}\``),
        '',
        '**📖 IRC Commands:**',
        ...this.ircCommands.map(cmd => `• \`${cmd.command}\``),
        '',
        `**Total Commands:** ${botCommands.length + this.ircCommands.length}`,
        '',
        '💡 Use `!help <command>` for detailed help on any command'
      ].join('\n');

      return this.createResponse(commandsContent, BOT_RESPONSE_TYPES.TEXT, {
        type: 'command_list',
        botCommands: botCommands.length,
        ircCommands: this.ircCommands.length,
        total: botCommands.length + this.ircCommands.length
      });

    } catch (error) {
      console.error('Error listing commands:', error);
      return this.createErrorResponse('Failed to list commands');
    }
  }

  async showAbout(context) {
    try {
      const aboutContent = [
        '🌐 **IRC on Nostr**',
        '',
        '**What is it?**',
        'A decentralized IRC-like chat application built on the Nostr protocol, combining the familiar interface of IRC with the censorship-resistance of Nostr.',
        '',
        '**🔑 Key Features:**',
        '• Decentralized messaging via Nostr relays',
        '• Familiar IRC commands and interface',
        '• Channel creation and management',
        '• Operator moderation tools',
        '• Interactive bot system',
        '• Cross-platform support (web & mobile)',
        '',
        '**🤖 Bot System:**',
        'Extensible bot framework with weather, games, statistics, and utility commands.',
        '',
        '**⚡ Powered by:**',
        '• Nostr Protocol (NIPs 1, 28, and custom events)',
        '• React Native for cross-platform UI',
        '• Multiple relay connections for redundancy',
        '',
        '**📊 Current Status:**',
        `• Active since bot startup`,
        `• Connected to multiple Nostr relays`,
        `• Real-time message synchronization`,
        '',
        '🚀 **Try commands like !weather, !roll, !stats to explore!**'
      ].join('\n');

      return this.createResponse(aboutContent, BOT_RESPONSE_TYPES.TEXT, {
        type: 'about_info',
        version: '1.0.0',
        protocol: 'Nostr'
      });

    } catch (error) {
      console.error('Error showing about:', error);
      return this.createErrorResponse('Failed to show about information');
    }
  }

  async showTime(context) {
    try {
      const now = new Date();
      const utcTime = now.toUTCString();
      const localTime = now.toLocaleString();
      const timestamp = now.getTime();
      
      const timeContent = [
        '🕒 **Current Time**',
        '',
        `**Local Time:** ${localTime}`,
        `**UTC Time:** ${utcTime}`,
        `**Unix Timestamp:** ${Math.floor(timestamp / 1000)}`,
        '',
        `📅 **Date:** ${now.toDateString()}`,
        `⏰ **Time Zone:** ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown'}`
      ].join('\n');

      return this.createResponse(timeContent, BOT_RESPONSE_TYPES.TEXT, {
        type: 'time_info',
        timestamp: timestamp,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      });

    } catch (error) {
      console.error('Error showing time:', error);
      return this.createErrorResponse('Failed to show time information');
    }
  }

  getSpecificCommandHelp(command) {
    const commandHelp = {
      'weather': {
        description: 'Get current weather information for any location',
        usage: '!weather <location>',
        examples: ['!weather New York', '!weather London, UK', '!weather Tokyo']
      },
      'forecast': {
        description: 'Get 3-day weather forecast for any location',
        usage: '!forecast <location>',
        examples: ['!forecast Paris', '!forecast San Francisco']
      },
      'roll': {
        description: 'Roll dice using standard dice notation',
        usage: '!roll [dice_notation]',
        examples: ['!roll (1d6)', '!roll 2d10', '!roll d20', '!roll 3d8+5']
      },
      'flip': {
        description: 'Flip a coin',
        usage: '!flip',
        examples: ['!flip']
      },
      '8ball': {
        description: 'Ask the magic 8-ball a question',
        usage: '!8ball <question>',
        examples: ['!8ball Will it rain today?', '!8ball Should I learn programming?']
      },
      'rps': {
        description: 'Play rock-paper-scissors against the bot',
        usage: '!rps <choice>',
        examples: ['!rps rock', '!rps paper', '!rps scissors']
      },
      'number': {
        description: 'Generate a random number within a range',
        usage: '!number [range]',
        examples: ['!number (1-100)', '!number 50', '!number 10-20']
      },
      'stats': {
        description: 'Show channel activity statistics',
        usage: '!stats',
        examples: ['!stats']
      },
      'uptime': {
        description: 'Show bot uptime and status information',
        usage: '!uptime',
        examples: ['!uptime']
      }
    };

    const help = commandHelp[command];
    if (!help) {
      return this.createErrorResponse(`No help available for command: ${command}`);
    }

    const helpContent = [
      `📖 **Help: !${command}**`,
      '',
      `**Description:** ${help.description}`,
      `**Usage:** \`${help.usage}\``,
      '',
      '**Examples:**',
      ...help.examples.map(example => `• \`${example}\``)
    ].join('\n');

    return this.createResponse(helpContent, BOT_RESPONSE_TYPES.TEXT, {
      type: 'command_help',
      command: command
    });
  }
}

export default HelperBot;