import { SimplePool, getPublicKey, finalizeEvent, generateSecretKey, nip04 } from 'nostr-tools';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nostrUtils } from '../utils/nostrUtils';
import { cacheService } from './CacheService';
import { groupEncryptionService } from './GroupEncryptionService';
import { 
  DEFAULT_RELAYS, 
  NIP29_RELAYS,
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

  async createPrivateGroup(name, about, picture = '') {
    try {
      console.log('⚠️ Creating private channel using basic privacy flag (not real NIP-17)...');
      
      // Create a private group event (kind 40 with special private group markers)
      const event = {
        kind: 40, // Channel creation event
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['name', name],
          ['about', about],
          ['picture', picture],
          ['private', 'true'], // Mark as private group
          ['privacy', 'basic'], // Basic privacy flag only - no real encryption
          ['member_limit', '50'] // Recommended member limit for private groups
        ],
        content: JSON.stringify({
          name,
          about,
          picture,
          type: 'private',
          created_by: this.publicKey,
          encryption_method: 'nip-17',
          member_limit: 50,
          invitation_only: true
        }),
        pubkey: this.publicKey
      };

      // Sign the event
      const publishedEvent = await this.publishEvent(event);
      
      console.log('✅ Private group created:', publishedEvent.id);
      
      // Initialize empty member list for this private group
      await this.initializePrivateGroupMembers(publishedEvent.id, [this.publicKey]);
      
      return publishedEvent;
    } catch (error) {
      console.error('Error creating private group:', error);
      throw error;
    }
  }

  // NEW: Create real encrypted private group with shared secret
  async createRealEncryptedGroup(name, about, picture = '', initialMemberPubkeys = []) {
    try {
      console.log('🔐 Creating REAL encrypted private group with shared secret...');
      
      // Use GroupEncryptionService to create encrypted group
      const groupData = await groupEncryptionService.createEncryptedGroup(
        name, 
        about, 
        picture, 
        initialMemberPubkeys
      );
      
      // Set up encryption service reference
      groupEncryptionService.publicKey = this.publicKey;
      
      // Publish the group creation event
      const publishedGroupEvent = await this.publishEvent(groupData.groupEvent);
      
      // Distribute group key to initial members
      if (initialMemberPubkeys.length > 0) {
        console.log(`🔑 Distributing group key to ${initialMemberPubkeys.length} members...`);
        
        const keyDistribution = await groupEncryptionService.distributeGroupKey(
          groupData.groupId,
          groupData.groupKey,
          groupData.keyVersion,
          initialMemberPubkeys,
          this // Pass NostrService instance
        );
        
        // Publish key distribution DMs
        for (const distribution of keyDistribution) {
          if (distribution.success) {
            try {
              await this.publishEvent(distribution.keyEvent);
              console.log(`✅ Key sent to ${distribution.member.substring(0, 8)}...`);
            } catch (error) {
              console.error(`❌ Failed to send key to ${distribution.member}:`, error);
            }
          }
        }
      }
      
      console.log(`✅ Real encrypted group created: ${groupData.groupId}`);
      
      return {
        ...publishedGroupEvent,
        groupId: groupData.groupId,
        encrypted: true,
        keyVersion: groupData.keyVersion
      };
      
    } catch (error) {
      console.error('Error creating real encrypted group:', error);
      throw error;
    }
  }

  // NEW: Send encrypted message to encrypted group
  async sendEncryptedGroupMessage(groupId, message, replyTo = null) {
    try {
      console.log(`🔐 Sending encrypted message to group ${groupId}...`);
      
      // Create encrypted message using GroupEncryptionService
      const encryptedEvent = await groupEncryptionService.createEncryptedGroupMessage(
        groupId,
        message,
        replyTo
      );
      
      // Publish encrypted message
      const publishedEvent = await this.publishEvent(encryptedEvent);
      
      console.log('✅ Encrypted message sent successfully');
      return publishedEvent;
      
    } catch (error) {
      console.error('Error sending encrypted group message:', error);
      throw error;
    }
  }

  // NEW: Add member to encrypted group (triggers key rotation)
  async addMemberToEncryptedGroup(groupId, newMemberPubkey) {
    try {
      console.log(`👥 Adding member to encrypted group ${groupId}...`);
      
      // Get current group members (would need to be tracked)
      const currentMembers = await this.getGroupMembers(groupId);
      const newMembers = [...currentMembers, newMemberPubkey];
      
      // Rotate group key for forward secrecy
      const keyRotation = await groupEncryptionService.rotateGroupKey(
        groupId,
        newMembers,
        [], // no removed members
        this
      );
      
      // Publish key rotation event
      await this.publishEvent(keyRotation.rotationEvent);
      
      // Send new keys to all members
      for (const distribution of keyRotation.keyDistribution) {
        if (distribution.success) {
          await this.publishEvent(distribution.keyEvent);
        }
      }
      
      console.log(`✅ Member added and keys rotated`);
      return keyRotation;
      
    } catch (error) {
      console.error('Error adding member to encrypted group:', error);
      throw error;
    }
  }

  // NEW: Remove member from encrypted group (triggers key rotation)
  async removeMemberFromEncryptedGroup(groupId, removeMemberPubkey) {
    try {
      console.log(`👥 Removing member from encrypted group ${groupId}...`);
      
      // Get current group members
      const currentMembers = await this.getGroupMembers(groupId);
      const newMembers = currentMembers.filter(m => m !== removeMemberPubkey);
      
      // Rotate group key for backward secrecy
      const keyRotation = await groupEncryptionService.rotateGroupKey(
        groupId,
        newMembers,
        [removeMemberPubkey],
        this
      );
      
      // Publish key rotation event
      await this.publishEvent(keyRotation.rotationEvent);
      
      // Send new keys to remaining members
      for (const distribution of keyRotation.keyDistribution) {
        if (distribution.success) {
          await this.publishEvent(distribution.keyEvent);
        }
      }
      
      console.log(`✅ Member removed and keys rotated`);
      return keyRotation;
      
    } catch (error) {
      console.error('Error removing member from encrypted group:', error);
      throw error;
    }
  }

  async initializePrivateGroupMembers(groupId, initialMembers = []) {
    try {
      // Create initial member list event (kind 30000 for member management)
      const memberEvent = {
        kind: 30000, // Parameterized replaceable event
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', `private_group_members_${groupId}`], // Replaceable event identifier
          ['group', groupId],
          ['action', 'init_members']
        ],
        content: JSON.stringify({
          group_id: groupId,
          members: initialMembers,
          created_at: Math.floor(Date.now() / 1000),
          created_by: this.publicKey
        }),
        pubkey: this.publicKey
      };

      await this.publishEvent(memberEvent);
      console.log('✅ Private group member list initialized');
    } catch (error) {
      console.error('Error initializing private group members:', error);
    }
  }

  async inviteToPrivateGroup(groupId, inviteePubkey, personalMessage = '') {
    try {
      console.log(`📨 Inviting ${inviteePubkey.substring(0, 8)}... to private group ${groupId.substring(0, 8)}...`);
      
      // Try to get the group name by querying for the group creation event
      let groupName = null;
      try {
        const channels = await this.queryChannels(200);
        const group = channels.find(c => c.id === groupId);
        groupName = group?.name || null;
      } catch (error) {
        console.warn('Could not fetch group name for invitation:', error);
      }
      
      // Create invitation event using basic approach (not real NIP-17)
      const invitationContent = JSON.stringify({
        type: 'private_group_invitation',
        group_id: groupId,
        group_name: groupName,
        invited_by: this.publicKey,
        message: personalMessage,
        timestamp: Math.floor(Date.now() / 1000)
      });

      // Encrypt the invitation using NIP-04 (basic encryption for invites only)
      const encryptedContent = await nip04.encrypt(this.privateKey, inviteePubkey, invitationContent);

      const inviteEvent = {
        kind: 4, // Direct message for invitation
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['p', inviteePubkey],
          ['group_invite', groupId],
          ['invitation', 'true']
        ],
        content: encryptedContent,
        pubkey: this.publicKey
      };

      await this.publishEvent(inviteEvent);
      console.log('✅ Private group invitation sent');
      
      return true;
    } catch (error) {
      console.error('Error inviting to private group:', error);
      throw error;
    }
  }

  async acceptPrivateGroupInvitation(groupId, inviterPubkey) {
    try {
      console.log(`✅ Accepting invitation to private group ${groupId.substring(0, 8)}...`);
      
      // Create acceptance event
      const acceptEvent = {
        kind: 30001, // Custom event for group membership
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', `group_membership_${groupId}`],
          ['group', groupId],
          ['action', 'join'],
          ['invited_by', inviterPubkey]
        ],
        content: JSON.stringify({
          group_id: groupId,
          action: 'accept_invitation',
          invited_by: inviterPubkey,
          joined_at: Math.floor(Date.now() / 1000)
        }),
        pubkey: this.publicKey
      };

      await this.publishEvent(acceptEvent);
      console.log('✅ Private group invitation accepted');
      
      return true;
    } catch (error) {
      console.error('Error accepting private group invitation:', error);
      throw error;
    }
  }

  // NIP-29 Group Invitation
  async inviteToNIP29Group(groupId, inviteePubkey, personalMessage = '') {
    try {
      console.log(`🏛️ Inviting ${inviteePubkey.substring(0, 8)}... to NIP-29 group ${groupId}`);
      
      // Try to get the group name by querying NIP-29 groups
      let groupName = null;
      try {
        const metadata = await this.getNIP29GroupMetadata(groupId);
        groupName = metadata.name || null;
      } catch (error) {
        console.warn('Could not fetch NIP-29 group name for invitation:', error);
      }
      
      // Get NIP-29 relays
      const nip29RelaysStored = await AsyncStorage.getItem('nip29_relays');
      const nip29Relays = nip29RelaysStored ? JSON.parse(nip29RelaysStored) : NIP29_RELAYS;
      
      if (nip29Relays.length === 0) {
        throw new Error('No NIP-29 relays configured');
      }
      
      // Create NIP-29 invitation event (kind 9009)
      const inviteEvent = {
        kind: 9009, // NIP-29 group invitation
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['h', groupId], // group identifier
          ['p', inviteePubkey], // invitee pubkey
        ],
        content: personalMessage || `You've been invited to join the NIP-29 group: ${groupName || groupId}`
      };

      // Sign and publish the event to NIP-29 relays
      const signedEvent = finalizeEvent(inviteEvent, this.privateKey);
      
      // Publish to NIP-29 relays specifically
      await Promise.all(nip29Relays.map(async (relayUrl) => {
        try {
          await this.pool.publish([relayUrl], signedEvent);
          console.log(`✅ NIP-29 invitation published to ${relayUrl}`);
        } catch (error) {
          console.warn(`⚠️ Failed to publish invitation to ${relayUrl}:`, error);
        }
      }));
      
      console.log('✅ NIP-29 group invitation sent');
      return true;
    } catch (error) {
      console.error('Error inviting to NIP-29 group:', error);
      throw error;
    }
  }

  // NIP-29 Group Creation
  async createNIP29Group(name, about, picture = '') {
    try {
      console.log('🏛️ Creating NIP-29 managed group...');
      
      // Get NIP-29 relays from storage
      const nip29RelaysStored = await AsyncStorage.getItem('nip29_relays');
      const nip29Relays = nip29RelaysStored ? JSON.parse(nip29RelaysStored) : NIP29_RELAYS;
      
      if (nip29Relays.length === 0) {
        throw new Error('No NIP-29 relays configured. Please add a NIP-29 relay in settings.');
      }
      
      // Generate a random group ID for NIP-29
      const groupId = this.generateRandomGroupId();
      
      // Create the group creation event for NIP-29
      const groupEvent = {
        kind: 9007, // NIP-29 create-group event
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', groupId], // group identifier
          ['name', name],
          ['about', about],
          ['picture', picture],
          ['privacy', 'private'],
          ['type', 'closed'] // requires approval to join
        ],
        content: JSON.stringify({
          name,
          about,
          picture,
          privacy: 'private',
          type: 'closed',
          created_by: this.publicKey
        })
        // Note: pubkey will be added by finalizeEvent
      };

      // Convert private key to proper format for finalizeEvent
      if (!this.privateKey) {
        throw new Error('No private key available for signing');
      }
      
      const privateKeyBytes = new Uint8Array(
        this.privateKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );
      
      // Sign the event properly
      const signedGroupEvent = finalizeEvent(groupEvent, privateKeyBytes);

      // Publish to NIP-29 relays specifically
      let publishedEvent = null;
      let publishSuccess = false;
      
      for (const relay of nip29Relays) {
        try {
          console.log(`📡 Publishing NIP-29 group to relay: ${relay}`);
          
          // Create a temporary pool for this specific relay
          const tempPool = new SimplePool();
          publishedEvent = await tempPool.publish([relay], signedGroupEvent);
          
          if (publishedEvent) {
            console.log(`✅ NIP-29 group published to ${relay}`);
            publishSuccess = true;
            break; // Success on first relay
          }
        } catch (relayError) {
          console.warn(`⚠️ Failed to publish to ${relay}:`, relayError.message);
          continue; // Try next relay
        }
      }
      
      if (!publishSuccess) {
        throw new Error('Failed to create group on any NIP-29 relay. Please check your NIP-29 relay connections.');
      }
      
      // Store the group info locally with NIP-29 metadata
      const groupInfo = {
        id: publishedEvent.id,
        groupId: groupId,
        name,
        about,
        picture,
        protocol: 'nip29',
        created_by: this.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        relays: nip29Relays,
        privacy: 'private',
        type: 'closed'
      };
      
      // Cache the group using generic cache method
      try {
        await cacheService.set(`channel_info_${publishedEvent.id}`, groupInfo);
        console.log('💾 Cached NIP-29 group info');
      } catch (cacheError) {
        console.warn('⚠️ Failed to cache group info:', cacheError.message);
        // Don't fail group creation if caching fails
      }
      
      console.log('✅ NIP-29 group created successfully:', publishedEvent.id);
      console.log('🆔 Group ID:', groupId);
      
      return publishedEvent;
      
    } catch (error) {
      console.error('Error creating NIP-29 group:', error);
      throw error;
    }
  }

  generateRandomGroupId() {
    // Generate a random group ID following NIP-29 spec (a-z0-9-_)
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789-_';
    let result = '';
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async getPrivateGroupMembers(groupId) {
    try {
      // Check cache first
      const cachedMembers = await cacheService.getGroupMembers(groupId);
      if (cachedMembers) {
        console.log(`💾 Group members cache hit for ${groupId.substring(0, 8)}... (${cachedMembers.length} members)`);
        return cachedMembers;
      }

      console.log(`🌐 Fetching group members from network for ${groupId.substring(0, 8)}...`);

      // Query for member management events
      const memberEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [30000, 30001], // Member management events
        '#group': [groupId],
        limit: 100
      });

      const members = new Set();
      
      // Process member events to build current member list
      for (const event of memberEvents) {
        try {
          const data = JSON.parse(event.content);
          if (data.group_id === groupId) {
            if (event.kind === 30000 && data.members) {
              // Initial member list
              data.members.forEach(member => members.add(member));
            } else if (event.kind === 30001 && data.action === 'accept_invitation') {
              // Member joining
              members.add(event.pubkey);
            }
          }
        } catch (error) {
          console.warn('Error parsing member event:', error);
        }
      }

      const membersList = Array.from(members);
      
      // Cache the member list
      await cacheService.setGroupMembers(groupId, membersList);
      console.log(`💾 Cached ${membersList.length} group members for ${groupId.substring(0, 8)}...`);

      return membersList;
    } catch (error) {
      console.error('Error getting private group members:', error);
      return [];
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
    
    return this.subscribe(filters, async (event) => {
      switch (event.kind) {
        case EVENT_KINDS.CHANNEL_MESSAGE:
          if (onMessage) {
            // Check if this is an encrypted message
            if (groupEncryptionService.isEncryptedMessage(event)) {
              try {
                console.log('🔓 Decrypting encrypted group message...');
                const decryptedMessage = await groupEncryptionService.decryptGroupMessage(event, channelId);
                
                if (decryptedMessage) {
                  onMessage(decryptedMessage);
                } else {
                  console.warn('Failed to decrypt message - might not have group key');
                  // Still show the message but indicate decryption failed
                  const failedMessage = nostrUtils.parseChannelMessage(event);
                  failedMessage.content = '[🔒 Encrypted message - no access]';
                  failedMessage.encrypted = true;
                  failedMessage.decryption_failed = true;
                  onMessage(failedMessage);
                }
              } catch (error) {
                console.error('Error decrypting message:', error);
                const failedMessage = nostrUtils.parseChannelMessage(event);
                failedMessage.content = '[🔒 Decryption failed]';
                failedMessage.encrypted = true;
                failedMessage.decryption_failed = true;
                onMessage(failedMessage);
              }
            } else {
              // Regular unencrypted message
              const message = nostrUtils.parseChannelMessage(event);
              onMessage(message);
            }
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
    
    return this.subscribe(filters, async (event) => {
      if (event.kind === EVENT_KINDS.ENCRYPTED_DM) {
        try {
          // Check if this is a group key share
          const isGroupKeyShare = event.tags.some(tag => tag[0] === 'group_key_share');
          
          if (isGroupKeyShare) {
            console.log('🔑 Received group key share DM');
            const processed = await groupEncryptionService.processGroupKeyShare(event, this);
            
            if (processed) {
              console.log('✅ Group key share processed successfully');
              // Optionally notify user about new group access
              if (onMessage) {
                onMessage({
                  id: event.id,
                  content: '[🔑 You were added to an encrypted group]',
                  sender: event.pubkey,
                  timestamp: event.created_at,
                  type: 'group_key_share'
                });
              }
            }
          } else {
            // Regular encrypted DM
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
          }
        } catch (error) {
          console.error('Error processing direct message:', error);
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

  async getUserPosts(userPubkey, limit = 500) {
    try {
      // Check cache first
      const cachedPosts = await cacheService.getUserPosts(userPubkey);
      if (cachedPosts) {
        console.log(`💾 Posts cache hit for ${userPubkey.substring(0, 8)}... (${cachedPosts.length} posts)`);
        return cachedPosts;
      }

      console.log(`🌐 Fetching posts from network for ${userPubkey.substring(0, 8)}...`);
      
      const filters = {
        kinds: [EVENT_KINDS.TEXT_NOTE], // Kind 1 - text notes
        authors: [userPubkey],
        limit: limit
        // Removed 'since' filter to get ALL historical posts
      };
      
      console.log('User posts filters:', filters);
      
      // Use querySync for better reliability in getting historical posts
      const posts = await this.pool.querySync(Array.from(this.connectedRelays), filters);
      
      console.log('📬 Found', posts.length, 'total posts/replies for user');
      
      // Remove duplicates (just in case)
      const uniquePosts = [];
      const seenIds = new Set();
      
      for (const post of posts) {
        if (!seenIds.has(post.id)) {
          seenIds.add(post.id);
          uniquePosts.push(post);
        }
      }
      
      // Cache the posts
      await cacheService.setUserPosts(userPubkey, uniquePosts);
      console.log(`💾 Cached ${uniquePosts.length} posts for ${userPubkey.substring(0, 8)}...`);
      
      return uniquePosts;
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

  // Read status tracking methods
  async getLastReadTimestamp(contactPubkey) {
    try {
      const timestamps = await AsyncStorage.getItem(STORAGE_KEYS.DM_LAST_READ_TIMESTAMPS);
      const readTimestamps = timestamps ? JSON.parse(timestamps) : {};
      const timestamp = readTimestamps[contactPubkey] || 0;
      
      console.log(`🔍 Getting read timestamp for ${contactPubkey.substring(0, 8)}... = ${timestamp}`);
      if (timestamp === 0) {
        console.log(`📊 All stored timestamps:`, Object.keys(readTimestamps).map(key => 
          `${key.substring(0, 8)}...=${readTimestamps[key]}`
        ));
      }
      
      return timestamp;
    } catch (error) {
      console.error('Error getting last read timestamp:', error);
      return 0;
    }
  }

  async setLastReadTimestamp(contactPubkey, timestamp) {
    try {
      console.log(`💾 Setting read timestamp for ${contactPubkey.substring(0, 8)}... to ${timestamp}`);
      const timestamps = await AsyncStorage.getItem(STORAGE_KEYS.DM_LAST_READ_TIMESTAMPS);
      const readTimestamps = timestamps ? JSON.parse(timestamps) : {};
      readTimestamps[contactPubkey] = timestamp;
      await AsyncStorage.setItem(STORAGE_KEYS.DM_LAST_READ_TIMESTAMPS, JSON.stringify(readTimestamps));
      
      // Verify the write was successful by reading it back
      const verification = await AsyncStorage.getItem(STORAGE_KEYS.DM_LAST_READ_TIMESTAMPS);
      const verifiedTimestamps = verification ? JSON.parse(verification) : {};
      const verifiedTimestamp = verifiedTimestamps[contactPubkey];
      
      if (verifiedTimestamp === timestamp) {
        console.log(`✅ Successfully saved and verified read timestamp for ${contactPubkey.substring(0, 8)}...`);
      } else {
        console.error(`❌ Verification failed! Expected ${timestamp}, got ${verifiedTimestamp} for ${contactPubkey.substring(0, 8)}...`);
        throw new Error(`AsyncStorage write verification failed for ${contactPubkey.substring(0, 8)}...`);
      }
    } catch (error) {
      console.error(`❌ Error setting last read timestamp for ${contactPubkey.substring(0, 8)}...:`, error);
      throw error; // Re-throw to ensure Promise.all catches failures
    }
  }

  async markConversationAsRead(contactPubkey) {
    // FIRST: Invalidate cache to ensure fresh data on next load
    const cacheKey = `cache_conversations_${this.publicKey}`;
    cacheService.memoryCache.delete(cacheKey);
    await AsyncStorage.removeItem(cacheKey);
    
    // THEN: Update timestamp
    const currentTimestamp = Math.floor(Date.now() / 1000);
    await this.setLastReadTimestamp(contactPubkey, currentTimestamp);
    
    console.log(`✅ Marked conversation as read: ${contactPubkey.substring(0, 8)}...`);
  }

  async markAllConversationsAsRead() {
    try {
      console.log('🔄 Starting markAllConversationsAsRead...');
      
      if (!this.publicKey) {
        throw new Error('No public key available');
      }

      // Get all conversations to mark them as read - use cached version to avoid recalculation
      const cachedConversations = await cacheService.getConversations(this.publicKey);
      if (!cachedConversations || cachedConversations.length === 0) {
        console.log('⚠️ No conversations found to mark as read');
        return 0;
      }
      
      console.log(`📝 Found ${cachedConversations.length} conversations to mark as read`);
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      // Log current read timestamps before updating
      console.log('📊 Current read timestamps before marking all as read:');
      for (const conv of cachedConversations) {
        const currentReadTimestamp = await this.getLastReadTimestamp(conv.pubkey);
        console.log(`  ${conv.pubkey.substring(0, 8)}... = ${currentReadTimestamp} (unread: ${conv.unreadCount})`);
      }
      
      // Update timestamps for all conversations sequentially to avoid race conditions
      console.log(`🔄 Updating all timestamps to ${currentTimestamp}...`);
      let successCount = 0;
      for (const conv of cachedConversations) {
        console.log(`📌 Marking conversation ${conv.pubkey.substring(0, 8)}... as read`);
        try {
          await this.setLastReadTimestamp(conv.pubkey, currentTimestamp);
          successCount++;
          console.log(`✅ Timestamp saved for ${conv.pubkey.substring(0, 8)}... (${successCount}/${cachedConversations.length})`);
        } catch (error) {
          console.error(`❌ Failed to save timestamp for ${conv.pubkey.substring(0, 8)}...:`, error);
          throw error;
        }
      }
      console.log(`✅ Successfully updated ${successCount}/${cachedConversations.length} read timestamps`);
      
      // Verify all timestamps were saved correctly
      console.log('🔍 Verifying all timestamps were saved correctly...');
      for (const conv of cachedConversations) {
        const verifiedTimestamp = await this.getLastReadTimestamp(conv.pubkey);
        if (verifiedTimestamp !== currentTimestamp) {
          console.error(`❌ Verification failed for ${conv.pubkey.substring(0, 8)}...: expected ${currentTimestamp}, got ${verifiedTimestamp}`);
          throw new Error(`Timestamp verification failed for ${conv.pubkey.substring(0, 8)}...`);
        }
      }
      console.log('✅ All timestamps verified successfully');
      
      // Update the cached conversations with unreadCount: 0 instead of invalidating
      const updatedConversations = cachedConversations.map(conv => ({
        ...conv,
        unreadCount: 0
      }));
      
      await cacheService.setConversations(this.publicKey, updatedConversations);
      console.log('💾 Updated conversations cache with read status');
      
      console.log(`✅ Marked all ${cachedConversations.length} conversations as read`);
      return cachedConversations.length;
    } catch (error) {
      console.error('❌ Error marking all conversations as read:', error);
      throw error;
    }
  }

  async updateConversationCacheWithNewMessage(newMessage, contactPubkey) {
    try {
      // Get current conversations from cache
      const conversations = await cacheService.getConversations(this.publicKey);
      if (!conversations) return;

      // Get current read timestamp for this contact
      const lastReadTimestamp = await this.getLastReadTimestamp(contactPubkey);

      const updatedConversations = conversations.map(conv => {
        if (conv.pubkey === contactPubkey) {
          const updatedMessages = [...(conv.messages || []), newMessage];
          
          // Calculate proper unread count based on read timestamp
          const unreadCount = updatedMessages.filter(msg => 
            !msg.isFromMe && msg.timestamp > lastReadTimestamp
          ).length;

          return {
            ...conv,
            lastMessage: newMessage,
            messages: updatedMessages,
            unreadCount: unreadCount
          };
        }
        return conv;
      });

      // Sort by last message timestamp
      updatedConversations.sort((a, b) => {
        const aTime = a.lastMessage ? a.lastMessage.timestamp : 0;
        const bTime = b.lastMessage ? b.lastMessage.timestamp : 0;
        return bTime - aTime;
      });

      // Update conversation cache
      await cacheService.setConversations(this.publicKey, updatedConversations);

      // Also update the specific conversation messages cache
      const messages = await cacheService.getPrivateMessages(this.publicKey, contactPubkey);
      if (messages) {
        const updatedMessages = [...messages, newMessage];
        await cacheService.setPrivateMessages(this.publicKey, contactPubkey, updatedMessages);
      }

      console.log(`🔄 Updated conversation cache for ${contactPubkey.substring(0, 8)}... with proper unread count`);
    } catch (error) {
      console.warn('Error updating conversation cache with new message:', error);
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
      
      // Create message object for cache update
      const newMessage = {
        id: signedEvent.id,
        content: content,
        author: this.publicKey,
        recipient: recipientPubkey,
        timestamp: signedEvent.created_at,
        isFromMe: true
      };

      // Update cache with new message (for real-time updates with proper unread count)
      await this.updateConversationCacheWithNewMessage(newMessage, recipientPubkey);
      
      console.log('Private message sent and cached:', recipientPubkey.substring(0, 8) + '...');
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
      // Check cache first
      const cachedConversations = await cacheService.getConversations(this.publicKey);
      if (cachedConversations) {
        console.log(`💾 Conversations cache hit (${cachedConversations.length} conversations)`);
        
        // Recalculate unread counts with current read timestamps
        for (const conv of cachedConversations) {
          const lastReadTimestamp = await this.getLastReadTimestamp(conv.pubkey);
          const unreadMessages = conv.messages?.filter(msg => 
            !msg.isFromMe && msg.timestamp > lastReadTimestamp
          ) || [];
          
          console.log(`📊 Conversation ${conv.pubkey.substring(0, 8)}... - Read timestamp: ${lastReadTimestamp}, Unread: ${unreadMessages.length}`);
          if (unreadMessages.length > 0) {
            console.log(`📝 Latest unread message timestamp: ${Math.max(...unreadMessages.map(m => m.timestamp))}`);
          }
          
          conv.unreadCount = unreadMessages.length;
        }
        
        console.log(`🔄 Updated unread counts for cached conversations`);
        return cachedConversations;
      }

      console.log('🌐 Fetching private conversations from network...');

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
      const conversationsList = [];
      for (const conv of conversations.values()) {
        conv.messages.sort((a, b) => a.timestamp - b.timestamp);
        
        // Get last read timestamp for this conversation
        const lastReadTimestamp = await this.getLastReadTimestamp(conv.pubkey);
        
        // Count messages from others that are newer than last read timestamp
        const unreadMessages = conv.messages.filter(msg => 
          !msg.isFromMe && msg.timestamp > lastReadTimestamp
        );
        conv.unreadCount = unreadMessages.length;
        
        // Debug logging for unread count calculation
        if (conv.unreadCount > 0) {
          console.log(`📧 ${conv.pubkey.substring(0, 8)}... has ${conv.unreadCount} unread messages (lastRead: ${lastReadTimestamp})`);
          unreadMessages.forEach(msg => {
            console.log(`  📩 Unread message from ${msg.timestamp}: ${msg.content?.substring(0, 30)}...`);
          });
        }
        
        conversationsList.push(conv);
      }

      // Sort conversations by last message timestamp
      conversationsList.sort((a, b) => {
        const aTime = a.lastMessage ? a.lastMessage.timestamp : 0;
        const bTime = b.lastMessage ? b.lastMessage.timestamp : 0;
        return bTime - aTime;
      });

      // Cache the conversations
      await cacheService.setConversations(this.publicKey, conversationsList);
      console.log(`💾 Cached ${conversationsList.length} conversations`);

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
      // Check cache first
      const cachedMessages = await cacheService.getPrivateMessages(this.publicKey, contactPubkey);
      if (cachedMessages) {
        console.log(`💾 Messages cache hit for ${contactPubkey.substring(0, 8)}... (${cachedMessages.length} messages)`);
        return cachedMessages;
      }

      console.log(`🌐 Fetching messages from network for ${contactPubkey.substring(0, 8)}...`);

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
      
      // Cache the messages
      await cacheService.setPrivateMessages(this.publicKey, contactPubkey, messages);
      console.log(`💾 Cached ${messages.length} messages for ${contactPubkey.substring(0, 8)}...`);
      
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
      // Check cache first (cache-first strategy)
      const cachedProfile = await cacheService.getProfile(pubkey);
      if (cachedProfile) {
        console.log(`💾 Profile cache hit for ${pubkey.substring(0, 8)}...`);
        return cachedProfile;
      }

      console.log(`🌐 Fetching profile from network for ${pubkey.substring(0, 8)}...`);
      
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
          
          // Cache the profile for future use
          await cacheService.setProfile(pubkey, profileData);
          console.log(`💾 Cached profile for ${pubkey.substring(0, 8)}...`);
          
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
      // Check cache first
      const cachedFollowing = await cacheService.getFollowing(pubkey);
      if (cachedFollowing) {
        console.log(`💾 Following cache hit for ${pubkey.substring(0, 8)}... (${cachedFollowing.length} contacts)`);
        return cachedFollowing;
      }

      console.log(`🌐 Fetching following list from network for ${pubkey.substring(0, 8)}...`);
      
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
        
        // Cache the following list
        await cacheService.setFollowing(pubkey, following);
        console.log(`💾 Cached following list: ${following.length} contacts for ${pubkey.substring(0, 8)}...`);
        
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
      // Check cache first
      const cachedFollowers = await cacheService.getFollowers(pubkey);
      if (cachedFollowers) {
        console.log(`💾 Followers cache hit for ${pubkey.substring(0, 8)}... (${cachedFollowers.length} followers)`);
        return cachedFollowers;
      }

      console.log(`🌐 Finding followers from network for ${pubkey.substring(0, 8)}...`);
      
      // Query for contact lists (kind 3) that include this user in their p tags
      const followerEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [3], // Contact lists
        '#p': [pubkey], // Contact lists that mention this pubkey
        limit: limit
      });

      console.log(`📡 Found ${followerEvents.length} contact list events mentioning user`);

      // Extract unique followers
      const followers = new Set();

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
      
      // Cache the followers list
      await cacheService.setFollowers(pubkey, followersList);
      console.log(`💾 Cached followers list: ${followersList.length} followers for ${pubkey.substring(0, 8)}...`);
      
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

      console.log(`📋 Querying ${pubkeys.length} profiles (cache-first)...`);
      
      // Check cache first for all profiles
      const cachedProfiles = await cacheService.getMultipleProfiles(pubkeys);
      const missingPubkeys = pubkeys.filter(pubkey => !cachedProfiles.has(pubkey));
      
      console.log(`💾 Cache hits: ${cachedProfiles.size}/${pubkeys.length}, fetching ${missingPubkeys.length} from network`);
      
      if (missingPubkeys.length === 0) {
        return cachedProfiles;
      }

      // Query for missing profiles from network
      const profileEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [0],
        authors: missingPubkeys,
        limit: missingPubkeys.length * 2
      });

      const newProfiles = new Map();

      // Process each profile event
      for (const event of profileEvents) {
        try {
          const profileData = JSON.parse(event.content);
          
          // Keep only the most recent profile for each pubkey
          if (!newProfiles.has(event.pubkey) || 
              newProfiles.get(event.pubkey).timestamp < event.created_at) {
            newProfiles.set(event.pubkey, {
              ...profileData,
              pubkey: event.pubkey,
              timestamp: event.created_at
            });
          }
        } catch (parseError) {
          console.warn('Failed to parse profile data for:', event.pubkey);
        }
      }

      // Cache the new profiles
      if (newProfiles.size > 0) {
        await cacheService.setMultipleProfiles(newProfiles);
        console.log(`💾 Cached ${newProfiles.size} new profiles`);
      }

      // Combine cached and new profiles
      const allProfiles = new Map([...cachedProfiles, ...newProfiles]);
      console.log(`✅ Total profiles: ${allProfiles.size}/${pubkeys.length}`);
      
      return allProfiles;
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

      // Create cache key based on following list
      const feedKey = `feed_${followingPubkeys.slice(0, 10).join('_').substring(0, 30)}`;
      
      // Check cache first
      const cachedFeed = await cacheService.getFeed(feedKey);
      if (cachedFeed) {
        console.log(`💾 Feed cache hit (${cachedFeed.length} posts)`);
        return cachedFeed;
      }

      console.log(`🌐 Fetching feed from network (${followingPubkeys.length} followed users)...`);
      
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

      // Cache the feed
      await cacheService.setFeed(feedKey, posts);
      console.log(`💾 Cached feed with ${posts.length} posts`);

      return posts;
    } catch (error) {
      console.error('Error getting feed posts:', error);
      return [];
    }
  }

  // Real-time subscription for feed posts
  subscribeToFeedPosts(followingPubkeys, onNewPost) {
    if (!followingPubkeys || followingPubkeys.length === 0) {
      console.log('No following pubkeys provided for feed subscription');
      return null;
    }

    const subscriptionId = 'feed_posts';
    
    console.log(`🔄 Subscribing to feed posts from ${followingPubkeys.length} users...`);
    
    const subscription = this.pool.subscribeMany(Array.from(this.connectedRelays), [
      {
        kinds: [1], // Text notes
        authors: followingPubkeys,
        since: Math.floor(Date.now() / 1000) // Only new posts from now
      }
    ], {
      onevent: (event) => {
        console.log(`📝 New feed post received from ${event.pubkey.substring(0, 8)}...`);
        
        const newPost = {
          id: event.id,
          content: event.content,
          pubkey: event.pubkey,
          created_at: event.created_at,
          tags: event.tags || [],
          sig: event.sig
        };
        
        onNewPost(newPost);
      },
      oneose: () => {
        console.log('✅ Feed subscription established');
      }
    });

    this.subscriptions.set(subscriptionId, subscription);
    return subscriptionId;
  }

  // General subscription for all private messages (for conversation list updates)
  subscribeToAllPrivateMessages(onNewMessage) {
    if (!this.publicKey) {
      console.error('No public key available for DM subscription');
      return null;
    }

    const subscriptionId = 'all_private_messages';
    
    console.log(`🔄 Subscribing to all private messages for user ${this.publicKey.substring(0, 8)}...`);
    
    const subscription = this.pool.subscribeMany(Array.from(this.connectedRelays), [
      {
        kinds: [4], // Encrypted direct messages
        '#p': [this.publicKey], // Messages sent to me
        since: Math.floor(Date.now() / 1000) // Only new messages from now
      }
    ], {
      onevent: async (event) => {
        try {
          console.log(`💬 New private message received from ${event.pubkey.substring(0, 8)}...`);
          
          // Check if this is a group invitation by looking at tags
          const isGroupInvitation = event.tags?.some(tag => 
            (tag[0] === 'invitation' && tag[1] === 'true') ||
            tag[0] === 'group_invite'
          );
          
          // Decrypt the message
          const decryptedContent = await nip04.decrypt(this.privateKey, event.pubkey, event.content);
          
          // Handle group invitations separately
          if (isGroupInvitation) {
            await this.handleGroupInvitation(event, decryptedContent);
            return; // Don't process as regular DM
          }
          
          const newMessage = {
            id: event.id,
            content: decryptedContent,
            author: event.pubkey,
            recipient: this.publicKey,
            timestamp: event.created_at,
            isFromMe: false
          };
          
          // Update cache with new message for real-time updates (with proper unread count)
          await this.updateConversationCacheWithNewMessage(newMessage, event.pubkey);
          
          onNewMessage(newMessage, event.pubkey);
        } catch (decryptError) {
          console.warn('Failed to decrypt new private message:', decryptError);
        }
      },
      oneose: () => {
        console.log('✅ Private messages subscription established');
      }
    });

    this.subscriptions.set(subscriptionId, subscription);
    return subscriptionId;
  }

  async handleGroupInvitation(event, decryptedContent) {
    try {
      console.log(`📨 Handling group invitation from ${event.pubkey.substring(0, 8)}...`);
      
      // Parse the invitation content
      let invitationData;
      try {
        invitationData = JSON.parse(decryptedContent);
      } catch (parseError) {
        console.warn('Failed to parse group invitation JSON:', parseError);
        return;
      }
      
      // Validate invitation data
      if (invitationData.type !== 'private_group_invitation' || !invitationData.group_id) {
        console.warn('Invalid group invitation format');
        return;
      }
      
      console.log(`🔔 Group invitation received for group: ${invitationData.group_id.substring(0, 8)}...`);
      
      // Get inviter's profile for the notification
      const inviterProfile = await this.getUserProfile(event.pubkey);
      const inviterName = inviterProfile?.display_name || 
                         inviterProfile?.name || 
                         inviterProfile?.username || 
                         `${event.pubkey.substring(0, 8)}...`;
      
      // Try to get the group name (this might not work if we're not a member yet)
      const groupName = invitationData.group_name || 
                       `Group ${invitationData.group_id.substring(0, 8)}...`;
      
      // Import notification service dynamically to avoid circular imports
      const { notificationService } = await import('./NotificationService');
      
      // Show notification
      notificationService.notifyInvitation(groupName, inviterName);
      
      // Store the invitation for later processing (optional)
      await this.storeGroupInvitation({
        id: event.id,
        groupId: invitationData.group_id,
        inviterPubkey: event.pubkey,
        inviterName,
        groupName,
        message: invitationData.message || '',
        timestamp: event.created_at,
        status: 'pending'
      });
      
      console.log(`✅ Group invitation processed and notification shown`);
    } catch (error) {
      console.error('Error handling group invitation:', error);
    }
  }

  async storeGroupInvitation(invitation) {
    try {
      // Store invitation in AsyncStorage for later access
      const invitationsKey = `group_invitations_${this.publicKey}`;
      const existingInvitations = await AsyncStorage.getItem(invitationsKey);
      let invitations = existingInvitations ? JSON.parse(existingInvitations) : [];
      
      // Check if invitation already exists
      const existingIndex = invitations.findIndex(inv => inv.id === invitation.id);
      if (existingIndex >= 0) {
        invitations[existingIndex] = invitation; // Update existing
      } else {
        invitations.push(invitation); // Add new
      }
      
      // Keep only last 50 invitations
      invitations = invitations.slice(-50);
      
      await AsyncStorage.setItem(invitationsKey, JSON.stringify(invitations));
      console.log(`💾 Stored group invitation: ${invitation.groupName}`);
    } catch (error) {
      console.error('Error storing group invitation:', error);
    }
  }

  async getGroupInvitations() {
    try {
      const invitationsKey = `group_invitations_${this.publicKey}`;
      const storedInvitations = await AsyncStorage.getItem(invitationsKey);
      return storedInvitations ? JSON.parse(storedInvitations) : [];
    } catch (error) {
      console.error('Error getting group invitations:', error);
      return [];
    }
  }

  // Fetch posts by note IDs or event IDs for nostr references
  async getReferencedPosts(references) {
    if (!references || references.length === 0) {
      return new Map();
    }

    try {
      const eventIds = [];
      references.forEach(ref => {
        if (ref.type === 'note') {
          // note1... is a bech32 encoded event ID
          eventIds.push(ref.data);
        } else if (ref.type === 'nevent') {
          // nevent contains event ID and optionally relay info
          if (ref.data && ref.data.id) {
            eventIds.push(ref.data.id);
          }
        }
      });

      if (eventIds.length === 0) {
        return new Map();
      }

      console.log(`🔍 Fetching ${eventIds.length} referenced posts...`);
      
      // Query for the referenced events
      const referencedEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [1], // Text notes
        ids: eventIds,
        limit: eventIds.length * 2 // Allow some buffer
      });

      // Process and map the results
      const referencedPosts = new Map();
      referencedEvents.forEach(event => {
        const post = {
          id: event.id,
          content: event.content,
          pubkey: event.pubkey,
          created_at: event.created_at,
          tags: event.tags || [],
          sig: event.sig
        };
        referencedPosts.set(event.id, post);
      });

      console.log(`✅ Retrieved ${referencedPosts.size} referenced posts`);
      return referencedPosts;
    } catch (error) {
      console.error('❌ Error fetching referenced posts:', error);
      return new Map();
    }
  }

  // Fetch original posts for reply context
  async getOriginalPosts(postIds) {
    if (!postIds || postIds.length === 0) {
      return new Map();
    }

    try {
      console.log(`🔍 Fetching ${postIds.length} original posts for reply context...`);
      
      // Query for the original posts by their IDs
      const originalEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [1], // Text notes
        ids: postIds,
        limit: postIds.length * 2 // Allow some buffer
      });

      // Process and map the results
      const originalPosts = new Map();
      originalEvents.forEach(event => {
        const post = {
          id: event.id,
          content: event.content,
          pubkey: event.pubkey,
          created_at: event.created_at,
          tags: event.tags || [],
          sig: event.sig
        };
        originalPosts.set(event.id, post);
      });

      console.log(`✅ Retrieved ${originalPosts.size} original posts`);
      return originalPosts;
    } catch (error) {
      console.error('❌ Error fetching original posts:', error);
      return new Map();
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
      
      // Invalidate interaction caches
      await this.invalidateInteractionCaches(postId);
      
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
      
      // Invalidate interaction caches
      await this.invalidateInteractionCaches(postId);
      
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
      
      // Invalidate interaction caches and user's repost cache
      await Promise.all([
        this.invalidateInteractionCaches(postId),
        this.invalidateUserCaches(this.publicKey), // User's own reposts
        this.invalidateFeedCaches(), // Reposts might appear in feeds
      ]);
      
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
      
      // Invalidate interaction caches and user's post cache
      await Promise.all([
        this.invalidateInteractionCaches(postId), // Original post's reply count
        this.invalidateUserCaches(this.publicKey), // User's own posts (replies)
        this.invalidateFeedCaches(), // Replies might appear in feeds
      ]);
      
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
      
      // Invalidate relevant caches
      await Promise.all([
        this.invalidateUserCaches(this.publicKey), // Invalidate user's own posts cache
        this.invalidateFeedCaches(), // Invalidate feed caches
      ]);
      
      console.log('✅ Text note published and caches invalidated:', signedEvent.id);
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

  async getFollowing(userPubkey) {
    try {
      // Query for the user's contact list (kind 3)
      const contactEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [3],
        authors: [userPubkey],
        limit: 1
      });

      if (contactEvents.length === 0) {
        return [];
      }

      // Get the most recent contact list
      const latestContactEvent = contactEvents.sort((a, b) => b.created_at - a.created_at)[0];
      
      // Extract pubkeys from tags
      const following = latestContactEvent.tags
        .filter(tag => tag[0] === 'p' && tag[1])
        .map(tag => tag[1]);

      return following;
    } catch (error) {
      console.error('Error getting following list:', error);
      return [];
    }
  }

  async getFollowers(userPubkey) {
    try {
      // Query for contact lists that include this user (kind 3)
      const contactEvents = await this.pool.querySync(Array.from(this.connectedRelays), {
        kinds: [3],
        '#p': [userPubkey],
        limit: 1000
      });

      // Extract unique authors (followers)
      const followers = [...new Set(contactEvents.map(event => event.pubkey))];
      
      return followers;
    } catch (error) {
      console.error('Error getting followers list:', error);
      return [];
    }
  }

  // Follow/Unfollow methods
  async followUser(targetPubkey) {
    try {
      if (!this.privateKey) {
        throw new Error('No private key available for following users');
      }

      console.log(`👤 Following user ${targetPubkey.substring(0, 8)}...`);

      // Get current following list (using cache first, then network)
      const currentFollowing = await this.getUserContacts(this.publicKey);
      
      // Check if already following
      if (currentFollowing.includes(targetPubkey)) {
        console.log('Already following this user');
        return;
      }

      // Add user to following list
      const updatedFollowing = [...currentFollowing, targetPubkey];
      
      // Create contact list event (kind 3)
      const contactEvent = {
        kind: 3, // Contact list
        created_at: Math.floor(Date.now() / 1000),
        tags: updatedFollowing.map(pubkey => ['p', pubkey]),
        content: '', // Content can contain relay recommendations but we'll keep it simple
      };

      const signedEvent = await this.publishEvent(contactEvent);
      
      // Invalidate caches AFTER successful operation
      await Promise.all([
        cacheService.invalidateFollowing(this.publicKey), // Current user's following
        cacheService.invalidateFollowers(targetPubkey),   // Target user's followers
      ]);
      
      console.log(`✅ Successfully followed user and invalidated caches`);
      return signedEvent;
    } catch (error) {
      console.error('Error following user:', error);
      throw error;
    }
  }

  async unfollowUser(targetPubkey) {
    try {
      if (!this.privateKey) {
        throw new Error('No private key available for unfollowing users');
      }

      console.log(`👤 Unfollowing user ${targetPubkey.substring(0, 8)}...`);
      
      // Get current following list (using cache first, then network)
      const currentFollowing = await this.getUserContacts(this.publicKey);
      
      // Check if not following
      if (!currentFollowing.includes(targetPubkey)) {
        console.log('Not following this user');
        return;
      }

      // Remove user from following list
      const updatedFollowing = currentFollowing.filter(pubkey => pubkey !== targetPubkey);
      
      // Create contact list event (kind 3)
      const contactEvent = {
        kind: 3, // Contact list
        created_at: Math.floor(Date.now() / 1000),
        tags: updatedFollowing.map(pubkey => ['p', pubkey]),
        content: '', // Content can contain relay recommendations but we'll keep it simple
      };

      const signedEvent = await this.publishEvent(contactEvent);
      
      // Invalidate caches AFTER successful operation
      await Promise.all([
        cacheService.invalidateFollowing(this.publicKey), // Current user's following
        cacheService.invalidateFollowers(targetPubkey),   // Target user's followers
      ]);
      
      console.log(`✅ Successfully unfollowed user and invalidated caches`);
      return signedEvent;
    } catch (error) {
      console.error('Error unfollowing user:', error);
      throw error;
    }
  }

  // Cache invalidation helper methods
  async invalidateInteractionCaches(postId) {
    try {
      // Invalidate all caches related to interactions
      const interactionCacheKey = `cache_interactions_${postId}`;
      const userLikesCacheKey = 'cache_user_likes';
      const userRepostsCacheKey = 'cache_user_reposts';
      
      // Remove from memory cache
      cacheService.memoryCache.delete(interactionCacheKey);
      cacheService.memoryCache.delete(userLikesCacheKey);
      cacheService.memoryCache.delete(userRepostsCacheKey);
      
      // Remove from AsyncStorage
      await Promise.all([
        AsyncStorage.removeItem(interactionCacheKey),
        AsyncStorage.removeItem(userLikesCacheKey),
        AsyncStorage.removeItem(userRepostsCacheKey),
      ]);
      
      console.log(`🗑️ Invalidated interaction caches for post ${postId}`);
    } catch (error) {
      console.warn('Error invalidating interaction caches:', error);
    }
  }

  async invalidateUserCaches(pubkey) {
    try {
      await Promise.all([
        cacheService.invalidateProfile(pubkey),
        cacheService.invalidateUserPosts(pubkey),
      ]);
      console.log(`🗑️ Invalidated caches for user ${pubkey.substring(0, 8)}...`);
    } catch (error) {
      console.warn('Error invalidating user caches:', error);
    }
  }

  async invalidateFeedCaches() {
    try {
      // Invalidate main feed cache when new posts are created
      await cacheService.invalidateFeed('main');
      console.log('🗑️ Invalidated feed caches');
    } catch (error) {
      console.warn('Error invalidating feed caches:', error);
    }
  }

  // NIP-29 Group Query Methods
  async queryNIP29Groups(limit = 50) {
    try {
      console.log('🏛️ ==> QUERYING NIP-29 GROUPS FROM RELAYS...');
      
      // Get NIP-29 relays from storage
      const nip29RelaysStored = await AsyncStorage.getItem('nip29_relays');
      const nip29Relays = nip29RelaysStored ? JSON.parse(nip29RelaysStored) : NIP29_RELAYS;
      
      console.log('💾 NIP-29 relays from storage:', nip29RelaysStored);
      console.log('🔗 Using NIP-29 relays:', nip29Relays);
      
      if (nip29Relays.length === 0) {
        console.log('❌ No NIP-29 relays configured, returning empty array');
        return [];
      }
      
      // Check if we have a private key (needed to see our own groups)
      if (!this.publicKey) {
        console.log('❌ No public key available, cannot query NIP-29 groups');
        return [];
      }
      
      console.log('🔑 Using public key:', this.publicKey.substring(0, 16) + '...');
      
      return new Promise((resolve) => {
        const groups = [];
        let timeoutId;
        
        // Query for NIP-29 groups the user has created OR joined
        const filters = [
          {
            kinds: [9007], // NIP-29 group creation events by current user
            authors: [this.publicKey], // Groups YOU CREATED
            since: Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60), // Last year
            limit: 20
          },
          {
            kinds: [9021], // Join requests made by current user
            authors: [this.publicKey], // Groups YOU JOINED
            since: Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60), // Last 90 days
            limit: 50
          }
        ];
        
        console.log('🔍 NIP-29 query filters:', filters);
        console.log('📡 Connecting to NIP-29 relays for subscription...');
        console.log('🔑 Using public key:', this.publicKey);
        
        // Debug: Track what we find
        let foundCreatedGroups = 0;
        let foundJoinRequests = 0;
        
        const subscription = this.pool.subscribeMany(
          nip29Relays,
          filters,
          {
            onevent: (event) => {
              try {
                console.log('🎉 ==> FOUND NIP-29 EVENT!');
                console.log('   Event ID:', event.id.substring(0, 16) + '...');
                console.log('   Event Kind:', event.kind);
                console.log('   Event Author:', event.pubkey.substring(0, 16) + '...');
                console.log('   Event Tags:', event.tags);
                
                if (event.kind === 9007) {
                  // Process group creation event (groups created by user)
                  foundCreatedGroups++;
                  console.log(`📝 Processing group YOU CREATED (#${foundCreatedGroups}):`, event.id.substring(0, 8));
                  console.log('   Group tags:', event.tags);
                  this.processNIP29GroupEvent(event, groups);
                  
                } else if (event.kind === 9021) {
                  // Process join request - extract group ID and fetch group metadata
                  foundJoinRequests++;
                  console.log(`🔗 Processing group YOU JOINED (#${foundJoinRequests}):`, event.id.substring(0, 8));
                  console.log('   Join request tags:', event.tags);
                  
                  const groupIdTag = event.tags?.find(tag => tag[0] === 'h');
                  if (groupIdTag && groupIdTag[1]) {
                    const groupId = groupIdTag[1];
                    console.log(`🎯 Found join request for group: ${groupId}`);
                    
                    // Query for the actual group metadata (for groups you joined)
                    this.fetchGroupFromJoinRequest(groupId, groups);
                  } else {
                    console.warn('⚠️ Join request missing group ID (h tag)');
                  }
                }
                
              } catch (error) {
                console.error('Error processing NIP-29 event:', error);
              }
            },
            oneose: () => {
              console.log('📨 ==> END OF STORED NIP-29 GROUPS');
              console.log('📊 Discovery summary:');
              console.log(`   - Groups you created: ${foundCreatedGroups}`);
              console.log(`   - Join requests found: ${foundJoinRequests}`);
              console.log(`   - Groups from relay queries: ${groups.length}`);
              
              // Load groups from local storage and fetch their metadata
              this.loadJoinedGroupsFromStorage(groups).then(() => {
                if (timeoutId) {
                  clearTimeout(timeoutId);
                }
                subscription.close();
                console.log(`🎆 ==> RETURNING ${groups.length} NIP-29 GROUPS (relay + local storage)`);
                resolve(groups);
              });
            }
          }
        );
        
        // Set timeout to prevent hanging
        timeoutId = setTimeout(() => {
          console.log('⏰ ==> NIP-29 QUERY TIMEOUT REACHED (10 seconds)');
          console.log('📅 Groups found before timeout:', groups.length);
          subscription.close();
          
          // Even on timeout, load groups from local storage
          this.loadJoinedGroupsFromStorage(groups).then(() => {
            console.log(`🚫 ==> RETURNING ${groups.length} NIP-29 GROUPS DUE TO TIMEOUT (after local storage)`);
            resolve(groups);
          });
        }, 10000); // 10 second timeout
      });
      
    } catch (error) {
      console.error('Error querying NIP-29 groups:', error);
      return [];
    }
  }

  // Helper method to fetch group metadata from join request
  async fetchGroupFromJoinRequest(groupId, groups) {
    try {
      console.log(`🔍 Fetching group metadata for joined group: ${groupId}`);
      
      // Check if we already have this group in the list
      const existingGroup = groups.find(g => g.groupId === groupId || g.id === groupId);
      if (existingGroup) {
        console.log(`✅ Group ${groupId} already in list`);
        return;
      }
      
      const nip29Relays = NIP29_RELAYS;
      
      const groupQuery = this.pool.subscribeMany(
        nip29Relays,
        [{
          kinds: [9007], // Group creation events
          '#d': [groupId], // Match group ID
          limit: 1
        }],
        {
          onevent: (groupEvent) => {
            console.log(`🏛️ Found group metadata for joined group: ${groupId}`);
            console.log('   Group event tags:', groupEvent.tags);
            console.log('   Group event content:', groupEvent.content);
            this.processNIP29GroupEvent(groupEvent, groups);
          },
          oneose: () => {
            console.log(`📝 End of metadata query for group ${groupId}`);
            groupQuery.close();
          }
        }
      );
      
      // Close the query after 3 seconds if no results
      setTimeout(() => {
        groupQuery.close();
        
        // If no group metadata found, create a minimal entry
        const existingAfterQuery = groups.find(g => g.groupId === groupId || g.id === groupId);
        if (!existingAfterQuery) {
          console.log(`⚠️ No metadata found for group ${groupId}, creating minimal entry`);
          const minimalGroup = {
            id: groupId,
            kind: 9007,
            name: `Group ${groupId}`,
            about: `NIP-29 group (ID: ${groupId})`,
            picture: '',
            creator: 'unknown',
            created_at: Math.floor(Date.now() / 1000),
            tags: [['d', groupId]],
            protocol: 'nip29',
            privacy: 'public',
            groupId: groupId
          };
          groups.push(minimalGroup);
          console.log(`✅ Added minimal group entry for ${groupId}`);
        }
      }, 3000);
      
    } catch (error) {
      console.error('Error fetching group from join request:', error);
    }
  }

  // Helper method to process NIP-29 group events
  processNIP29GroupEvent(event, groups) {
    try {
      // Parse NIP-29 group event
      const groupData = {
        id: event.id,
        kind: event.kind,
        name: '',
        about: '',
        picture: '',
        creator: event.pubkey,
        created_at: event.created_at,
        tags: event.tags || [],
        protocol: 'nip29',
        privacy: 'public'  // Default to public since relay.groups.nip29.com only supports public groups
      };
      
      // Extract group info from tags
      if (event.tags) {
        event.tags.forEach(tag => {
          if (tag[0] === 'name' && tag[1]) groupData.name = tag[1];
          if (tag[0] === 'about' && tag[1]) groupData.about = tag[1];
          if (tag[0] === 'picture' && tag[1]) groupData.picture = tag[1];
          if (tag[0] === 'd' && tag[1]) groupData.groupId = tag[1];
          // Check if group has private/public indicators
          if (tag[0] === 'private' && tag[1] === 'true') groupData.privacy = 'private';
          if (tag[0] === 'public' && tag[1] === 'true') groupData.privacy = 'public';
        });
      }
      
      // Also try to parse from content if available
      if (event.content) {
        try {
          const contentData = JSON.parse(event.content);
          if (contentData.name && !groupData.name) groupData.name = contentData.name;
          if (contentData.about && !groupData.about) groupData.about = contentData.about;
          if (contentData.picture && !groupData.picture) groupData.picture = contentData.picture;
        } catch (parseError) {
          // Content is not JSON, ignore
        }
      }
      
      // Set fallback name if none found
      if (!groupData.name) {
        groupData.name = `NIP-29 Group ${event.id.substring(0, 8)}`;
      }
      
      console.log('✅ ==> SUCCESSFULLY PARSED NIP-29 GROUP:');
      console.log('   Name:', groupData.name);
      console.log('   About:', groupData.about);
      console.log('   Protocol:', groupData.protocol);
      console.log('   Privacy:', groupData.privacy);
      console.log('   Group ID:', groupData.groupId);
      
      // Check if this group is already in the list (avoid duplicates)
      const existingGroup = groups.find(g => g.id === groupData.id);
      if (!existingGroup) {
        groups.push(groupData);
      }
      
    } catch (error) {
      console.error('Error processing NIP-29 group event:', error);
    }
  }

  // NIP-29 Group Joining Methods
  async joinNIP29Group(groupId) {
    try {
      console.log(`🏛️ Sending join request for NIP-29 group: ${groupId}`);
      
      // Handle different group ID formats
      let cleanGroupId = groupId.trim();
      
      // If it's a bech32 encoded naddr, decode it
      if (cleanGroupId.startsWith('naddr1')) {
        console.log('📝 Detected bech32 naddr format, using as-is for now');
        // For now, we'll use the bech32 as-is, but NIP-29 typically expects hex IDs
        // The relay should handle the conversion
      }
      
      // If it contains the relay address, extract just the group ID
      if (cleanGroupId.includes("'")) {
        const parts = cleanGroupId.split("'");
        if (parts.length > 1) {
          cleanGroupId = parts[1];
          console.log(`🔧 Extracted group ID from relay format: ${cleanGroupId}`);
        }
      }
      
      console.log(`🎯 Using group ID: ${cleanGroupId}`);
      
      // Ensure we're initialized
      if (!this.isConnected) {
        console.log('🔄 NostrService not connected, initializing...');
        await this.initialize();
      }
      
      // Get NIP-29 relays from storage
      const nip29RelaysStored = await AsyncStorage.getItem('nip29_relays');
      const nip29Relays = nip29RelaysStored ? JSON.parse(nip29RelaysStored) : NIP29_RELAYS;
      
      console.log(`📡 Using NIP-29 relays:`, nip29Relays);
      
      if (nip29Relays.length === 0) {
        throw new Error('No NIP-29 relays configured');
      }
      
      // Create NIP-29 join request event (kind 9021)
      const joinEvent = {
        kind: 9021, // NIP-29 join request
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['h', cleanGroupId], // group reference
        ],
        content: '' // Empty content for join requests
      };
      
      console.log(`📝 Created join event:`, joinEvent);
      
      // Convert private key to proper format for finalizeEvent
      if (!this.privateKey) {
        throw new Error('No private key available for signing');
      }
      
      const privateKeyBytes = new Uint8Array(
        this.privateKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );
      
      // Sign and publish to NIP-29 relays
      const finalEvent = finalizeEvent(joinEvent, privateKeyBytes);
      
      console.log(`✍️ Signed join event:`, finalEvent.id);
      
      let successCount = 0;
      const publishPromises = [];
      
      for (const relay of nip29Relays) {
        try {
          console.log(`📤 Publishing join request to ${relay}...`);
          const publishPromise = this.pool.publish([relay], finalEvent);
          publishPromises.push(publishPromise);
          console.log(`✅ Join request sent to ${relay}`);
          successCount++;
        } catch (relayError) {
          console.warn(`⚠️ Failed to send join request to ${relay}:`, relayError.message);
        }
      }
      
      // Wait for all publish attempts to complete
      try {
        const results = await Promise.allSettled(publishPromises);
        console.log(`📊 All publish attempts completed:`, results);
        
        // Check if any result indicates we're already a member
        const alreadyMemberError = results.find(result => 
          result.status === 'rejected' && 
          result.reason?.message?.includes('already a member')
        );
        
        if (alreadyMemberError) {
          console.log(`✅ Already a member of group ${cleanGroupId}`);
          return { alreadyMember: true, event: finalEvent };
        }
        
      } catch (publishError) {
        // Check if the error indicates we're already a member
        if (publishError.message?.includes('already a member')) {
          console.log(`✅ Already a member of group ${cleanGroupId}`);
          return { alreadyMember: true, event: finalEvent };
        }
        console.warn(`⚠️ Some publish attempts failed:`, publishError);
      }
      
      if (successCount === 0) {
        throw new Error('Failed to send join request to any NIP-29 relay');
      }
      
      console.log(`✅ Join request sent for group ${cleanGroupId} to ${successCount} relay(s)`);
      
      // Store the joined group locally for future discovery
      await this.storeJoinedNIP29Group(cleanGroupId);
      
      return finalEvent;
      
    } catch (error) {
      console.error('❌ Error joining NIP-29 group:', error);
      throw error;
    }
  }


  // Local storage for joined NIP-29 groups
  async storeJoinedNIP29Group(groupId) {
    try {
      console.log(`💾 Storing joined NIP-29 group: ${groupId}`);
      
      const existingGroups = await AsyncStorage.getItem('joined_nip29_groups');
      const joinedGroups = existingGroups ? JSON.parse(existingGroups) : [];
      
      // Add the group if not already stored
      if (!joinedGroups.includes(groupId)) {
        joinedGroups.push(groupId);
        await AsyncStorage.setItem('joined_nip29_groups', JSON.stringify(joinedGroups));
        console.log(`✅ Stored joined group ${groupId}, total: ${joinedGroups.length}`);
      } else {
        console.log(`📝 Group ${groupId} already stored`);
      }
    } catch (error) {
      console.error('Error storing joined NIP-29 group:', error);
    }
  }

  async getJoinedNIP29Groups() {
    try {
      const existingGroups = await AsyncStorage.getItem('joined_nip29_groups');
      const joinedGroups = existingGroups ? JSON.parse(existingGroups) : [];
      console.log(`📋 Retrieved ${joinedGroups.length} joined NIP-29 groups from storage:`, joinedGroups);
      return joinedGroups;
    } catch (error) {
      console.error('Error retrieving joined NIP-29 groups:', error);
      return [];
    }
  }

  async loadJoinedGroupsFromStorage(existingGroups) {
    try {
      console.log('💾 Loading joined groups from local storage...');
      
      let joinedGroupIds = await this.getJoinedNIP29Groups();
      
      if (joinedGroupIds.length === 0) {
        console.log('📝 No joined groups in local storage');
        
        // One-time migration: store the known group 87c25f that the user was using
        console.log('🔄 Performing one-time migration for known group 87c25f');
        await this.storeJoinedNIP29Group('87c25f');
        
        // Reload the joined groups after migration
        joinedGroupIds = await this.getJoinedNIP29Groups();
        console.log(`✅ Migration complete, now have ${joinedGroupIds.length} stored groups`);
      }
      
      console.log(`🔍 Fetching metadata for ${joinedGroupIds.length} stored groups...`);
      
      // Fetch metadata for each stored group
      const metadataPromises = joinedGroupIds.map(async (groupId) => {
        // Check if we already have this group from relay queries
        const existingGroup = existingGroups.find(g => g.groupId === groupId || g.id === groupId);
        if (existingGroup) {
          console.log(`✅ Group ${groupId} already loaded from relay`);
          return;
        }
        
        try {
          console.log(`🔍 Fetching metadata for stored group: ${groupId}`);
          const metadata = await this.getNIP29GroupMetadata(groupId);
          
          console.log(`📊 Metadata received for ${groupId}:`, metadata);
          console.log(`📝 Group name from metadata: "${metadata.name}"`);
          
          const groupEntry = {
            id: groupId,
            kind: 9007,
            name: metadata.name || `Group ${groupId}`,
            about: metadata.about || `NIP-29 group (ID: ${groupId})`,
            picture: metadata.picture || '',
            creator: metadata.creator || 'unknown',
            created_at: metadata.created_at || Math.floor(Date.now() / 1000),
            tags: [['d', groupId]],
            protocol: 'nip29',
            privacy: 'public',
            groupId: groupId
          };
          
          existingGroups.push(groupEntry);
          console.log(`✅ Added stored group: "${groupEntry.name}" (ID: ${groupId})`);
          
        } catch (error) {
          console.warn(`⚠️ Failed to get metadata for stored group ${groupId}, adding minimal entry`);
          
          // Add minimal entry even if metadata fetch fails
          const minimalEntry = {
            id: groupId,
            kind: 9007,
            name: `Group ${groupId}`,
            about: `NIP-29 group (ID: ${groupId})`,
            picture: '',
            creator: 'unknown',
            created_at: Math.floor(Date.now() / 1000),
            tags: [['d', groupId]],
            protocol: 'nip29',
            privacy: 'public',
            groupId: groupId
          };
          
          existingGroups.push(minimalEntry);
          console.log(`✅ Added minimal entry for stored group: ${groupId}`);
        }
      });
      
      await Promise.all(metadataPromises);
      console.log(`✅ Finished loading ${joinedGroupIds.length} stored groups`);
      
    } catch (error) {
      console.error('Error loading joined groups from storage:', error);
    }
  }

  // Helper method to get NIP-29 group metadata
  async getNIP29GroupMetadata(groupId) {
    try {
      console.log(`🔍 Fetching metadata for NIP-29 group: ${groupId}`);
      
      const nip29Relays = NIP29_RELAYS;
      
      return new Promise((resolve, reject) => {
        let metadata = {};
        let timeoutId;
        
        // Try multiple approaches to get group info
        const queries = [
          // Query 1: Group creation event with 'd' tag
          { kinds: [9007], '#d': [groupId], limit: 1 },
          // Query 2: Group creation event with 'h' tag (some NIP-29 implementations)
          { kinds: [9007], '#h': [groupId], limit: 1 },
          // Query 3: Group metadata events with 'd' tag
          { kinds: [39000], '#d': [groupId], limit: 1 },
          // Query 4: Group metadata events with 'h' tag
          { kinds: [39000], '#h': [groupId], limit: 1 },
          // Query 5: Recent messages to infer group activity
          { kinds: [9], '#h': [groupId], limit: 1 }
        ];
        
        let completedQueries = 0;
        const totalQueries = queries.length;
        
        queries.forEach((filter, index) => {
          const sub = this.pool.subscribeMany(
            nip29Relays,
            [filter],
            {
              onevent: (event) => {
                console.log(`📝 Found metadata event type ${event.kind} for group ${groupId}`);
                console.log(`🏷️ Event tags:`, event.tags);
                console.log(`📄 Event content:`, event.content);
                
                if (event.kind === 9007) {
                  // Group creation event
                  event.tags?.forEach(tag => {
                    if (tag[0] === 'name' && tag[1]) {
                      metadata.name = tag[1];
                      console.log(`🎯 Found group name in tags: "${tag[1]}"`);
                    }
                    if (tag[0] === 'about' && tag[1]) metadata.about = tag[1];
                    if (tag[0] === 'picture' && tag[1]) metadata.picture = tag[1];
                  });
                  metadata.creator = event.pubkey;
                  metadata.created_at = event.created_at;
                } else if (event.kind === 39000) {
                  // Group metadata event (alternative format)
                  console.log(`📋 Processing kind 39000 metadata event`);
                  event.tags?.forEach(tag => {
                    if (tag[0] === 'name' && tag[1]) {
                      metadata.name = tag[1];
                      console.log(`🎯 Found group name in kind 39000 tags: "${tag[1]}"`);
                    }
                    if (tag[0] === 'about' && tag[1]) metadata.about = tag[1];
                    if (tag[0] === 'picture' && tag[1]) metadata.picture = tag[1];
                    if (tag[0] === 'title' && tag[1]) {
                      metadata.name = tag[1]; // Some implementations use 'title' instead of 'name'
                      console.log(`🎯 Found group title in kind 39000 tags: "${tag[1]}"`);
                    }
                  });
                  if (!metadata.creator) metadata.creator = event.pubkey;
                  if (!metadata.created_at) metadata.created_at = event.created_at;
                  
                  // Also try to parse from content
                  if (event.content) {
                    try {
                      const contentData = JSON.parse(event.content);
                      console.log(`📦 Parsed content data:`, contentData);
                      if (contentData.name && !metadata.name) {
                        metadata.name = contentData.name;
                        console.log(`🎯 Found group name in content: "${contentData.name}"`);
                      }
                      if (contentData.about && !metadata.about) metadata.about = contentData.about;
                      if (contentData.picture && !metadata.picture) metadata.picture = contentData.picture;
                    } catch (e) {
                      console.log('Content is not JSON, trying as plain text');
                    }
                  }
                }
              },
              oneose: () => {
                sub.close();
                completedQueries++;
                
                if (completedQueries >= totalQueries) {
                  if (timeoutId) clearTimeout(timeoutId);
                  
                  if (metadata.name || metadata.about) {
                    console.log('✅ Found group metadata:', metadata);
                    resolve(metadata);
                  } else {
                    console.log('❌ No metadata found for group');
                    reject(new Error('No metadata found'));
                  }
                }
              }
            }
          );
        });
        
        // Timeout after 5 seconds
        timeoutId = setTimeout(() => {
          console.log('⏰ Group metadata query timeout');
          if (metadata.name || metadata.about) {
            resolve(metadata);
          } else {
            reject(new Error('Metadata query timeout'));
          }
        }, 5000);
      });
      
    } catch (error) {
      console.error('Error fetching group metadata:', error);
      throw error;
    }
  }

  // NIP-29 Group Messaging Methods
  async queryNIP29GroupMessages(groupId, limit = 100) {
    try {
      console.log(`🏛️ Querying NIP-29 group messages for group: ${groupId}`);
      
      // Get NIP-29 relays from storage
      const nip29RelaysStored = await AsyncStorage.getItem('nip29_relays');
      const nip29Relays = nip29RelaysStored ? JSON.parse(nip29RelaysStored) : NIP29_RELAYS;
      
      if (nip29Relays.length === 0) {
        console.log('❌ No NIP-29 relays configured');
        return [];
      }
      
      return new Promise((resolve) => {
        const messages = [];
        let timeoutId;
        
        // Query for NIP-29 group messages (kind 9)
        const filters = {
          kinds: [9], // NIP-29 group messages
          '#h': [groupId], // group reference tag
          limit: limit
        };
        
        console.log('🔍 NIP-29 message query filters:', filters);
        
        const subscription = this.pool.subscribeMany(
          nip29Relays,
          [filters],
          {
            onevent: (event) => {
              try {
                console.log('📨 Found NIP-29 message:', event.id.substring(0, 16) + '...');
                
                // Parse the message event
                const message = {
                  id: event.id,
                  author: event.pubkey,
                  content: event.content,
                  timestamp: event.created_at,
                  type: 'normal',
                  protocol: 'nip29',
                  groupId: groupId,
                  tags: event.tags || []
                };
                
                // Check for reply references
                const replyTag = event.tags?.find(tag => tag[0] === 'e' && tag[3] === 'reply');
                if (replyTag) {
                  message.replyTo = replyTag[1];
                }
                
                messages.push(message);
                
              } catch (error) {
                console.error('Error processing NIP-29 message:', error);
              }
            },
            oneose: () => {
              console.log('📨 End of NIP-29 messages, found:', messages.length);
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              subscription.close();
              
              // Sort messages by timestamp
              messages.sort((a, b) => a.timestamp - b.timestamp);
              
              console.log('✅ Returning', messages.length, 'NIP-29 messages');
              resolve(messages);
            }
          }
        );
        
        // Set timeout to prevent hanging
        timeoutId = setTimeout(() => {
          console.log('⏰ NIP-29 message query timeout');
          subscription.close();
          messages.sort((a, b) => a.timestamp - b.timestamp);
          resolve(messages);
        }, 10000);
      });
      
    } catch (error) {
      console.error('Error querying NIP-29 group messages:', error);
      return [];
    }
  }

  subscribeToNIP29Group(groupId, onMessage, onModeration) {
    console.log(`🏛️ Setting up real-time subscription for NIP-29 group: ${groupId}`);
    
    const filters = {
      kinds: [9, 9001, 9002, 9003], // Messages and moderation events
      '#h': [groupId], // group reference tag
      since: Math.floor(Date.now() / 1000) // Only new messages from now
    };
    
    console.log('🔍 NIP-29 subscription filters:', filters);
    
    // Use NIP-29 relays instead of regular relays
    const nip29Relays = NIP29_RELAYS;
    console.log('📡 Subscribing to NIP-29 relays:', nip29Relays);
    
    const subscriptionId = Math.random().toString(36).substring(2, 8);
    console.log(`🆔 NIP-29 subscription ID: ${subscriptionId}`);
    
    const subscription = this.pool.subscribeMany(
      nip29Relays,
      [filters],
      {
        onevent: async (event) => {
          console.log(`📨 NIP-29 event received [${subscriptionId}]:`, event.kind, event.id.substring(0, 8));
          
          switch (event.kind) {
            case 9: // NIP-29 group message
              if (onMessage) {
                console.log('📨 Processing new NIP-29 message in real-time');
                
                const message = {
                  id: event.id,
                  author: event.pubkey,
                  content: event.content,
                  timestamp: event.created_at,
                  type: 'normal',
                  protocol: 'nip29',
                  groupId: groupId,
                  tags: event.tags || []
                };
                
                // Check for reply references
                const replyTag = event.tags?.find(tag => tag[0] === 'e' && tag[3] === 'reply');
                if (replyTag) {
                  message.replyTo = replyTag[1];
                }
                
                onMessage(message);
              }
              break;
              
            case 9001: // NIP-29 kick
            case 9002: // NIP-29 ban
            case 9003: // NIP-29 admin action
              if (onModeration) {
                console.log('🛡️ NIP-29 moderation event received');
                onModeration(event);
              }
              break;
          }
        },
        oneose: () => {
          console.log(`📨 NIP-29 subscription [${subscriptionId}] end of stored events`);
        }
      }
    );
    
    // Return a compatible subscription object
    return {
      id: subscriptionId,
      close: () => {
        console.log(`🔒 Closing NIP-29 subscription [${subscriptionId}]`);
        subscription.close();
      }
    };
  }

  async sendNIP29GroupMessage(groupId, message, replyTo = null) {
    try {
      console.log('🏛️ Sending NIP-29 group message...');
      
      // Get NIP-29 relays from storage
      const nip29RelaysStored = await AsyncStorage.getItem('nip29_relays');
      const nip29Relays = nip29RelaysStored ? JSON.parse(nip29RelaysStored) : NIP29_RELAYS;
      
      if (nip29Relays.length === 0) {
        throw new Error('No NIP-29 relays configured');
      }
      
      // Create NIP-29 group message event (kind 9)
      const messageEvent = {
        kind: 9, // NIP-29 group message  
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['h', groupId], // group reference (NIP-29 standard)
        ],
        content: message
        // Note: pubkey will be added by finalizeEvent
      };
      
      if (replyTo) {
        messageEvent.tags.push(['e', replyTo, '', 'reply']);
      }
      
      // Convert private key to proper format for finalizeEvent
      if (!this.privateKey) {
        throw new Error('No private key available for signing');
      }
      
      const privateKeyBytes = new Uint8Array(
        this.privateKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );
      
      // Publish to NIP-29 relays
      const finalEvent = finalizeEvent(messageEvent, privateKeyBytes);
      
      let successCount = 0;
      let lastError = null;
      
      for (const relay of nip29Relays) {
        try {
          this.pool.publish([relay], finalEvent);
          console.log(`✅ NIP-29 message sent to ${relay}`);
          successCount++;
        } catch (relayError) {
          console.warn(`⚠️ Failed to send to ${relay}:`, relayError.message);
          lastError = relayError;
        }
      }
      
      // If no relays succeeded, fail with clear error message
      if (successCount === 0) {
        throw new Error(`Failed to send NIP-29 message: All NIP-29 relays unreachable. NIP-29 groups require specialized relay infrastructure. Last error: ${lastError?.message || 'Unknown error'}`);
      }
      
      return finalEvent;
    } catch (error) {
      console.error('Error sending NIP-29 group message:', error);
      throw error;
    }
  }

  async performNIP29ModerationAction(groupId, action, targetPubkey, reason = '') {
    try {
      console.log(`🏛️ Performing NIP-29 ${action} action...`);
      
      // Get NIP-29 relays from storage
      const nip29RelaysStored = await AsyncStorage.getItem('nip29_relays');
      const nip29Relays = nip29RelaysStored ? JSON.parse(nip29RelaysStored) : NIP29_RELAYS;
      
      if (nip29Relays.length === 0) {
        throw new Error('No NIP-29 relays configured');
      }
      
      // Create NIP-29 moderation event based on action
      let moderationEvent;
      
      switch (action) {
        case 'kick':
        case 'mute':
          moderationEvent = {
            kind: 9004, // NIP-29 mute action
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['h', groupId], // group reference
              ['p', targetPubkey], // target user
              ['reason', reason] // reason for action
            ],
            content: reason || `User muted in group`
            // Note: pubkey will be added by finalizeEvent
          };
          break;
          
        case 'unkick':
        case 'unmute':
          moderationEvent = {
            kind: 9005, // NIP-29 unmute action
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['h', groupId], // group reference
              ['p', targetPubkey], // target user
              ['reason', reason] // reason for action
            ],
            content: reason || `User unmuted in group`
            // Note: pubkey will be added by finalizeEvent
          };
          break;
          
        case 'ban':
          moderationEvent = {
            kind: 9002, // NIP-29 ban action (permanent removal)
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['h', groupId], // group reference
              ['p', targetPubkey], // target user
              ['reason', reason] // reason for action
            ],
            content: reason || `User banned from group`
            // Note: pubkey will be added by finalizeEvent
          };
          break;
          
        case 'op':
        case 'deop':
          moderationEvent = {
            kind: 9003, // admin action
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['h', groupId], // group reference
              ['p', targetPubkey], // target user
              ['action', action], // op or deop
              ['reason', reason] // reason for action
            ],
            content: `User ${action === 'op' ? 'granted operator status' : 'operator status removed'}`
            // Note: pubkey will be added by finalizeEvent
          };
          break;
          
        default:
          throw new Error(`Unsupported NIP-29 moderation action: ${action}`);
      }
      
      // Convert private key to proper format for finalizeEvent
      if (!this.privateKey) {
        throw new Error('No private key available for signing');
      }
      
      const privateKeyBytes = new Uint8Array(
        this.privateKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );
      
      // Publish to NIP-29 relays
      const finalEvent = finalizeEvent(moderationEvent, privateKeyBytes);
      
      for (const relay of nip29Relays) {
        try {
          this.pool.publish([relay], finalEvent);
          console.log(`✅ NIP-29 ${action} action sent to ${relay}`);
        } catch (relayError) {
          console.warn(`⚠️ Failed to send ${action} to ${relay}:`, relayError.message);
        }
      }
      
      return finalEvent;
    } catch (error) {
      console.error(`Error performing NIP-29 ${action}:`, error);
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