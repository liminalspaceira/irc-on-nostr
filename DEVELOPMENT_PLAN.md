# IRC on Nostr - Development Plan

## Project Overview

Building a decentralized IRC-like chat application using the Nostr protocol. This will combine the familiar interface and functionality of IRC with the censorship-resistance and decentralization of Nostr.

## Architecture Overview

### Core Components

1. **Frontend App** (React Native)
   - Cross-platform mobile and web interface
   - Channel list and chat interface
   - User management and settings
   - Bot command interface

2. **Nostr Client Layer**
   - WebSocket connections to multiple relays
   - Event publishing and subscription
   - Key management and signing
   - Caching and offline support

3. **IRC Compatibility Layer**
   - Maps IRC commands to Nostr events
   - Channel management (NIP-28)
   - User operations and moderation
   - Bot framework

4. **Bot System**
   - Automated clients listening for commands
   - Extensible plugin architecture
   - Built-in utility bots
   - Custom command handlers

## Development Phases

### Phase 1: Foundation ✅ **COMPLETED**
**Goal**: Basic chat functionality working

#### Core Infrastructure
- [x] Project setup with React Native ✅
- [x] Nostr client integration (nostr-tools) ✅
- [x] Basic key management (nsec1/hex import/generation) ✅
- [x] WebSocket relay connections (8 default relays) ✅

#### Basic Chat
- [x] Channel creation (Kind 40) ✅
- [x] Channel discovery/listing ✅
- [x] Real-time channel querying ✅
- [x] Simple user interface (web + mobile ready) ✅

#### UI Components Created
- [x] HomeScreen (channel discovery) ✅
- [x] CreateChannelScreen ✅
- [x] ChannelScreen (chat interface) ✅
- [x] SettingsScreen (key management) ✅
- [x] ProfileScreen (Nostr profile editing) ✅

#### Deliverables ✅
- ✅ Users can create channels (published to real Nostr network)
- ✅ Users can discover existing channels from other Nostr clients
- ✅ Private key import/export working (nsec1 + hex format)
- ✅ Connected to real Nostr ecosystem
- ✅ Web interface working, mobile-ready

### Phase 2: IRC Core Features ✅ **COMPLETED**
**Goal**: Essential IRC functionality

#### Channel Management
- [x] Channel discovery/listing ✅
- [x] Channel joining (enter existing channels) ✅
- [x] Channel metadata (Kind 41) ✅
- [x] Send/receive messages (Kind 42) ✅
- [x] Channel operators system ✅
- [x] User lists and presence ✅
- [x] Real-time message subscriptions ✅

#### IRC Commands
- [x] Channel joining via UI navigation ✅
- [x] `/part #channel` - Leave channels ✅
- [x] `/msg user message` - Private messages ✅
- [ ] `/nick nickname` - Set display name
- [x] `/topic text` - Set channel topic ✅
- [x] `/users` - List channel users ✅

#### User Interface
- [x] Message input with command parsing ✅
- [x] Basic settings screen ✅
- [x] Channel messaging interface ✅
- [x] User list panel ✅
- [x] Message display and real-time updates ✅

#### Deliverables ✅
- ✅ Full IRC-style navigation
- ✅ Real-time messaging working
- ✅ Channel joining/leaving complete
- ✅ Message querying from relays
- ✅ Command parsing and execution
- ✅ Real-time subscriptions for new messages

### Phase 3: Moderation & Operations ✅ **COMPLETED**
**Goal**: Channel moderation and operator features

#### Operator System
- [x] Channel operator permissions ✅
- [x] Op assignment/removal ✅
- [x] Moderation event types ✅

#### Moderation Commands
- [x] `/kick user [reason]` - Remove user from channel ✅
- [x] `/ban user [reason]` - Ban user from channel ✅
- [ ] `/unban user` - Remove ban
- [ ] `/mute user [time]` - Temporarily mute user
- [x] `/op user` - Grant operator status ✅
- [x] `/deop user` - Remove operator status ✅

#### Moderation Events
- [x] Define custom event kinds for moderation ✅
- [x] Kick/ban event handling ✅
- [x] User permission checking ✅
- [x] Moderation log interface ✅

#### UI Enhancements
- [x] Operator status indicators in channel header ✅
- [x] Operator badges next to usernames ✅
- [x] Permission-based command availability ✅
- [x] Enhanced moderation event display ✅

