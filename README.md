# IRC on Nostr

A decentralized IRC-like chat application built on the Nostr protocol, bringing classic IRC functionality to a censorship-resistant, decentralized network.

## Features

### 🏗️ Core IRC Architecture
- **Public Channels**: Create and join chat rooms using Nostr NIP-28 protocol
- **Real-time Messaging**: Live message streaming with WebSocket subscriptions  
- **Channel Discovery**: Search and browse public channels across the entire Nostr network
- **Channel Creation**: Full channel creation with metadata, topics, and descriptions
- **User Operations**: Channel operators with comprehensive moderation powers
- **Classic IRC Navigation**: Traditional IRC workflow with modern UI

### 🤖 Advanced Bot Ecosystem (32 Commands)

#### 🛠️ Helper & Information Commands (4 Commands)
- `!help [command]` - Show comprehensive help or specific command help with examples
- `!commands` - List all available bot and IRC commands with descriptions  
- `!about` - Show detailed information about the IRC on Nostr system and features
- `!time` - Show current server time with timezone information and Unix timestamp

#### 📊 Statistics & Monitoring Commands (2 Commands)
- `!stats` - Detailed channel statistics with message counts and user activity
- `!uptime` - Show bot uptime, framework status, and operational statistics

#### 🌤️ Weather Information Commands (2 Commands)
- `!weather [location]` - Get current weather with real OpenWeatherMap API or simulated data
- `!forecast [location]` - Get detailed 3-day weather forecast with conditions

#### 🎮 Gaming & Entertainment Commands (7 Commands)
- `!roll [dice]` - Advanced dice rolling with D&D notation (`2d6+3`, `d20`, modifiers, critical detection)
- `!flip` - Flip a coin with heads/tails results
- `!8ball [question]` - Magic 8-ball with 20 different mystical responses
- `!rps [choice]` - Play rock-paper-scissors against the bot with emoji responses
- `!number [range]` - Generate random numbers with custom ranges (`1-100`, `50`)

#### 🃏 Complete Poker Game System (17 Commands)
- `!poker <ante> [max_players]` - Start new multi-player poker game (2-6 players)
- `!solo <ante> [difficulty]` - Play solo Texas Hold'em against intelligent AI
- `!join <ante>` - Join existing poker game in the channel
- `!commit <number> <salt>` - Commit random number for cryptographic deck shuffling
- `!reveal` - Reveal committed number to generate provably fair deck
- `!start` - Start committed game after all players have joined
- `!bet <amount>` - Place initial bet in current betting round
- `!call` - Call current bet amount
- `!check` - Check (stay in hand without betting when no bet to call)
- `!fold` - Fold hand and exit current round
- `!raise <amount>` - Raise current bet by specified amount
- `!verify <game_id>` - Verify cryptographic fairness of completed game
- `!games` - List all active poker games in the channel
- `!hand` - Show your current poker hand (cards and strength)
- `!chips` - Show current chip count and betting position
- `!status` - Show detailed current game status and betting round
- `!cards` - View your private cards in secure modal interface

### 📋 IRC Command System (8 Commands)

#### 🏛️ Channel Management Commands
- `/help` - Show IRC commands help with available operations
- `/users` - List active channel users with last seen timestamps  
- `/topic [text]` - Set/view channel topic (operators only)

#### 👑 Moderation Commands (Operators Only)
- `/kick [user] [reason]` - Remove user from channel with optional reason
- `/ban [user] [reason]` - Ban user from channel with optional reason  
- `/op [user]` - Grant operator status to user
- `/deop [user]` - Remove operator status from user

#### 💬 Communication Commands
- `/msg [username|pubkey|npub] [message]` - Send private message with username resolution

### 🔧 Advanced Bot Architecture & Gaming System
- **Modular Framework**: Extensible BaseBot class with plugin registration system
- **5 Specialized Bots**: WeatherBot, GameBot, StatsBot, HelperBot, PokerBot with distinct capabilities
- **Channel Segregation**: Bots isolated per channel with command deduplication system
- **Enhanced Network Reliability**: Rate-limiting, proof-of-work, and retry mechanisms for Nostr publishing
- **Command Registration**: Dynamic command discovery and registration system
- **Error Handling**: Graceful error handling with user-friendly feedback messages
- **Response Types**: Structured bot responses with metadata and rich formatting
- **Caching System**: Smart caching for weather data and API responses
- **Statistics Tracking**: Real-time tracking of bot usage and channel activity

#### 🃏 Poker Game Features
- **Texas Hold'em Implementation**: Complete poker game mechanics with betting rounds
- **Multi-player Support**: 2-6 players per game with real-time action processing
- **Solo AI Mode**: Play against intelligent AI opponent with strategic decision-making
- **Cryptographic Fairness**: Commit-reveal scheme ensuring provably fair deck shuffling
- **Game Verification**: Cryptographic verification of completed games for transparency
- **Real-time Updates**: Live game state synchronization via Nostr protocol
- **Complete Action Set**: All poker actions (bet, call, check, fold, raise) implemented
- **Hand Evaluation**: Comprehensive poker hand ranking and winner determination
- **Chip Management**: Virtual chip system with betting validation and pot management

