import { BaseBot } from './BotFramework';
import { BOT_RESPONSE_TYPES } from '../utils/constants';

export class GameBot extends BaseBot {
  constructor() {
    super('game-bot', 'GameBot', 'Provides dice rolling and simple games for channel entertainment');
    
    // Add supported commands
    this.addCommand('roll', 'Roll dice (e.g., !roll 2d6, !roll d20, !roll 3d10+5)');
    this.addCommand('flip', 'Flip a coin');
    this.addCommand('8ball', 'Ask the magic 8-ball a question');
    this.addCommand('rps', 'Play rock-paper-scissors (e.g., !rps rock)');
    this.addCommand('number', 'Pick a random number (e.g., !number 1-100)');
    
    // Game state tracking
    this.gameStats = new Map(); // userId -> stats
    this.eightBallResponses = [
      'It is certain',
      'Reply hazy, try again',
      'Don\'t count on it',
      'It is decidedly so',
      'Ask again later',
      'My reply is no',
      'Without a doubt',
      'Better not tell you now',
      'My sources say no',
      'Yes definitely',
      'Cannot predict now',
      'Outlook not so good',
      'You may rely on it',
      'Concentrate and ask again',
      'Very doubtful',
      'As I see it, yes',
      'Most likely',
      'Outlook good',
      'Yes',
      'Signs point to yes'
    ];
  }

  async executeCommand(command, args, context) {
    const userId = context.userId;
    this.trackUserActivity(userId);
    
    switch (command) {
      case 'roll':
        return await this.rollDice(args, context);
      
      case 'flip':
        return await this.flipCoin(context);
      
      case '8ball':
        return await this.magic8Ball(args, context);
      
      case 'rps':
        return await this.rockPaperScissors(args, context);
      
      case 'number':
        return await this.randomNumber(args, context);
      
      default:
        return this.createErrorResponse(`Unknown command: ${command}`);
    }
  }

  async rollDice(args, context) {
    try {
      if (args.length === 0) {
        // Default to 1d6
        args = ['1d6'];
      }

      const diceNotation = args[0];
      const result = this.parseDiceNotation(diceNotation);
      
      if (!result) {
        return this.createErrorResponse('Invalid dice notation. Examples: d6, 2d10, 3d8+5, d20-2');
      }

      const { numDice, numSides, modifier, modifierValue } = result;
      
      // Roll the dice
      const rolls = [];
      let total = 0;
      
      for (let i = 0; i < numDice; i++) {
        const roll = Math.floor(Math.random() * numSides) + 1;
        rolls.push(roll);
        total += roll;
      }
      
      // Apply modifier
      const finalTotal = total + modifierValue;
      
      // Format the response
      let rollContent = `🎲 **Dice Roll: ${diceNotation}**\n\n`;
      
      if (numDice === 1) {
        rollContent += `Result: **${rolls[0]}**`;
      } else {
        rollContent += `Rolls: [${rolls.join(', ')}]\n`;
        rollContent += `Sum: ${total}`;
      }
      
      if (modifierValue !== 0) {
        rollContent += `\nModifier: ${modifier}${modifierValue}\n`;
        rollContent += `**Final Total: ${finalTotal}**`;
      } else if (numDice > 1) {
        rollContent += `\n**Total: ${total}**`;
      }

      // Add some flavor for special rolls
      if (numSides === 20 && rolls[0] === 20) {
        rollContent += '\n🎉 **NATURAL 20!**';
      } else if (numSides === 20 && rolls[0] === 1) {
        rollContent += '\n💀 **CRITICAL FAIL!**';
      }

      return this.createResponse(rollContent, BOT_RESPONSE_TYPES.TEXT, {
        notation: diceNotation,
        rolls: rolls,
        total: finalTotal,
        isNat20: numSides === 20 && rolls[0] === 20,
        isCritFail: numSides === 20 && rolls[0] === 1
      });

    } catch (error) {
      console.error('Error rolling dice:', error);
      return this.createErrorResponse('Failed to roll dice');
    }
  }

  async flipCoin(context) {
    try {
      const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
      const emoji = result === 'Heads' ? '🪙' : '🟡';
      
      const flipContent = `${emoji} **Coin Flip Result: ${result}**`;
      
      return this.createResponse(flipContent, BOT_RESPONSE_TYPES.TEXT, {
        result: result
      });

    } catch (error) {
      console.error('Error flipping coin:', error);
      return this.createErrorResponse('Failed to flip coin');
    }
  }

  async magic8Ball(args, context) {
    try {
      if (args.length === 0) {
        return this.createErrorResponse('Ask the magic 8-ball a question! Example: !8ball Will it rain today?');
      }

      const question = args.join(' ');
      const response = this.eightBallResponses[
        Math.floor(Math.random() * this.eightBallResponses.length)
      ];
      
      const ballContent = [
        '🎱 **Magic 8-Ball**',
        '',
        `**Question:** ${question}`,
        `**Answer:** ${response}`
      ].join('\n');

      return this.createResponse(ballContent, BOT_RESPONSE_TYPES.TEXT, {
        question: question,
        answer: response
      });

    } catch (error) {
      console.error('Error with 8-ball:', error);
      return this.createErrorResponse('The magic 8-ball is cloudy, try again later');
    }
  }

