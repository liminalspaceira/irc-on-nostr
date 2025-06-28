# IRC on Nostr

A decentralized IRC-like chat application built on the Nostr protocol, bringing classic IRC functionality to a censorship-resistant, decentralized network.

## Features

### 🏗️ Core IRC Architecture
- **Public Channels**: Create and join chat rooms using Nostr NIP-28 protocol
- **Private Groups with Protocol Choice**: Choose between Private NIP-28 (basic privacy flag) and NIP-29 (relay-managed) protocols
- **Real-time Messaging**: Live message streaming with WebSocket subscriptions  
- **Channel Discovery**: Search and browse public channels across the entire Nostr network
- **Channel Creation**: Full channel creation with metadata, topics, descriptions, and protocol selection
- **User Operations**: Channel operators with comprehensive moderation powers (real enforcement in NIP-29)
- **Classic IRC Navigation**: Traditional IRC workflow with modern UI and protocol indicators

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
- `/help` - Show IRC commands help with protocol-specific features and capabilities
- `/users` - List active channel users with last seen timestamps  
- `/topic [text]` - Set/view channel topic (operators only)

#### ⚔️ Moderation Commands (Protocol-Dependent)
- `/kick [user] [reason]` - Remove user (permanent in NIP-29, visual-only in others)
- `/ban [user] [reason]` - Ban user (permanent in NIP-29, visual-only in others)
- `/op [user]` - Grant operator status (real power in NIP-29, visual-only in others)
- `/deop [user]` - Remove operator status (real effect in NIP-29, visual-only in others)

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

### 🔐 Private Messaging & Group Communication

#### 💬 Direct Messages (NIP-04)
- **End-to-end Encrypted DMs**: Private conversations using NIP-04 encryption
- **Conversation Management**: Organized conversation list with unread counts and timestamps
- **Username Resolution**: Contact discovery using display names, usernames, pubkeys, or npubs
- **Real-time DM System**: Live private message updates with optimistic sending
- **Contact Management**: Add contacts via public key or npub with validation
- **Message History**: Persistent conversation history with proper encryption/decryption
- **Auto-navigation**: Direct navigation to conversations from `/msg` commands

#### 🏛️ Private Groups - Hybrid Protocol System

##### **NIP-29 Managed Groups (Real Moderation)**
- **Relay-Managed Groups**: Groups hosted and enforced by NIP-29 compatible relays
- **Real Admin Controls**: Kick/ban commands that actually work - users are blocked by the relay
- **True Operator Privileges**: Operator status grants real moderation powers
- **Dedicated Relay Infrastructure**: Uses specialized NIP-29 relays (relay.groups.nip29.com)
- **Persistent Enforcement**: Moderation actions survive client restarts and are network-enforced
- **Group ID System**: Uses cryptographic group identifiers for relay management
- **Invitation System**: Controlled membership with admin-managed invitations

##### **Private NIP-28 Channels (Limited Privacy)**
- **Invitation-Only Access**: Only invited members can join the group
- **Encrypted Invitations**: Invitations are encrypted using NIP-04
- **Plain Text Messages**: Group messages are visible to relays in plain text
- **Fake Moderation**: Kick/ban commands are cosmetic with zero enforcement
- **Standard Nostr Relays**: Uses regular Nostr relay infrastructure
- **Limited Privacy**: Some encryption for invites, but not for group chat

##### **Protocol Selection & Management**
- **Creation-Time Choice**: Select Private NIP-28 or NIP-29 when creating private groups
- **Clear Protocol Indicators**: Visual badges showing group protocol type (🏛️ NIP-29, ⚠️ Private NIP-28)
- **Separate Relay Management**: Dedicated NIP-29 relay configuration in settings
- **Protocol-Aware Commands**: Commands behave differently based on group protocol
- **Honest User Feedback**: Clear warnings when moderation commands have no effect

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
- **Dual Relay System**: Separate relay pools for standard Nostr and NIP-29 group relays
- **Automatic Failover**: Graceful handling of relay disconnections and reconnections
- **Event Subscriptions**: Real-time event streaming with sophisticated filter support
- **NIP-19 Support**: Full npub/nsec encoding/decoding with format validation
- **Profile Synchronization**: Automatic profile data fetching and intelligent caching
- **Network-wide Search**: Deep search across the entire decentralized Nostr network
- **Event Validation**: Cryptographic event verification and signature validation
- **Protocol-Specific Publishing**: Messages route to appropriate relays based on group protocol
- **NIP-29 Event Types**: Support for kind 9007 (group creation), kind 9 (group messages), kinds 9001-9003 (moderation)

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
- **HomeScreen**: Channel discovery with protocol indicators and network search
- **ChannelScreen**: Protocol-aware IRC chat interface with real/fake moderation feedback
- **CreateChannelScreen**: Channel creation with Private NIP-28/NIP-29 protocol selection for private groups
- **FeedScreen**: Social media feed with threaded posts and interactions
- **PrivateMessageScreen**: Encrypted conversation list with contact management
- **PrivateConversationScreen**: Individual encrypted chat interface
- **ProfileScreen**: Complete profile management with following/followers
- **UserProfileScreen**: View other users' profiles with follow/unfollow actions
- **SettingsScreen**: Dual relay management (standard + NIP-29) and key management

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

