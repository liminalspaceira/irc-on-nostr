import { nip04 } from 'nostr-tools';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * GroupEncryptionService - Implements shared secret encryption for private groups
 * 
 * Architecture:
 * 1. Each group has a symmetric encryption key (AES-256)
 * 2. Key is distributed to members via encrypted DMs (NIP-04)
 * 3. All group messages are encrypted with the shared key
 * 4. Key rotation when members join/leave for forward/backward secrecy
 */

class GroupEncryptionService {
  constructor() {
    this.groupKeys = new Map(); // groupId -> encryption key
    this.keyVersions = new Map(); // groupId -> version number
  }

  /**
   * Generate a new symmetric encryption key for a group
   */
  generateGroupKey() {
    // Generate 256-bit key for AES encryption
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    
    // Convert to base64 for storage/transmission
    return btoa(String.fromCharCode(...key));
  }

  /**
   * Create a new encrypted group with shared key
   */
  async createEncryptedGroup(name, about, picture = '', initialMembers = []) {
    try {
      // Generate group encryption key
      const groupKey = this.generateGroupKey();
      const keyVersion = 1;
      const groupId = this.generateGroupId(name, Date.now());

      console.log('🔐 Creating encrypted group with shared key...');

      // Store key locally
      await this.storeGroupKey(groupId, groupKey, keyVersion);
      
      // Create group metadata (encrypted)
      const groupMetadata = {
        name,
        about,
        picture,
        type: 'encrypted_private',
        created_by: this.publicKey,
        key_version: keyVersion,
        member_count: initialMembers.length + 1, // +1 for creator
        created_at: Math.floor(Date.now() / 1000)
      };

      // Encrypt metadata with group key
      const encryptedMetadata = await this.encryptWithGroupKey(
        JSON.stringify(groupMetadata), 
        groupKey
      );

      // Create group creation event
      const groupEvent = {
        kind: 40, // Channel creation
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['name', name],
          ['about', 'Encrypted Private Group'], // Don't reveal real description
          ['encrypted', 'true'],
          ['encryption_method', 'shared_secret'],
          ['key_version', keyVersion.toString()],
          ['member_limit', '50'],
          ['d', groupId] // Deterministic ID for replaceable events
        ],
        content: encryptedMetadata // Encrypted group metadata
      };

      return {
        groupEvent,
        groupId,
        groupKey,
        keyVersion,
        initialMembers
      };

    } catch (error) {
      console.error('Error creating encrypted group:', error);
      throw error;
    }
  }

  /**
   * Distribute group key to members via encrypted DMs
   */
  async distributeGroupKey(groupId, groupKey, keyVersion, memberPubkeys, nostrService) {
    const results = [];

    for (const memberPubkey of memberPubkeys) {
      try {
        // Create key share payload
        const keyShare = {
          type: 'group_key_share',
          group_id: groupId,
          group_key: groupKey,
          key_version: keyVersion,
          timestamp: Math.floor(Date.now() / 1000),
          shared_by: nostrService.publicKey
        };

        // Encrypt key share with member's pubkey using NIP-04
        const encryptedKeyShare = await nip04.encrypt(
          nostrService.privateKey, 
          memberPubkey, 
          JSON.stringify(keyShare)
        );

        // Create key distribution DM
        const keyDM = {
          kind: 4, // Encrypted DM
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['p', memberPubkey],
            ['group_key_share', groupId],
            ['key_version', keyVersion.toString()]
          ],
          content: encryptedKeyShare
        };

        results.push({
          member: memberPubkey,
          keyEvent: keyDM,
          success: true
        });

      } catch (error) {
        console.error(`Failed to create key share for ${memberPubkey}:`, error);
        results.push({
          member: memberPubkey,
          error: error.message,
          success: false
        });
      }
    }

    return results;
  }

  /**
   * Encrypt message content with group key
   */
  async encryptWithGroupKey(content, groupKey) {
    try {
      // Convert base64 key to bytes
      const keyBytes = new Uint8Array(
        atob(groupKey).split('').map(char => char.charCodeAt(0))
      );

      // Generate random IV
      const iv = new Uint8Array(16);
      crypto.getRandomValues(iv);

      // Import key for WebCrypto
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM' },
        false,
        ['encrypt']
      );

      // Encrypt content
      const contentBytes = new TextEncoder().encode(content);
      const encryptedBytes = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        cryptoKey,
        contentBytes
      );

      // Combine IV + encrypted data
      const combined = new Uint8Array(iv.length + encryptedBytes.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encryptedBytes), iv.length);

      // Return base64 encoded
      return btoa(String.fromCharCode(...combined));

    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt message');
    }
  }

  /**
   * Decrypt message content with group key
   */
  async decryptWithGroupKey(encryptedContent, groupKey) {
    try {
      // Convert base64 to bytes
      const combinedBytes = new Uint8Array(
        atob(encryptedContent).split('').map(char => char.charCodeAt(0))
      );

      // Extract IV and encrypted data
      const iv = combinedBytes.slice(0, 16);
      const encryptedBytes = combinedBytes.slice(16);

      // Convert base64 key to bytes
      const keyBytes = new Uint8Array(
        atob(groupKey).split('').map(char => char.charCodeAt(0))
      );

      // Import key for WebCrypto
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      // Decrypt content
      const decryptedBytes = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        cryptoKey,
        encryptedBytes
      );

      // Convert back to string
      return new TextDecoder().decode(decryptedBytes);

    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt message');
    }
  }

  /**
   * Create encrypted group message
   */
  async createEncryptedGroupMessage(groupId, message, replyTo = null) {
    try {
      // Get group key
      const groupKey = await this.getGroupKey(groupId);
      if (!groupKey) {
        throw new Error('Group key not found - cannot encrypt message');
      }

      // Create message payload
      const messagePayload = {
        content: message,
        timestamp: Math.floor(Date.now() / 1000),
        type: 'group_message'
      };

      // Encrypt message with group key
      const encryptedContent = await this.encryptWithGroupKey(
        JSON.stringify(messagePayload),
        groupKey.key
      );

      // Create message event
      const tags = [
        ['e', groupId, '', 'root'],
        ['encrypted', 'true'],
        ['key_version', groupKey.version.toString()]
      ];

      if (replyTo) {
        tags.push(['e', replyTo, '', 'reply']);
      }

      return {
        kind: 42, // Channel message
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: encryptedContent
      };

    } catch (error) {
      console.error('Error creating encrypted message:', error);
      throw error;
    }
  }

  /**
   * Decrypt received group message
   */
  async decryptGroupMessage(event, groupId) {
    try {
      // Get group key
      const groupKey = await this.getGroupKey(groupId);
      if (!groupKey) {
        console.warn('Group key not found for decryption');
        return null;
      }

      // Check key version compatibility
      const messageKeyVersion = this.getKeyVersionFromTags(event.tags);
      if (messageKeyVersion && messageKeyVersion !== groupKey.version) {
        console.warn(`Key version mismatch: message=${messageKeyVersion}, local=${groupKey.version}`);
        // Could try to get older key version here
      }

      // Decrypt message content
      const decryptedContent = await this.decryptWithGroupKey(
        event.content,
        groupKey.key
      );

      // Parse decrypted payload
      const messagePayload = JSON.parse(decryptedContent);

      return {
        id: event.id,
        content: messagePayload.content,
        author: event.pubkey,
        channelId: groupId,
        timestamp: event.created_at,
        type: messagePayload.type,
        encrypted: true,
        tags: event.tags
      };

    } catch (error) {
      console.error('Error decrypting group message:', error);
      return {
        id: event.id,
        content: '[Failed to decrypt message]',
        author: event.pubkey,
        channelId: groupId,
        timestamp: event.created_at,
        encrypted: true,
        decryption_failed: true,
        tags: event.tags
      };
    }
  }

  /**
   * Handle receiving a group key share
   */
  async processGroupKeyShare(dmEvent, nostrService) {
    try {
      // Decrypt the key share DM
      const decryptedContent = await nip04.decrypt(
        nostrService.privateKey,
        dmEvent.pubkey,
        dmEvent.content
      );

      const keyShare = JSON.parse(decryptedContent);

      // Validate key share
      if (keyShare.type !== 'group_key_share') {
        return false;
      }

      // Store the group key
      await this.storeGroupKey(
        keyShare.group_id,
        keyShare.group_key,
        keyShare.key_version
      );

      console.log(`🔑 Received group key for ${keyShare.group_id} (v${keyShare.key_version})`);
      return true;

    } catch (error) {
      console.error('Error processing group key share:', error);
      return false;
    }
  }

  /**
   * Key rotation for member changes
   */
  async rotateGroupKey(groupId, newMembers, removedMembers, nostrService) {
    try {
      console.log(`🔄 Rotating key for group ${groupId}`);

      // Generate new key
      const newGroupKey = this.generateGroupKey();
      const currentVersion = await this.getGroupKeyVersion(groupId);
      const newVersion = currentVersion + 1;

      // Store new key locally
      await this.storeGroupKey(groupId, newGroupKey, newVersion);

      // Distribute new key to all remaining members
      const allCurrentMembers = [...newMembers]; // Get all current members
      const keyDistribution = await this.distributeGroupKey(
        groupId,
        newGroupKey,
        newVersion,
        allCurrentMembers,
        nostrService
      );

      // Create key rotation announcement (encrypted with new key)
      const rotationMessage = {
        type: 'key_rotation',
        new_version: newVersion,
        reason: removedMembers.length > 0 ? 'member_removed' : 'member_added',
        timestamp: Math.floor(Date.now() / 1000)
      };

      const encryptedAnnouncement = await this.encryptWithGroupKey(
        JSON.stringify(rotationMessage),
        newGroupKey
      );

      const rotationEvent = {
        kind: 42,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', groupId, '', 'root'],
          ['encrypted', 'true'],
          ['key_version', newVersion.toString()],
          ['key_rotation', 'true']
        ],
        content: encryptedAnnouncement
      };

      return {
        newKey: newGroupKey,
        newVersion: newVersion,
        keyDistribution: keyDistribution,
        rotationEvent: rotationEvent
      };

    } catch (error) {
      console.error('Error rotating group key:', error);
      throw error;
    }
  }

  // Utility methods
  generateGroupId(name, timestamp) {
    const content = `encrypted_group:${name.toLowerCase()}:${timestamp}`;
    // Simple hash for demo - use proper crypto hash in production
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash) + content.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  async storeGroupKey(groupId, key, version) {
    const keyData = { key, version, stored_at: Date.now() };
    await AsyncStorage.setItem(`group_key_${groupId}`, JSON.stringify(keyData));
    this.groupKeys.set(groupId, keyData);
  }

  async getGroupKey(groupId) {
    if (this.groupKeys.has(groupId)) {
      return this.groupKeys.get(groupId);
    }

    try {
      const stored = await AsyncStorage.getItem(`group_key_${groupId}`);
      if (stored) {
        const keyData = JSON.parse(stored);
        this.groupKeys.set(groupId, keyData);
        return keyData;
      }
    } catch (error) {
      console.error('Error loading group key:', error);
    }

    return null;
  }

  async getGroupKeyVersion(groupId) {
    const keyData = await this.getGroupKey(groupId);
    return keyData ? keyData.version : 0;
  }

  getKeyVersionFromTags(tags) {
    const versionTag = tags.find(tag => tag[0] === 'key_version');
    return versionTag ? parseInt(versionTag[1]) : null;
  }

  isEncryptedMessage(event) {
    return event.tags.some(tag => tag[0] === 'encrypted' && tag[1] === 'true');
  }

  // Clean up old keys
  async cleanupOldKeys(groupId, keepVersions = 2) {
    try {
      const currentVersion = await this.getGroupKeyVersion(groupId);
      
      for (let v = 1; v < currentVersion - keepVersions; v++) {
        await AsyncStorage.removeItem(`group_key_${groupId}_v${v}`);
      }
    } catch (error) {
      console.error('Error cleaning up old keys:', error);
    }
  }
}

export const groupEncryptionService = new GroupEncryptionService();
export default groupEncryptionService;