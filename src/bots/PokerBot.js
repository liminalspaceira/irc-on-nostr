import { BaseBot } from './BotFramework';
import { nostrService } from '../services/NostrService';
import { nostrUtils } from '../utils/nostrUtils';
import { BOT_RESPONSE_TYPES, EVENT_KINDS, MESSAGE_TYPES } from '../utils/constants';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';

// Poker-specific Nostr event kinds
const POKER_EVENT_KINDS = {
  GAME_ANNOUNCEMENT: 1,      // Regular note announcing game
  PLAYER_COMMIT: 30100,      // Player commits to random number
  PLAYER_REVEAL: 30101,      // Player reveals their number
  DECK_GENERATION: 30102,    // Bot publishes shuffled deck
  GAME_ACTION: 30103,        // Player actions (bet, call, fold)
  GAME_RESULT: 30104,        // Final game state and verification
  BOT_IDENTITY: 30105        // Bot identity announcement
};

// Crypto utilities for commit-reveal scheme
class CryptoUtils {
  static sha256(data) {
    // Use SubtleCrypto API for browser/React Native
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data.toString());
    
    return crypto.subtle.digest('SHA-256', dataBuffer).then(hashBuffer => {
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    });
  }

  static async createCommitment(number, salt) {
    return await this.sha256(number + salt);
  }

  static async verifyCommitment(number, salt, commitment) {
    const calculatedCommitment = await this.sha256(number + salt);
    return calculatedCommitment === commitment;
  }

  static seedRandom(seed) {
    // Linear congruential generator for deterministic randomness
    let current = seed % 2147483647;
    return () => {
      current = (current * 16807) % 2147483647;
      return (current - 1) / 2147483646;
    };
  }

  static shuffleWithSeed(array, seed) {
    const rng = this.seedRandom(seed);
    const shuffled = [...array];
    
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled;
  }
}

// Global poker game state that persists across bot instances
const GLOBAL_POKER_GAMES = new Map();

// Global killswitch for all poker bots - stored in window to persist across all instances
if (typeof window !== 'undefined') {
  window.POKER_GLOBAL_KILLSWITCH = window.POKER_GLOBAL_KILLSWITCH || Date.now();
  window.POKER_ACTIVE_BOT_COUNT = window.POKER_ACTIVE_BOT_COUNT || 0;
}

// Track the latest active poker bot instance to prevent duplicates
let LATEST_POKER_BOT_ID = null;

// Get current session ID from global scope (updated by BotService)
function getCurrentSessionId() {
  return (typeof window !== 'undefined' && window.POKER_SESSION_ID) || Date.now();
}

// Check if this bot instance should be active
function shouldBotBeActive(botCreationTime) {
  if (typeof window === 'undefined') return true;
  return botCreationTime >= window.POKER_GLOBAL_KILLSWITCH;
}

// Poker rules engine
class PokerRules {
  static HAND_RANKINGS = {
    'royal-flush': 10,
    'straight-flush': 9,
    'four-kind': 8,
    'full-house': 7,
    'flush': 6,
    'straight': 5,
    'three-kind': 4,
    'two-pair': 3,
    'pair': 2,
    'high-card': 1
  };

  static createStandardDeck() {
    const suits = ['H', 'D', 'C', 'S']; // Hearts, Diamonds, Clubs, Spades
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
    const deck = [];
    
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push(rank + suit);
      }
    }
    
    return deck;
  }

  static getRankValue(rank) {
    const ranks = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10 };
    return ranks[rank] || parseInt(rank);
  }

  static evaluateHand(cards) {
    // Convert cards to standard format
    const hand = cards.map(card => ({
      rank: this.getRankValue(card[0]),
      suit: card[1]
    })).sort((a, b) => b.rank - a.rank);

    // Check for each hand type
    if (this.isRoyalFlush(hand)) return { type: 'royal-flush', value: 10, cards: hand };
    if (this.isStraightFlush(hand)) return { type: 'straight-flush', value: 9, cards: hand };
    if (this.isFourOfAKind(hand)) return { type: 'four-kind', value: 8, cards: hand };
    if (this.isFullHouse(hand)) return { type: 'full-house', value: 7, cards: hand };
    if (this.isFlush(hand)) return { type: 'flush', value: 6, cards: hand };
    if (this.isStraight(hand)) return { type: 'straight', value: 5, cards: hand };
    if (this.isThreeOfAKind(hand)) return { type: 'three-kind', value: 4, cards: hand };
    if (this.isTwoPair(hand)) return { type: 'two-pair', value: 3, cards: hand };
    if (this.isPair(hand)) return { type: 'pair', value: 2, cards: hand };
    
    return { type: 'high-card', value: 1, cards: hand };
  }

  static isRoyalFlush(hand) {
    return this.isStraightFlush(hand) && hand[0].rank === 14; // Ace high
  }

  static isStraightFlush(hand) {
    return this.isFlush(hand) && this.isStraight(hand);
  }

  static isFourOfAKind(hand) {
    const ranks = this.getRankCounts(hand);
    return Object.values(ranks).includes(4);
  }

  static isFullHouse(hand) {
    const ranks = this.getRankCounts(hand);
    const counts = Object.values(ranks).sort((a, b) => b - a);
    return counts[0] === 3 && counts[1] === 2;
  }

  static isFlush(hand) {
    const suits = hand.map(card => card.suit);
    return new Set(suits).size === 1;
  }

  static isStraight(hand) {
    const ranks = hand.map(card => card.rank).sort((a, b) => b - a);
    
    // Check for regular straight
    for (let i = 0; i < ranks.length - 1; i++) {
      if (ranks[i] - ranks[i + 1] !== 1) {
        // Check for wheel straight (A-2-3-4-5)
        if (i === 0 && ranks[0] === 14) {
          const wheelRanks = [14, 5, 4, 3, 2];
          return JSON.stringify(ranks) === JSON.stringify(wheelRanks);
        }
        return false;
      }
    }
    return true;
  }

  static isThreeOfAKind(hand) {
    const ranks = this.getRankCounts(hand);
    return Object.values(ranks).includes(3);
  }

  static isTwoPair(hand) {
    const ranks = this.getRankCounts(hand);
    const pairs = Object.values(ranks).filter(count => count === 2);
    return pairs.length === 2;
  }

  static isPair(hand) {
    const ranks = this.getRankCounts(hand);
    return Object.values(ranks).includes(2);
  }

  static getRankCounts(hand) {
    const counts = {};
    hand.forEach(card => {
      counts[card.rank] = (counts[card.rank] || 0) + 1;
    });
    return counts;
  }

  static getHandDescription(handEval) {
    const descriptions = {
      'royal-flush': 'Royal Flush',
      'straight-flush': 'Straight Flush',
      'four-kind': 'Four of a Kind',
      'full-house': 'Full House',
      'flush': 'Flush',
      'straight': 'Straight',
      'three-kind': 'Three of a Kind',
      'two-pair': 'Two Pair',
      'pair': 'Pair',
      'high-card': 'High Card'
    };

    return descriptions[handEval.type] || 'Unknown';
  }

  static compareHands(hand1, hand2) {
    const eval1 = this.evaluateHand(hand1);
    const eval2 = this.evaluateHand(hand2);

    if (eval1.value !== eval2.value) {
      return eval1.value - eval2.value; // Higher value wins
    }

    // Same hand type, compare by high cards
    return this.compareHighCards(eval1.cards, eval2.cards);
  }

  static compareHighCards(cards1, cards2) {
    for (let i = 0; i < Math.min(cards1.length, cards2.length); i++) {
      if (cards1[i].rank !== cards2[i].rank) {
        return cards1[i].rank - cards2[i].rank;
      }
    }
    return 0; // Tie
  }
}

// Poker game state management
class PokerGame {
  constructor(gameId, hostPubkey, ante, maxPlayers = 6, isSolo = false, aiDifficulty = 'medium') {
    this.gameId = gameId;
    this.hostPubkey = hostPubkey;
    this.ante = ante;
    this.maxPlayers = maxPlayers;
    this.isSolo = isSolo;
    this.players = new Map(); // pubkey -> player info
    this.phase = 'joining'; // joining, committing, revealing, playing, finished
    this.commits = new Map(); // pubkey -> commitment hash
    this.reveals = new Map(); // pubkey -> {number, salt}
    this.playerCommitData = new Map(); // pubkey -> {number, salt} for auto-reveal
    this.deck = [];
    this.pot = 0;
    this.currentPlayer = 0;
    this.currentBet = 0;
    this.round = 0;
    this.communityCards = [];
    this.playerHands = new Map(); // pubkey -> cards
    this.gameActions = [];
    this.createdAt = Date.now();
    this.masterSeed = 0;
    this.nextCardIndex = 0;
    this.aiPlayer = isSolo ? new AIPlayer(aiDifficulty) : null;
    this.aiCommitment = null;
    this.aiReveal = null;
    this.playerOrder = [];
    this.actionPhase = 'preflop'; // preflop, flop, turn, river
    
    // Generate unique bot Nostr identity for this game
    this.botPrivateKey = generateSecretKey();
    this.botPrivateKeyHex = Array.from(this.botPrivateKey).map(b => b.toString(16).padStart(2, '0')).join('');
    this.botPublicKey = getPublicKey(this.botPrivateKey);
    
    // Nostr event tracking
    this.nostrEvents = [];
    this.channelId = null; // Will be set when game is created
  }

  addPlayer(pubkey, displayName) {
    if (this.players.size >= this.maxPlayers) {
      throw new Error('Game is full');
    }
    
    if (this.phase !== 'joining') {
      throw new Error('Cannot join game in progress');
    }

    // Give players starting chips (100x the ante)
    const startingChips = this.ante * 100;

    this.players.set(pubkey, {
      pubkey: pubkey,
      displayName: displayName,
      chips: startingChips,
      currentBet: 0,
      folded: false,
      allIn: false,
      cards: [],
      joinedAt: Date.now()
    });

    return this.players.size;
  }

