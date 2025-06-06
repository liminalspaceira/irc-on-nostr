import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent as verifyNostrEvent, nip19 } from 'nostr-tools';
import { EVENT_KINDS, DEFAULT_RELAYS } from './constants';

export class NostrUtils {
  constructor() {
    this.relays = new Map();
    this.subscriptions = new Map();
    this.eventQueue = [];
  }

  generateKeyPair() {
    const privateKey = generateSecretKey();
    // Convert Uint8Array to hex string
    const privateKeyHex = Array.from(privateKey).map(b => b.toString(16).padStart(2, '0')).join('');
    const publicKey = getPublicKey(privateKey);
    return { privateKey: privateKeyHex, publicKey };
  }

  createEvent(kind, content, tags = [], createdAt = null) {
    const event = {
      kind,
      content,
      tags,
      created_at: createdAt || Math.floor(Date.now() / 1000),
      pubkey: null // Will be set when signing
    };
    return event;
  }

  signEvent(event, privateKey) {
    try {
      const eventTemplate = {
        kind: event.kind,
        created_at: event.created_at || Math.floor(Date.now() / 1000),
        tags: event.tags || [],
        content: event.content
      };
      
      // Convert hex string to Uint8Array for nostr-tools
      const privateKeyBytes = new Uint8Array(
        privateKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );
      
      return finalizeEvent(eventTemplate, privateKeyBytes);
    } catch (error) {
      console.error('Error signing event:', error);
      throw error;
    }
  }

  verifyEvent(event) {
    try {
      return verifyNostrEvent(event);
    } catch (error) {
      console.error('Error verifying event:', error);
      return false;
    }
  }

  createChannelEvent(name, about, picture = '') {
    const content = JSON.stringify({
      name,
      about,
      picture
    });
    
    return this.createEvent(EVENT_KINDS.CHANNEL_CREATION, content);
  }

  createChannelMetadataEvent(channelId, metadata) {
    const tags = [
      ['e', channelId, '', 'root']
    ];
    
    return this.createEvent(
      EVENT_KINDS.CHANNEL_METADATA, 
      JSON.stringify(metadata), 
      tags
    );
  }

  createChannelMessageEvent(channelId, message, replyTo = null) {
    const tags = [
      ['e', channelId, '', 'root']
    ];
    
    if (replyTo) {
      tags.push(['e', replyTo, '', 'reply']);
    }
    
    return this.createEvent(EVENT_KINDS.CHANNEL_MESSAGE, message, tags);
  }

  createDirectMessageEvent(recipientPubkey, message, privateKey) {
    try {
      // For now, just create a plaintext DM (will implement encryption later)
      const tags = [
        ['p', recipientPubkey]
      ];
      
      return this.createEvent(EVENT_KINDS.ENCRYPTED_DM, message, tags);
    } catch (error) {
      console.error('Error creating DM:', error);
      throw error;
    }
  }

  decryptDirectMessage(event, privateKey) {
    try {
      // For now, just return the content as-is (will implement decryption later)
      return event.content;
    } catch (error) {
      console.error('Error decrypting DM:', error);
      return null;
    }
  }

  createModerationEvent(channelId, action, targetPubkey, reason = '') {
    const content = JSON.stringify({
      action, // 'kick', 'ban', 'unban', 'op', 'deop', 'mute', 'unmute'
      target: targetPubkey,
      reason
    });
    
    const tags = [
      ['e', channelId, '', 'root'],
      ['p', targetPubkey]
    ];
    
    return this.createEvent(EVENT_KINDS.CHANNEL_MODERATION, content, tags);
  }

  createBotCommandEvent(channelId, command, args = []) {
    const content = JSON.stringify({
      command,
      args
    });
    
    const tags = [
      ['e', channelId, '', 'root']
    ];
    
    return this.createEvent(EVENT_KINDS.BOT_COMMAND, content, tags);
  }

