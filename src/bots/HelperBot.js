import { BaseBot, botFramework } from './BotFramework';
import { BOT_RESPONSE_TYPES, IRC_COMMANDS } from '../utils/constants';

export class HelperBot extends BaseBot {
  constructor() {
    super('helper-bot', 'HelperBot', 'Provides help and command information for the IRC on Nostr system');
    
    // Add supported commands
    this.addCommand('help', 'Show available bot commands and IRC commands');
    this.addCommand('commands', 'List all available bot commands');
    this.addCommand('about', 'Show information about the IRC on Nostr system');
    this.addCommand('time', 'Show current server time');
    
    // IRC Commands - get from constants and add descriptions
    this.ircCommands = [
      { command: '/help', description: 'Show IRC commands help with protocol-specific features' },
      { command: '/users', description: 'List active channel users with last seen timestamps' },
      { command: '/topic [text]', description: 'Set/view channel topic (operators only)' },
      { command: '/kick [user] [reason]', description: 'Remove user (permanent in NIP-29, visual-only in others)' },
      { command: '/ban [user] [reason]', description: 'Ban user (permanent in NIP-29, visual-only in others)' },
      { command: '/op [user]', description: 'Grant operator status (real power in NIP-29, visual-only in others)' },
      { command: '/deop [user]', description: 'Remove operator status (real effect in NIP-29, visual-only in others)' },
      { command: '/msg [username|pubkey|npub] [message]', description: 'Send private message with username resolution' }
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

      // Get all bot commands dynamically from framework
      const allBotCommands = botFramework.getCommands();
      const totalBotCommands = allBotCommands.length;
      const totalIrcCommands = this.ircCommands.length;
      
      // Group bot commands by category
      const helperCommands = allBotCommands.filter(cmd => ['help', 'commands', 'about', 'time'].includes(cmd.command));
      const statsCommands = allBotCommands.filter(cmd => ['stats', 'uptime'].includes(cmd.command));
      const weatherCommands = allBotCommands.filter(cmd => ['weather', 'forecast'].includes(cmd.command));
      const gameCommands = allBotCommands.filter(cmd => ['roll', 'flip', '8ball', 'rps', 'number'].includes(cmd.command));
      const pokerCommands = allBotCommands.filter(cmd => ['poker', 'solo', 'join', 'commit', 'reveal', 'start', 'bet', 'call', 'check', 'fold', 'raise', 'verify', 'games', 'hand', 'chips', 'status', 'cards'].includes(cmd.command));

      // Show comprehensive help
      const helpContent = [
        '🤖 **IRC on Nostr - Complete Command Reference**',
        '',
        '**📋 IRC Commands (8 commands)**',
        ...this.ircCommands.map(cmd => `\`${cmd.command}\` - ${cmd.description}`),
        '',
        '**🤖 Bot Commands (32 commands)**',
        '',
        '**🛠️ Helper & Information (4 commands)**',
        ...helperCommands.map(cmd => `\`!${cmd.command}\` - ${cmd.description || 'No description'}`),
        '',
        '**📊 Statistics & Monitoring (2 commands)**',
        ...statsCommands.map(cmd => `\`!${cmd.command}\` - ${cmd.description || 'No description'}`),
        '',
        '**🌤️ Weather Information (2 commands)**',
        ...weatherCommands.map(cmd => `\`!${cmd.command}\` - ${cmd.description || 'No description'}`),
        '',
        '**🎮 Gaming & Entertainment (5 commands)**',
        ...gameCommands.map(cmd => `\`!${cmd.command}\` - ${cmd.description || 'No description'}`),
        '',
        '**🃏 Complete Poker Game System (17 commands)**',
        ...pokerCommands.map(cmd => `\`!${cmd.command}\` - ${cmd.description || 'No description'}`),
        '',
        `**📊 Total Commands:** ${totalBotCommands + totalIrcCommands} (${totalBotCommands} bot + ${totalIrcCommands} IRC)`,
        '',
        '**ℹ️ Examples:**',
        '• `!weather New York` - Get weather for New York',
        '• `!poker 100 4` - Start 4-player poker game with 100 chip ante',
        '• `!roll 2d10+5` - Roll 2 ten-sided dice with +5 modifier',
        '• `!help poker` - Get detailed help for poker commands',
        '',
        '💡 **Tip:** Use `!help <command>` for detailed help on any specific command!'
      ].join('\n');

      return this.createResponse(helpContent, BOT_RESPONSE_TYPES.TEXT, {
        type: 'general_help',
        botCommands: totalBotCommands,
        ircCommands: totalIrcCommands,
        totalCommands: totalBotCommands + totalIrcCommands
      });

    } catch (error) {
      console.error('Error showing help:', error);
      return this.createErrorResponse('Failed to show help information');
    }
  }