#### Deliverables ✅
- ✅ Channel operators can moderate
- ✅ Ban/kick system working
- ✅ Moderation logs visible
- ✅ Permission system implemented
- ✅ Visual operator indicators
- ✅ Enhanced system message display

### Phase 4: Bot Framework ✅ **COMPLETED**
**Goal**: Extensible bot system with core bots

#### Bot Infrastructure
- [x] Bot client framework ✅
- [x] Command parsing system ✅
- [x] Plugin architecture (BaseBot class) ✅
- [x] Bot registration/discovery ✅

#### Core Bots
- [x] **StatsBot**: Channel statistics and uptime ✅
- [x] **WeatherBot**: Weather information service ✅
- [x] **GameBot**: Dice rolling and simple games ✅
- [x] **HelperBot**: Help and command information ✅

#### Bot Commands Implemented ✅
- [x] `!stats` - Channel activity statistics ✅
- [x] `!uptime` - Show bot/channel uptime ✅
- [x] `!weather <location>` - Get weather data ✅
- [x] `!forecast <location>` - Get weather forecast ✅
- [x] `!roll [dice]` - Roll dice (supports complex notation like 2d6+3) ✅
- [x] `!flip` - Flip a coin ✅
- [x] `!8ball <question>` - Magic 8-ball responses ✅
- [x] `!rps <choice>` - Rock-paper-scissors game ✅
- [x] `!number <max>` - Random number generator ✅
- [x] `!help` - Show bot help information ✅
- [x] `!commands` - List all available bot commands ✅
- [x] `!about` - Show information about the bot system ✅
- [x] `!time` - Get current server time ✅

#### Additional Features Implemented ✅
- [x] Weather API integration (OpenWeatherMap support) ✅
- [x] Caching system for weather data ✅
- [x] Fallback to simulated data when API unavailable ✅
- [x] Complex dice notation parsing (supports modifiers) ✅
- [x] Error handling and graceful fallbacks ✅
- [x] Bot response formatting with emojis and structure ✅
- [x] Statistics tracking for channels and users ✅
- [x] Real-time bot command processing ✅

#### Deliverables ✅
- ✅ Bot framework operational with 4 core bots
- ✅ 13 bot commands responding reliably
- ✅ Extensible plugin system with BaseBot class
- ✅ Weather integration ready for real API data
- ✅ Gaming features (dice, coin flip, 8-ball, RPS)
- ✅ Statistics and uptime tracking
- ✅ Comprehensive error handling and user feedback

### Phase 5: Private Messaging System ✅ **COMPLETED**
**Goal**: NIP-04 encrypted direct messages and user experience improvements

#### Private Messaging Implementation
- [x] **NIP-04 Encrypted Direct Messages** ✅
- [x] **PrivateMessageScreen** - Conversations list interface ✅
- [x] **PrivateConversationScreen** - Individual chat interface ✅
- [x] **NostrService DM Support** - Encryption/decryption methods ✅
- [x] **Real-time message subscriptions** ✅
- [x] **Message history loading** ✅

#### Private Message Features ✅
- [x] **End-to-end encryption** using NIP-04 ✅
- [x] **Conversation list** with last message and unread counts ✅
- [x] **Real-time messaging** with optimistic sending ✅
- [x] **Username resolution** for `/msg` command ✅
- [x] **Self-messaging support** (notes to self) ✅
- [x] **Auto-scroll and proper input behavior** ✅

#### `/msg` Command Enhancement ✅
- [x] **Username support** - `/msg hackira hello` ✅
- [x] **Pubkey support** - `/msg abc123... hello` ✅
- [x] **npub support** - `/msg npub1... hello` ✅
- [x] **Auto-navigation** to conversation with initial message ✅
- [x] **User lookup** across channel participants ✅

#### User Display Name System ✅
- [x] **Profile loading** from Nostr metadata (Kind 0) ✅
- [x] **Display name resolution** - name/display_name/username priority ✅
- [x] **Channel message names** - Show usernames instead of pubkeys ✅
- [x] **Private message names** - Show usernames in conversation list ✅
- [x] **User list names** - Show usernames in channel user lists ✅
- [x] **Profile caching** for performance ✅

#### UI/UX Improvements ✅
- [x] **Consistent input behavior** - Enter key sends messages ✅
- [x] **Web-compatible scrolling** - Fixed scrolling issues ✅
- [x] **Auto-scroll to new messages** ✅
- [x] **Contact management** - Add contacts via pubkey/npub ✅
- [x] **Error handling** - Graceful fallbacks and user feedback ✅