  createUserPresenceEvent(status, channels = []) {
    const content = JSON.stringify({
      status, // 'online', 'away', 'busy', 'offline'
      channels
    });
    
    return this.createEvent(EVENT_KINDS.USER_PRESENCE, content);
  }

  parseChannelEvent(event) {
    try {
      const content = JSON.parse(event.content);
      return {
        id: event.id,
        name: content.name,
        about: content.about,
        picture: content.picture,
        creator: event.pubkey,
        createdAt: event.created_at,
        relays: this.extractRelaysFromTags(event.tags)
      };
    } catch (error) {
      console.error('Error parsing channel event:', error);
      return null;
    }
  }

  parseChannelMessage(event) {
    const channelId = this.getChannelIdFromTags(event.tags);
    const replyTo = this.getReplyToFromTags(event.tags);
    
    return {
      id: event.id,
      content: event.content,
      author: event.pubkey,
      channelId,
      timestamp: event.created_at,
      replyTo,
      tags: event.tags
    };
  }

  parseModerationEvent(event) {
    try {
      const content = JSON.parse(event.content);
      const channelId = this.getChannelIdFromTags(event.tags);
      
      return {
        id: event.id,
        channelId,
        action: content.action,
        target: content.target,
        reason: content.reason,
        moderator: event.pubkey,
        timestamp: event.created_at
      };
    } catch (error) {
      console.error('Error parsing moderation event:', error);
      return null;
    }
  }

  parseBotCommand(event) {
    try {
      const content = JSON.parse(event.content);
      const channelId = this.getChannelIdFromTags(event.tags);
      
      return {
        id: event.id,
        channelId,
        command: content.command,
        args: content.args,
        user: event.pubkey,
        timestamp: event.created_at
      };
    } catch (error) {
      console.error('Error parsing bot command:', error);
      return null;
    }
  }

  getChannelIdFromTags(tags) {
    const rootTag = tags.find(tag => 
      tag[0] === 'e' && (tag[3] === 'root' || tag.length === 2)
    );
    return rootTag ? rootTag[1] : null;
  }

  getReplyToFromTags(tags) {
    const replyTag = tags.find(tag => 
      tag[0] === 'e' && tag[3] === 'reply'
    );
    return replyTag ? replyTag[1] : null;
  }

  extractRelaysFromTags(tags) {
    return tags
      .filter(tag => tag[0] === 'relay')
      .map(tag => tag[1]);
  }

  getMentionsFromTags(tags) {
    return tags
      .filter(tag => tag[0] === 'p')
      .map(tag => tag[1]);
  }

  createSubscriptionFilter(channelId = null, authors = null, kinds = null, since = null, limit = 100) {
    const filter = {};
    
    if (channelId) {
      filter['#e'] = [channelId];
    }
    
    if (authors) {
      filter.authors = Array.isArray(authors) ? authors : [authors];
    }
    
    if (kinds) {
      filter.kinds = Array.isArray(kinds) ? kinds : [kinds];
    }
    
    if (since) {
      filter.since = since;
    }
    
    if (limit) {
      filter.limit = limit;
    }
    
    return filter;
  }

  createChannelSubscription(channelId, since = null) {
    return {
      kinds: [
        EVENT_KINDS.CHANNEL_MESSAGE,
        EVENT_KINDS.CHANNEL_METADATA,
        EVENT_KINDS.CHANNEL_MODERATION,
        EVENT_KINDS.BOT_COMMAND
      ],
      '#e': [channelId],
      since: since || Math.floor(Date.now() / 1000) - (24 * 60 * 60) // Last 24 hours
    };
  }

  createUserProfileSubscription(pubkeys) {
    return {
      kinds: [EVENT_KINDS.METADATA],
      authors: Array.isArray(pubkeys) ? pubkeys : [pubkeys]
    };
  }