  async listCommands(context) {
    try {
      // Get all bot commands dynamically from framework
      const allBotCommands = botFramework.getCommands();
      const totalBotCommands = allBotCommands.length;
      const totalIrcCommands = this.ircCommands.length;

      const commandsContent = [
        '📋 **Available Bot Commands**',
        '',
        '**🤖 Bot Commands:**',
        ...allBotCommands.map(cmd => `• \`!${cmd.command}\``),
        '',
        '**📖 IRC Commands:**',
        ...this.ircCommands.map(cmd => `• \`${cmd.command}\``),
        '',
        `**Total Commands:** ${totalBotCommands + totalIrcCommands} (${totalBotCommands} bot + ${totalIrcCommands} IRC)`,
        '',
        '💡 Use `!help <command>` for detailed help on any command'
      ].join('\n');

      return this.createResponse(commandsContent, BOT_RESPONSE_TYPES.TEXT, {
        type: 'command_list',
        botCommands: totalBotCommands,
        ircCommands: totalIrcCommands,
        total: totalBotCommands + totalIrcCommands
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
      },
      // Poker Commands
      'poker': {
        description: 'Start new multi-player poker game (2-6 players)',
        usage: '!poker <ante> [max_players]',
        examples: ['!poker 100', '!poker 50 4', '!poker 200 6']
      },
      'solo': {
        description: 'Play solo Texas Hold\'em against intelligent AI',
        usage: '!solo <ante> [difficulty]',
        examples: ['!solo 100', '!solo 50 easy', '!solo 200 hard']
      },
      'join': {
        description: 'Join existing poker game in the channel',
        usage: '!join <ante>',
        examples: ['!join 100']
      },
      'commit': {
        description: 'Commit random number for cryptographic deck shuffling',
        usage: '!commit <number> <salt>',
        examples: ['!commit 12345 mysalt123']
      },
      'reveal': {
        description: 'Reveal committed number to generate provably fair deck',
        usage: '!reveal',
        examples: ['!reveal']
      },
      'start': {
        description: 'Start committed game after all players have joined',
        usage: '!start',
        examples: ['!start']
      },
      'bet': {
        description: 'Place initial bet in current betting round',
        usage: '!bet <amount>',
        examples: ['!bet 50', '!bet 100']
      },
      'call': {
        description: 'Call current bet amount',
        usage: '!call',
        examples: ['!call']
      },
      'check': {
        description: 'Check (stay in hand without betting when no bet to call)',
        usage: '!check',
        examples: ['!check']
      },
      'fold': {
        description: 'Fold hand and exit current round',
        usage: '!fold',
        examples: ['!fold']
      },
      'raise': {
        description: 'Raise current bet by specified amount',
        usage: '!raise <amount>',
        examples: ['!raise 50', '!raise 100']
      },
      'verify': {
        description: 'Verify cryptographic fairness of completed game',
        usage: '!verify <game_id>',
        examples: ['!verify abc123']
      },
      'games': {
        description: 'List all active poker games in the channel',
        usage: '!games',
        examples: ['!games']
      },
      'hand': {
        description: 'Show your current poker hand (cards and strength)',
        usage: '!hand',
        examples: ['!hand']
      },
      'chips': {
        description: 'Show current chip count and betting position',
        usage: '!chips',
        examples: ['!chips']
      },
      'status': {
        description: 'Show detailed current game status and betting round',
        usage: '!status',
        examples: ['!status']
      },
      'cards': {
        description: 'View your private cards in secure modal interface',
        usage: '!cards',
        examples: ['!cards']
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