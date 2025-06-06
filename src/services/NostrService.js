import { SimplePool, getPublicKey, finalizeEvent, generateSecretKey, nip04 } from 'nostr-tools';
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

  async sendChannelMessage(channelId, message, replyTo = null, messageType = null) {
    try {
      const event = nostrUtils.createChannelMessageEvent(channelId, message, replyTo);
      
      // Add message type tag if specified (for bot responses, etc.)
      if (messageType) {
        event.tags = event.tags || [];
        event.tags.push(['message_type', messageType]);
      }
      
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

  async queryChannels(limit = 200) {
    try {
      console.log('Querying channels from relays...');
      console.log('Connected relays:', Array.from(this.connectedRelays));
      
      // Only query real channels from relays
      return new Promise((resolve) => {
        const channels = [];
        let timeoutId;
        
        const filters = {
          kinds: [EVENT_KINDS.CHANNEL_CREATION],
          limit: limit
          // Removed 'since' filter to get all channels, not just last 7 days
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
        
        // Timeout after 12 seconds (increased for better relay response)
        timeoutId = setTimeout(() => {
          console.log('⏰ Channel query timeout, returning', channels.length, 'channels');
          subscription.close();
          
          // Sort by creation time (newest first)
          const sortedChannels = channels.sort((a, b) => b.createdAt - a.createdAt);
          resolve(sortedChannels);
        }, 12000);
      });
    } catch (error) {
      console.error('Error querying channels:', error);
      return [];
    }
  }

  async queryChannelMessages(channelId, limit = 100, since = null) {
    try {
      const queryId = Math.random().toString(36).substring(2, 8);
      console.log(`🔄 FRESH QUERY [${queryId}] for channel ${channelId}...`);
      console.log('Channel ID length:', channelId.length);
      console.log('Channel ID sample:', channelId.substring(0, 20) + '...');
      
      return new Promise((resolve) => {
        const messages = [];
        let timeoutId;
        let subscription;
        
        // Try both: with and without channel filtering to compare
        const filters = [
          // Filter 1: Official channel messages for this specific channel
          {
            kinds: [EVENT_KINDS.CHANNEL_MESSAGE],
            '#e': [channelId],
            limit: 50
          },
          // Filter 2: Text notes that reference this channel
          {
            kinds: [EVENT_KINDS.TEXT_NOTE],
            '#e': [channelId], 
            limit: 50
          }
        ];
        
        console.log('Message query filters:', filters);
        
        subscription = this.pool.subscribeMany(
          Array.from(this.connectedRelays),
          filters,
          {
            onevent: (event) => {
              console.log(`🔍 [${queryId}] CHANNEL-SPECIFIC EVENT found:`);
              console.log('🔍 Kind:', event.kind);
              console.log('🔍 Content:', event.content);
              console.log('🔍 Tags:', JSON.stringify(event.tags, null, 2));
              console.log('🔍 Target channel:', channelId);
              
              // Verify this event actually references our channel
              const referencesChannel = event.tags.some(tag => 
                tag[0] === 'e' && tag[1] === channelId
              );
              
              if (referencesChannel) {
                const message = {
                  id: event.id,
                  content: event.content,
                  author: event.pubkey,
                  channelId: channelId,
                  timestamp: event.created_at,
                  kind: event.kind,
                  tags: event.tags
                };
                
                messages.push(message);
                console.log(`✅ [${queryId}] Added VALID channel message - Total:`, messages.length);
              } else {
                console.log(`❌ [${queryId}] Event does not reference target channel`);
              }
            },
            oneose: () => {
              console.log('📬 End of stored events for channel', channelId);
              clearTimeout(timeoutId);
              if (subscription) {
                subscription.close();
                subscription = null;
              }
              
              // Sort by timestamp (oldest first)
              const sortedMessages = messages.sort((a, b) => a.timestamp - b.timestamp);
              console.log('🎯 Returning', sortedMessages.length, 'messages for channel', channelId);
              resolve(sortedMessages);
            }
          }
        );
        
        // Timeout after 5 seconds
        timeoutId = setTimeout(() => {
          console.log('⏰ Query timeout for channel', channelId, '- returning', messages.length, 'messages');
          if (subscription) {
            subscription.close();
            subscription = null;
          }
          
          // Sort by timestamp (oldest first)
          const sortedMessages = messages.sort((a, b) => a.timestamp - b.timestamp);
          resolve(sortedMessages);
        }, 5000);
      });
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

  // Private messaging methods (NIP-04)
  async sendPrivateMessage(recipientPubkey, content) {
    if (!this.privateKey) {
      throw new Error('No private key available for encryption');
    }

    try {
      // Encrypt the message using NIP-04
      const encryptedContent = await nip04.encrypt(this.privateKey, recipientPubkey, content);
      
      // Create the encrypted direct message event
      const event = {
        kind: 4, // NIP-04 encrypted direct message
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', recipientPubkey]],
        content: encryptedContent,
      };

      const signedEvent = finalizeEvent(event, this.privateKey);
      
      // Publish to relays
      await this.pool.publish(Array.from(this.connectedRelays), signedEvent);
      
      console.log('Private message sent to:', recipientPubkey.substring(0, 8) + '...');
      return signedEvent;
    } catch (error) {
      console.error('Error sending private message:', error);
      throw error;
    }
  }

  async getPrivateConversations() {
    if (!this.publicKey) {
      throw new Error('No public key available');
    }

    try {
      // Query for both sent and received DMs
      const sentEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [4],
        authors: [this.publicKey],
        limit: 1000
      });

      const receivedEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [4],
        '#p': [this.publicKey],
        limit: 1000
      });

      // Combine and process messages
      const allEvents = [...sentEvents, ...receivedEvents];
      const conversations = new Map();

      for (const event of allEvents) {
        try {
          let otherPubkey;
          let isFromMe = event.pubkey === this.publicKey;
          
          if (isFromMe) {
            // Message sent by me, find recipient
            const pTag = event.tags.find(tag => tag[0] === 'p');
            if (!pTag) continue;
            otherPubkey = pTag[1];
          } else {
            // Message received by me
            otherPubkey = event.pubkey;
          }

          // Decrypt message
          const decryptedContent = await nip04.decrypt(this.privateKey, otherPubkey, event.content);
          
          const message = {
            id: event.id,
            content: decryptedContent,
            author: event.pubkey,
            recipient: isFromMe ? otherPubkey : this.publicKey,
            timestamp: event.created_at,
            isFromMe: isFromMe
          };

          if (!conversations.has(otherPubkey)) {
            conversations.set(otherPubkey, {
              pubkey: otherPubkey,
              messages: [],
              lastMessage: null,
              unreadCount: 0
            });
          }

          const conversation = conversations.get(otherPubkey);
          conversation.messages.push(message);
          
          // Update last message if this is newer
          if (!conversation.lastMessage || message.timestamp > conversation.lastMessage.timestamp) {
            conversation.lastMessage = message;
          }
        } catch (decryptError) {
          console.warn('Failed to decrypt message:', decryptError);
          // Skip messages that can't be decrypted
        }
      }

      // Sort messages in each conversation and calculate unread count
      const conversationsList = Array.from(conversations.values()).map(conv => {
        conv.messages.sort((a, b) => a.timestamp - b.timestamp);
        
        // For now, mark all messages from others as unread (in a real app, you'd track read status)
        conv.unreadCount = conv.messages.filter(msg => !msg.isFromMe).length;
        
        return conv;
      });

      // Sort conversations by last message timestamp
      conversationsList.sort((a, b) => {
        const aTime = a.lastMessage ? a.lastMessage.timestamp : 0;
        const bTime = b.lastMessage ? b.lastMessage.timestamp : 0;
        return bTime - aTime;
      });

      return conversationsList;
    } catch (error) {
      console.error('Error getting private conversations:', error);
      throw error;
    }
  }

  async getPrivateMessages(contactPubkey, limit = 100) {
    if (!this.publicKey || !this.privateKey) {
      throw new Error('No keys available');
    }

    try {
      // Query for messages between me and the contact
      const sentEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [4],
        authors: [this.publicKey],
        '#p': [contactPubkey],
        limit: limit
      });

      const receivedEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [4],
        authors: [contactPubkey],
        '#p': [this.publicKey],
        limit: limit
      });

      const allEvents = [...sentEvents, ...receivedEvents];
      const messages = [];

      for (const event of allEvents) {
        try {
          const decryptedContent = await nip04.decrypt(this.privateKey, contactPubkey, event.content);
          
          messages.push({
            id: event.id,
            content: decryptedContent,
            author: event.pubkey,
            timestamp: event.created_at,
            isFromMe: event.pubkey === this.publicKey
          });
        } catch (decryptError) {
          console.warn('Failed to decrypt message:', decryptError);
        }
      }

      // Sort by timestamp
      messages.sort((a, b) => a.timestamp - b.timestamp);
      
      return messages;
    } catch (error) {
      console.error('Error getting private messages:', error);
      throw error;
    }
  }

  subscribeToPrivateMessages(contactPubkey, onNewMessage) {
    if (!this.publicKey) {
      throw new Error('No public key available');
    }

    const subscriptionId = `dm_${contactPubkey}`;
    
    // Subscribe to new messages from contact
    const sub = this.pool.subscribeMany(Array.from(this.connectedRelays), [
      {
        kinds: [4],
        authors: [contactPubkey],
        '#p': [this.publicKey],
        since: Math.floor(Date.now() / 1000)
      }
    ], {
      onevent: async (event) => {
        try {
          const decryptedContent = await nip04.decrypt(this.privateKey, contactPubkey, event.content);
          
          const message = {
            id: event.id,
            content: decryptedContent,
            author: event.pubkey,
            timestamp: event.created_at,
            isFromMe: false
          };

          onNewMessage(message);
        } catch (error) {
          console.error('Error decrypting new private message:', error);
        }
      },
      oneose: () => {
        console.log('Private message subscription established for:', contactPubkey.substring(0, 8) + '...');
      }
    });

    this.subscriptions.set(subscriptionId, sub);
    return subscriptionId;
  }

  async getUserProfile(pubkey) {
    try {
      // Query for user profile metadata (kind 0)
      const profileEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [0],
        authors: [pubkey],
        limit: 1
      });

      if (profileEvents.length > 0) {
        // Get the most recent profile event
        const latestProfile = profileEvents.sort((a, b) => b.created_at - a.created_at)[0];
        
        try {
          const profileData = JSON.parse(latestProfile.content);
          return profileData;
        } catch (parseError) {
          console.warn('Failed to parse profile data for:', pubkey);
          return null;
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting user profile:', error);
      return null;
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