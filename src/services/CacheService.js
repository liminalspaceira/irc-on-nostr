import AsyncStorage from '@react-native-async-storage/async-storage';

// Cache configuration
const CACHE_CONFIG = {
  // Time-to-live (TTL) values in milliseconds
  TTL: {
    PROFILES: 24 * 60 * 60 * 1000,        // 24 hours
    POSTS: 6 * 60 * 60 * 1000,            // 6 hours  
    FEED: 30 * 60 * 1000,                 // 30 minutes
    FOLLOWING: 60 * 60 * 1000,            // 1 hour
    FOLLOWERS: 60 * 60 * 1000,            // 1 hour
    INTERACTIONS: 10 * 60 * 1000,         // 10 minutes
    PRIVATE_MESSAGES: 60 * 60 * 1000,     // 1 hour
    CONVERSATIONS: 30 * 60 * 1000,        // 30 minutes
    PRIVATE_GROUPS: 2 * 60 * 60 * 1000,   // 2 hours
    GROUP_MEMBERS: 60 * 60 * 1000,        // 1 hour
    METADATA: 7 * 24 * 60 * 60 * 1000,    // 7 days
  },
  
  // Cache size limits
  LIMITS: {
    MAX_PROFILES: 1000,
    MAX_POSTS: 500,
    MAX_FEED_ITEMS: 200,
    MAX_CONVERSATIONS: 100,
    MAX_MESSAGES_PER_CONVERSATION: 200,
  },
  
  // Cache keys
  KEYS: {
    PROFILES: 'cache_profiles',
    POSTS: 'cache_posts',
    FEED: 'cache_feed',
    FOLLOWING: 'cache_following',
    FOLLOWERS: 'cache_followers',
    INTERACTIONS: 'cache_interactions',
    USER_LIKES: 'cache_user_likes',
    USER_REPOSTS: 'cache_user_reposts',
    PRIVATE_MESSAGES: 'cache_private_messages',
    CONVERSATIONS: 'cache_conversations',
    PRIVATE_GROUPS: 'cache_private_groups',
    GROUP_MEMBERS: 'cache_group_members',
    METADATA: 'cache_metadata',
    LAST_CLEANUP: 'cache_last_cleanup',
  }
};

class CacheService {
  constructor() {
    this.memoryCache = new Map(); // In-memory cache for frequently accessed data
    this.batchQueue = new Map(); // Batch operations queue
    this.batchTimeout = null;
    this.initializeCleanup();
  }

  // Initialize periodic cache cleanup
  async initializeCleanup() {
    try {
      const lastCleanup = await AsyncStorage.getItem(CACHE_CONFIG.KEYS.LAST_CLEANUP);
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      
      if (!lastCleanup || parseInt(lastCleanup) < oneDayAgo) {
        await this.cleanupExpiredCache();
        await AsyncStorage.setItem(CACHE_CONFIG.KEYS.LAST_CLEANUP, now.toString());
      }
    } catch (error) {
      console.warn('Cache cleanup initialization failed:', error);
    }
  }

  // Create a cache entry with TTL
  createCacheEntry(data, ttl = null) {
    return {
      data,
      timestamp: Date.now(),
      ttl: ttl || CACHE_CONFIG.TTL.METADATA,
      version: 1
    };
  }

  // Check if cache entry is valid
  isCacheValid(cacheEntry) {
    if (!cacheEntry || !cacheEntry.timestamp) return false;
    const now = Date.now();
    return (now - cacheEntry.timestamp) < cacheEntry.ttl;
  }

