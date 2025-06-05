# IRC on Nostr

A decentralized IRC-like chat application built on the Nostr protocol, bringing classic IRC functionality to a censorship-resistant, decentralized network.

## Features

### Core IRC Features
- **Public Channels**: Create and join chat rooms using Nostr NIP-28
- **Private Messages**: Direct encrypted messaging via NIP-04
- **User Operations**: Channel operators with moderation powers
- **Bot Framework**: Extensible bot system for commands and automation
- **Classic Commands**: Traditional IRC commands like `/join`, `/part`, `/kick`, `/ban`

### IRC Commands
- `!users` - List active users in channel
- `!uptime` - Show bot/room statistics
- `!weather [location]` - Get weather information
- `!roll [dice]` - Roll dice for games
- `!help` - Show available commands
- `!stats` - Channel statistics
- `!topic [text]` - Set/view channel topic

### Modern Enhancements
- **Cryptographic Identity**: Secure user authentication via Nostr keys
- **Decentralized**: No single point of failure
- **Cross-Platform**: React Native app for mobile and web
- **Rich Media**: Support for images, links, and emojis
- **Persistent History**: Messages stored across multiple relays

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