### 🌐 Modern Social Media Features
- **Feed System**: Timeline view of posts from followed users with threaded discussions
- **Social Interactions**: Like, repost, and reply to posts with real-time counts
- **Profile Management**: Complete Nostr profile editing with picture, bio, website
- **Following System**: Follow/unfollow users with follower/following counts  
- **Post Creation**: Create and share text notes with image support and markdown
- **Interaction Analytics**: Real-time like, repost, and reply counts with user indicators
- **Thread Display**: Intelligent thread organization with followed/unfollowed reply separation

### 🔐 Private Messaging & Communication
- **NIP-04 Encrypted Messages**: End-to-end encrypted private conversations
- **Conversation Management**: Organized conversation list with unread counts and timestamps
- **Username Resolution**: Contact discovery using display names, usernames, pubkeys, or npubs
- **Real-time DM System**: Live private message updates with optimistic sending
- **Contact Management**: Add contacts via public key or npub with validation
- **Message History**: Persistent conversation history with proper encryption/decryption
- **Auto-navigation**: Direct navigation to conversations from `/msg` commands

### 🎨 User Experience & Interface Design
- **Cross-Platform Ready**: React Native app for iOS, Android, and Web deployment
- **Modern Dark Theme**: Elegant dark mode with purple accent colors and high contrast
- **Responsive Navigation**: Tab-based navigation with stack-based modal presentations
- **Pull-to-Refresh**: Gesture-based content refreshing across all screens
- **Real-time Search**: Network-wide channel search with live filtering and results
- **Connection Indicators**: Visual relay connectivity status with connection counts
- **Loading States**: Smooth loading animations and skeleton states
- **Optimistic Updates**: Immediate UI feedback for better perceived performance

### 🔗 Network & Protocol Implementation
- **Multi-Relay Architecture**: Connect to 17+ default Nostr relays simultaneously
- **Automatic Failover**: Graceful handling of relay disconnections and reconnections
- **Event Subscriptions**: Real-time event streaming with sophisticated filter support
- **NIP-19 Support**: Full npub/nsec encoding/decoding with format validation
- **Profile Synchronization**: Automatic profile data fetching and intelligent caching
- **Network-wide Search**: Deep search across the entire decentralized Nostr network
- **Event Validation**: Cryptographic event verification and signature validation

### ⚙️ Technical Architecture & Capabilities

#### 🔑 Security & Cryptography
- **Nostr Key Management**: Secure private/public key generation, import, and storage
- **NIP-04 Encryption**: End-to-end encryption for private messages
- **Event Signing**: Cryptographic signing of all events with secp256k1
- **Key Format Support**: Hex and nsec1/npub1 key format compatibility

#### 💾 Data Management & Performance
- **AsyncStorage Integration**: Local data persistence and caching system
- **Profile Caching**: Intelligent user profile caching for performance
- **Message Threading**: Sophisticated message threading and reply organization
- **Event Filtering**: Advanced message filtering and subscription management
- **Optimistic Updates**: Client-side optimistic updates for better UX

#### 🌍 Platform & Deployment
- **React Native Framework**: Cross-platform mobile and web compatibility
- **Expo Integration**: Modern React Native development with Expo tools
- **WebSocket Management**: Efficient connection pooling and message handling
- **Web Compatibility**: Full web browser support with responsive design
- **Bundle Optimization**: Optimized builds for web and mobile platforms

### 📱 Screen Architecture & Components

#### 🖥️ Main Application Screens
- **HomeScreen**: Channel discovery with network search and real-time results
- **ChannelScreen**: Full IRC chat interface with user lists and real-time messaging
- **CreateChannelScreen**: Channel creation with validation and metadata input
- **FeedScreen**: Social media feed with threaded posts and interactions
- **PrivateMessageScreen**: Encrypted conversation list with contact management
- **PrivateConversationScreen**: Individual encrypted chat interface
- **ProfileScreen**: Complete profile management with following/followers
- **UserProfileScreen**: View other users' profiles with follow/unfollow actions
- **SettingsScreen**: Application settings and key management

#### 🔧 Reusable UI Components
- **ChannelList**: Reusable channel listing with member counts and descriptions
- **MessageInput**: Universal message input with command parsing and validation
- **MessageItem**: Message display with user names, timestamps, and interaction buttons
- **UserList**: User listing with operator badges and online status indicators

## Technology Stack

- **Frontend**: React Native (iOS, Android, Web)
- **Protocol**: Nostr (Decentralized social protocol)
- **Crypto**: secp256k1 for key management
- **Networking**: WebSocket connections to Nostr relays
- **Storage**: AsyncStorage for local data

## Getting Started

```bash
npm install
npm start
```

## Development Status

🚧 **In Development** - This project is currently being built.

See `DEVELOPMENT_PLAN.md` for detailed roadmap and implementation phases.