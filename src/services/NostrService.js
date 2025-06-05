import { SimplePool, getPublicKey, finalizeEvent, generateSecretKey } from 'nostr-tools';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nostrUtils } from '../utils/nostrUtils';
import { 
  DEFAULT_RELAYS, 
  STORAGE_KEYS, 
  EVENT_KINDS,
  ERROR_MESSAGES 
} from '../utils/constants';

// Browser WebSocket polyfill
if (typeof WebSocket === 'undefined') {
  global.WebSocket = require('ws');
}

class NostrService {
  constructor() {
    this.pool = new SimplePool();
    this.relays = new Map();
    this.subscriptions = new Map();
    this.eventHandlers = new Map();
    this.isConnected = false;
    this.privateKey = null;
    this.publicKey = null;
    this.connectedRelays = new Set();
  }

  async initialize() {
    try {
      await this.loadKeys();
      await this.loadRelays();
      await this.connectToRelays();
      this.isConnected = true;
      console.log('NostrService initialized successfully');
    } catch (error) {
      console.error('Failed to initialize NostrService:', error);
      // Don't throw - allow app to continue without Nostr connection
      this.isConnected = false;
    }
  }

  async loadKeys() {
    try {
      const privateKey = await AsyncStorage.getItem(STORAGE_KEYS.PRIVATE_KEY);
      const publicKey = await AsyncStorage.getItem(STORAGE_KEYS.PUBLIC_KEY);
      
      if (privateKey && publicKey) {
        this.privateKey = privateKey;
        this.publicKey = publicKey;
        console.log('Keys loaded successfully');
      } else {
        console.log('No keys found in storage');
        // Don't throw error - we'll generate keys if needed
        this.privateKey = null;
        this.publicKey = null;
      }
    } catch (error) {
      console.error('Error loading keys:', error);
      this.privateKey = null;
      this.publicKey = null;
    }
  }

  async generateAndSaveKeys() {
    try {
      const { privateKey, publicKey } = nostrUtils.generateKeyPair();
      
      await AsyncStorage.setItem(STORAGE_KEYS.PRIVATE_KEY, privateKey);
      await AsyncStorage.setItem(STORAGE_KEYS.PUBLIC_KEY, publicKey);
      
      this.privateKey = privateKey;
      this.publicKey = publicKey;
      
      return { privateKey, publicKey };
    } catch (error) {
      console.error('Error generating keys:', error);
      throw error;
    }
  }

  async loadRelays() {
    try {
      const savedRelays = await AsyncStorage.getItem(STORAGE_KEYS.RELAYS);
      const relayUrls = savedRelays ? JSON.parse(savedRelays) : DEFAULT_RELAYS;
      
      this.relayUrls = relayUrls;
    } catch (error) {
      console.error('Error loading relays:', error);
      this.relayUrls = DEFAULT_RELAYS;
    }
  }

  async connectToRelays() {
    try {
      // For browser environment, we'll just mark all relays as "connected"
      // The SimplePool will handle the actual connections
      this.relayUrls.forEach(url => {
        this.connectedRelays.add(url);
        console.log(`Marked relay as available: ${url}`);
      });
      
      if (this.connectedRelays.size === 0) {
        throw new Error(ERROR_MESSAGES.RELAY_CONNECTION_FAILED);
      }
    } catch (error) {
      console.error('Error connecting to relays:', error);
      throw error;
    }
  }

  async publishEvent(event) {
    try {
      if (!this.privateKey) {
        throw new Error(ERROR_MESSAGES.NO_PRIVATE_KEY);
      }
      
      // Create the event with proper structure
      const eventTemplate = {
        kind: event.kind,
        created_at: event.created_at || Math.floor(Date.now() / 1000),
        tags: event.tags || [],
        content: event.content
      };
      
      // Debug: check private key format
      console.log('Private key type:', typeof this.privateKey);
      console.log('Private key length:', this.privateKey?.length);
      console.log('Private key sample:', this.privateKey?.substring(0, 10) + '...');
      
      // Convert hex string to Uint8Array for nostr-tools
      const privateKeyBytes = new Uint8Array(
        this.privateKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );
      
      console.log('Private key bytes length:', privateKeyBytes.length);
      
      const finalEvent = finalizeEvent(eventTemplate, privateKeyBytes);
      
      // Publish using SimplePool
      const pubs = this.pool.publish(Array.from(this.connectedRelays), finalEvent);
      
      console.log('Published event:', finalEvent);
      return finalEvent;
    } catch (error) {
      console.error('Error publishing event:', error);
      throw error;
    }
  }

