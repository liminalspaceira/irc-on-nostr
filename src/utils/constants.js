// Nostr Event Kinds
export const EVENT_KINDS = {
  METADATA: 0,
  TEXT_NOTE: 1,
  RECOMMEND_SERVER: 2,
  CONTACTS: 3,
  ENCRYPTED_DM: 4,
  DELETE: 5,
  
  // NIP-28 Channel Events
  CHANNEL_CREATION: 40,
  CHANNEL_METADATA: 41,
  CHANNEL_MESSAGE: 42,
  CHANNEL_HIDE_MESSAGE: 43,
  CHANNEL_MUTE_USER: 44,
  
  // Custom IRC Events (Proposed)
  CHANNEL_MODERATION: 45,  // kick/ban/op actions
  BOT_COMMAND: 46,         // bot commands and responses
  CHANNEL_MODE: 47,        // channel modes and settings
  USER_PRESENCE: 48,       // user presence/status updates
};

// Default Nostr Relays
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.current.fyi',
  'wss://nostr.wine',
  'wss://eden.nostr.land',
  // Additional relays
  'wss://relay.nostr.info',
  'wss://nostr.zebedee.cloud',
  'wss://relay.nostrgraph.net',
  'wss://nostr.fmt.wiz.biz',
  'wss://relay.nostr.bg',
  'wss://nostr.oxtr.dev',
  'wss://nostr.bitcoiner.social',
  'wss://relay.nostr.com',
  'wss://nostr.mutinywallet.com'
];

// IRC Commands
export const IRC_COMMANDS = {
  // Channel Commands
  JOIN: '/join',
  PART: '/part',
  LEAVE: '/leave',
  TOPIC: '/topic',
  
  // User Commands
  NICK: '/nick',
  MSG: '/msg',
  WHOIS: '/whois',
  USERS: '/users',
  
  // Moderation Commands
  KICK: '/kick',
  BAN: '/ban',
  UNBAN: '/unban',
  MUTE: '/mute',
  UNMUTE: '/unmute',
  OP: '/op',
  DEOP: '/deop',
  
  // Utility Commands
  HELP: '/help',
  QUIT: '/quit',
  CLEAR: '/clear'
};

// Bot Commands
export const BOT_COMMANDS = {
  USERS: '!users',
  UPTIME: '!uptime',
  WEATHER: '!weather',
  ROLL: '!roll',
  HELP: '!help',
  STATS: '!stats',
  TIME: '!time',
  QUOTE: '!quote',
  TRANSLATE: '!translate',
  REMIND: '!remind'
};

// Channel Modes
export const CHANNEL_MODES = {
  MODERATED: 'm',      // Only ops can speak
  INVITE_ONLY: 'i',    // Invite only
  NO_EXTERNAL: 'n',    // No external messages
  TOPIC_LOCKED: 't',   // Only ops can change topic
  SECRET: 's',         // Secret channel
  PRIVATE: 'p'         // Private channel
};

// User Modes
export const USER_MODES = {
  OPERATOR: 'o',       // Channel operator
  VOICE: 'v',          // Can speak in moderated channels
  BANNED: 'b',         // Banned from channel
  MUTED: 'm',          // Cannot speak
  INVISIBLE: 'i'       // Invisible to user lists
};

// App Theme Colors
export const THEMES = {
  DARK: {
    name: 'dark',
    // Main backgrounds - deep charcoal gradient
    backgroundColor: '#0f0f0f',           // Deepest black-grey
    cardBackgroundColor: '#1a1a1a',      // Card/post background
    surfaceColor: '#141414',             // Input fields, buttons
    
    // Primary colors - elegant purple-grey accent
    primaryColor: '#8b5cf6',             // Primary purple (violet-500)
    secondaryColor: '#a78bfa',           // Lighter purple (violet-400)
    accentColor: '#c4b5fd',              // Lightest purple (violet-300)
    
    // Text colors - high contrast greys
    textColor: '#f8fafc',                // Pure white for main text
    secondaryTextColor: '#94a3b8',       // Medium grey for secondary text
    mutedTextColor: '#64748b',           // Muted grey for timestamps
    
    // Border and dividers - subtle greys
    borderColor: '#374151',              // Subtle border grey
    dividerColor: '#1f2937',             // Darker divider
    
    // Status colors - modern and vibrant
    errorColor: '#f87171',               // Soft red (red-400)
    successColor: '#34d399',             // Emerald green (emerald-400) 
    warningColor: '#fbbf24',             // Amber (amber-400)
    
    // Interactive states
    hoverColor: '#1f2937',               // Hover background
    pressedColor: '#111827',             // Pressed state
    
    // Special accent colors for features
    likeColor: '#ec4899',                // Pink for likes (pink-500)
    repostColor: '#06b6d4',              // Cyan for reposts (cyan-500)
    replyColor: '#10b981',               // Emerald for replies (emerald-500)
  },
  LIGHT: {
    name: 'light',
    backgroundColor: '#ffffff',
    cardBackgroundColor: '#f8fafc',
    surfaceColor: '#f1f5f9',
    primaryColor: '#0066cc',
    secondaryColor: '#3b82f6',
    textColor: '#1e293b',
    secondaryTextColor: '#64748b',
    borderColor: '#e2e8f0',
    errorColor: '#ef4444',
    successColor: '#10b981',
    warningColor: '#f59e0b'
  }
};