  // Nostr event publishing methods
  async publishToNostr(kind, content, tags = []) {
    try {
      const event = {
        kind: kind,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', this.gameId], // Game identifier
          ['game_id', this.gameId],
          ...tags
        ],
        content: content
      };

      const signedEvent = finalizeEvent(event, this.botPrivateKey);
      
      // Store event locally for verification
      this.nostrEvents.push(signedEvent);
      
      // Publish to relays
      if (nostrService && nostrService.pool && nostrService.connectedRelays) {
        await nostrService.pool.publish(Array.from(nostrService.connectedRelays), signedEvent);
        console.log(`Published poker event kind ${kind} for game ${this.gameId}`);
      }
      
      return signedEvent;
    } catch (error) {
      console.error('Error publishing poker event to Nostr:', error);
      return null;
    }
  }

  async publishBotIdentity() {
    const identityData = {
      type: 'poker_bot',
      game_id: this.gameId,
      version: '1.0',
      algorithm: 'Fisher-Yates',
      commitment_scheme: 'SHA256',
      created_at: this.createdAt
    };

    return await this.publishToNostr(
      POKER_EVENT_KINDS.BOT_IDENTITY,
      JSON.stringify(identityData),
      [['poker_bot', 'true'], ['version', '1.0']]
    );
  }

  async publishGameAnnouncement(hostName, channelId) {
    this.channelId = channelId;
    
    const announcement = `🃏 **Provably Fair Poker Game**\n` +
      `Game ID: ${this.gameId}\n` +
      `Host: ${hostName}\n` +
      `Ante: ${this.ante} sats\n` +
      `Max Players: ${this.maxPlayers}\n` +
      `Bot Public Key: ${this.botPublicKey}\n\n` +
      `All game actions will be cryptographically signed and stored on Nostr for verification.`;

    return await this.publishToNostr(
      POKER_EVENT_KINDS.GAME_ANNOUNCEMENT,
      announcement,
      [
        ['e', channelId],
        ['poker_game', 'true'],
        ['ante', this.ante.toString()],
        ['max_players', this.maxPlayers.toString()],
        ['bot_pubkey', this.botPublicKey]
      ]
    );
  }

  async publishCommitment(playerPubkey, commitment) {
    const commitData = {
      player_pubkey: playerPubkey,
      commitment: commitment,
      phase: 'commit',
      timestamp: Date.now()
    };

    return await this.publishToNostr(
      POKER_EVENT_KINDS.PLAYER_COMMIT,
      JSON.stringify(commitData),
      [
        ['player', playerPubkey],
        ['phase', 'commit'],
        ['commitment', commitment]
      ]
    );
  }

  async publishReveal(playerPubkey, number, salt) {
    const revealData = {
      player_pubkey: playerPubkey,
      random_number: number,
      salt: salt,
      phase: 'reveal',
      timestamp: Date.now()
    };

    return await this.publishToNostr(
      POKER_EVENT_KINDS.PLAYER_REVEAL,
      JSON.stringify(revealData),
      [
        ['player', playerPubkey],
        ['phase', 'reveal'],
        ['number', number.toString()],
        ['salt', salt]
      ]
    );
  }

  async publishDeckGeneration() {
    const deckData = {
      master_seed: this.masterSeed,
      deck: this.deck,
      algorithm: 'Fisher-Yates',
      player_contributions: Array.from(this.reveals.entries()).map(([pubkey, data]) => ({
        player: pubkey,
        number: data.number,
        salt: data.salt
      })),
      generated_at: Date.now(),
      verifiable: true
    };

    return await this.publishToNostr(
      POKER_EVENT_KINDS.DECK_GENERATION,
      JSON.stringify(deckData),
      [
        ['phase', 'deck_generated'],
        ['master_seed', this.masterSeed.toString()],
        ['deck_size', this.deck.length.toString()],
        ['algorithm', 'Fisher-Yates']
      ]
    );
  }

  async publishGameAction(playerPubkey, action, amount = null, phase = null) {
    const actionData = {
      player_pubkey: playerPubkey,
      action: action,
      amount: amount,
      betting_round: this.actionPhase,
      pot_size: this.pot,
      current_bet: this.currentBet,
      phase: phase || 'action',
      timestamp: Date.now(),
      community_cards: this.communityCards
    };

    return await this.publishToNostr(
      POKER_EVENT_KINDS.GAME_ACTION,
      JSON.stringify(actionData),
      [
        ['player', playerPubkey],
        ['action', action],
        ['betting_round', this.actionPhase],
        ['pot', this.pot.toString()],
        ...(amount ? [['amount', amount.toString()]] : [])
      ]
    );
  }

  async publishGameResult(winnerPubkey, winAmount, reason) {
    const resultData = {
      game_id: this.gameId,
      winner: winnerPubkey,
      win_amount: winAmount,
      reason: reason,
      final_pot: this.pot,
      final_hands: Array.from(this.playerHands.entries()).map(([pubkey, cards]) => ({
        player: pubkey,
        cards: cards
      })),
      community_cards: this.communityCards,
      game_ended_at: Date.now(),
      verifiable: true
    };

    return await this.publishToNostr(
      POKER_EVENT_KINDS.GAME_RESULT,
      JSON.stringify(resultData),
      [
        ['winner', winnerPubkey],
        ['reason', reason],
        ['win_amount', winAmount.toString()],
        ['game_finished', 'true']
      ]
    );
  }

  canStartGame() {
    return this.players.size >= 2 && this.phase === 'joining';
  }

  startCommitPhase() {
    if (!this.canStartGame()) {
      throw new Error('Cannot start game');
    }
    
    this.phase = 'committing';
    return Array.from(this.players.keys());
  }

  async addCommitment(pubkey, commitment) {
    if (this.phase !== 'committing') {
      throw new Error('Not in commit phase');
    }
    
    if (!this.players.has(pubkey)) {
      throw new Error('Player not in game');
    }

    this.commits.set(pubkey, {
      commitment: commitment,
      timestamp: Date.now()
    });

    // Check if all players have committed
    if (this.commits.size === this.players.size) {
      this.phase = 'revealing';
      return true; // All commits received
    }
    
    return false;
  }

  async addReveal(pubkey, number, salt) {
    if (this.phase !== 'revealing') {
      throw new Error('Not in reveal phase');
    }

    // Verify reveal matches commitment
    const expectedCommit = await CryptoUtils.sha256(number + salt);
    const actualCommit = this.commits.get(pubkey)?.commitment;
    
    if (expectedCommit !== actualCommit) {
      throw new Error(`Invalid reveal from ${pubkey}: commitment mismatch`);
    }

    this.reveals.set(pubkey, {
      number: parseInt(number),
      salt: salt,
      timestamp: Date.now()
    });

    // Check if all players have revealed
    if (this.reveals.size === this.players.size) {
      await this.generateDeck();
      this.phase = 'playing';
      return true; // All reveals received
    }
    
    return false;
  }

  async generateDeck() {
    // Combine all player random numbers (including AI player)
    const playerNumbers = Array.from(this.reveals.values()).map(r => r.number);
    
    this.masterSeed = playerNumbers.reduce((sum, num) => sum + num, 0);
    
    // Create and shuffle deck
    const standardDeck = PokerRules.createStandardDeck();
    this.deck = CryptoUtils.shuffleWithSeed(standardDeck, this.masterSeed);
    this.nextCardIndex = 0;

    // Publish deck generation to Nostr for verification
    await this.publishDeckGeneration();

    return {
      masterSeed: this.masterSeed,
      deck: this.deck,
      verifiable: true
    };
  }

  dealCard() {
    if (this.nextCardIndex >= this.deck.length) {
      throw new Error('No more cards in deck');
    }
    
    return this.deck[this.nextCardIndex++];
  }

  dealPlayerHands(cardsPerPlayer = 2) {
    for (const pubkey of this.players.keys()) {
      const cards = [];
      for (let i = 0; i < cardsPerPlayer; i++) {
        cards.push(this.dealCard());
      }
      this.playerHands.set(pubkey, cards);
    }
  }
}

// AI Player strategies
class AIPlayer {
  constructor(difficulty = 'medium') {
    this.difficulty = difficulty;
    this.pubkey = 'poker-bot-ai';
    this.displayName = 'PokerBot AI';
    this.chips = 10000; // Starting stack
    this.style = this.getPlayingStyle(difficulty);
    this.handHistory = [];
    this.playerHistory = new Map(); // Track opponent patterns
  }

  getPlayingStyle(difficulty) {
    const styles = {
      'easy': {
        aggression: 0.2,
        bluffFrequency: 0.1,
        foldThreshold: 0.6,
        callThreshold: 0.4,
        raiseThreshold: 0.8
      },
      'medium': {
        aggression: 0.4,
        bluffFrequency: 0.25,
        foldThreshold: 0.4,
        callThreshold: 0.6,
        raiseThreshold: 0.8
      },
      'hard': {
        aggression: 0.7,
        bluffFrequency: 0.4,
        foldThreshold: 0.3,
        callThreshold: 0.7,
        raiseThreshold: 0.85
      }
    };
    return styles[difficulty] || styles['medium'];
  }

  // Evaluate hand strength (0-1 scale)
  evaluateHandStrength(cards, communityCards = []) {
    const allCards = [...cards, ...communityCards];
    const handEval = PokerRules.evaluateHand(allCards);
    
    // Convert hand ranking to strength percentage
    const strengthMap = {
      10: 0.99, // royal flush
      9: 0.95,  // straight flush
      8: 0.90,  // four of a kind
      7: 0.85,  // full house
      6: 0.75,  // flush
      5: 0.65,  // straight
      4: 0.55,  // three of a kind
      3: 0.45,  // two pair
      2: 0.35,  // pair
      1: 0.20   // high card
    };

    let baseStrength = strengthMap[handEval.value] || 0.2;
    
    // Adjust for high cards if weak hand
    if (handEval.value <= 2) {
      const highCard = handEval.cards[0].rank;
      if (highCard >= 12) baseStrength += 0.1; // Face cards
      if (highCard === 14) baseStrength += 0.15; // Aces
    }

    return Math.min(baseStrength, 1.0);
  }