  createDirectMessageSubscription(userPubkey, since = null) {
    return {
      kinds: [EVENT_KINDS.ENCRYPTED_DM],
      '#p': [userPubkey],
      since: since || Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60) // Last 7 days
    };
  }

  validateEvent(event) {
    if (!event.id || !event.pubkey || !event.sig) {
      return false;
    }
    
    if (!event.kind || event.created_at === undefined) {
      return false;
    }
    
    if (!Array.isArray(event.tags)) {
      return false;
    }
    
    return this.verifyEvent(event);
  }

  formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now - date;
    
    // Less than 1 minute
    if (diff < 60000) {
      return 'now';
    }
    
    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }
    
    // Less than 1 day
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }
    
    // Less than 1 week
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }
    
    // Older than 1 week
    return date.toLocaleDateString();
  }

  generateChannelId(name, creator) {
    // Create a deterministic channel ID based on name and creator
    const content = `${name.toLowerCase()}:${creator}`;
    return this.sha256(content);
  }

  sha256(message) {
    // Simple hash function for channel IDs
    // In production, use a proper crypto library
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
      const char = message.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  parseIRCCommand(input) {
    const trimmed = input.trim();
    
    if (!trimmed.startsWith('/')) {
      return null;
    }
    
    const parts = trimmed.slice(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    return { command, args };
  }

  parseBotCommandFromMessage(content) {
    const trimmed = content.trim();
    
    if (!trimmed.startsWith('!')) {
      return null;
    }
    
    const parts = trimmed.slice(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    return { command, args };
  }

  extractMentions(content) {
    const mentions = [];
    const regex = /@([a-f0-9]{64})/gi;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      mentions.push(match[1]);
    }
    
    return mentions;
  }

  extractChannelReferences(content) {
    const channels = [];
    const regex = /#([a-zA-Z0-9_-]+)/gi;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      channels.push(match[1]);
    }
    
    return channels;
  }

  truncatePubkey(pubkey, length = 8) {
    if (pubkey.length <= length) return pubkey;
    return `${pubkey.slice(0, length)}...`;
  }

  isValidPubkey(pubkey) {
    return /^[a-f0-9]{64}$/i.test(pubkey);
  }

  isValidSignature(signature) {
    return /^[a-f0-9]{128}$/i.test(signature);
  }

  sortEventsByTimestamp(events, ascending = false) {
    return events.sort((a, b) => {
      const timestampA = a.created_at;
      const timestampB = b.created_at;
      
      return ascending ? timestampA - timestampB : timestampB - timestampA;
    });
  }

  // NIP-19 encoding/decoding functions
  npubToPubkey(npub) {
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') {
        return decoded.data;
      }
      throw new Error('Invalid npub format');
    } catch (error) {
      throw new Error('Failed to decode npub: ' + error.message);
    }
  }

  pubkeyToNpub(pubkey) {
    try {
      return nip19.npubEncode(pubkey);
    } catch (error) {
      throw new Error('Failed to encode pubkey to npub: ' + error.message);
    }
  }

  nsecToPrivkey(nsec) {
    try {
      const decoded = nip19.decode(nsec);
      if (decoded.type === 'nsec') {
        return decoded.data;
      }
      throw new Error('Invalid nsec format');
    } catch (error) {
      throw new Error('Failed to decode nsec: ' + error.message);
    }
  }

  privkeyToNsec(privkey) {
    try {
      // Convert hex string to Uint8Array if needed
      let keyBytes;
      if (typeof privkey === 'string') {
        keyBytes = new Uint8Array(privkey.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      } else {
        keyBytes = privkey;
      }
      return nip19.nsecEncode(keyBytes);
    } catch (error) {
      throw new Error('Failed to encode private key to nsec: ' + error.message);
    }
  }

  isValidNpub(npub) {
    try {
      const decoded = nip19.decode(npub);
      return decoded.type === 'npub';
    } catch (error) {
      return false;
    }
  }

  isValidNsec(nsec) {
    try {
      const decoded = nip19.decode(nsec);
      return decoded.type === 'nsec';
    } catch (error) {
      return false;
    }
  }
}

export const nostrUtils = new NostrUtils();
export default nostrUtils;