// Message Types
export const MESSAGE_TYPES = {
  NORMAL: 'normal',
  SYSTEM: 'system',
  ACTION: 'action',
  BOT_RESPONSE: 'bot_response',
  ERROR: 'error',
  JOIN: 'join',
  PART: 'part',
  KICK: 'kick',
  BAN: 'ban',
  TOPIC: 'topic'
};

// Bot Response Types
export const BOT_RESPONSE_TYPES = {
  TEXT: 'text',
  EMBED: 'embed',
  IMAGE: 'image',
  LIST: 'list',
  ERROR: 'error'
};

// Regular Expressions
export const REGEX = {
  URL: /(https?:\/\/[^\s]+)/gi,
  IMAGE_URL: /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s]*)?)/gi,
  MENTION: /@([a-f0-9]{64}|[a-zA-Z0-9_]+)/gi,
  CHANNEL: /#([a-zA-Z0-9_-]+)/gi,
  IRC_COMMAND: /^\/(\w+)(?:\s+(.*))?$/,
  BOT_COMMAND: /^!(\w+)(?:\s+(.*))?$/,
  DICE_ROLL: /^(\d+)?d(\d+)(?:\+(\d+))?$/i
};

// Storage Keys
export const STORAGE_KEYS = {
  PRIVATE_KEY: 'nostr_private_key',
  PUBLIC_KEY: 'nostr_public_key',
  RELAYS: 'nostr_relays',
  PROFILE: 'user_profile',
  CHANNELS: 'user_channels',
  THEME: 'app_theme',
  SETTINGS: 'app_settings'
};

// Error Messages
export const ERROR_MESSAGES = {
  NO_PRIVATE_KEY: 'No private key found. Please set up your Nostr identity.',
  RELAY_CONNECTION_FAILED: 'Failed to connect to Nostr relays.',
  CHANNEL_NOT_FOUND: 'Channel not found.',
  PERMISSION_DENIED: 'You do not have permission to perform this action.',
  INVALID_COMMAND: 'Invalid command. Type /help for available commands.',
  BOT_COMMAND_FAILED: 'Bot command failed to execute.',
  MESSAGE_SEND_FAILED: 'Failed to send message.',
  CHANNEL_JOIN_FAILED: 'Failed to join channel.'
};

// Success Messages
export const SUCCESS_MESSAGES = {
  CHANNEL_CREATED: 'Channel created successfully!',
  CHANNEL_JOINED: 'Joined channel successfully!',
  CHANNEL_LEFT: 'Left channel successfully!',
  MESSAGE_SENT: 'Message sent successfully!',
  PROFILE_UPDATED: 'Profile updated successfully!',
  SETTINGS_SAVED: 'Settings saved successfully!'
};

// Default Settings
export const DEFAULT_SETTINGS = {
  theme: 'dark',
  notifications: true,
  soundEnabled: true,
  relays: DEFAULT_RELAYS
};

export default {
  EVENT_KINDS,
  DEFAULT_RELAYS,
  IRC_COMMANDS,
  BOT_COMMANDS,
  CHANNEL_MODES,
  USER_MODES,
  THEMES,
  MESSAGE_TYPES,
  BOT_RESPONSE_TYPES,
  REGEX,
  STORAGE_KEYS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  DEFAULT_SETTINGS
};