#### NIP-19 Support ✅
- [x] **npub encoding/decoding** ✅
- [x] **nsec encoding/decoding** ✅
- [x] **Format validation** ✅
- [x] **Conversion utilities** ✅

#### Navigation Integration ✅
- [x] **Private Messages tab** - Fully functional ✅
- [x] **Screen transitions** - Smooth navigation ✅
- [x] **Deep linking** - Direct access to conversations ✅
- [x] **Back navigation** - Proper navigation stack ✅

#### Deliverables ✅
- ✅ **Complete private messaging system** with NIP-04 encryption
- ✅ **Username-based messaging** - Natural user experience
- ✅ **Real-time encrypted conversations** 
- ✅ **User-friendly interface** matching channel behavior
- ✅ **Profile system** showing real names instead of pubkeys
- ✅ **Cross-platform compatibility** (web & mobile ready)

### Phase 6: Advanced Features (Weeks 9-10)
**Goal**: Polish and advanced IRC features

#### Advanced IRC Features
- [ ] Channel modes (+i invite-only, +m moderated, etc.)
- [ ] User modes (+o operator, +v voice, etc.)
- [ ] CTCP-style commands
- [ ] Channel history/logs
- [ ] File/image sharing

#### Rich Features
- [ ] Emoji reactions to messages
- [ ] Message threading/replies
- [ ] Rich text formatting
- [ ] Link previews
- [ ] Image/media display

#### Performance & Polish
- [ ] Message pagination
- [ ] Offline message sync
- [ ] Multiple relay support
- [ ] Export/backup functionality

#### Deliverables
- Feature-complete IRC client
- Rich media support
- Production-ready polish

### Phase 6: Advanced Bots & Plugins (Weeks 11-12)
**Goal**: Rich bot ecosystem

#### Advanced Bots
- [ ] **NewsBot**: RSS/news aggregation
- [ ] **TranslateBot**: Message translation
- [ ] **QuoteBot**: Random quotes and sayings
- [ ] **ReminderBot**: Set reminders and alerts
- [ ] **LogBot**: Channel logging and search

#### Plugin System
- [ ] Bot marketplace/discovery
- [ ] Custom bot deployment
- [ ] Bot permissions system
- [ ] Rate limiting and abuse prevention

#### Gaming Features
- [ ] **TriviBot**: Trivia game bot
- [ ] **PokerBot**: Simple poker games
- [ ] **RPGBot**: Basic RPG commands
- [ ] Multi-channel bot coordination

#### Deliverables
- Rich bot ecosystem
- Gaming and entertainment bots
- Plugin marketplace concept

## Technical Specifications

### Nostr Event Types Used

#### Standard NIPs
- **NIP-01**: Basic protocol, event structure ✅
- **NIP-04**: Encrypted direct messages ✅
- **NIP-05**: DNS-based identity verification
- **NIP-10**: Text note references (replies)
- **NIP-19**: bech32-encoded entities (npub/nsec) ✅
- **NIP-28**: Public chat channels ✅
- **NIP-42**: Authentication of clients to relays

#### Custom Event Kinds (Proposed)
- **Kind 45**: Channel operator actions (kick/ban/op)
- **Kind 46**: Bot commands and responses
- **Kind 47**: Channel modes and settings
- **Kind 48**: User presence/status updates

### Data Models

#### Channel Structure
```javascript
{
  id: "channel_event_id",
  name: "#general",
  about: "General discussion channel",
  picture: "https://...",
  creator: "pubkey",
  operators: ["pubkey1", "pubkey2"],
  modes: {
    moderated: false,
    inviteOnly: false,
    topic: "Welcome to #general"
  },
  relays: ["wss://relay1.com", "wss://relay2.com"]
}
```

#### User Structure
```javascript
{
  pubkey: "user_public_key",
  displayName: "nickname",
  profile: {
    name: "Real Name",
    picture: "https://...",
    about: "User bio"
  },
  modes: {
    operator: false,
    voice: false,
    banned: false,
    muted: false
  },
  lastSeen: timestamp
}
```

#### Message Structure
```javascript
{
  id: "message_event_id",
  content: "Hello world!",
  author: "pubkey",
  channel: "channel_id",
  timestamp: 1234567890,
  type: "message|command|system",
  replyTo: "parent_message_id",
  reactions: {
    "👍": ["pubkey1", "pubkey2"],
    "❤️": ["pubkey3"]
  }
}
```

