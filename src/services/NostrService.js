import { SimplePool, getPublicKey, finalizeEvent, generateSecretKey, nip04 } from 'nostr-tools';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nostrUtils } from '../utils/nostrUtils';
import { 
  DEFAULT_RELAYS, 
  STORAGE_KEYS, 
  EVENT_KINDS,
  ERROR_MESSAGES 
} from '../utils/constants';

// Simple proof-of-work calculation for Nostr events
function calculateProofOfWork(event, targetDifficulty = 16) {
  let nonce = 0;
  const baseEvent = { ...event };
  
  while (true) {
    // Add nonce tag
    baseEvent.tags = (event.tags || []).filter(tag => tag[0] !== 'nonce');
    baseEvent.tags.push(['nonce', nonce.toString(), targetDifficulty.toString()]);
    
    // Calculate event ID (hash)
    const eventString = JSON.stringify([
      0,
      baseEvent.pubkey,
      baseEvent.created_at,
      baseEvent.kind,
      baseEvent.tags,
      baseEvent.content
    ]);
    
    // Simple hash calculation (this is a simplified version)
    let hash = 0;
    for (let i = 0; i < eventString.length; i++) {
      const char = eventString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    // Convert to hex and check leading zeros
    const hexHash = Math.abs(hash).toString(16).padStart(8, '0');
    const leadingZeros = hexHash.match(/^0*/)[0].length * 4; // Each hex digit = 4 bits
    
    if (leadingZeros >= targetDifficulty) {
      console.log(`⛏️ Proof of work found: nonce=${nonce}, difficulty=${leadingZeros} bits`);
      return { ...baseEvent, tags: baseEvent.tags };
    }
    
    nonce++;
    
    // Prevent infinite loops
    if (nonce > 100000) {
      console.log('⚠️ Proof of work calculation timeout, using original event');
      return event;
    }
  }
}

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
    
    // Rate limiting and retry management
    this.publishDelay = 3000; // 3 seconds between publishes (reduced from 5s for better responsiveness)
    this.maxRetries = 8; // Even more retries for better success rate  
    this.baseRetryDelay = 1500; // 1.5 second base delay
    this.lastGlobalPublish = 0; // timestamp of last publish
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

  async publishEvent(event, retryCount = 0, options = {}) {
    try {
      if (!this.privateKey) {
        throw new Error(ERROR_MESSAGES.NO_PRIVATE_KEY);
      }
      
      // Create the event with proper structure
      let eventTemplate = {
        kind: event.kind,
        created_at: event.created_at || Math.floor(Date.now() / 1000),
        tags: event.tags || [],
        content: event.content
      };
      
      // Apply proof-of-work if requested (for bot messages that need higher delivery success)
      if (options.useProofOfWork) {
        console.log('⛏️ Calculating proof of work for better delivery...');
        eventTemplate = calculateProofOfWork(eventTemplate, options.proofOfWorkDifficulty || 16);
      }
      
      // Convert hex string to Uint8Array for nostr-tools
      const privateKeyBytes = new Uint8Array(
        this.privateKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );
      
      const finalEvent = finalizeEvent(eventTemplate, privateKeyBytes);
      
      // Apply rate limiting delay if requested
      if (retryCount === 0 && options.useRateLimit !== false) {
        await this.applyGlobalRateLimit();
      }
      
      // Publish using SimplePool (simple approach)
      console.log(`📡 Publishing event to ${this.connectedRelays.size} relays (attempt ${retryCount + 1}/${this.maxRetries + 1})`);
      
      try {
        const pubs = this.pool.publish(Array.from(this.connectedRelays), finalEvent);
        console.log('✅ Event published to relays');
        return finalEvent;
      } catch (publishError) {
        console.log(`❌ Publish failed:`, publishError.message);
        
        // Retry with exponential backoff if we haven't exceeded max retries
        if (retryCount < this.maxRetries) {
          const delay = this.baseRetryDelay * Math.pow(2, retryCount);
          console.log(`⏳ Retrying in ${delay}ms...`);
          
          await new Promise(resolve => setTimeout(resolve, delay));
          return await this.publishEvent(event, retryCount + 1, options);
        }
        
        throw publishError;
      }
      
    } catch (error) {
      console.error('Error publishing event:', error);
      throw error;
    }
  }

  async applyGlobalRateLimit() {
    const now = Date.now();
    const lastPublish = this.lastGlobalPublish || 0;
    const timeSinceLastPublish = now - lastPublish;
    
    if (timeSinceLastPublish < this.publishDelay) {
      const delay = this.publishDelay - timeSinceLastPublish;
      console.log(`⏱️ Rate limiting: waiting ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastGlobalPublish = now;
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
      
      // Use enhanced publishing with proof-of-work for bot responses
      const publishOptions = {};
      if (messageType === 'bot_response') {
        publishOptions.useProofOfWork = true;
        publishOptions.proofOfWorkDifficulty = 16; // Moderate difficulty for better delivery
        console.log('🤖 Using enhanced publishing for bot response');
      }
      
      return await this.publishEvent(event, 0, publishOptions);
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

  async searchChannels(searchQuery, limit = 500) {
    try {
      console.log('🔍 Searching channels on Nostr network for:', searchQuery);
      console.log('Connected relays:', Array.from(this.connectedRelays));
      
      return new Promise((resolve) => {
        const channels = [];
        let timeoutId;
        
        // Query more channels for search (500 instead of 200)
        const filters = {
          kinds: [EVENT_KINDS.CHANNEL_CREATION],
          limit: limit
        };
        
        console.log('Search filters:', filters);
        
        const subscription = this.pool.subscribeMany(
          Array.from(this.connectedRelays),
          [filters],
          {
            onevent: (event) => {
              const channel = nostrUtils.parseChannelEvent(event);
              if (channel) {
                // Filter by search query on name and description
                const nameMatch = channel.name && channel.name.toLowerCase().includes(searchQuery.toLowerCase());
                const aboutMatch = channel.about && channel.about.toLowerCase().includes(searchQuery.toLowerCase());
                
                if (nameMatch || aboutMatch) {
                  // Check if we already have this channel
                  const exists = channels.find(c => c.id === channel.id);
                  if (!exists) {
                    channels.push(channel);
                    console.log('🎯 Found matching channel:', channel.name);
                  }
                }
              }
            },
            oneose: () => {
              console.log('📬 End of search, found', channels.length, 'matching channels');
              clearTimeout(timeoutId);
              subscription.close();
              
              // Sort by creation time (newest first)
              const sortedChannels = channels.sort((a, b) => b.createdAt - a.createdAt);
              console.log('✅ Returning', sortedChannels.length, 'search results');
              resolve(sortedChannels);
            }
          }
        );
        
        // Shorter timeout for search (8 seconds)
        timeoutId = setTimeout(() => {
          console.log('⏰ Search timeout, returning', channels.length, 'results');
          subscription.close();
          
          // Sort by creation time (newest first)
          const sortedChannels = channels.sort((a, b) => b.createdAt - a.createdAt);
          resolve(sortedChannels);
        }, 8000);
      });
    } catch (error) {
      console.error('Error searching channels:', error);
      return [];
    }
  }

  async getUserPosts(userPubkey, limit = 50) {
    try {
      console.log('📝 Querying posts for user:', userPubkey.substring(0, 8) + '...');
      
      return new Promise((resolve) => {
        const posts = [];
        let timeoutId;
        
        const filters = {
          kinds: [EVENT_KINDS.TEXT_NOTE], // Kind 1 - text notes
          authors: [userPubkey],
          limit: limit
        };
        
        console.log('User posts filters:', filters);
        
        const subscription = this.pool.subscribeMany(
          Array.from(this.connectedRelays),
          [filters],
          {
            onevent: (event) => {
              // Only include regular text notes, not replies
              const isReply = event.tags && event.tags.some(tag => tag[0] === 'e');
              if (!isReply) {
                const exists = posts.find(p => p.id === event.id);
                if (!exists) {
                  posts.push(event);
                  console.log('📄 Found post from user');
                }
              }
            },
            oneose: () => {
              console.log('📬 End of user posts query, found', posts.length, 'posts');
              clearTimeout(timeoutId);
              subscription.close();
              resolve(posts);
            }
          }
        );
        
        // Timeout after 10 seconds
        timeoutId = setTimeout(() => {
          console.log('⏰ User posts query timeout, returning', posts.length, 'posts');
          subscription.close();
          resolve(posts);
        }, 10000);
      });
    } catch (error) {
      console.error('Error querying user posts:', error);
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
      console.log(`🔍 Querying profile for ${pubkey.substring(0, 8)}...`);
      
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
          console.log('✅ Profile found:', profileData.name || 'Unnamed');
          return profileData;
        } catch (parseError) {
          console.warn('Failed to parse profile data for:', pubkey.substring(0, 8));
          return null;
        }
      }

      console.log('📭 No profile found for user');
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

  async getUserContacts(pubkey) {
    try {
      // Query for contact list (kind 3)
      const contactEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [3],
        authors: [pubkey],
        limit: 1
      });

      if (contactEvents.length > 0) {
        // Get the most recent contact list event
        const latestContacts = contactEvents.sort((a, b) => b.created_at - a.created_at)[0];
        
        // Extract pubkeys from p tags
        const following = latestContacts.tags
          .filter(tag => tag[0] === 'p' && tag[1])
          .map(tag => tag[1]);
        
        console.log(`Found ${following.length} contacts for user ${pubkey.substring(0, 8)}...`);
        return following;
      }

      return [];
    } catch (error) {
      console.error('Error getting user contacts:', error);
      return [];
    }
  }

  async getUserFollowers(pubkey, limit = 200) {
    try {
      console.log(`🔍 Finding followers for user ${pubkey.substring(0, 8)}...`);
      
      // Query for contact lists (kind 3) that include this user in their p tags
      const followerEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [3], // Contact lists
        '#p': [pubkey], // Contact lists that mention this pubkey
        limit: limit
      });

      console.log(`📡 Found ${followerEvents.length} contact list events mentioning user`);

      // Extract unique followers
      const followers = new Set();
      const followerProfiles = new Map();

      for (const event of followerEvents) {
        // Check if this contact list actually includes our user
        const includesUser = event.tags.some(tag => 
          tag[0] === 'p' && tag[1] === pubkey
        );
        
        if (includesUser) {
          followers.add(event.pubkey);
          console.log(`👤 Found follower: ${event.pubkey.substring(0, 8)}...`);
        }
      }

      const followersList = Array.from(followers);
      console.log(`✅ Total unique followers found: ${followersList.length}`);
      
      return followersList;
    } catch (error) {
      console.error('Error getting user followers:', error);
      return [];
    }
  }

  async getMultipleUserProfiles(pubkeys) {
    try {
      if (!pubkeys || pubkeys.length === 0) {
        return new Map();
      }

      console.log(`Querying profiles for ${pubkeys.length} users...`);
      
      // Query for multiple user profiles at once
      const profileEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [0],
        authors: pubkeys,
        limit: pubkeys.length * 2
      });

      const profiles = new Map();

      // Process each profile event
      for (const event of profileEvents) {
        try {
          const profileData = JSON.parse(event.content);
          
          // Keep only the most recent profile for each pubkey
          if (!profiles.has(event.pubkey) || 
              profiles.get(event.pubkey).timestamp < event.created_at) {
            profiles.set(event.pubkey, {
              ...profileData,
              pubkey: event.pubkey,
              timestamp: event.created_at
            });
          }
        } catch (parseError) {
          console.warn('Failed to parse profile data for:', event.pubkey);
        }
      }

      console.log(`Retrieved ${profiles.size} profiles out of ${pubkeys.length} requested`);
      return profiles;
    } catch (error) {
      console.error('Error getting multiple user profiles:', error);
      return new Map();
    }
  }

  async getFeedPosts(followingPubkeys, limit = 100) {
    try {
      if (!followingPubkeys || followingPubkeys.length === 0) {
        return [];
      }

      console.log(`Querying feed posts from ${followingPubkeys.length} followed users...`);
      
      // Query for text notes (kind 1) from followed users
      const feedEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [1], // Text notes
        authors: followingPubkeys,
        limit: limit,
        since: Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60) // Last 7 days
      });

      // Also get potential replies to these posts
      const postIds = feedEvents.map(event => event.id);
      const replyEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [1],
        '#e': postIds,
        limit: limit * 2
      });

      // Combine and deduplicate events
      const allEvents = [...feedEvents, ...replyEvents];
      const uniqueEvents = new Map();
      
      allEvents.forEach(event => {
        if (!uniqueEvents.has(event.id)) {
          uniqueEvents.set(event.id, event);
        }
      });

      const posts = Array.from(uniqueEvents.values()).map(event => ({
        id: event.id,
        content: event.content,
        pubkey: event.pubkey,
        created_at: event.created_at,
        tags: event.tags || [],
        sig: event.sig
      }));

      console.log(`Retrieved ${posts.length} posts for feed`);
      return posts;
    } catch (error) {
      console.error('Error getting feed posts:', error);
      return [];
    }
  }

  async likePost(postId, authorPubkey) {
    try {
      console.log('🔍 NostrService.likePost called with:', { postId, authorPubkey });
      console.log('🔍 Service state:', { 
        hasPrivateKey: !!this.privateKey, 
        isConnected: this.isConnected,
        connectedRelays: this.connectedRelays.size 
      });
      
      if (!this.privateKey) {
        throw new Error('No private key available for liking posts');
      }

      if (!this.isConnected || this.connectedRelays.size === 0) {
        throw new Error('Not connected to any Nostr relays');
      }

      console.log(`❤️ Creating like event for post ${postId}...`);
      
      // Create reaction event (kind 7)
      const reactionEvent = {
        kind: 7, // Reaction
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', postId], // Event being reacted to
          ['p', authorPubkey], // Author of the event being reacted to
        ],
        content: '❤️', // Heart emoji for like
      };

      console.log('📝 Publishing reaction event:', reactionEvent);
      const signedEvent = await this.publishEvent(reactionEvent);
      console.log('✅ Like event published successfully:', signedEvent.id);
      return signedEvent;
    } catch (error) {
      console.error('❌ Error in likePost:', error);
      throw error;
    }
  }

  async unlikePost(postId, authorPubkey) {
    try {
      console.log('🔍 NostrService.unlikePost called with:', { postId, authorPubkey });
      
      if (!this.privateKey) {
        throw new Error('No private key available for unliking posts');
      }

      if (!this.isConnected || this.connectedRelays.size === 0) {
        throw new Error('Not connected to any Nostr relays');
      }

      console.log(`💔 Creating delete event for liked post ${postId}...`);
      
      // First, find the user's like event for this post
      const userLikes = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [7], // Reactions
        authors: [this.publicKey],
        '#e': [postId],
        limit: 10
      });

      if (userLikes.length === 0) {
        console.log('⚠️ No like event found to delete');
        return null;
      }

      // Get the most recent like event
      const likeToDelete = userLikes.sort((a, b) => b.created_at - a.created_at)[0];
      console.log('🎯 Found like event to delete:', likeToDelete.id);

      // Create deletion event (kind 5)
      const deleteEvent = {
        kind: 5, // Deletion
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', likeToDelete.id], // Event to delete (the like event)
        ],
        content: 'Unliked post',
      };

      console.log('📝 Publishing delete event:', deleteEvent);
      const signedEvent = await this.publishEvent(deleteEvent);
      console.log('✅ Unlike event published successfully:', signedEvent.id);
      return signedEvent;
    } catch (error) {
      console.error('❌ Error in unlikePost:', error);
      throw error;
    }
  }

  async repostPost(postId, authorPubkey, content = '') {
    try {
      if (!this.privateKey) {
        throw new Error('No private key available for reposting');
      }

      console.log(`Reposting post ${postId}...`);
      
      // Create repost event (kind 6)
      const repostEvent = {
        kind: 6, // Repost
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', postId], // Event being reposted
          ['p', authorPubkey], // Author of the event being reposted
        ],
        content: content, // Optional comment on repost
      };

      const signedEvent = await this.publishEvent(repostEvent);
      console.log('Repost event published:', signedEvent.id);
      return signedEvent;
    } catch (error) {
      console.error('Error reposting post:', error);
      throw error;
    }
  }

  async replyToPost(postId, authorPubkey, content) {
    try {
      if (!this.privateKey) {
        throw new Error('No private key available for replying');
      }

      if (!content || !content.trim()) {
        throw new Error('Reply content cannot be empty');
      }

      console.log(`Replying to post ${postId}...`);
      
      // Create reply event (kind 1 with e tag)
      const replyEvent = {
        kind: 1, // Text note
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', postId], // Event being replied to
          ['p', authorPubkey], // Author of the event being replied to
        ],
        content: content.trim(),
      };

      const signedEvent = await this.publishEvent(replyEvent);
      console.log('Reply event published:', signedEvent.id);
      return signedEvent;
    } catch (error) {
      console.error('Error replying to post:', error);
      throw error;
    }
  }

  async createTextNote(content) {
    try {
      if (!this.privateKey) {
        throw new Error('No private key available for posting');
      }

      if (!content || !content.trim()) {
        throw new Error('Post content cannot be empty');
      }

      console.log('📝 Creating new text note...');
      
      // Create text note event (kind 1)
      const textNoteEvent = {
        kind: 1, // Text note
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: content.trim(),
      };

      const signedEvent = await this.publishEvent(textNoteEvent);
      console.log('✅ Text note published:', signedEvent.id);
      return signedEvent;
    } catch (error) {
      console.error('❌ Error creating text note:', error);
      throw error;
    }
  }

  async getPostInteractions(postIds) {
    try {
      if (!postIds || postIds.length === 0) {
        return { likes: new Map(), reposts: new Map(), replies: new Map() };
      }

      console.log(`🔍 Querying interactions for ${postIds.length} posts...`);

      // Query for reactions (kind 7) - likes
      const reactionEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [7], // Reactions
        '#e': postIds,
        limit: 1000
      });

      // Query for reposts (kind 6)
      const repostEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [6], // Reposts
        '#e': postIds,
        limit: 1000
      });

      // Query for replies (kind 1 with e tags)
      const replyEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [1], // Text notes that are replies
        '#e': postIds,
        limit: 1000
      });

      // Process results
      const likes = new Map();
      const reposts = new Map();
      const replies = new Map();

      // Count reactions/likes
      reactionEvents.forEach(event => {
        const postId = event.tags.find(tag => tag[0] === 'e')?.[1];
        if (postId) {
          if (!likes.has(postId)) {
            likes.set(postId, { count: 0, users: new Set(), userLiked: false });
          }
          const likeData = likes.get(postId);
          likeData.count++;
          likeData.users.add(event.pubkey);
          if (event.pubkey === this.publicKey) {
            likeData.userLiked = true;
          }
        }
      });

      // Count reposts
      repostEvents.forEach(event => {
        const postId = event.tags.find(tag => tag[0] === 'e')?.[1];
        if (postId) {
          if (!reposts.has(postId)) {
            reposts.set(postId, { count: 0, users: new Set(), userReposted: false });
          }
          const repostData = reposts.get(postId);
          repostData.count++;
          repostData.users.add(event.pubkey);
          if (event.pubkey === this.publicKey) {
            repostData.userReposted = true;
          }
        }
      });

      // Count replies
      replyEvents.forEach(event => {
        const postId = event.tags.find(tag => tag[0] === 'e')?.[1];
        if (postId && event.pubkey !== this.publicKey) { // Don't count our own posts
          if (!replies.has(postId)) {
            replies.set(postId, { count: 0, users: new Set() });
          }
          const replyData = replies.get(postId);
          replyData.count++;
          replyData.users.add(event.pubkey);
        }
      });

      console.log(`📊 Found interactions - Likes: ${reactionEvents.length}, Reposts: ${repostEvents.length}, Replies: ${replyEvents.length}`);

      return { likes, reposts, replies };
    } catch (error) {
      console.error('Error getting post interactions:', error);
      return { likes: new Map(), reposts: new Map(), replies: new Map() };
    }
  }

  async getUserLikes() {
    try {
      if (!this.publicKey) return new Set();

      // Query for user's reactions (kind 7)
      const reactionEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [7],
        authors: [this.publicKey],
        limit: 1000
      });

      const likedPosts = new Set();
      reactionEvents.forEach(event => {
        const postId = event.tags.find(tag => tag[0] === 'e')?.[1];
        if (postId) {
          likedPosts.add(postId);
        }
      });

      return likedPosts;
    } catch (error) {
      console.error('Error getting user likes:', error);
      return new Set();
    }
  }

  async getUserReposts() {
    try {
      if (!this.publicKey) return new Set();

      // Query for user's reposts (kind 6)
      const repostEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [6],
        authors: [this.publicKey],
        limit: 1000
      });

      const repostedPosts = new Set();
      repostEvents.forEach(event => {
        const postId = event.tags.find(tag => tag[0] === 'e')?.[1];
        if (postId) {
          repostedPosts.add(postId);
        }
      });

      return repostedPosts;
    } catch (error) {
      console.error('Error getting user reposts:', error);
      return new Set();
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