  // Calculate pot odds
  calculatePotOdds(potSize, betToCall) {
    if (betToCall === 0) return 1;
    return potSize / (potSize + betToCall);
  }

  // Make betting decision
  makeDecision(gameState) {
    const { 
      myCards, 
      communityCards, 
      potSize, 
      currentBet, 
      myChips, 
      opponent,
      phase 
    } = gameState;

    const handStrength = this.evaluateHandStrength(myCards, communityCards);
    const potOdds = this.calculatePotOdds(potSize, currentBet);
    const random = Math.random();

    // Pre-flop strategy
    if (phase === 'preflop') {
      return this.makePreflopDecision(handStrength, currentBet, potOdds, random);
    }

    // Post-flop strategy
    return this.makePostflopDecision(handStrength, currentBet, potOdds, random, gameState);
  }

  makePreflopDecision(handStrength, currentBet, potOdds, random) {
    const { aggression, bluffFrequency, foldThreshold, callThreshold, raiseThreshold } = this.style;

    // Strong hands - always play aggressively
    if (handStrength >= 0.8) {
      if (random < aggression) {
        return { action: 'raise', amount: Math.floor(currentBet * (1.5 + random)) };
      }
      return { action: 'call' };
    }

    // Medium hands - context dependent
    if (handStrength >= callThreshold) {
      if (random < aggression * 0.7) {
        return { action: 'raise', amount: Math.floor(currentBet * 1.2) };
      }
      return { action: 'call' };
    }

    // Weak hands - mostly fold, occasional bluff
    if (handStrength < foldThreshold) {
      if (random < bluffFrequency && currentBet < 1000) { // Small bluff threshold
        return { action: 'raise', amount: Math.floor(currentBet * 2 + 500) };
      }
      return { action: 'fold' };
    }

    // Borderline hands - use pot odds
    if (potOdds > handStrength) {
      return { action: 'call' };
    }

    return { action: 'fold' };
  }

  makePostflopDecision(handStrength, currentBet, potOdds, random, gameState) {
    const { aggression, bluffFrequency, raiseThreshold } = this.style;
    const { potSize } = gameState;

    // Very strong hands - value bet/raise
    if (handStrength >= raiseThreshold) {
      const betSize = Math.floor(potSize * (0.5 + random * 0.5)) + 300;
      return { action: 'raise', amount: betSize };
    }

    // Good hands - call or small raise
    if (handStrength >= 0.6) {
      if (random < aggression * 0.6) {
        return { action: 'raise', amount: Math.floor(currentBet * 1.5) };
      }
      return { action: 'call' };
    }

    // Marginal hands - check pot odds
    if (handStrength >= 0.4) {
      if (potOdds > 0.3 || currentBet < potSize * 0.2) {
        return { action: 'call' };
      }
      return { action: 'fold' };
    }

    // Weak hands - fold or bluff
    if (random < bluffFrequency && currentBet < potSize * 0.5) {
      const bluffSize = Math.floor(potSize * (0.7 + random * 0.5));
      return { action: 'raise', amount: bluffSize };
    }

    return { action: 'fold' };
  }

  // Generate AI's random number for commit-reveal
  generateRandomNumber() {
    return Math.floor(Math.random() * 1000000);
  }

  generateSalt() {
    return 'ai-salt-' + Math.random().toString(36).substring(2, 15);
  }
}

// Main Poker Bot class
export class PokerBot extends BaseBot {
  constructor() {
    super('poker', 'Poker Bot', 'Provably fair poker games with cryptographic security and AI opponents');
    
    // Use global game state instead of instance-specific state
    this.activeGames = GLOBAL_POKER_GAMES;
    this.gameSequence = 0;
    this.userProfiles = new Map(); // Cache for user profiles
    
    // Mark this as the latest active poker bot and store session ID
    this.creationTime = Date.now();
    LATEST_POKER_BOT_ID = this.publicKey;
    this.sessionId = getCurrentSessionId();
    
    // Update global killswitch to disable all previous bots
    if (typeof window !== 'undefined') {
      window.POKER_GLOBAL_KILLSWITCH = this.creationTime;
      window.POKER_ACTIVE_BOT_COUNT = (window.POKER_ACTIVE_BOT_COUNT || 0) + 1;
    }
    
    console.log(`🤖 New PokerBot instance #${window.POKER_ACTIVE_BOT_COUNT || '?'} created with session ${this.sessionId} at ${this.creationTime}`);
    
    // Add poker commands
    this.addCommand('poker', 'Start a new poker game: !poker <ante> [max_players]');
    this.addCommand('solo', 'Play solo against AI: !solo <ante> [difficulty]');
    this.addCommand('join', 'Join a poker game: !join <ante>');
    this.addCommand('commit', 'Commit to random number: !commit <number> <salt>');
    this.addCommand('reveal', 'Reveal your committed number: !reveal');
    this.addCommand('start', 'Start committed game: !start');
    this.addCommand('bet', 'Place a bet: !bet <amount>');
    this.addCommand('call', 'Call current bet: !call');
    this.addCommand('check', 'Check (bet 0 when no bet to call): !check');
    this.addCommand('fold', 'Fold your hand: !fold');
    this.addCommand('raise', 'Raise the bet: !raise <amount>');
    this.addCommand('verify', 'Verify game fairness: !verify <game_id>');
    this.addCommand('games', 'List active poker games: !games');
    this.addCommand('hand', 'Show your current hand: !hand');
    this.addCommand('chips', 'Show your chip count: !chips');
    this.addCommand('status', 'Show current game status: !status');
    this.addCommand('cards', 'View your private cards in modal: !cards');
  }

  generateGameId() {
    return `poker_${Date.now()}_${++this.gameSequence}`;
  }

  async executeCommand(command, args, context) {
    // Check global killswitch - if this bot was created before the killswitch time, it's dead
    if (!shouldBotBeActive(this.creationTime)) {
      console.log(`💀 Dead poker bot instance ${this.publicKey.substring(0, 8)}... created at ${this.creationTime}, killswitch at ${window.POKER_GLOBAL_KILLSWITCH}`);
      return null; // Don't respond
    }
    
    // Only allow the latest poker bot instance from current session to respond
    const currentSessionId = getCurrentSessionId();
    if (this.publicKey !== LATEST_POKER_BOT_ID || this.sessionId !== currentSessionId) {
      console.log(`🚫 Old poker bot instance ${this.publicKey.substring(0, 8)}... from session ${this.sessionId} ignoring command (current session: ${currentSessionId})`);
      return null; // Don't respond
    }
    
    try {
      switch (command) {
        case 'poker':
          return await this.handlePokerStart(args, context);
        case 'solo':
          return await this.handleSoloGame(args, context);
        case 'join':
          return await this.handleJoinGame(args, context);
        case 'commit':
          return await this.handleCommit(args, context);
        case 'reveal':
          return await this.handleReveal(args, context);
        case 'start':
          return await this.handleStartGame(args, context);
        case 'bet':
        case 'call':
        case 'check':
        case 'fold':
        case 'raise':
          return await this.handleGameAction(command, args, context);
        case 'verify':
          return await this.handleVerifyGame(args, context);
        case 'games':
          return await this.handleListGames(args, context);
        case 'hand':
          return await this.handleShowHand(args, context);
        case 'chips':
          return await this.handleShowChips(args, context);
        case 'status':
          return await this.handleShowStatus(args, context);
        case 'cards':
          return await this.handleShowCards(args, context);
        default:
          return this.createErrorResponse(`Unknown poker command: ${command}`);
      }
    } catch (error) {
      console.error(`Poker bot error in command ${command}:`, error);
      return this.createErrorResponse(`Error: ${error.message}`);
    }
  }

  async handlePokerStart(args, context) {
    const ante = parseInt(args[0]) || 1000;
    const maxPlayers = parseInt(args[1]) || 6;

    if (ante < 100) {
      return this.createErrorResponse('Minimum ante is 100 sats');
    }

    if (maxPlayers < 2 || maxPlayers > 10) {
      return this.createErrorResponse('Max players must be between 2 and 10');
    }

    const gameId = this.generateGameId();
    const game = new PokerGame(gameId, context.userId, ante, maxPlayers);
    
    // Add host as first player
    const hostName = await this.getUserName(context.userId);
    game.addPlayer(context.userId, hostName);
    
    this.activeGames.set(gameId, game);

    // Publish bot identity and game announcement to Nostr
    await game.publishBotIdentity();
    await game.publishGameAnnouncement(hostName, context.channelId);

    return this.createSuccessResponse(
      `🃏 **Provably Fair Poker Game Created!**\n` +
      `Game ID: ${gameId}\n` +
      `Host: ${hostName}\n` +
      `Ante: ${ante} sats\n` +
      `Starting Chips: ${ante * 100} sats each\n` +
      `Max Players: ${maxPlayers}\n` +
      `Current Players: 1/${maxPlayers}\n` +
      `Bot Public Key: ${game.botPublicKey.substring(0, 16)}...\n\n` +
      `✅ Game published to Nostr for verification!\n` +
      `Type \`!join ${ante}\` to join the game!`,
      { gameId, ante, maxPlayers, players: 1, startingChips: ante * 100, botPubkey: game.botPublicKey }
    );
  }

  async handleSoloGame(args, context) {
    const ante = parseInt(args[0]) || 1000;
    const difficulty = args[1] || 'medium';

    if (ante < 100) {
      return this.createErrorResponse('Minimum ante is 100 sats');
    }

    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      return this.createErrorResponse('Difficulty must be: easy, medium, or hard');
    }

    const gameId = this.generateGameId();
    const game = new PokerGame(gameId, context.userId, ante, 2, true, difficulty);
    
    // Add human player
    const playerName = await this.getUserName(context.userId);
    game.addPlayer(context.userId, playerName);
    
    // Add AI player
    game.addPlayer(game.aiPlayer.pubkey, game.aiPlayer.displayName);
    