  // Generic get method with memory cache check
  async get(key, fallbackTtl = CACHE_CONFIG.TTL.METADATA) {
    try {
      // Check memory cache first (fastest)
      if (this.memoryCache.has(key)) {
        const memoryEntry = this.memoryCache.get(key);
        if (this.isCacheValid(memoryEntry)) {
          return memoryEntry.data;
        } else {
          this.memoryCache.delete(key);
        }
      }

      // Check AsyncStorage cache
      const cachedData = await AsyncStorage.getItem(key);
      if (cachedData) {
        const cacheEntry = JSON.parse(cachedData);
        if (this.isCacheValid(cacheEntry)) {
          // Store in memory cache for next time
          this.memoryCache.set(key, cacheEntry);
          return cacheEntry.data;
        } else {
          // Cache expired, remove it
          await AsyncStorage.removeItem(key);
        }
      }
      return null;
    } catch (error) {
      console.warn(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  // Generic set method with memory cache update
  async set(key, data, ttl = CACHE_CONFIG.TTL.METADATA) {
    try {
      const cacheEntry = this.createCacheEntry(data, ttl);
      
      // Store in memory cache immediately
      this.memoryCache.set(key, cacheEntry);
      
      // Queue for batch write to AsyncStorage
      this.queueBatchWrite(key, cacheEntry);
      
      return true;
    } catch (error) {
      console.warn(`Cache set error for key ${key}:`, error);
      return false;
    }
  }

  // Batch write operations for better performance
  queueBatchWrite(key, data) {
    this.batchQueue.set(key, data);
    
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    
    this.batchTimeout = setTimeout(async () => {
      await this.flushBatchQueue();
    }, 100); // Batch writes every 100ms
  }

  async flushBatchQueue() {
    if (this.batchQueue.size === 0) return;
    
    try {
      const batchOperations = [];
      for (const [key, data] of this.batchQueue) {
        batchOperations.push([key, JSON.stringify(data)]);
      }
      
      await AsyncStorage.multiSet(batchOperations);
      console.log(`💾 Batch cached ${batchOperations.length} items`);
      this.batchQueue.clear();
    } catch (error) {
      console.warn('Batch write error:', error);
    }
  }

  // Profile caching methods
  async getProfile(pubkey) {
    const key = `${CACHE_CONFIG.KEYS.PROFILES}_${pubkey}`;
    return await this.get(key, CACHE_CONFIG.TTL.PROFILES);
  }

  async setProfile(pubkey, profile) {
    const key = `${CACHE_CONFIG.KEYS.PROFILES}_${pubkey}`;
    return await this.set(key, profile, CACHE_CONFIG.TTL.PROFILES);
  }

  async getMultipleProfiles(pubkeys) {
    try {
      const profiles = new Map();
      const keys = pubkeys.map(pubkey => `${CACHE_CONFIG.KEYS.PROFILES}_${pubkey}`);
      
      // Check memory cache first
      const cachedFromMemory = [];
      const missingKeys = [];
      
      keys.forEach((key, index) => {
        const pubkey = pubkeys[index];
        if (this.memoryCache.has(key)) {
          const memoryEntry = this.memoryCache.get(key);
          if (this.isCacheValid(memoryEntry)) {
            profiles.set(pubkey, memoryEntry.data);
            cachedFromMemory.push(key);
          } else {
            this.memoryCache.delete(key);
            missingKeys.push(key);
          }
        } else {
          missingKeys.push(key);
        }
      });

      // Get remaining from AsyncStorage
      if (missingKeys.length > 0) {
        const storageResults = await AsyncStorage.multiGet(missingKeys);
        
        storageResults.forEach(([key, value], index) => {
          if (value) {
            try {
              const cacheEntry = JSON.parse(value);
              if (this.isCacheValid(cacheEntry)) {
                const pubkey = key.replace(`${CACHE_CONFIG.KEYS.PROFILES}_`, '');
                profiles.set(pubkey, cacheEntry.data);
                // Store in memory cache
                this.memoryCache.set(key, cacheEntry);
              }
            } catch (error) {
              console.warn(`Error parsing cached profile ${key}:`, error);
            }
          }
        });
      }
      
      console.log(`📊 Profile cache hit: ${profiles.size}/${pubkeys.length}`);
      return profiles;
    } catch (error) {
      console.warn('Error getting multiple profiles from cache:', error);
      return new Map();
    }
  }

  async setMultipleProfiles(profilesMap) {
    try {
      for (const [pubkey, profile] of profilesMap) {
        await this.setProfile(pubkey, profile);
      }
    } catch (error) {
      console.warn('Error setting multiple profiles in cache:', error);
    }
  }

  // Post caching methods
  async getPost(postId) {
    const key = `${CACHE_CONFIG.KEYS.POSTS}_${postId}`;
    return await this.get(key, CACHE_CONFIG.TTL.POSTS);
  }

  async setPost(postId, post) {
    const key = `${CACHE_CONFIG.KEYS.POSTS}_${postId}`;
    return await this.set(key, post, CACHE_CONFIG.TTL.POSTS);
  }

  async getUserPosts(pubkey) {
    const key = `${CACHE_CONFIG.KEYS.POSTS}_user_${pubkey}`;
    return await this.get(key, CACHE_CONFIG.TTL.POSTS);
  }

  async setUserPosts(pubkey, posts) {
    const key = `${CACHE_CONFIG.KEYS.POSTS}_user_${pubkey}`;
    return await this.set(key, posts, CACHE_CONFIG.TTL.POSTS);
  }

  // Feed caching methods
  async getFeed(feedKey = 'main') {
    const key = `${CACHE_CONFIG.KEYS.FEED}_${feedKey}`;
    return await this.get(key, CACHE_CONFIG.TTL.FEED);
  }

  async setFeed(feedKey = 'main', posts) {
    const key = `${CACHE_CONFIG.KEYS.FEED}_${feedKey}`;
    // Limit feed cache size
    const limitedPosts = posts.slice(0, CACHE_CONFIG.LIMITS.MAX_FEED_ITEMS);
    return await this.set(key, limitedPosts, CACHE_CONFIG.TTL.FEED);
  }

  // Following/Followers caching
  async getFollowing(pubkey) {
    const key = `${CACHE_CONFIG.KEYS.FOLLOWING}_${pubkey}`;
    return await this.get(key, CACHE_CONFIG.TTL.FOLLOWING);
  }

  async setFollowing(pubkey, following) {
    const key = `${CACHE_CONFIG.KEYS.FOLLOWING}_${pubkey}`;
    return await this.set(key, following, CACHE_CONFIG.TTL.FOLLOWING);
  }

  async getFollowers(pubkey) {
    const key = `${CACHE_CONFIG.KEYS.FOLLOWERS}_${pubkey}`;
    return await this.get(key, CACHE_CONFIG.TTL.FOLLOWERS);
  }

  async setFollowers(pubkey, followers) {
    const key = `${CACHE_CONFIG.KEYS.FOLLOWERS}_${pubkey}`;
    return await this.set(key, followers, CACHE_CONFIG.TTL.FOLLOWERS);
  }

  // Interaction caching (likes, reposts, etc.)
  async getInteractions(postIds) {
    const key = `${CACHE_CONFIG.KEYS.INTERACTIONS}_${postIds.join('_').substring(0, 50)}`;
    return await this.get(key, CACHE_CONFIG.TTL.INTERACTIONS);
  }

  async setInteractions(postIds, interactions) {
    const key = `${CACHE_CONFIG.KEYS.INTERACTIONS}_${postIds.join('_').substring(0, 50)}`;
    return await this.set(key, interactions, CACHE_CONFIG.TTL.INTERACTIONS);
  }

  async getUserLikes() {
    return await this.get(CACHE_CONFIG.KEYS.USER_LIKES, CACHE_CONFIG.TTL.INTERACTIONS);
  }

  async setUserLikes(likes) {
    return await this.set(CACHE_CONFIG.KEYS.USER_LIKES, Array.from(likes), CACHE_CONFIG.TTL.INTERACTIONS);
  }

  async getUserReposts() {
    return await this.get(CACHE_CONFIG.KEYS.USER_REPOSTS, CACHE_CONFIG.TTL.INTERACTIONS);
  }

  async setUserReposts(reposts) {
    return await this.set(CACHE_CONFIG.KEYS.USER_REPOSTS, Array.from(reposts), CACHE_CONFIG.TTL.INTERACTIONS);
  }

  // Private message caching methods
  async getConversations(userPubkey) {
    const key = `${CACHE_CONFIG.KEYS.CONVERSATIONS}_${userPubkey}`;
    return await this.get(key, CACHE_CONFIG.TTL.CONVERSATIONS);
  }

  async setConversations(userPubkey, conversations) {
    const key = `${CACHE_CONFIG.KEYS.CONVERSATIONS}_${userPubkey}`;
    // Limit number of conversations cached
    const limitedConversations = conversations.slice(0, CACHE_CONFIG.LIMITS.MAX_CONVERSATIONS);
    return await this.set(key, limitedConversations, CACHE_CONFIG.TTL.CONVERSATIONS);
  }

  async getPrivateMessages(userPubkey, contactPubkey) {
    const key = `${CACHE_CONFIG.KEYS.PRIVATE_MESSAGES}_${userPubkey}_${contactPubkey}`;
    return await this.get(key, CACHE_CONFIG.TTL.PRIVATE_MESSAGES);
  }

  async setPrivateMessages(userPubkey, contactPubkey, messages) {
    const key = `${CACHE_CONFIG.KEYS.PRIVATE_MESSAGES}_${userPubkey}_${contactPubkey}`;
    // Limit number of messages cached per conversation
    const limitedMessages = messages.slice(-CACHE_CONFIG.LIMITS.MAX_MESSAGES_PER_CONVERSATION);
    return await this.set(key, limitedMessages, CACHE_CONFIG.TTL.PRIVATE_MESSAGES);
  }

  // Update conversation with new message (for real-time updates)
  async updateConversationWithNewMessage(userPubkey, newMessage, contactPubkey) {
    try {
      // Update conversations list
      const conversations = await this.getConversations(userPubkey);
      if (conversations) {
        const updatedConversations = conversations.map(conv => {
          if (conv.pubkey === contactPubkey) {
            return {
              ...conv,
              lastMessage: newMessage,
              messages: [...(conv.messages || []), newMessage],
              unreadCount: newMessage.isFromMe ? conv.unreadCount : (conv.unreadCount || 0) + 1
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
        
        await this.setConversations(userPubkey, updatedConversations);
      }

      // Update specific conversation messages
      const messages = await this.getPrivateMessages(userPubkey, contactPubkey);
      if (messages) {
        const updatedMessages = [...messages, newMessage];
        await this.setPrivateMessages(userPubkey, contactPubkey, updatedMessages);
      }
    } catch (error) {
      console.warn('Error updating conversation cache with new message:', error);
    }
  }

  // Mark conversation as read
  async markConversationAsRead(userPubkey, contactPubkey) {
    try {
      const conversations = await this.getConversations(userPubkey);
      if (conversations) {
        const updatedConversations = conversations.map(conv => {
          if (conv.pubkey === contactPubkey) {
            return { ...conv, unreadCount: 0 };
          }
          return conv;
        });
        await this.setConversations(userPubkey, updatedConversations);
      }
    } catch (error) {
      console.warn('Error marking conversation as read in cache:', error);
    }
  }

  // Mark all conversations as read
  async markAllConversationsAsRead(userPubkey) {
    try {
      const conversations = await this.getConversations(userPubkey);
      if (conversations) {
        const updatedConversations = conversations.map(conv => ({
          ...conv,
          unreadCount: 0
        }));
        await this.setConversations(userPubkey, updatedConversations);
      }
    } catch (error) {
      console.warn('Error marking all conversations as read in cache:', error);
    }
  }

  // Cache invalidation methods
  async invalidateProfile(pubkey) {
    const key = `${CACHE_CONFIG.KEYS.PROFILES}_${pubkey}`;
    this.memoryCache.delete(key);
    await AsyncStorage.removeItem(key);
  }

  async invalidateUserPosts(pubkey) {
    const key = `${CACHE_CONFIG.KEYS.POSTS}_user_${pubkey}`;
    this.memoryCache.delete(key);
    await AsyncStorage.removeItem(key);
  }

  async invalidateFeed(feedKey = 'main') {
    const key = `${CACHE_CONFIG.KEYS.FEED}_${feedKey}`;
    this.memoryCache.delete(key);
    await AsyncStorage.removeItem(key);
  }

  async invalidateFollowing(pubkey) {
    const key = `${CACHE_CONFIG.KEYS.FOLLOWING}_${pubkey}`;
    this.memoryCache.delete(key);
    await AsyncStorage.removeItem(key);
  }

  async invalidateFollowers(pubkey) {
    const key = `${CACHE_CONFIG.KEYS.FOLLOWERS}_${pubkey}`;
    this.memoryCache.delete(key);
    await AsyncStorage.removeItem(key);
  }

  // Cache cleanup methods
  async cleanupExpiredCache() {
    try {
      console.log('🧹 Starting cache cleanup...');
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter(key => key.startsWith('cache_'));
      
      if (cacheKeys.length === 0) return;
      
      const cacheData = await AsyncStorage.multiGet(cacheKeys);
      const expiredKeys = [];
      
      cacheData.forEach(([key, value]) => {
        if (value) {
          try {
            const cacheEntry = JSON.parse(value);
            if (!this.isCacheValid(cacheEntry)) {
              expiredKeys.push(key);
            }
          } catch (error) {
            // Invalid JSON, mark for removal
            expiredKeys.push(key);
          }
        }
      });
      
      if (expiredKeys.length > 0) {
        await AsyncStorage.multiRemove(expiredKeys);
        console.log(`🗑️ Cleaned up ${expiredKeys.length} expired cache entries`);
      }
      
      // Clean up memory cache too
      for (const key of this.memoryCache.keys()) {
        const entry = this.memoryCache.get(key);
        if (!this.isCacheValid(entry)) {
          this.memoryCache.delete(key);
        }
      }
      
    } catch (error) {
      console.warn('Cache cleanup error:', error);
    }
  }

  async clearCache() {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter(key => key.startsWith('cache_'));
      
      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
      }
      
      this.memoryCache.clear();
      console.log('🗑️ Cache cleared completely');
    } catch (error) {
      console.warn('Error clearing cache:', error);
    }
  }

  // Private group caching methods
  async getPrivateGroups(userPubkey) {
    const key = `${CACHE_CONFIG.KEYS.PRIVATE_GROUPS}_${userPubkey}`;
    return await this.get(key, CACHE_CONFIG.TTL.PRIVATE_GROUPS);
  }

  async setPrivateGroups(userPubkey, groups) {
    const key = `${CACHE_CONFIG.KEYS.PRIVATE_GROUPS}_${userPubkey}`;
    return await this.set(key, groups, CACHE_CONFIG.TTL.PRIVATE_GROUPS);
  }

  async getGroupMembers(groupId) {
    const key = `${CACHE_CONFIG.KEYS.GROUP_MEMBERS}_${groupId}`;
    return await this.get(key, CACHE_CONFIG.TTL.GROUP_MEMBERS);
  }

  async setGroupMembers(groupId, members) {
    const key = `${CACHE_CONFIG.KEYS.GROUP_MEMBERS}_${groupId}`;
    return await this.set(key, members, CACHE_CONFIG.TTL.GROUP_MEMBERS);
  }

  async invalidatePrivateGroups(userPubkey) {
    const key = `${CACHE_CONFIG.KEYS.PRIVATE_GROUPS}_${userPubkey}`;
    this.memoryCache.delete(key);
    await AsyncStorage.removeItem(key);
  }

  async invalidateGroupMembers(groupId) {
    const key = `${CACHE_CONFIG.KEYS.GROUP_MEMBERS}_${groupId}`;
    this.memoryCache.delete(key);
    await AsyncStorage.removeItem(key);
  }

  // Cache statistics
  async getCacheStats() {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter(key => key.startsWith('cache_'));
      
      const stats = {
        totalEntries: cacheKeys.length,
        memoryEntries: this.memoryCache.size,
        profiles: cacheKeys.filter(key => key.includes('profiles')).length,
        posts: cacheKeys.filter(key => key.includes('posts')).length,
        feed: cacheKeys.filter(key => key.includes('feed')).length,
        interactions: cacheKeys.filter(key => key.includes('interactions')).length,
        privateMessages: cacheKeys.filter(key => key.includes('private_messages')).length,
        conversations: cacheKeys.filter(key => key.includes('conversations')).length,
        privateGroups: cacheKeys.filter(key => key.includes('private_groups')).length,
        groupMembers: cacheKeys.filter(key => key.includes('group_members')).length,
      };
      
      return stats;
    } catch (error) {
      console.warn('Error getting cache stats:', error);
      return null;
    }
  }
}

export const cacheService = new CacheService();
export default cacheService;