  async rockPaperScissors(args, context) {
    try {
      if (args.length === 0) {
        return this.createErrorResponse('Choose rock, paper, or scissors! Example: !rps rock');
      }

      const userChoice = args[0].toLowerCase();
      const validChoices = ['rock', 'paper', 'scissors'];
      
      if (!validChoices.includes(userChoice)) {
        return this.createErrorResponse('Invalid choice! Use: rock, paper, or scissors');
      }

      const botChoice = validChoices[Math.floor(Math.random() * validChoices.length)];
      const result = this.determineRPSWinner(userChoice, botChoice);
      
      const emojis = {
        rock: '🪨',
        paper: '📄',
        scissors: '✂️'
      };

      let resultEmoji = '';
      let resultText = '';
      
      switch (result) {
        case 'win':
          resultEmoji = '🎉';
          resultText = 'You win!';
          break;
        case 'lose':
          resultEmoji = '😔';
          resultText = 'You lose!';
          break;
        case 'tie':
          resultEmoji = '🤝';
          resultText = 'It\'s a tie!';
          break;
      }

      const rpsContent = [
        '🎮 **Rock Paper Scissors**',
        '',
        `You: ${emojis[userChoice]} ${userChoice}`,
        `Bot: ${emojis[botChoice]} ${botChoice}`,
        '',
        `${resultEmoji} **${resultText}**`
      ].join('\n');

      return this.createResponse(rpsContent, BOT_RESPONSE_TYPES.TEXT, {
        userChoice: userChoice,
        botChoice: botChoice,
        result: result
      });

    } catch (error) {
      console.error('Error with rock-paper-scissors:', error);
      return this.createErrorResponse('Failed to play rock-paper-scissors');
    }
  }

  async randomNumber(args, context) {
    try {
      let min = 1;
      let max = 100;
      
      if (args.length > 0) {
        const range = args[0];
        
        if (range.includes('-')) {
          const [minStr, maxStr] = range.split('-');
          min = parseInt(minStr) || 1;
          max = parseInt(maxStr) || 100;
        } else {
          max = parseInt(range) || 100;
        }
      }
      
      if (min > max) {
        [min, max] = [max, min]; // Swap if min > max
      }
      
      const randomNum = Math.floor(Math.random() * (max - min + 1)) + min;
      
      const numberContent = [
        '🔢 **Random Number**',
        '',
        `Range: ${min} - ${max}`,
        `**Result: ${randomNum}**`
      ].join('\n');

      return this.createResponse(numberContent, BOT_RESPONSE_TYPES.TEXT, {
        min: min,
        max: max,
        result: randomNum
      });

    } catch (error) {
      console.error('Error generating random number:', error);
      return this.createErrorResponse('Failed to generate random number');
    }
  }

  // Parse dice notation like "2d6", "d20", "3d8+5", etc.
  parseDiceNotation(notation) {
    const diceRegex = /^(\d*)d(\d+)([+-]\d+)?$/i;
    const match = notation.match(diceRegex);
    
    if (!match) {
      return null;
    }
    
    const numDice = parseInt(match[1]) || 1;
    const numSides = parseInt(match[2]);
    const modifierStr = match[3] || '';
    
    let modifier = '';
    let modifierValue = 0;
    
    if (modifierStr) {
      modifier = modifierStr.charAt(0);
      modifierValue = parseInt(modifierStr.slice(1));
      if (modifier === '-') {
        modifierValue = -modifierValue;
      }
    }
    
    // Validate ranges
    if (numDice < 1 || numDice > 100) return null;
    if (numSides < 2 || numSides > 1000) return null;
    
    return {
      numDice,
      numSides,
      modifier,
      modifierValue
    };
  }

  // Determine winner for rock-paper-scissors
  determineRPSWinner(userChoice, botChoice) {
    if (userChoice === botChoice) {
      return 'tie';
    }
    
    const winConditions = {
      rock: 'scissors',
      paper: 'rock',
      scissors: 'paper'
    };
    
    return winConditions[userChoice] === botChoice ? 'win' : 'lose';
  }

  // Track user activity for stats
  trackUserActivity(userId) {
    if (!this.gameStats.has(userId)) {
      this.gameStats.set(userId, {
        commandCount: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now()
      });
    }
    
    const stats = this.gameStats.get(userId);
    stats.commandCount++;
    stats.lastSeen = Date.now();
  }

  // Get user statistics
  getUserStats(userId) {
    return this.gameStats.get(userId) || null;
  }

  // Get global game statistics
  getGlobalStats() {
    return {
      totalUsers: this.gameStats.size,
      totalCommands: Array.from(this.gameStats.values())
        .reduce((sum, stats) => sum + stats.commandCount, 0)
    };
  }
}

export default GameBot;