## Recent Updates (Latest Session)

### 🎯 **Major Features: NIP-29 Moderation System & Enhanced User Invitations**

#### ✅ **NIP-29 Moderation System Implementation**
1. **Proper NIP-29 Moderation Commands**: Implemented real mute/unmute system using NIP-29 protocol
   - `/kick` command now uses kind 9004 (mute) instead of removal
   - `/unkick` command added using kind 9005 (unmute) to restore user access
   - Removed `/unban` command (NIP-29 doesn't support unbanning)
   - Updated help system to reflect proper NIP-29 moderation capabilities

2. **NIP-29 Group Discovery & Management**: 
   - Generic group discovery system (no hardcoded group IDs)
   - Local storage backup for joined groups
   - Proper metadata fetching and display with group names
   - Migration system for existing groups

3. **Create Channel Screen Restructuring**:
   - Moved NIP-29 from "Private Channel" to separate "NIP-29 Group" category
   - Three distinct channel types: Public Channel, Private Channel, NIP-29 Group
   - Updated UI to reflect that NIP-29 groups are public channels with relay management
   - Improved WebView compatibility by switching to Expo Linking API
   - Dynamic descriptions and form field validation based on channel type

#### ✅ **Enhanced User Invitation System with Username Search**
4. **Smart User Search for Invitations**:
   - **Search by Username**: Type display names or usernames to find people you follow
   - **Following List Integration**: Automatically loads your following list when invite modal opens
   - **Real-time Search**: 300ms debounced search with instant results
   - **Visual Search Results**: Shows display name, username, and truncated pubkey
   - **Tap to Select**: Click search results to auto-fill pubkey field

5. **Dual Input Methods for Invitations**:
   - **Username Search**: Search through people you follow for easy selection
   - **Manual Pubkey Entry**: Traditional pubkey/npub input for any user
   - **Personal Messages**: Add optional invitation messages
   - **Smart State Management**: Proper cleanup and reset when modal closes

6. **Enhanced User Experience**:
   - **Loading Indicators**: Shows search progress and number of profiles loaded
   - **Debug Information**: Console logging for troubleshooting search issues
   - **Comprehensive Styling**: Professional UI with consistent theming
   - **Cross-Channel Support**: Works for all channel types (Public, Private, NIP-29)

#### 🏛️ **NIP-29 Technical Implementation**
- **Mute System**: Uses kind 9004 events for user muting (kick equivalent)
- **Unmute System**: Uses kind 9005 events for user unmuting (unkick feature)
- **Group Discovery**: Combines relay queries with local storage for reliable group listing
- **Metadata Enhancement**: Improved group name display and information fetching
- **Linking Integration**: External NIP-29 group creation via relay.groups.nip29.com

#### 🔍 **User Search Technical Details**
- **Following List Loading**: Fetches user's contact list (kind 3 events) from Nostr relays
- **Profile Batch Loading**: Efficiently loads multiple user profiles for search
- **Fuzzy Search**: Matches both display_name and name fields with partial matching
- **Search Optimization**: Limits results to 10 for performance, sorts by relevance
- **Cache Integration**: Leverages existing profile caching system for performance

#### ⚖️ **Updated Moderation System**
- **NIP-29 Groups**: 
  - ✅ `/kick` = Mute user (kind 9004) - prevents posting but allows viewing
  - ✅ `/unkick` = Unmute user (kind 9005) - restores posting privileges
  - ✅ `/ban` = Permanent removal (kind 9002) - complete group removal
  - ❌ `/unban` = Not supported in NIP-29 protocol (removed from commands)
- **Private NIP-28/Public Groups**: 
  - ⚠️ "FAKE MODERATION: User can still send messages. Use NIP-29 for real moderation."
  - Clear warnings that commands have no effect

## Development Status

🚀 **Production Ready Features** - Hybrid private group system with real NIP-29 moderation is complete and functional.

See `DEVELOPMENT_PLAN.md` for detailed roadmap and implementation phases.