  subscribe(filters, onEvent, onEose = null) {
    try {
      const subscriptionId = this.generateSubscriptionId();
      
      const subscription = this.pool.subscribeMany(
        Array.from(this.connectedRelays),
        [filters],
        {
          onevent: (event) => {
            console.log('Received event:', event);
            onEvent(event);
          },
          oneose: onEose || (() => {
            console.log('End of stored events');
          })
        }
      );
      
      this.subscriptions.set(subscriptionId, subscription);
      
      return subscriptionId;
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw error;
    }
  }

  unsubscribe(subscriptionId) {
    try {
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription) {
        subscription.close();
        this.subscriptions.delete(subscriptionId);
      }
    } catch (error) {
      console.error('Error unsubscribing:', error);
    }
  }

  async createChannel(name, about, picture = '') {
    try {
      const event = nostrUtils.createChannelEvent(name, about, picture);
      const publishedEvent = await this.publishEvent(event);
      
      console.log('Channel published to relays:', publishedEvent.id);
      
      // Verify the channel was actually accepted by checking relays
      setTimeout(async () => {
        try {
          const channels = await this.queryChannels(10);
          const found = channels.find(c => c.id === publishedEvent.id);
          if (found) {
            console.log('✅ Channel confirmed on relays:', found.name);
          } else {
            console.log('⚠️ Channel not found on relays - may have been rejected');
          }
        } catch (error) {
          console.log('Could not verify channel on relays');
        }
      }, 2000);
      
      return publishedEvent;
    } catch (error) {
      console.error('Error creating channel:', error);
      throw error;
    }
  }

  async updateChannelMetadata(channelId, metadata) {
    try {
      const event = nostrUtils.createChannelMetadataEvent(channelId, metadata);
      return await this.publishEvent(event);
    } catch (error) {
      console.error('Error updating channel metadata:', error);
      throw error;
    }
  }

  async sendChannelMessage(channelId, message, replyTo = null) {
    try {
      const event = nostrUtils.createChannelMessageEvent(channelId, message, replyTo);
      return await this.publishEvent(event);
    } catch (error) {
      console.error('Error sending channel message:', error);
      throw error;
    }
  }

  async sendDirectMessage(recipientPubkey, message) {
    try {
      const event = nostrUtils.createDirectMessageEvent(
        recipientPubkey, 
        message, 
        this.privateKey
      );
      return await this.publishEvent(event);
    } catch (error) {
      console.error('Error sending direct message:', error);
      throw error;
    }
  }

  async performModerationAction(channelId, action, targetPubkey, reason = '') {
    try {
      const event = nostrUtils.createModerationEvent(
        channelId, 
        action, 
        targetPubkey, 
        reason
      );
      return await this.publishEvent(event);
    } catch (error) {
      console.error('Error performing moderation action:', error);
      throw error;
    }
  }

  async sendBotCommand(channelId, command, args = []) {
    try {
      const event = nostrUtils.createBotCommandEvent(channelId, command, args);
      return await this.publishEvent(event);
    } catch (error) {
      console.error('Error sending bot command:', error);
      throw error;
    }
  }

  async updateUserPresence(status, channels = []) {
    try {
      const event = nostrUtils.createUserPresenceEvent(status, channels);
      return await this.publishEvent(event);
    } catch (error) {
      console.error('Error updating user presence:', error);
      throw error;
    }
  }

  subscribeToChannel(channelId, onMessage, onMetadata, onModeration) {
    const filters = nostrUtils.createChannelSubscription(channelId);
    
    return this.subscribe(filters, (event) => {
      switch (event.kind) {
        case EVENT_KINDS.CHANNEL_MESSAGE:
          if (onMessage) {
            const message = nostrUtils.parseChannelMessage(event);
            onMessage(message);
          }
          break;
          
        case EVENT_KINDS.CHANNEL_METADATA:
          if (onMetadata) {
            onMetadata(event);
          }
          break;
          
        case EVENT_KINDS.CHANNEL_MODERATION:
          if (onModeration) {
            const modEvent = nostrUtils.parseModerationEvent(event);
            onModeration(modEvent);
          }
          break;
          
        case EVENT_KINDS.BOT_COMMAND:
          // Handle bot commands if needed
          break;
      }
    });
  }

  subscribeToDirectMessages(onMessage) {
    const filters = nostrUtils.createDirectMessageSubscription(this.publicKey);
    
    return this.subscribe(filters, (event) => {
      if (event.kind === EVENT_KINDS.ENCRYPTED_DM) {
        try {
          const decryptedContent = nostrUtils.decryptDirectMessage(
            event, 
            this.privateKey
          );
          
          if (decryptedContent && onMessage) {
            onMessage({
              id: event.id,
              content: decryptedContent,
              sender: event.pubkey,
              timestamp: event.created_at
            });
          }
        } catch (error) {
          console.error('Error decrypting direct message:', error);
        }
      }
    });
  }

  subscribeToUserProfiles(pubkeys, onProfile) {
    const filters = nostrUtils.createUserProfileSubscription(pubkeys);
    
    return this.subscribe(filters, (event) => {
      if (event.kind === EVENT_KINDS.METADATA) {
        try {
          const profile = JSON.parse(event.content);
          if (onProfile) {
            onProfile({
              pubkey: event.pubkey,
              profile,
              timestamp: event.created_at
            });
          }
        } catch (error) {
          console.error('Error parsing user profile:', error);
        }
      }
    });
  }

  async queryChannels(limit = 50) {
    try {
      console.log('Querying channels from relays...');
      console.log('Connected relays:', Array.from(this.connectedRelays));
      
      // Only query real channels from relays
      return new Promise((resolve) => {
        const channels = [];
        let timeoutId;
        
        const filters = {
          kinds: [EVENT_KINDS.CHANNEL_CREATION],
          limit: limit,
          since: Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60) // Last 7 days
        };
        
        console.log('Query filters:', filters);
        
        const subscription = this.pool.subscribeMany(
          Array.from(this.connectedRelays),
          [filters],
          {
            onevent: (event) => {
              console.log('📡 Found channel event from relay:', event);
              const channel = nostrUtils.parseChannelEvent(event);
              if (channel) {
                // Check if we already have this channel
                const exists = channels.find(c => c.id === channel.id);
                if (!exists) {
                  channels.push(channel);
                  console.log('✅ Added channel from relay:', channel.name);
                } else {
                  console.log('🔄 Duplicate channel ignored:', channel.name);
                }
              } else {
                console.log('❌ Failed to parse channel event');
              }
            },
            oneose: () => {
              console.log('📬 End of stored events for channels');
              clearTimeout(timeoutId);
              subscription.close();
              
              // Sort by creation time (newest first)
              const sortedChannels = channels.sort((a, b) => b.createdAt - a.createdAt);
              console.log('🎯 Returning', sortedChannels.length, 'channels from relays');
              resolve(sortedChannels);
            }
          }
        );
        
        // Timeout after 8 seconds (increased for better relay response)
        timeoutId = setTimeout(() => {
          console.log('⏰ Channel query timeout, returning', channels.length, 'channels');
          subscription.close();
          
          // Sort by creation time (newest first)
          const sortedChannels = channels.sort((a, b) => b.createdAt - a.createdAt);
          resolve(sortedChannels);
        }, 8000);
      });
    } catch (error) {
      console.error('Error querying channels:', error);
      return [];
    }
  }

  async queryChannelMessages(channelId, limit = 100, since = null) {
    try {
      // For now, return empty array
      console.log(`Querying messages for channel ${channelId} - returning empty for now`);
      return [];
    } catch (error) {
      console.error('Error querying channel messages:', error);
      return [];
    }
  }

  async queryUserProfile(pubkey) {
    try {
      // For now, return null
      console.log(`Querying profile for ${pubkey} - returning null for now`);
      return null;
    } catch (error) {
      console.error('Error querying user profile:', error);
      return null;
    }
  }

  generateSubscriptionId() {
    return Math.random().toString(36).substring(2, 15);
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      connectedRelays: Array.from(this.connectedRelays || []),
      totalRelays: (this.relayUrls || []).length
    };
  }

  async addRelay(url) {
    try {
      if (!this.relayUrls.includes(url)) {
        this.relayUrls.push(url);
        await AsyncStorage.setItem(STORAGE_KEYS.RELAYS, JSON.stringify(this.relayUrls));
        await this.connectToRelay(url);
      }
    } catch (error) {
      console.error('Error adding relay:', error);
      throw error;
    }
  }

  async removeRelay(url) {
    try {
      const index = this.relayUrls.indexOf(url);
      if (index > -1) {
        this.relayUrls.splice(index, 1);
        await AsyncStorage.setItem(STORAGE_KEYS.RELAYS, JSON.stringify(this.relayUrls));
        
        const relay = this.relays.get(url);
        if (relay) {
          relay.close();
          this.relays.delete(url);
          this.connectedRelays.delete(url);
        }
      }
    } catch (error) {
      console.error('Error removing relay:', error);
      throw error;
    }
  }

  disconnect() {
    try {
      // Close all subscriptions
      this.subscriptions.forEach(sub => sub.close());
      this.subscriptions.clear();
      
      // Close all relay connections
      this.relays.forEach(relay => relay.close());
      this.relays.clear();
      this.connectedRelays.clear();
      
      this.isConnected = false;
    } catch (error) {
      console.error('Error disconnecting:', error);
    }
  }
}

export const nostrService = new NostrService();
export default nostrService;