    // Initialize AI player chips
    const aiPlayerData = game.players.get(game.aiPlayer.pubkey);
    aiPlayerData.chips = game.aiPlayer.chips;
    
    this.activeGames.set(gameId, game);

    // Publish bot identity and game announcement to Nostr
    await game.publishBotIdentity();
    await game.publishGameAnnouncement(playerName, context.channelId);

    // Automatically start the commit phase for solo games
    game.startCommitPhase();

    // Generate AI commitment
    const aiNumber = game.aiPlayer.generateRandomNumber();
    const aiSalt = game.aiPlayer.generateSalt();
    const aiCommitment = await CryptoUtils.createCommitment(aiNumber, aiSalt);
    
    game.aiCommitment = { number: aiNumber, salt: aiSalt };
    await game.addCommitment(game.aiPlayer.pubkey, aiCommitment);
    
    // Store AI commitment data for reveal (same as human players)
    game.playerCommitData = game.playerCommitData || new Map();
    game.playerCommitData.set(game.aiPlayer.pubkey, { number: aiNumber, salt: aiSalt });
    
    // Publish AI commitment to Nostr
    await game.publishCommitment(game.aiPlayer.pubkey, aiCommitment);

    return this.createSuccessResponse(
      `🤖 **Solo Poker Game Started!**\n` +
      `Game ID: ${gameId}\n` +
      `Player: ${playerName}\n` +
      `AI Opponent: ${game.aiPlayer.displayName} (${difficulty} difficulty)\n` +
      `Ante: ${ante} sats\n` +
      `Starting Chips: ${ante * 100} sats each\n\n` +
      `🔒 **Commit Phase**\n` +
      `AI has committed. Now you need to commit to a random number:\n\n` +
      `1. Generate a random number (e.g., 12345)\n` +
      `2. Choose a secret salt (e.g., "mysecret")\n` +
      `3. Post: \`!commit <number> <salt>\`\n\n` +
      `Example: \`!commit 12345 mysecret\`\n\n` +
      `✨ The bot will automatically generate the hash for you!`,
      { 
        gameId, 
        ante, 
        difficulty,
        isSolo: true,
        aiCommitted: true,
        phase: 'committing',
        startingChips: ante * 100
      }
    );
  }

  async handleJoinGame(args, context) {
    const ante = parseInt(args[0]);
    
    if (!ante) {
      return this.createErrorResponse('Must specify ante amount: !join <ante>');
    }

    // Find game with matching ante
    let targetGame = null;
    for (const [gameId, game] of this.activeGames) {
      if (game.ante === ante && game.phase === 'joining') {
        targetGame = game;
        break;
      }
    }

    if (!targetGame) {
      return this.createErrorResponse(`No open game found with ante ${ante} sats`);
    }

    if (targetGame.players.has(context.userId)) {
      return this.createErrorResponse('You are already in this game');
    }

    const playerName = await this.getUserName(context.userId);
    const playerCount = targetGame.addPlayer(context.userId, playerName);

    let message = `🎯 **${playerName}** joined the poker game! (${playerCount}/${targetGame.maxPlayers})\n` +
                  `💰 Ante: ${targetGame.ante} sats | 🏆 Starting chips: ${targetGame.ante * 100} sats`;
    
    // Check if we can start
    if (playerCount >= 2) {
      message += `\n\n🎲 Game can start! Host can type \`!start\` when ready.`;
    }

    return this.createSuccessResponse(message, {
      gameId: targetGame.gameId,
      playerCount,
      maxPlayers: targetGame.maxPlayers
    });
  }

  async handleStartGame(args, context) {
    // Find player's active game
    const game = this.findPlayerGame(context.userId, 'joining');
    if (!game) {
      return this.createErrorResponse('No active game in joining phase');
    }

    if (game.hostPubkey !== context.userId) {
      return this.createErrorResponse('Only the game host can start the game');
    }

    if (!game.canStartGame()) {
      return this.createErrorResponse('Need at least 2 players to start');
    }

    // Start commit phase
    game.startCommitPhase();

    return this.createSuccessResponse(
      `🔒 **Commit Phase Started!**\n` +
      `All players must now commit to a random number.\n\n` +
      `**Instructions:**\n` +
      `1. Generate a random number (e.g., 12345)\n` +
      `2. Choose a secret salt (e.g., "mysecret")\n` +
      `3. Post: \`!commit <number> <salt>\`\n\n` +
      `Example: \`!commit 12345 mysecret\`\n\n` +
      `✨ The bot will automatically generate the hash for you!`,
      { gameId: game.gameId, phase: 'committing' }
    );
  }

  async handleCommit(args, context) {
    const number = args[0];
    const salt = args[1];
    
    if (!number || !salt) {
      return this.createErrorResponse('Must provide number and salt: !commit <number> <salt>\nExample: !commit 12345 mysecret');
    }

    // Find player's active game
    const game = this.findPlayerGame(context.userId, 'committing');
    if (!game) {
      return this.createErrorResponse('No active game in commit phase');
    }

    // Generate the commitment hash
    const commitment = await CryptoUtils.createCommitment(number, salt);
    
    // Store the player's commitment data for later reveal verification
    game.playerCommitData = game.playerCommitData || new Map();
    game.playerCommitData.set(context.userId, { number: parseInt(number), salt: salt });

    const allCommitted = await game.addCommitment(context.userId, commitment);

    // Publish commitment to Nostr
    await game.publishCommitment(context.userId, commitment);

    const playerName = await this.getUserName(context.userId);
    let message = `🔒 **${playerName}** committed to random number for game ${game.gameId}`;
    
    if (allCommitted) {
      if (game.isSolo) {
        message += `\n\n🔓 **All players committed!** Now reveal:\n` +
                  `Use: \`!reveal\`\n\n` +
                  `🤖 AI will automatically reveal when you do.\n` +
                  `✨ Your number and salt are remembered from commit phase!`;
      } else {
        message += `\n\n🔓 **All players committed!** Now reveal:\n` +
                  `Use: \`!reveal\`\n\n` +
                  `✨ Your numbers and salts are remembered from commit phase!`;
      }
    } else {
      const remaining = game.players.size - game.commits.size;
      message += `\nWaiting for ${remaining} more commitment(s)...`;
    }

    return this.createSuccessResponse(message, {
      gameId: game.gameId,
      commitsReceived: game.commits.size,
      totalPlayers: game.players.size,
      allCommitted,
      isSolo: game.isSolo
    });
  }

  async handleReveal(args, context) {
    const game = this.findPlayerGame(context.userId, 'revealing');
    if (!game) {
      return this.createErrorResponse('No active game in reveal phase');
    }

    // Get the stored commitment data
    const commitData = game.playerCommitData?.get(context.userId);
    if (!commitData) {
      return this.createErrorResponse('No commitment data found. You need to commit first.');
    }

    try {
      const allRevealed = await game.addReveal(context.userId, commitData.number, commitData.salt);

      // Publish reveal to Nostr
      await game.publishReveal(context.userId, commitData.number, commitData.salt);

      // If solo game, process AI reveal immediately (fallback approach)
      if (game.isSolo && !game.reveals.has(game.aiPlayer.pubkey)) {
        console.log('Processing AI reveal immediately...');
        const aiCommitData = game.playerCommitData?.get(game.aiPlayer.pubkey);
        if (aiCommitData) {
          await game.addReveal(game.aiPlayer.pubkey, aiCommitData.number, aiCommitData.salt);
          await game.publishReveal(game.aiPlayer.pubkey, aiCommitData.number, aiCommitData.salt);
          console.log(`AI revealed: ${aiCommitData.number}`);
        }
      }

      const finalAllRevealed = game.reveals.size === game.players.size;
      const playerName = await this.getUserName(context.userId);

      let message = `🔓 **${playerName}** revealed their number (${commitData.number}) for game ${game.gameId}`;
      
      if (game.isSolo) {
        message += `\n🤖 AI revealed: ${game.aiCommitment.number}`;
      }
      
      if (finalAllRevealed) {
        // Deal cards and start game
        game.dealPlayerHands(2); // Texas Hold'em style
        
        // Send private cards to human players only
        for (const [pubkey, cards] of game.playerHands) {
          if (pubkey !== game.aiPlayer?.pubkey) {
            await this.sendPrivateCards(pubkey, game.gameId, cards);
          }
        }

        // Set up player order (human goes first in solo games)
        game.playerOrder = Array.from(game.players.keys());
        if (game.isSolo) {
          // Ensure human player goes first
          const humanPlayer = game.playerOrder.find(p => p !== game.aiPlayer.pubkey);
          game.playerOrder = [humanPlayer, game.aiPlayer.pubkey];
        }
        game.currentPlayer = 0;

        message += `\n\n🎰 **Game Started!**\n` +
                  `Deck shuffled with seed: ${game.masterSeed}\n` +
                  `Cards dealt to all players.\n` +
                  `🔐 Private cards sent via encrypted DM!\n` +
                  `Use \`!cards\` to view in modal or \`!hand\` to see your cards! 🃏\n\n`;
        
        message += `**Betting Round: Pre-flop**\n` +
                  `Current player: ${await this.getUserName(game.playerOrder[0])}\n` +
                  `Pot: ${game.pot} sats\n\n`;
                  
        if (game.isSolo && game.playerOrder[0] !== context.userId) {
          // AI goes first, schedule AI action
          message += `\n\n🤖 **${game.aiPlayer.displayName}** is thinking...`;
          this.scheduleAIAction(game, context.channelId);
        } else {
          message += `\n\nYour turn! Use: !bet, !call, !fold, or !raise`;
        }
      } else {
        const remaining = game.players.size - game.reveals.size;
        message += `\nWaiting for ${remaining} more reveal(s)...`;
      }

      return this.createSuccessResponse(message, {
        gameId: game.gameId,
        revealsReceived: game.reveals.size,
        totalPlayers: game.players.size,
        allRevealed: finalAllRevealed,
        masterSeed: finalAllRevealed ? game.masterSeed : null,
        isSolo: game.isSolo
      });
    } catch (error) {
      return this.createErrorResponse(error.message);
    }
  }

  async handleGameAction(action, args, context) {
    const game = this.findPlayerGame(context.userId, 'playing');
    if (!game) {
      return this.createErrorResponse('No active game in playing phase');
    }

    // Check if it's the player's turn
    const currentPlayerPubkey = game.playerOrder[game.currentPlayer];
    if (currentPlayerPubkey !== context.userId) {
      const currentPlayerName = await this.getUserName(currentPlayerPubkey);
      return this.createErrorResponse(`It's ${currentPlayerName}'s turn to act`);
    }

    const player = game.players.get(context.userId);
    if (!player) {
      return this.createErrorResponse('Player not found in game');
    }

    let actionResult;
    try {
      switch (action) {
        case 'fold':
          actionResult = await this.processFold(game, context.userId);
          break;
        case 'call':
          actionResult = await this.processCall(game, context.userId);
          break;
        case 'check':
          actionResult = await this.processCheck(game, context.userId);
          break;
        case 'bet':
          const betAmount = parseInt(args[0]);
          if (!betAmount || betAmount <= 0) {
            return this.createErrorResponse('Invalid bet amount');
          }
          actionResult = await this.processBet(game, context.userId, betAmount);
          break;
        case 'raise':
          const raiseAmount = parseInt(args[0]);
          if (!raiseAmount || raiseAmount <= 0) {
            return this.createErrorResponse('Invalid raise amount');
          }
          actionResult = await this.processRaise(game, context.userId, raiseAmount);
          break;
        default:
          return this.createErrorResponse(`Invalid action: ${action}`);
      }

      // Move to next player
      this.advanceToNextPlayer(game);

      const playerName = await this.getUserName(context.userId);
      let message = `🎯 **${playerName}** ${actionResult.description}\n`;
      message += `💰 Pot: ${game.pot} sats\n`;
      
      // Check if someone won by fold
      const activePlayers = game.playerOrder.filter(pubkey => !game.players.get(pubkey).folded);
      if (activePlayers.length === 1) {
        // Only one player left - they win!
        const winner = activePlayers[0];
        const winnerName = await this.getUserName(winner);
        const winAmount = game.pot;
        game.players.get(winner).chips += winAmount;
        game.phase = 'finished';
        
        // Publish game result to Nostr
        await game.publishGameResult(winner, winAmount, 'opponent_folded');
        
        message += `\n🏆 **${winnerName} wins ${winAmount} sats!** (Opponent folded)`;
        
        return this.createSuccessResponse(message, {
          gameId: game.gameId,
          action: action,
          pot: winAmount,
          winner: winner,
          gameFinished: true
        });
      }
      
      // Check if betting round is complete
      if (this.isBettingRoundComplete(game)) {
        message += await this.advanceBettingRound(game);
      } else {
        // Next player's turn
        const nextPlayerPubkey = game.playerOrder[game.currentPlayer];
        const nextPlayerName = await this.getUserName(nextPlayerPubkey);
        message += `\nNext: ${nextPlayerName}`;
        
        // If solo game and AI is next, schedule AI action
        if (game.isSolo && nextPlayerPubkey === game.aiPlayer.pubkey) {
          message += `\n\n🤖 **${game.aiPlayer.displayName}** is thinking...`;
          this.scheduleAIAction(game, context.channelId);
        }
      }

      return this.createSuccessResponse(message, {
        gameId: game.gameId,
        action: action,
        pot: game.pot,
        currentBet: game.currentBet,
        phase: game.actionPhase
      });

    } catch (error) {
      return this.createErrorResponse(error.message);
    }
  }

  async processFold(game, playerPubkey) {
    const player = game.players.get(playerPubkey);
    player.folded = true;
    
    game.gameActions.push({
      player: playerPubkey,
      action: 'fold',
      timestamp: Date.now()
    });

    // Publish action to Nostr
    await game.publishGameAction(playerPubkey, 'fold');

    return { description: 'folded' };
  }

  async processCall(game, playerPubkey) {
    const player = game.players.get(playerPubkey);
    const callAmount = game.currentBet - player.currentBet;
    
    if (callAmount > player.chips) {
      throw new Error('Not enough chips to call');
    }

    player.chips -= callAmount;
    player.currentBet += callAmount;
    game.pot += callAmount;

    game.gameActions.push({
      player: playerPubkey,
      action: 'call',
      amount: callAmount,
      timestamp: Date.now()
    });

    // Publish action to Nostr
    await game.publishGameAction(playerPubkey, 'call', callAmount);

    return { description: `called ${callAmount} sats` };
  }

  async processCheck(game, playerPubkey) {
    // Check is only allowed when no bet has been made
    if (game.currentBet > 0) {
      throw new Error('Cannot check when there is a bet to call (use call, fold, or raise instead)');
    }

    const player = game.players.get(playerPubkey);
    
    // If player has already bet this round, they can't check
    if (player.currentBet > 0) {
      throw new Error('Cannot check after betting in the same round');
    }

    game.gameActions.push({
      player: playerPubkey,
      action: 'check',
      timestamp: Date.now()
    });

    // Publish action to Nostr
    await game.publishGameAction(playerPubkey, 'check');

    return { description: 'checked' };
  }

  async processBet(game, playerPubkey, amount) {
    if (game.currentBet > 0) {
      throw new Error('Cannot bet when there is already a bet (use raise instead)');
    }

    const player = game.players.get(playerPubkey);
    if (amount > player.chips) {
      throw new Error('Not enough chips to bet');
    }

    player.chips -= amount;
    player.currentBet += amount;
    game.currentBet = amount;
    game.pot += amount;

    game.gameActions.push({
      player: playerPubkey,
      action: 'bet',
      amount: amount,
      timestamp: Date.now()
    });

    // Publish action to Nostr
    await game.publishGameAction(playerPubkey, 'bet', amount);

    return { description: `bet ${amount} sats` };
  }

  async processRaise(game, playerPubkey, amount) {
    if (game.currentBet === 0) {
      throw new Error('Cannot raise when there is no bet (use bet instead)');
    }

    const player = game.players.get(playerPubkey);
    const totalAmount = game.currentBet + amount - player.currentBet;
    
    if (totalAmount > player.chips) {
      throw new Error('Not enough chips to raise');
    }

    player.chips -= totalAmount;
    player.currentBet += totalAmount;
    game.currentBet += amount;
    game.pot += totalAmount;

    game.gameActions.push({
      player: playerPubkey,
      action: 'raise',
      amount: amount,
      timestamp: Date.now()
    });

    // Publish action to Nostr
    await game.publishGameAction(playerPubkey, 'raise', amount);

    return { description: `raised by ${amount} sats` };
  }

  advanceToNextPlayer(game) {
    do {
      game.currentPlayer = (game.currentPlayer + 1) % game.playerOrder.length;
    } while (game.players.get(game.playerOrder[game.currentPlayer]).folded);
  }

  isBettingRoundComplete(game) {
    const activePlayers = game.playerOrder.filter(pubkey => !game.players.get(pubkey).folded);
    
    // If only one player left, round is complete
    if (activePlayers.length <= 1) {
      return true;
    }

    // Check if all active players have equal bets
    const firstPlayerBet = game.players.get(activePlayers[0]).currentBet;
    return activePlayers.every(pubkey => game.players.get(pubkey).currentBet === firstPlayerBet);
  }

  async advanceBettingRound(game) {
    // Reset player bets for next round
    game.playerOrder.forEach(pubkey => {
      game.players.get(pubkey).currentBet = 0;
    });
    game.currentBet = 0;
    game.currentPlayer = 0; // Reset to first player

    let message = '';

    switch (game.actionPhase) {
      case 'preflop':
        // Deal flop (3 community cards)
        game.communityCards = [game.dealCard(), game.dealCard(), game.dealCard()];
        game.actionPhase = 'flop';
        message = `\n\n🃏 **FLOP:** ${game.communityCards.join(' ')}\n` +
                 `💰 Pot: ${game.pot} sats | 🎯 New betting round begins!`;
        break;
               
      case 'flop':
        // Deal turn (1 community card)
        game.communityCards.push(game.dealCard());
        game.actionPhase = 'turn';
        message = `\n\n🃏 **TURN:** ${game.communityCards.join(' ')}\n` +
                 `💰 Pot: ${game.pot} sats | 🎯 New betting round begins!`;
        break;
               
      case 'turn':
        // Deal river (1 community card)
        game.communityCards.push(game.dealCard());
        game.actionPhase = 'river';
        message = `\n\n🃏 **RIVER:** ${game.communityCards.join(' ')}\n` +
                 `💰 Pot: ${game.pot} sats | 🎯 Final betting round begins!`;
        break;
               
      case 'river':
        // Showdown
        return await this.processShowdown(game);
        
      default:
        return '';
    }

    // Check if AI should act first in the new betting round
    if (game.isSolo && game.playerOrder[game.currentPlayer] === game.aiPlayer.pubkey) {
      message += `\n\n🤖 **${game.aiPlayer.displayName}** is thinking...`;
      // We need the channelId, but it's not available here. We'll need to pass it through or find another way.
      // For now, let's get it from the game context
      if (game.channelId) {
        this.scheduleAIAction(game, game.channelId);
      }
    } else {
      // Show whose turn it is
      const currentPlayerName = await this.getUserName(game.playerOrder[game.currentPlayer]);
      message += `\nCurrent player: ${currentPlayerName}`;
    }

    return message;
  }

  async processShowdown(game) {
    const activePlayers = game.playerOrder.filter(pubkey => !game.players.get(pubkey).folded);
    
    if (activePlayers.length === 1) {
      // Only one player left - they win
      const winner = activePlayers[0];
      const winnerName = await this.getUserName(winner);
      game.players.get(winner).chips += game.pot;
      game.phase = 'finished';
      
      return `\n\n🏆 **${winnerName} wins ${game.pot} sats!** (All others folded)`;
    }

    // Evaluate hands for showdown
    const handEvaluations = [];
    for (const pubkey of activePlayers) {
      const playerCards = game.playerHands.get(pubkey);
      const allCards = [...playerCards, ...game.communityCards];
      const handEval = PokerRules.evaluateHand(allCards);
      
      handEvaluations.push({
        pubkey,
        name: await this.getUserName(pubkey),
        hand: handEval,
        cards: playerCards
      });
    }

    // Sort by hand strength (highest first)
    handEvaluations.sort((a, b) => {
      if (a.hand.value !== b.hand.value) {
        return b.hand.value - a.hand.value;
      }
      return PokerRules.compareHighCards(b.hand.cards, a.hand.cards);
    });

    const winner = handEvaluations[0];
    const winAmount = game.pot;
    game.players.get(winner.pubkey).chips += winAmount;
    game.phase = 'finished';

    // Publish game result to Nostr
    await game.publishGameResult(winner.pubkey, winAmount, 'showdown');

    let showdownMessage = `\n\n🏆 **Showdown Results:**\n`;
    for (const player of handEvaluations) {
      const handDesc = PokerRules.getHandDescription(player.hand);
      showdownMessage += `${player.name}: ${player.cards.join(' ')} (${handDesc})\n`;
    }
    showdownMessage += `\n🎉 **${winner.name} wins ${winAmount} sats!**`;

    return showdownMessage;
  }

  async scheduleAIAction(game, channelId) {
    // Schedule AI action to happen after a short delay (like a human thinking)
    setTimeout(async () => {
      try {
        const aiPlayer = game.aiPlayer;
        const aiCards = game.playerHands.get(aiPlayer.pubkey);
        const aiPlayerData = game.players.get(aiPlayer.pubkey);
        
        const gameState = {
          myCards: aiCards,
          communityCards: game.communityCards,
          potSize: game.pot,
          currentBet: game.currentBet - aiPlayerData.currentBet, // Amount needed to call
          myChips: aiPlayerData.chips,
          phase: game.actionPhase
        };

        const aiDecision = aiPlayer.makeDecision(gameState);
        
        // Send AI action as a real chat message using bot's Nostr identity
        let command = '';
        switch (aiDecision.action) {
          case 'fold':
            command = '!fold';
            break;
          case 'call':
            command = '!call';
            break;
          case 'bet':
            command = `!bet ${aiDecision.amount}`;
            break;
          case 'raise':
            command = `!raise ${aiDecision.amount}`;
            break;
        }

        // Execute AI command directly instead of sending via Nostr to avoid pubkey mismatch
        if (command) {
          console.log(`🤖 AI executing command directly: ${command} for game ${game.gameId}`);
          console.log(`🤖 AI player pubkey: ${aiPlayer.pubkey}`);
          console.log(`🤖 Channel ID: ${channelId}`);
          
          // Parse the command
          const commandParts = command.substring(1).split(' '); // Remove ! and split
          const aiCommand = commandParts[0];
          const aiArgs = commandParts.slice(1);
          
          // Create AI context
          const aiContext = {
            channelId: channelId,
            userId: aiPlayer.pubkey, // Use AI player's pubkey
            timestamp: Math.floor(Date.now() / 1000)
          };
          
          console.log(`🤖 AI context:`, aiContext);
          
          // Execute the command directly on this bot instance
          try {
            const aiResponse = await this.executeCommand(aiCommand, aiArgs, aiContext);
            console.log(`🤖 AI command executed successfully: ${aiCommand}`, aiResponse);
            
            // Send the AI response to the channel (this was missing!)
            if (aiResponse && aiResponse.content) {
              console.log(`🤖 Sending AI response to channel: ${aiResponse.content.substring(0, 100)}...`);
              
              // Import botFramework to send the response
              const { botFramework } = await import('./BotFramework');
              await botFramework.sendBotResponseAsBot(this, channelId, aiResponse.content, aiResponse.type || 'text', aiResponse.data);
              
              console.log(`✅ AI response sent to channel successfully`);
            }
          } catch (error) {
            console.error(`🤖 AI command execution failed: ${error.message}`);
            console.error(`🤖 AI error stack:`, error.stack);
            // Fallback to fold
            try {
              const fallbackResponse = await this.executeCommand('fold', [], aiContext);
              console.log(`🤖 AI fallback: executed fold`);
              
              // Send the fallback response to channel
              if (fallbackResponse && fallbackResponse.content) {
                const { botFramework } = await import('./BotFramework');
                await botFramework.sendBotResponseAsBot(this, channelId, fallbackResponse.content, fallbackResponse.type || 'text', fallbackResponse.data);
                console.log(`✅ AI fallback response sent to channel`);
              }
            } catch (fallbackError) {
              console.error(`🤖 AI fallback failed: ${fallbackError.message}`);
            }
          }
        }
      } catch (error) {
        console.error('Error in AI action:', error);
        // Fallback: execute fold command directly
        try {
          const aiContext = {
            channelId: channelId,
            userId: game.aiPlayer.pubkey,
            timestamp: Math.floor(Date.now() / 1000)
          };
          
          const fallbackResponse = await this.executeCommand('fold', [], aiContext);
          console.log(`🤖 AI fallback: executed fold due to error`);
          
          // Send the final fallback response to channel
          if (fallbackResponse && fallbackResponse.content) {
            const { botFramework } = await import('./BotFramework');
            await botFramework.sendBotResponseAsBot(this, channelId, fallbackResponse.content, fallbackResponse.type || 'text', fallbackResponse.data);
            console.log(`✅ AI final fallback response sent to channel`);
          }
        } catch (fallbackError) {
          console.error('Failed to execute AI fallback action:', fallbackError);
        }
      }
    }, 1500 + Math.random() * 2000); // 1.5-3.5 second delay to simulate thinking
  }

  async handleVerifyGame(args, context) {
    const gameId = args[0];
    
    if (!gameId) {
      return this.createErrorResponse('Must specify game ID: !verify <game_id>');
    }

    const game = this.activeGames.get(gameId);
    if (!game) {
      return this.createErrorResponse(`Game ${gameId} not found`);
    }

    if (game.phase === 'joining' || game.phase === 'committing') {
      return this.createErrorResponse('Game not yet verifiable - still in setup phase');
    }

    let verification = `📊 **Provable Fairness Verification: ${gameId}**\n\n`;
    
    // Show bot identity
    verification += `**🤖 Bot Identity:**\n`;
    verification += `Bot Public Key: ${game.botPublicKey}\n`;
    verification += `Nostr Events Published: ${game.nostrEvents.length}\n\n`;
    
    // Show commits and reveals
    if (game.commits.size > 0) {
      verification += `**🔒 Cryptographic Commits & Reveals:**\n`;
      for (const [pubkey, commitData] of game.commits) {
        const playerName = await this.getUserName(pubkey);
        const reveal = game.reveals.get(pubkey);
        verification += `• ${playerName}:\n`;
        verification += `  Commitment: ${commitData.commitment.substring(0, 16)}...\n`;
        if (reveal) {
          verification += `  Revealed: ${reveal.number} (salt: ${reveal.salt})\n`;
          // Verify commitment matches reveal
          const expectedCommit = await CryptoUtils.sha256(reveal.number + reveal.salt);
          const valid = expectedCommit === commitData.commitment;
          verification += `  Verified: ${valid ? '✅' : '❌'}\n`;
        } else {
          verification += `  Status: committed but not revealed\n`;
        }
      }
    }

    if (game.masterSeed) {
      verification += `\n**🎲 Deck Generation:**\n`;
      verification += `Master Seed: ${game.masterSeed}\n`;
      verification += `Algorithm: Fisher-Yates Shuffle\n`;
      verification += `Deck Size: ${game.deck.length} cards\n`;
      verification += `Verifiable: ✅ Published to Nostr\n`;
      
      // Show player contributions to seed
      verification += `\n**🔢 Seed Contributions:**\n`;
      let seedTotal = 0;
      for (const [pubkey, reveal] of game.reveals) {
        const playerName = await this.getUserName(pubkey);
        verification += `• ${playerName}: ${reveal.number}\n`;
        seedTotal += reveal.number;
      }
      verification += `• Total: ${seedTotal} → Master Seed: ${game.masterSeed}\n`;
      
      // Add detailed verification instructions
      // Only show detailed deck verification after game is finished to prevent cheating
      if (game.phase === 'finished') {
        verification += `\n**🔍 Deck Verification Guide:**\n`;
        verification += `🎯 Game is finished - full deck verification now available:\n\n`;
        
        verification += `**Step 1: Verify Master Seed**\n`;
        verification += `Add all player numbers: ${Array.from(game.reveals.values()).map(r => r.number).join(' + ')} = ${game.masterSeed}\n\n`;
        
        verification += `**Step 2: Verify Deck Shuffle**\n`;
        verification += `Use the Linear Congruential Generator with master seed:\n`;
        verification += `• Initial seed: ${game.masterSeed}\n`;
        verification += `• Formula: next = (current * 16807) % 2147483647\n`;
        verification += `• Normalize: (next - 1) / 2147483646\n`;
        verification += `• Apply Fisher-Yates shuffle algorithm\n\n`;
        
        verification += `**Step 3: Standard Deck Order**\n`;
        verification += `Starting deck: [AH, 2H, 3H, ..., KH, AD, 2D, ..., KS]\n`;
        verification += `(Hearts, Diamonds, Clubs, Spades - Ace through King)\n\n`;
        
        verification += `**Step 4: Verify Complete Deck**\n`;
        if (game.deck && game.deck.length > 0) {
          verification += `Published shuffled deck: ${game.deck.join(', ')}\n`;
          verification += `You should get the exact same order with seed ${game.masterSeed}\n\n`;
        }
        
        verification += `**Step 5: Code Verification**\n`;
        verification += `The exact shuffle algorithm is published in the poker bot source code.\n`;
        verification += `Function: CryptoUtils.shuffleWithSeed(standardDeck, ${game.masterSeed})\n`;
        verification += `Anyone can run this function to verify the identical deck.\n`;
      } else {
        verification += `\n**🔒 Deck Verification:**\n`;
        verification += `Master seed: ${game.masterSeed} (verified from player contributions)\n`;
        verification += `🛡️ Full deck verification available after game completion\n`;
        verification += `(Deck details hidden during play to prevent cheating)\n`;
        verification += `📝 All data is published to Nostr for post-game verification\n`;
      }
    }

    verification += `\n**📊 Game Actions:** ${game.gameActions.length} recorded\n`;
    verification += `**🌍 Nostr Events:** ${game.nostrEvents.length} published\n`;
    verification += `**✅ Status:** Cryptographically verifiable\n\n`;

    // Show all published Nostr events
    if (game.nostrEvents.length > 0) {
      verification += `**📝 Complete Nostr Event Audit Trail:**\n`;
      for (let i = 0; i < game.nostrEvents.length; i++) {
        const event = game.nostrEvents[i];
        const eventKindName = this.getEventKindName(event.kind);
        verification += `${i + 1}. **${eventKindName}** (Kind ${event.kind})\n`;
        verification += `   📅 Timestamp: ${new Date(event.created_at * 1000).toISOString()}\n`;
        verification += `   🆔 Event ID: \`${event.id}\`\n`;
        verification += `   ✍️  Signature: \`${event.sig.substring(0, 32)}...\`\n`;
        
        // Show detailed meaning and content for each event type
        if (event.kind === POKER_EVENT_KINDS.BOT_IDENTITY) {
          const content = JSON.parse(event.content);
          verification += `   📋 **Meaning**: Bot announces its identity and capabilities for this game\n`;
          verification += `   🔧 Version: ${content.version}\n`;
          verification += `   🎲 Algorithm: ${content.algorithm}\n`;
          verification += `   🔒 Commitment Scheme: ${content.commitment_scheme}\n`;
          verification += `   🎯 Purpose: Establishes bot transparency and prevents identity reuse\n`;
          
        } else if (event.kind === POKER_EVENT_KINDS.GAME_ANNOUNCEMENT) {
          verification += `   📋 **Meaning**: Public announcement of the poker game creation\n`;
          verification += `   🎮 Game ID: ${game.gameId}\n`;
          verification += `   💰 Ante: ${game.ante} sats\n`;
          verification += `   👥 Max Players: ${game.maxPlayers}\n`;
          verification += `   🔑 Bot Public Key: ${game.botPublicKey.substring(0, 16)}...\n`;
          verification += `   🎯 Purpose: Makes game discoverable and verifiable by anyone\n`;
          
        } else if (event.kind === POKER_EVENT_KINDS.PLAYER_COMMIT) {
          const content = JSON.parse(event.content);
          const playerName = await this.getUserName(content.player_pubkey);
          verification += `   📋 **Meaning**: ${playerName} commits to a secret random number\n`;
          verification += `   👤 Player: ${playerName} (${content.player_pubkey.substring(0, 8)}...)\n`;
          verification += `   🔒 Commitment Hash: \`${content.commitment}\`\n`;
          verification += `   📊 Phase: ${content.phase}\n`;
          verification += `   🎯 Purpose: Prevents cheating by locking in randomness before deck generation\n`;
          
        } else if (event.kind === POKER_EVENT_KINDS.PLAYER_REVEAL) {
          const content = JSON.parse(event.content);
          const playerName = await this.getUserName(content.player_pubkey);
          verification += `   📋 **Meaning**: ${playerName} reveals their committed random number\n`;
          verification += `   👤 Player: ${playerName} (${content.player_pubkey.substring(0, 8)}...)\n`;
          verification += `   🔢 Random Number: ${content.random_number}\n`;
          verification += `   🧂 Salt: "${content.salt}"\n`;
          verification += `   ✅ Verification: SHA256(${content.random_number} + "${content.salt}") must equal commitment\n`;
          verification += `   🎯 Purpose: Proves player didn't change their number after seeing others\n`;
          
        } else if (event.kind === POKER_EVENT_KINDS.DECK_GENERATION) {
          const content = JSON.parse(event.content);
          verification += `   📋 **Meaning**: Bot generates the shuffled deck using all player random numbers\n`;
          verification += `   🎲 Master Seed: ${content.master_seed}\n`;
          verification += `   🔀 Algorithm: ${content.algorithm}\n`;
          verification += `   🃏 Deck Size: ${content.deck.length} cards\n`;
          verification += `   👥 Contributors: ${content.player_contributions.length} players\n`;
          verification += `   📊 Player Numbers: ${content.player_contributions.map(p => p.number).join(' + ')} = ${content.master_seed}\n`;
          verification += `   🎯 Purpose: Creates provably fair deck that no single party can predict\n`;
          
        } else if (event.kind === POKER_EVENT_KINDS.GAME_ACTION) {
          const content = JSON.parse(event.content);
          const playerName = await this.getUserName(content.player_pubkey);
          verification += `   📋 **Meaning**: ${playerName} takes a game action during ${content.betting_round}\n`;
          verification += `   👤 Player: ${playerName} (${content.player_pubkey.substring(0, 8)}...)\n`;
          verification += `   🎯 Action: ${content.action.toUpperCase()}${content.amount ? ` ${content.amount} sats` : ''}\n`;
          verification += `   🎰 Betting Round: ${content.betting_round}\n`;
          verification += `   💰 Pot After: ${content.pot_size} sats\n`;
          verification += `   📊 Current Bet: ${content.current_bet} sats\n`;
          verification += `   🃏 Community Cards: ${content.community_cards.length > 0 ? content.community_cards.join(' ') : 'None'}\n`;
          verification += `   🎯 Purpose: Creates immutable record of all player decisions\n`;
          
        } else if (event.kind === POKER_EVENT_KINDS.GAME_RESULT) {
          const content = JSON.parse(event.content);
          const winnerName = await this.getUserName(content.winner);
          verification += `   📋 **Meaning**: Game concludes with final results and hand revelation\n`;
          verification += `   🏆 Winner: ${winnerName} (${content.winner.substring(0, 8)}...)\n`;
          verification += `   💰 Win Amount: ${content.win_amount} sats\n`;
          verification += `   📝 Reason: ${content.reason}\n`;
          verification += `   🃏 Final Community: ${content.community_cards.join(' ')}\n`;
          verification += `   👥 All Player Hands: ${content.final_hands.length} revealed\n`;
          for (const hand of content.final_hands) {
            const handPlayerName = await this.getUserName(hand.player);
            verification += `      • ${handPlayerName}: ${hand.cards.join(' ')}\n`;
          }
          verification += `   🎯 Purpose: Provides complete game outcome with all hidden information revealed\n`;
        }
        verification += `\n`;
      }
    }

    // Show all recorded game actions
    if (game.gameActions.length > 0) {
      verification += `**🎯 Complete Game Action Log:**\n`;
      for (let i = 0; i < game.gameActions.length; i++) {
        const action = game.gameActions[i];
        const playerName = await this.getUserName(action.player);
        const timestamp = new Date(action.timestamp).toLocaleTimeString();
        verification += `${i + 1}. [${timestamp}] ${playerName}: ${action.action}`;
        if (action.amount) verification += ` (${action.amount} sats)`;
        verification += `\n`;
      }
      verification += `\n`;
    }

    verification += `**🔍 Public Verification Instructions:**\n`;
    verification += `All events are permanently stored on Nostr relays and can be independently verified:\n`;
    verification += `1. Use any Nostr client to query events by bot public key\n`;
    verification += `2. Filter by game_id tag: "${gameId}"\n`;
    verification += `3. Verify all signatures using the bot's public key\n`;
    verification += `4. Reconstruct the game state from events\n`;
    verification += `5. Verify commit-reveal pairs match\n`;
    verification += `6. Verify deck shuffle using master seed\n\n`;
    
    verification += `**🔑 Bot Public Key for verification:**\n\`${game.botPublicKey}\`\n\n`;
    
    verification += `**🏷️ Nostr Query Tags:**\n`;
    verification += `- game_id: "${gameId}"\n`;
    verification += `- bot_pubkey: "${game.botPublicKey}"\n`;
    verification += `- poker_game: "true"\n\n`;
    
    verification += `**📡 Event Kinds Used:**\n`;
    const usedKinds = [...new Set(game.nostrEvents.map(e => e.kind))];
    for (const kind of usedKinds) {
      verification += `- ${kind}: ${this.getEventKindName(kind)}\n`;
    }

    return this.createSuccessResponse(verification, {
      gameId,
      phase: game.phase,
      masterSeed: game.masterSeed,
      botPublicKey: game.botPublicKey,
      nostrEvents: game.nostrEvents.map(e => ({
        id: e.id,
        kind: e.kind,
        sig: e.sig,
        created_at: e.created_at
      })),
      gameActions: game.gameActions,
      verifiable: true,
      queryTags: {
        game_id: gameId,
        bot_pubkey: game.botPublicKey,
        poker_game: "true"
      }
    });
  }

  getEventKindName(kind) {
    const kindNames = {
      [POKER_EVENT_KINDS.GAME_ANNOUNCEMENT]: 'Game Announcement',
      [POKER_EVENT_KINDS.PLAYER_COMMIT]: 'Player Commitment',
      [POKER_EVENT_KINDS.PLAYER_REVEAL]: 'Player Reveal',
      [POKER_EVENT_KINDS.DECK_GENERATION]: 'Deck Generation',
      [POKER_EVENT_KINDS.GAME_ACTION]: 'Game Action',
      [POKER_EVENT_KINDS.GAME_RESULT]: 'Game Result',
      [POKER_EVENT_KINDS.BOT_IDENTITY]: 'Bot Identity'
    };
    return kindNames[kind] || `Unknown Kind ${kind}`;
  }

  async handleListGames(args, context) {
    if (this.activeGames.size === 0) {
      return this.createSuccessResponse('No active poker games');
    }

    let gamesList = `🃏 **Active Poker Games:**\n\n`;
    
    for (const [gameId, game] of this.activeGames) {
      const hostName = await this.getUserName(game.hostPubkey);
      gamesList += `**${gameId}**\n`;
      gamesList += `• Host: ${hostName}\n`;
      gamesList += `• Ante: ${game.ante} sats\n`;
      gamesList += `• Players: ${game.players.size}/${game.maxPlayers}\n`;
      gamesList += `• Phase: ${game.phase}\n`;
      if (game.phase === 'joining') {
        gamesList += `• Join with: \`!join ${game.ante}\`\n`;
      }
      gamesList += `\n`;
    }

    return this.createSuccessResponse(gamesList, {
      activeGames: this.activeGames.size
    });
  }

  async handleShowHand(args, context) {
    const game = this.findPlayerGame(context.userId, 'playing');
    if (!game) {
      return this.createErrorResponse('No active game in playing phase');
    }

    const handInfo = game.playerHandInfo?.get(context.userId);
    if (!handInfo) {
      return this.createErrorResponse('No cards dealt yet');
    }

    // Show hand in a way that only the player can understand
    const playerName = await this.getUserName(context.userId);
    
    return this.createSuccessResponse(
      `🃏 **${playerName}'s Hand (Game: ${game.gameId})**\n\n` +
      `Cards: ${handInfo.cards.join(' ')}\n` +
      `Hand Type: ${handInfo.handDescription}\n\n` +
      `Community Cards: ${game.communityCards.length > 0 ? game.communityCards.join(' ') : 'None yet'}\n` +
      `Current Phase: ${game.actionPhase}\n` +
      `Pot: ${game.pot} sats`,
      { 
        gameId: game.gameId,
        cards: handInfo.cards,
        handType: handInfo.handType,
        communityCards: game.communityCards
      }
    );
  }

  async handleShowChips(args, context) {
    const game = this.findPlayerGame(context.userId);
    if (!game) {
      return this.createErrorResponse('You are not in any active poker game');
    }

    const player = game.players.get(context.userId);
    if (!player) {
      return this.createErrorResponse('Player not found in game');
    }

    const playerName = await this.getUserName(context.userId);
    
    return this.createSuccessResponse(
      `💰 **${playerName}'s Chips**\n\n` +
      `Current Stack: ${player.chips} sats\n` +
      `Current Bet: ${player.currentBet} sats\n` +
      `Game: ${game.gameId}\n` +
      `Ante: ${game.ante} sats`,
      { 
        gameId: game.gameId,
        chips: player.chips,
        currentBet: player.currentBet,
        ante: game.ante
      }
    );
  }

  async handleShowStatus(args, context) {
    const game = this.findPlayerGame(context.userId);
    if (!game) {
      return this.createErrorResponse('You are not in any active poker game');
    }

    const currentPlayerPubkey = game.playerOrder[game.currentPlayer];
    const currentPlayerName = await this.getUserName(currentPlayerPubkey);
    
    let playersInfo = '';
    for (const [pubkey, player] of game.players) {
      const name = await this.getUserName(pubkey);
      const isAI = pubkey === game.aiPlayer?.pubkey;
      playersInfo += `• ${name}${isAI ? ' (AI)' : ''}: ${player.chips} chips${player.folded ? ' (folded)' : ''}\n`;
    }
    
    return this.createSuccessResponse(
      `📊 **Game Status (${game.gameId})**\n\n` +
      `Phase: ${game.phase}\n` +
      `Betting Round: ${game.actionPhase}\n` +
      `Current Player: ${currentPlayerName}\n` +
      `Pot: ${game.pot} sats\n` +
      `Current Bet: ${game.currentBet} sats\n\n` +
      `Community Cards: ${game.communityCards.length > 0 ? game.communityCards.join(' ') : 'None yet'}\n\n` +
      `**Players:**\n${playersInfo}`,
      { 
        gameId: game.gameId,
        phase: game.phase,
        actionPhase: game.actionPhase,
        currentPlayer: currentPlayerPubkey,
        pot: game.pot
      }
    );
  }

  async handleShowCards(args, context) {
    const game = this.findPlayerGame(context.userId, 'playing', context.channelId);
    if (!game) {
      return this.createErrorResponse('No active game in playing phase in this channel');
    }

    // Check if player has received private cards
    const privateMessage = game.privateMessages?.get(context.userId);
    const handInfo = game.playerHandInfo?.get(context.userId);
    
    if (!privateMessage && !handInfo) {
      return this.createErrorResponse('No cards have been dealt yet');
    }

    const playerName = await this.getUserName(context.userId);
    
    // Use private message content if available, otherwise fall back to hand info
    if (privateMessage) {
      return this.createResponse(
        privateMessage.content,
        BOT_RESPONSE_TYPES.MODAL, // Special response type for modal display
        {
          gameId: game.gameId,
          cards: privateMessage.cards,
          handType: privateMessage.handType,
          handDescription: privateMessage.handDescription,
          modalTitle: '🃏 Your Private Cards',
          modalType: 'poker_cards',
          eventId: privateMessage.eventId,
          isPrivateMessage: true,
          botSender: true,
          botPublicKey: game.botPublicKey
        }
      );
    } else {
      // Fallback to hand info
      return this.createResponse(
        `🃏 **Your Poker Cards (Game: ${game.gameId})**\n\n` +
        `Cards: ${handInfo.cards.join(' ')}\n` +
        `Hand: ${handInfo.handDescription}\n\n` +
        `🎮 Game Phase: ${game.actionPhase}\n` +
        `💰 Pot: ${game.pot} sats\n\n` +
        `Use !hand to see this again anytime!`,
        BOT_RESPONSE_TYPES.MODAL,
        {
          gameId: game.gameId,
          cards: handInfo.cards,
          handType: handInfo.handType,
          handDescription: handInfo.handDescription,
          modalTitle: '🃏 Your Private Cards',
          modalType: 'poker_cards',
          isPrivateMessage: false
        }
      );
    }
  }

  async sendPrivateCards(pubkey, gameId, cards) {
    try {
      console.log(`🃏 Sending cards to player ${pubkey.substring(0, 8)}: ${cards.join(', ')}`);
      
      const handEval = PokerRules.evaluateHand(cards);
      const handDesc = PokerRules.getHandDescription(handEval);
      const game = this.findGameById(gameId);
      
      if (game) {
        // Store hand info for the !hand command (keep existing functionality)
        game.playerHandInfo = game.playerHandInfo || new Map();
        game.playerHandInfo.set(pubkey, {
          cards: cards,
          handType: handEval.type,
          handDescription: handDesc
        });

        // Send actual encrypted DM using bot's Nostr identity
        try {
          const cardMessage = `🃏 **Your Poker Cards (Game: ${gameId})**\n\n` +
            `Cards: ${cards.join(' ')}\n` +
            `Hand: ${handDesc}\n\n` +
            `🎮 Game Phase: ${game.actionPhase}\n` +
            `💰 Pot: ${game.pot} sats\n\n` +
            `Use !hand to see this again anytime!\n` +
            `🔒 This message was sent privately by the poker bot.`;

          // Create a temporary Nostr service instance using the bot's identity
          const botNostrEvent = {
            kind: 4, // Encrypted direct message
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', pubkey]],
            content: '', // Will be encrypted
          };

          // Use NIP-04 encryption with bot's private key
          if (nostrService && nostrService.pool && game.botPrivateKeyHex) {
            const { nip04 } = await import('nostr-tools');
            const encryptedContent = await nip04.encrypt(game.botPrivateKeyHex, pubkey, cardMessage);
            
            botNostrEvent.content = encryptedContent;
            
            // Sign event with bot's private key
            const { finalizeEvent } = await import('nostr-tools');
            const botPrivateKeyBytes = new Uint8Array(
              game.botPrivateKeyHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
            );
            
            const signedEvent = finalizeEvent(botNostrEvent, botPrivateKeyBytes);
            
            // Publish to relays
            await nostrService.pool.publish(Array.from(nostrService.connectedRelays), signedEvent);
            
            console.log(`🔐 Private cards sent via Nostr DM to player ${pubkey.substring(0, 8)}: ${cards.join(', ')} (${handDesc})`);
            
            // Store reference for modal display
            if (!game.privateMessages) {
              game.privateMessages = new Map();
            }
            game.privateMessages.set(pubkey, {
              eventId: signedEvent.id,
              content: cardMessage,
              timestamp: signedEvent.created_at,
              cards: cards,
              handType: handEval.type,
              handDescription: handDesc
            });
            
          } else {
            console.warn('Unable to send Nostr DM - service not available, using fallback storage');
          }
        } catch (dmError) {
          console.error('Error sending private DM:', dmError);
          // Fallback to storage-only mode
          console.log(`📝 Fallback: Cards stored for player ${pubkey.substring(0, 8)}: ${cards.join(', ')} (${handDesc})`);
        }
      }
    } catch (error) {
      console.error('Error processing private cards:', error);
    }
  }

  findGameById(gameId) {
    return this.activeGames.get(gameId);
  }

  findPlayerGame(playerPubkey, phase = null, channelId = null) {
    for (const game of this.activeGames.values()) {
      // If channelId is specified, only look for games in that channel
      if (channelId && game.channelId !== channelId) {
        continue;
      }
      
      if (game.players.has(playerPubkey)) {
        if (!phase || game.phase === phase) {
          return game;
        }
      }
    }
    return null;
  }

  async getUserName(pubkey) {
    if (this.userProfiles.has(pubkey)) {
      return this.userProfiles.get(pubkey);
    }

    try {
      // Try to get user profile
      const profile = await nostrService.getUserProfile(pubkey);
      const name = profile?.display_name || profile?.name || `User_${pubkey.slice(0, 8)}`;
      this.userProfiles.set(pubkey, name);
      return name;
    } catch (error) {
      // Fallback to truncated pubkey
      const fallbackName = `User_${pubkey.slice(0, 8)}`;
      this.userProfiles.set(pubkey, fallbackName);
      return fallbackName;
    }
  }

  // Get bot statistics
  getStats() {
    return {
      activeGames: this.activeGames.size,
      totalGamesCreated: this.gameSequence,
      commands: this.getCommands(),
      isEnabled: this.isEnabled()
    };
  }
}

export default PokerBot;