### Bot Command API

#### Command Structure
```javascript
{
  command: "weather",
  args: ["New York"],
  channel: "channel_id",
  user: "user_pubkey",
  timestamp: 1234567890
}
```

#### Bot Response
```javascript
{
  success: true,
  response: "Weather in New York: 72°F, Sunny",
  responseType: "text|embed|image",
  data: {
    temperature: 72,
    condition: "sunny",
    location: "New York, NY"
  }
}
```

## File Structure

```
irc-on-nostr/
├── README.md
├── DEVELOPMENT_PLAN.md
├── package.json
├── app.json
├── index.js
├── babel.config.js
├── metro.config.js
├── webpack.config.js
├── assets/
│   ├── icon.png
│   ├── splash.png
│   └── default-avatar.png
├── src/
│   ├── App.js
│   ├── components/
│   │   ├── ChannelList.js
│   │   ├── ChatInterface.js
│   │   ├── MessageInput.js
│   │   ├── UserList.js
│   │   ├── MessageItem.js
│   │   └── BotResponseCard.js
│   ├── screens/
│   │   ├── HomeScreen.js
│   │   ├── ChannelScreen.js
│   │   ├── PrivateMessageScreen.js
│   │   ├── PrivateConversationScreen.js
│   │   ├── SettingsScreen.js
│   │   ├── ProfileScreen.js
│   │   └── CreateChannelScreen.js
│   ├── services/
│   │   ├── NostrService.js
│   │   ├── ChannelService.js
│   │   ├── MessageService.js
│   │   ├── BotService.js
│   │   └── ModerationService.js
│   ├── bots/
│   │   ├── BotFramework.js
│   │   ├── StatsBot.js
│   │   ├── WeatherBot.js
│   │   ├── GameBot.js
│   │   └── HelperBot.js
│   ├── utils/
│   │   ├── nostrUtils.js
│   │   ├── ircCommands.js
│   │   ├── cryptoUtils.js
│   │   ├── themeContext.js
│   │   └── constants.js
│   └── styles/
│       ├── globalStyles.js
│       ├── channelStyles.js
│       └── messageStyles.js
└── web/
    └── index.html
```

## Testing Strategy

### Unit Tests
- [ ] Nostr event creation/parsing
- [ ] IRC command parsing
- [ ] Bot command handling
- [ ] Cryptographic functions

### Integration Tests
- [ ] Channel creation workflow
- [ ] Message sending/receiving
- [ ] Bot response handling
- [ ] Moderation actions

### End-to-End Tests
- [ ] User onboarding flow
- [ ] Channel management
- [ ] Bot interactions
- [ ] Cross-platform compatibility

## Deployment Strategy

### Development
- Local testing with development relays
- Bot testing environment
- Continuous integration setup

### Staging
- Public test relays
- Beta user testing
- Performance monitoring

### Production
- Multiple production relays
- App store deployment
- Web hosting setup
- Bot service deployment

## Success Metrics

### Phase 1 Success
- [ ] Users can create and join channels
- [ ] Messages send/receive reliably
- [ ] Basic mobile interface functional

### Phase 2 Success
- [ ] All core IRC commands working
- [ ] Private messaging functional
- [ ] Channel discovery working

### Phase 3 Success
- [ ] Channel moderation functional
- [ ] Operator permissions working
- [ ] Ban/kick system operational

### Phase 4 Success
- [ ] Core bots responding to commands
- [ ] Bot framework extensible
- [ ] Weather/stats/games working

### Final Success
- [ ] Feature parity with classic IRC
- [ ] Rich bot ecosystem
- [ ] Production-ready application
- [ ] Active user community

## Risk Mitigation

### Technical Risks
- **Relay availability**: Use multiple relays with fallbacks
- **Message ordering**: Implement client-side message ordering
- **Key management**: Secure storage and backup solutions
- **Performance**: Efficient caching and pagination

### Product Risks
- **User adoption**: Focus on familiar IRC interface
- **Bot quality**: Thorough testing and error handling
- **Moderation abuse**: Clear guidelines and appeal processes
- **Network effects**: Start with focused communities

This development plan provides a structured approach to building a full-featured IRC client on Nostr, with clear milestones and deliverables for each phase.