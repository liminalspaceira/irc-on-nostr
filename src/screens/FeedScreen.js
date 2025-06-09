import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
  Alert,
  TextInput,
  Modal
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nostrService } from '../services/NostrService';
import { nostrUtils } from '../utils/nostrUtils';
import { STORAGE_KEYS, THEMES } from '../utils/constants';

const { width: screenWidth } = Dimensions.get('window');

const FeedScreen = ({ navigation, theme = THEMES.DARK }) => {
  const [posts, setPosts] = useState([]);
  const [threads, setThreads] = useState(new Map());
  const [userProfiles, setUserProfiles] = useState(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [following, setFollowing] = useState([]);
  const [originalPosts, setOriginalPosts] = useState(new Map());
  const [referencedPosts, setReferencedPosts] = useState(new Map());
  const [likedPosts, setLikedPosts] = useState(new Set());
  const [repostedPosts, setRepostedPosts] = useState(new Set());
  const [actionInProgress, setActionInProgress] = useState(new Set());
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [showRepostModal, setShowRepostModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);
  const [newPostText, setNewPostText] = useState('');
  const [newPostImages, setNewPostImages] = useState([]);
  const [isPosting, setIsPosting] = useState(false);
  const [postInteractions, setPostInteractions] = useState({
    likes: new Map(),
    reposts: new Map(),
    replies: new Map()
  });

  const [feedSubscriptionId, setFeedSubscriptionId] = useState(null);

  useEffect(() => {
    loadFeed();
    loadUserInteractions();
    setupFeedSubscription();

    return () => {
      // Cleanup subscription when component unmounts
      if (feedSubscriptionId) {
        nostrService.unsubscribe(feedSubscriptionId);
      }
    };
  }, []);

  const setupFeedSubscription = async () => {
    try {
      // Get current following list for subscription
      const storedPublicKey = await AsyncStorage.getItem(STORAGE_KEYS.PUBLIC_KEY);
      if (!storedPublicKey) return;

      const contacts = await nostrService.getUserContacts(storedPublicKey);
      if (contacts.length > 0) {
        // Subscribe to new posts from followed users
        const subId = nostrService.subscribeToFeedPosts(contacts, onNewFeedPost);
        setFeedSubscriptionId(subId);
      }
    } catch (error) {
      console.error('Failed to setup feed subscription:', error);
    }
  };

  const onNewFeedPost = async (newPost) => {
    console.log('📝 New feed post received:', newPost.id);
    
    // Add the new post to the beginning of the posts array
    setPosts(prev => {
      const exists = prev.find(post => post.id === newPost.id);
      if (exists) return prev;
      
      const updated = [newPost, ...prev].sort((a, b) => b.created_at - a.created_at);
      return updated;
    });

    // If this is a reply, fetch the original post for context
    const replyToId = getReplyToId(newPost);
    if (replyToId && !originalPosts.has(replyToId)) {
      try {
        const originalPostsMap = await nostrService.getOriginalPosts([replyToId]);
        if (originalPostsMap.size > 0) {
          setOriginalPosts(prev => new Map([...prev, ...originalPostsMap]));
          
          // Load profile for original post author
          const originalPost = originalPostsMap.get(replyToId);
          if (originalPost && !userProfiles.has(originalPost.pubkey)) {
            const profile = await nostrService.getUserProfile(originalPost.pubkey);
            if (profile) {
              setUserProfiles(prev => new Map(prev).set(originalPost.pubkey, profile));
            }
          }
        }
      } catch (error) {
        console.error('Failed to load original post for new reply:', error);
      }
    }

    // Update threads structure
    setThreads(prev => {
      const newThreads = new Map(prev);
      
      if (replyToId && newThreads.has(replyToId)) {
        // This is a reply to an existing thread
        const thread = newThreads.get(replyToId);
        const isFollowed = following.includes(newPost.pubkey);
        
        if (isFollowed) {
          thread.followedReplies.push(newPost);
        } else {
          thread.unfollowedReplies.push(newPost);
        }
      } else {
        // This is a new original post or reply creating new thread
        newThreads.set(newPost.id, {
          original: newPost,
          followedReplies: [],
          unfollowedReplies: []
        });
      }
      
      return newThreads;
    });

    // Load profile for the new post author if we don't have it
    if (!userProfiles.has(newPost.pubkey)) {
      try {
        const profile = await nostrService.getUserProfile(newPost.pubkey);
        if (profile) {
          setUserProfiles(prev => new Map(prev).set(newPost.pubkey, profile));
        }
      } catch (error) {
        console.error('Failed to load profile for new post author:', error);
      }
    }

    // Handle nostr references in real-time posts
    const references = nostrUtils.parseNostrReferences(newPost.content);
    if (references.length > 0) {
      // Load profiles for mentioned users
      references.forEach(async (ref) => {
        if (ref.type === 'npub' && !userProfiles.has(ref.data)) {
          try {
            const profile = await nostrService.getUserProfile(ref.data);
            if (profile) {
              setUserProfiles(prev => new Map(prev).set(ref.data, profile));
            }
          } catch (error) {
            console.error('Failed to load profile for referenced user:', error);
          }
        }
      });

      // Load referenced posts
      const postReferences = references.filter(ref => ref.type === 'note' || ref.type === 'nevent');
      if (postReferences.length > 0) {
        try {
          const newReferencedPosts = await nostrService.getReferencedPosts(postReferences);
          if (newReferencedPosts.size > 0) {
            setReferencedPosts(prev => new Map([...prev, ...newReferencedPosts]));
            
            // Load profiles for referenced post authors
            newReferencedPosts.forEach(async (refPost) => {
              if (!userProfiles.has(refPost.pubkey)) {
                const profile = await nostrService.getUserProfile(refPost.pubkey);
                if (profile) {
                  setUserProfiles(prev => new Map(prev).set(refPost.pubkey, profile));
                }
              }
            });
          }
        } catch (error) {
          console.error('Failed to load referenced posts for new post:', error);
        }
      }
    }
  };

  const loadUserInteractions = async () => {
    try {
      const storedLikes = await AsyncStorage.getItem('user_liked_posts');
      const storedReposts = await AsyncStorage.getItem('user_reposted_posts');
      
      if (storedLikes) {
        setLikedPosts(new Set(JSON.parse(storedLikes)));
      }
      
      if (storedReposts) {
        setRepostedPosts(new Set(JSON.parse(storedReposts)));
      }
    } catch (error) {
      console.error('Error loading user interactions:', error);
    }
  };

  const saveUserInteractions = async (liked, reposted) => {
    try {
      await AsyncStorage.setItem('user_liked_posts', JSON.stringify(Array.from(liked)));
      await AsyncStorage.setItem('user_reposted_posts', JSON.stringify(Array.from(reposted)));
    } catch (error) {
      console.error('Error saving user interactions:', error);
    }
  };

  const loadFeed = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      // Ensure NostrService is initialized
      if (!nostrService.isConnected) {
        console.log('🔧 NostrService not connected, attempting to initialize...');
        try {
          await nostrService.initialize();
          console.log('✅ NostrService initialized successfully');
        } catch (initError) {
          console.error('❌ Failed to initialize NostrService:', initError);
          Alert.alert('Connection Error', 'Failed to connect to Nostr network. Some features may not work.');
        }
      }

      // Get user's following list first
      const storedPublicKey = await AsyncStorage.getItem(STORAGE_KEYS.PUBLIC_KEY);
      if (!storedPublicKey) {
        console.log('⚠️ No public key found');
        return;
      }

      console.log('📡 Loading feed for user:', storedPublicKey.substring(0, 8) + '...');

      const contacts = await nostrService.getUserContacts(storedPublicKey);
      setFollowing(contacts);

      if (contacts.length > 0) {
        // Get feed posts from followed users
        const feedPosts = await nostrService.getFeedPosts(contacts);
        
        // Build thread structure (after we have the contacts)
        console.log('📋 Building threads with', contacts.length, 'followed users');
        const threadMap = buildThreads(feedPosts, contacts);
        setThreads(threadMap);
        
        // Set posts sorted by timestamp (newest first)
        const sortedPosts = feedPosts.sort((a, b) => b.created_at - a.created_at);
        setPosts(sortedPosts);

        // Fetch original posts for replies to show context
        console.log('🔗 Fetching original posts for reply context...');
        const replyToIds = new Set();
        feedPosts.forEach(post => {
          if (post.tags) {
            const eTag = post.tags.find(tag => tag[0] === 'e' && tag[1]);
            if (eTag) {
              replyToIds.add(eTag[1]);
            }
          }
        });

        // Get profiles for all users mentioned in posts
        const allUserPubkeys = new Set();
        feedPosts.forEach(post => {
          allUserPubkeys.add(post.pubkey);
          // Add any mentioned users from replies
          if (post.tags) {
            post.tags.forEach(tag => {
              if (tag[0] === 'p' && tag[1]) {
                allUserPubkeys.add(tag[1]);
              }
            });
          }
          
          // Add users mentioned in nostr references
          const references = nostrUtils.parseNostrReferences(post.content);
          references.forEach(ref => {
            if (ref.type === 'npub') {
              allUserPubkeys.add(ref.data);
            }
          });
        });

        // Fetch original posts and add their authors to profile loading
        if (replyToIds.size > 0) {
          const originalPostsMap = await nostrService.getOriginalPosts(Array.from(replyToIds));
          setOriginalPosts(originalPostsMap);
          
          // Add original post authors to profile loading
          originalPostsMap.forEach(originalPost => {
            allUserPubkeys.add(originalPost.pubkey);
          });
          
          console.log(`✅ Loaded ${originalPostsMap.size} original posts for context`);
        }

        // Fetch referenced posts from nostr: references
        console.log('🔗 Fetching referenced posts from nostr references...');
        const allReferences = [];
        feedPosts.forEach(post => {
          const references = nostrUtils.parseNostrReferences(post.content);
          allReferences.push(...references);
        });

        if (allReferences.length > 0) {
          const referencedPostsMap = await nostrService.getReferencedPosts(allReferences);
          setReferencedPosts(referencedPostsMap);
          
          // Add referenced post authors to profile loading
          referencedPostsMap.forEach(refPost => {
            allUserPubkeys.add(refPost.pubkey);
          });
          
          console.log(`✅ Loaded ${referencedPostsMap.size} referenced posts`);
        }

        const profiles = await nostrService.getMultipleUserProfiles(Array.from(allUserPubkeys));
        setUserProfiles(profiles);

        // Load interaction counts for all posts
        console.log('📊 Loading interaction counts...');
        const postIds = feedPosts.map(post => post.id);
        const interactions = await nostrService.getPostInteractions(postIds);
        setPostInteractions(interactions);

        // Sync user's likes and reposts from Nostr
        console.log('🔄 Syncing user interactions...');
        const userLikes = await nostrService.getUserLikes();
        const userReposts = await nostrService.getUserReposts();
        
        setLikedPosts(userLikes);
        setRepostedPosts(userReposts);
        
        // Save to local storage
        await saveUserInteractions(userLikes, userReposts);
      } else {
        console.log('👥 No contacts found');
      }
    } catch (error) {
      console.error('❌ Error loading feed:', error);
      Alert.alert('Error', `Failed to load feed: ${error.message}`);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const buildThreads = (posts, followedUsers = []) => {
    const threadMap = new Map();
    const postMap = new Map();
    
    console.log('🔧 Building threads with', posts.length, 'posts and', followedUsers.length, 'followed users');
    
    // Create a map of all posts by ID
    posts.forEach(post => {
      postMap.set(post.id, post);
    });

    // Build thread relationships
    posts.forEach(post => {
      const replyToId = getReplyToId(post);
      
      if (replyToId) {
        // This is a reply
        if (!threadMap.has(replyToId)) {
          threadMap.set(replyToId, {
            original: postMap.get(replyToId),
            followedReplies: [],
            unfollowedReplies: []
          });
        }
        
        const thread = threadMap.get(replyToId);
        
        // Check if the reply author is someone we follow
        const isFollowed = followedUsers.includes(post.pubkey);
        console.log(`📝 Reply from ${post.pubkey.substring(0, 8)}... - Followed: ${isFollowed}`);
        
        if (isFollowed) {
          thread.followedReplies.push(post);
          console.log(`✅ Added to followedReplies for thread ${replyToId.substring(0, 8)}...`);
        } else {
          thread.unfollowedReplies.push(post);
          console.log(`➕ Added to unfollowedReplies for thread ${replyToId.substring(0, 8)}...`);
        }
      } else {
        // This is an original post
        if (!threadMap.has(post.id)) {
          threadMap.set(post.id, {
            original: post,
            followedReplies: [],
            unfollowedReplies: []
          });
        } else {
          threadMap.get(post.id).original = post;
        }
      }
    });

    // Log final thread structure
    threadMap.forEach((thread, threadId) => {
      if (thread.followedReplies.length > 0 || thread.unfollowedReplies.length > 0) {
        console.log(`🧵 Thread ${threadId.substring(0, 8)}... - Followed: ${thread.followedReplies.length}, Unfollowed: ${thread.unfollowedReplies.length}`);
      }
    });

    return threadMap;
  };

  const getReplyToId = (post) => {
    if (!post.tags) return null;
    
    const eTag = post.tags.find(tag => tag[0] === 'e' && tag[1]);
    return eTag ? eTag[1] : null;
  };

  const isReply = (post) => {
    return getReplyToId(post) !== null;
  };

  const getOriginalPost = (replyToId) => {
    return originalPosts.get(replyToId);
  };

  const extractImages = (content) => {
    if (!content) return [];
    
    // Common image URL patterns
    const imageRegex = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?/gi;
    const matches = content.match(imageRegex) || [];
    return matches;
  };

  const removeImageUrls = (content) => {
    if (!content) return '';
    
    const imageRegex = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?/gi;
    return content.replace(imageRegex, '').trim();
  };


  const handleLikePost = async (post) => {
    if (actionInProgress.has(post.id)) return;
    
    console.log('👍 Like button pressed for post:', post.id);
    
    try {
      setActionInProgress(prev => new Set(prev).add(post.id));
      
      if (likedPosts.has(post.id)) {
        // Already liked - unlike it
        console.log('💔 Unliking post...');
        const result = await nostrService.unlikePost(post.id, post.pubkey);
        console.log('✅ Unlike result:', result);
        
        // Update local state
        const newLikedPosts = new Set(likedPosts);
        newLikedPosts.delete(post.id);
        setLikedPosts(newLikedPosts);
        
        // Update network interaction state
        setPostInteractions(prev => {
          const newInteractions = { ...prev };
          const currentLikes = newInteractions.likes.get(post.id) || { count: 0, userLiked: false };
          newInteractions.likes.set(post.id, {
            ...currentLikes,
            userLiked: false,
            count: Math.max(0, currentLikes.count - 1) // Decrease count but don't go below 0
          });
          return newInteractions;
        });
        
        await saveUserInteractions(newLikedPosts, repostedPosts);
        Alert.alert('Success', 'Post unliked! Deletion event published to Nostr network.');
      } else {
        // Like the post
        console.log('❤️ Liking post...');
        const result = await nostrService.likePost(post.id, post.pubkey);
        console.log('✅ Like result:', result);
        
        // Update local state
        const newLikedPosts = new Set(likedPosts).add(post.id);
        setLikedPosts(newLikedPosts);
        
        // Update network interaction state
        setPostInteractions(prev => {
          const newInteractions = { ...prev };
          const currentLikes = newInteractions.likes.get(post.id) || { count: 0, userLiked: false };
          newInteractions.likes.set(post.id, {
            ...currentLikes,
            userLiked: true,
            count: currentLikes.count + 1 // Increase count
          });
          return newInteractions;
        });
        
        await saveUserInteractions(newLikedPosts, repostedPosts);
        Alert.alert('Success', 'Post liked! Event published to Nostr network.');
      }
    } catch (error) {
      console.error('❌ Error liking post:', error);
      Alert.alert('Error', `Failed to like post: ${error.message}`);
    } finally {
      setActionInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(post.id);
        return newSet;
      });
    }
  };

  const handleRepostPost = async (post) => {
    if (actionInProgress.has(post.id)) return;
    
    console.log('🔄 Repost button pressed for post:', post.id);
    setSelectedPost(post);
    setShowRepostModal(true);
  };

  const confirmRepost = async () => {
    if (!selectedPost) return;
    
    try {
      console.log('🔄 Starting repost...');
      setActionInProgress(prev => new Set(prev).add(selectedPost.id));
      setShowRepostModal(false);
      
      const result = await nostrService.repostPost(selectedPost.id, selectedPost.pubkey, '');
      console.log('✅ Repost result:', result);
      const newRepostedPosts = new Set(repostedPosts).add(selectedPost.id);
      setRepostedPosts(newRepostedPosts);
      await saveUserInteractions(likedPosts, newRepostedPosts);
      
      // Show success with a simple alert (this should work on web)
      setTimeout(() => {
        alert('Post reposted! Event published to Nostr network.');
      }, 100);
    } catch (error) {
      console.error('❌ Error reposting post:', error);
      setTimeout(() => {
        alert(`Failed to repost: ${error.message}`);
      }, 100);
    } finally {
      setActionInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(selectedPost.id);
        return newSet;
      });
      setSelectedPost(null);
    }
  };

  const handleReplyToPost = async (post) => {
    if (actionInProgress.has(post.id)) return;
    
    console.log('💬 Reply button pressed for post:', post.id);
    setSelectedPost(post);
    setReplyText('');
    setShowReplyModal(true);
  };

  const confirmReply = async () => {
    if (!selectedPost || !replyText.trim()) {
      alert('Reply cannot be empty');
      return;
    }
    
    try {
      console.log('💬 Starting reply...');
      setActionInProgress(prev => new Set(prev).add(selectedPost.id));
      setShowReplyModal(false);
      
      const result = await nostrService.replyToPost(selectedPost.id, selectedPost.pubkey, replyText.trim());
      console.log('✅ Reply result:', result);
      
      setTimeout(() => {
        alert('Reply posted! Event published to Nostr network.');
        loadFeed(true);
      }, 100);
    } catch (error) {
      console.error('❌ Error replying to post:', error);
      setTimeout(() => {
        alert(`Failed to post reply: ${error.message}`);
      }, 100);
    } finally {
      setActionInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(selectedPost.id);
        return newSet;
      });
      setSelectedPost(null);
      setReplyText('');
    }
  };

  const handleCreatePost = () => {
    console.log('✏️ Create post button pressed');
    setNewPostText('');
    setNewPostImages([]);
    setShowCreatePostModal(true);
  };

  const addImageUrl = () => {
    const imageUrl = prompt('Enter image URL:');
    if (imageUrl && imageUrl.trim()) {
      setNewPostImages(prev => [...prev, imageUrl.trim()]);
    }
  };

  const removeImage = (index) => {
    setNewPostImages(prev => prev.filter((_, i) => i !== index));
  };

  const confirmCreatePost = async () => {
    if (!newPostText.trim() && newPostImages.length === 0) {
      alert('Post cannot be empty');
      return;
    }
    
    try {
      console.log('📝 Creating new post...');
      setIsPosting(true);
      setShowCreatePostModal(false);
      
      // Combine text and images
      let postContent = newPostText.trim();
      if (newPostImages.length > 0) {
        if (postContent) {
          postContent += '\n\n';
        }
        postContent += newPostImages.join('\n');
      }
      
      const result = await nostrService.createTextNote(postContent);
      console.log('✅ Post result:', result);
      
      setTimeout(() => {
        alert('Post created! Event published to Nostr network.');
        loadFeed(true);
      }, 100);
    } catch (error) {
      console.error('❌ Error creating post:', error);
      setTimeout(() => {
        alert(`Failed to create post: ${error.message}`);
      }, 100);
    } finally {
      setIsPosting(false);
      setNewPostText('');
      setNewPostImages([]);
    }
  };

  const formatTime = (timestamp) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  };

  const navigateToUserProfile = (userPubkey, userName) => {
    console.log('👤 Navigating to user profile:', userName, userPubkey.substring(0, 8) + '...');
    navigation.navigate('UserProfile', {
      userPubkey,
      userName: userName || 'Unknown User'
    });
  };

  const navigateToPostDetail = (post) => {
    console.log('📖 Navigating to post detail:', post.id.substring(0, 8) + '...');
    navigation.navigate('PostDetail', {
      post,
      userProfiles
    });
  };

  const handleReferencePress = (clickData) => {
    if (!clickData) return;

    switch (clickData.type) {
      case 'user':
        // Navigate to user profile
        navigateToUserProfile(clickData.pubkey, clickData.profile?.name || clickData.profile?.display_name);
        break;
      case 'note':
        // For note references, we could show the post detail
        // For now, just show an alert
        Alert.alert('Post Reference', 'This is a reference to another post');
        break;
      case 'event':
        // For event references, similar to note
        Alert.alert('Event Reference', 'This is a reference to a Nostr event');
        break;
      default:
        console.log('Unknown reference type:', clickData.type);
    }
  };

  const getReferencedPost = (referenceData) => {
    if (referenceData.type === 'note') {
      return referencedPosts.get(referenceData.data);
    } else if (referenceData.type === 'nevent' && referenceData.data?.id) {
      return referencedPosts.get(referenceData.data.id);
    }
    return null;
  };

  const renderContentWithReferences = (content) => {
    const references = nostrUtils.parseNostrReferences(content);
    
    if (references.length === 0) {
      return (
        <Text style={[styles.postContent, { color: theme.textColor }]}>
          {content}
        </Text>
      );
    }

    const parts = [];
    let lastIndex = 0;

    references.forEach((ref, refIndex) => {
      // Add text before this reference
      if (ref.startIndex > lastIndex) {
        const beforeText = content.substring(lastIndex, ref.startIndex);
        if (beforeText) {
          parts.push(
            <Text key={`text-${refIndex}`} style={[styles.postContent, { color: theme.textColor }]}>
              {beforeText}
            </Text>
          );
        }
      }

      // Handle the reference
      if (ref.type === 'npub') {
        // Show user reference as clickable text
        const profile = userProfiles.get(ref.data);
        const displayName = profile?.name || profile?.display_name || `${ref.data.substring(0, 8)}...`;
        parts.push(
          <Text
            key={`ref-${refIndex}`}
            style={[styles.referenceText, { color: theme.primaryColor }]}
            onPress={() => navigateToUserProfile(ref.data, displayName)}
          >
            @{displayName}
          </Text>
        );
      } else if (ref.type === 'note' || ref.type === 'nevent') {
        // Show referenced post inline
        const referencedPost = getReferencedPost(ref);
        if (referencedPost) {
          parts.push(
            <View key={`ref-${refIndex}`} style={styles.referencedPostContainer}>
              {renderPost(referencedPost, false, true)} {/* isReferencedPost = true */}
            </View>
          );
        } else {
          // Fallback if post not found
          parts.push(
            <Text key={`ref-${refIndex}`} style={[styles.referenceText, { color: theme.secondaryTextColor }]}>
              📝 [Referenced post not found]
            </Text>
          );
        }
      }

      lastIndex = ref.endIndex;
    });

    // Add remaining text after last reference
    if (lastIndex < content.length) {
      const remainingText = content.substring(lastIndex);
      if (remainingText) {
        parts.push(
          <Text key="text-end" style={[styles.postContent, { color: theme.textColor }]}>
            {remainingText}
          </Text>
        );
      }
    }

    return (
      <Text style={[styles.postContent, { color: theme.textColor }]}>
        {parts}
      </Text>
    );
  };

  const renderPost = (post, isReply = false, isOriginalContext = false, isReferencedPost = false) => {
    const profile = userProfiles.get(post.pubkey);
    const indentStyle = isReply ? { marginLeft: 16, borderLeftWidth: 2, borderLeftColor: theme.borderColor, paddingLeft: 8 } : {};
    const images = extractImages(post.content);
    const textContent = removeImageUrls(post.content);
    
    // Get interaction counts for this post
    const likesData = postInteractions.likes.get(post.id) || { count: 0, userLiked: false };
    const repostsData = postInteractions.reposts.get(post.id) || { count: 0, userReposted: false };
    const repliesData = postInteractions.replies.get(post.id) || { count: 0 };
    
    // Check if user has liked/reposted (prioritize network data over local state)
    const isLiked = likesData.userLiked || likedPosts.has(post.id);
    const isReposted = repostsData.userReposted || repostedPosts.has(post.id);
    
    return (
      <View key={post.id} style={[
        styles.post, 
        { backgroundColor: theme.cardBackgroundColor }, 
        indentStyle,
        isOriginalContext && styles.originalContextPost,
        isReferencedPost && styles.referencedPost
      ]}>
        <View style={styles.postHeader}>
          <View style={styles.authorInfo}>
            {profile?.picture ? (
              <Image source={{ uri: profile.picture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: theme.primaryColor }]}>
                <Ionicons name="person" size={12} color="white" />
              </View>
            )}
            <View style={styles.authorText}>
              <TouchableOpacity 
                onPress={() => navigateToUserProfile(post.pubkey, profile?.name || profile?.display_name)}
                style={styles.authorNameContainer}
              >
                <Text style={[styles.authorName, { color: theme.primaryColor }]}>
                  {profile?.name || profile?.display_name || 'Unnamed'}
                </Text>
              </TouchableOpacity>
              <Text style={[styles.timestamp, { color: theme.secondaryTextColor }]}>
                {formatTime(post.created_at)}
              </Text>
            </View>
          </View>
          {isReply && (
            <Ionicons name="return-down-forward" size={12} color={theme.secondaryTextColor} />
          )}
        </View>
        
        {/* Clickable content area */}
        <TouchableOpacity 
          style={styles.postContentArea}
          onPress={() => !isOriginalContext && !isReferencedPost && navigateToPostDetail(post)}
          activeOpacity={(isOriginalContext || isReferencedPost) ? 1 : 0.95}
          disabled={isOriginalContext || isReferencedPost}
        >
          {textContent && (
            isReferencedPost ? (
              // For referenced posts, render content without nested references to avoid infinite recursion
              <Text style={[styles.postContent, { color: theme.textColor }]}>
                {textContent}
              </Text>
            ) : (
              renderContentWithReferences(textContent)
            )
          )}
          
          {images.length > 0 && (
            <View style={styles.imageContainer}>
              {images.map((imageUrl, index) => (
                <Image
                  key={index}
                  source={{ uri: imageUrl }}
                  style={[styles.postImage, { maxWidth: screenWidth - (isReply ? 80 : 32) }]}
                  resizeMode="contain"
                />
              ))}
            </View>
          )}
        </TouchableOpacity>
        
        <View style={styles.postFooter}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => handleLikePost(post)}
            disabled={actionInProgress.has(post.id)}
          >
            <View style={styles.actionButtonContent}>
              <Ionicons 
                name={isLiked ? "heart" : "heart-outline"} 
                size={16} 
                color={isLiked ? theme.likeColor : theme.secondaryTextColor} 
              />
              {likesData.count > 0 && (
                <Text style={[styles.actionCount, { color: theme.secondaryTextColor }]}>
                  {likesData.count}
                </Text>
              )}
              {actionInProgress.has(post.id) && (
                <ActivityIndicator size="small" color={theme.secondaryTextColor} style={{ marginLeft: 4 }} />
              )}
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => handleReplyToPost(post)}
            disabled={actionInProgress.has(post.id)}
          >
            <View style={styles.actionButtonContent}>
              <Ionicons name="chatbubble-outline" size={16} color={theme.replyColor} />
              {repliesData.count > 0 && (
                <Text style={[styles.actionCount, { color: theme.secondaryTextColor }]}>
                  {repliesData.count}
                </Text>
              )}
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => handleRepostPost(post)}
            disabled={actionInProgress.has(post.id)}
          >
            <View style={styles.actionButtonContent}>
              <Ionicons 
                name={isReposted ? "repeat" : "repeat-outline"} 
                size={16} 
                color={isReposted ? theme.repostColor : theme.secondaryTextColor} 
              />
              {repostsData.count > 0 && (
                <Text style={[styles.actionCount, { color: theme.secondaryTextColor }]}>
                  {repostsData.count}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderThread = (threadId, thread) => {
    const { original } = thread;
    
    if (!original) return null;

    const replyToId = getReplyToId(original);
    const originalPost = replyToId ? getOriginalPost(replyToId) : null;
    const authorProfile = userProfiles.get(original.pubkey);
    
    return (
      <View key={threadId} style={styles.thread}>
        {/* Show original post if this is a reply */}
        {originalPost && (
          <View style={styles.replyContext}>
            {renderPost(originalPost, false, true)} {/* isOriginalContext = true */}
            
            {/* "Replying to" indicator */}
            <View style={styles.replyIndicator}>
              <Ionicons name="return-down-forward" size={14} color={theme.secondaryTextColor} />
              <Text style={[styles.replyText, { color: theme.secondaryTextColor }]}>
                {authorProfile?.name || authorProfile?.display_name || 'Someone'} replied
              </Text>
            </View>
          </View>
        )}
        
        {/* Show the actual post/reply */}
        {renderPost(original, isReply(original))}
      </View>
    );
  };

  if (isLoading && posts.length === 0) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: theme.backgroundColor }]}>
        <ActivityIndicator size="large" color={theme.primaryColor} />
        <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
          Loading your feed...
        </Text>
      </View>
    );
  }

  if (following.length === 0) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: theme.backgroundColor }]}>
        <Ionicons name="newspaper-outline" size={64} color={theme.secondaryTextColor} />
        <Text style={[styles.emptyTitle, { color: theme.textColor }]}>
          No Feed Yet
        </Text>
        <Text style={[styles.emptySubtitle, { color: theme.secondaryTextColor }]}>
          Follow some people to see their posts here
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundColor }]}>
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => loadFeed(true)}
            tintColor={theme.primaryColor}
          />
        }
      >
      <View style={styles.feedHeader}>
        <Text style={[styles.feedTitle, { color: theme.textColor }]}>
          Feed
        </Text>
        <Text style={[styles.feedSubtitle, { color: theme.secondaryTextColor }]}>
          Posts from {following.length} people you follow
        </Text>
      </View>

      {posts.length > 0 ? (
        <View style={styles.feedContent}>
          {Array.from(threads.entries()).map(([threadId, thread]) => 
            renderThread(threadId, thread)
          )}
        </View>
      ) : (
        <View style={styles.emptyFeed}>
          <Ionicons name="time-outline" size={48} color={theme.secondaryTextColor} />
          <Text style={[styles.emptyTitle, { color: theme.textColor }]}>
            No Posts Yet
          </Text>
          <Text style={[styles.emptySubtitle, { color: theme.secondaryTextColor }]}>
            The people you follow haven't posted anything recently
          </Text>
        </View>
      )}

      {/* Reply Modal */}
      <Modal
        visible={showReplyModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowReplyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: theme.cardBackgroundColor }]}>
            <Text style={[styles.modalTitle, { color: theme.textColor }]}>Reply to Post</Text>
            
            <TextInput
              style={[styles.replyInput, { 
                backgroundColor: theme.surfaceColor,
                color: theme.textColor,
                borderColor: theme.borderColor
              }]}
              value={replyText}
              onChangeText={setReplyText}
              placeholder="Write your reply..."
              placeholderTextColor={theme.secondaryTextColor}
              multiline={true}
              numberOfLines={4}
              textAlignVertical="top"
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.borderColor }]}
                onPress={() => setShowReplyModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: theme.textColor }]}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.primaryColor }]}
                onPress={confirmReply}
              >
                <Text style={[styles.modalButtonText, { color: 'white' }]}>Reply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Repost Modal */}
      <Modal
        visible={showRepostModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowRepostModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: theme.cardBackgroundColor }]}>
            <Text style={[styles.modalTitle, { color: theme.textColor }]}>Repost</Text>
            <Text style={[styles.modalSubtitle, { color: theme.secondaryTextColor }]}>
              Do you want to repost this to your followers?
            </Text>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.borderColor }]}
                onPress={() => setShowRepostModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: theme.textColor }]}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.primaryColor }]}
                onPress={confirmRepost}
              >
                <Text style={[styles.modalButtonText, { color: 'white' }]}>Repost</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create Post Modal */}
      <Modal
        visible={showCreatePostModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCreatePostModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.createPostModalContainer, { backgroundColor: theme.cardBackgroundColor }]}>
            <View style={styles.createPostHeader}>
              <Text style={[styles.modalTitle, { color: theme.textColor }]}>Create Post</Text>
              <TouchableOpacity 
                onPress={() => setShowCreatePostModal(false)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color={theme.textColor} />
              </TouchableOpacity>
            </View>
            
            <TextInput
              style={[styles.createPostInput, { 
                backgroundColor: theme.surfaceColor,
                color: theme.textColor,
                borderColor: theme.borderColor
              }]}
              value={newPostText}
              onChangeText={setNewPostText}
              placeholder="What's on your mind?"
              placeholderTextColor={theme.secondaryTextColor}
              multiline={true}
              numberOfLines={8}
              textAlignVertical="top"
            />

            {/* Image URLs */}
            {newPostImages.length > 0 && (
              <View style={styles.imagePreviewContainer}>
                <Text style={[styles.imagePreviewTitle, { color: theme.textColor }]}>
                  Images ({newPostImages.length})
                </Text>
                {newPostImages.map((imageUrl, index) => (
                  <View key={index} style={styles.imagePreviewItem}>
                    <Image 
                      source={{ uri: imageUrl }} 
                      style={styles.imagePreview}
                      resizeMode="cover"
                    />
                    <TouchableOpacity 
                      onPress={() => removeImage(index)}
                      style={[styles.removeImageButton, { backgroundColor: theme.errorColor }]}
                    >
                      <Ionicons name="trash" size={16} color="white" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.createPostActions}>
              <TouchableOpacity 
                style={[styles.imageButton, { backgroundColor: theme.surfaceColor }]}
                onPress={addImageUrl}
              >
                <Ionicons name="image" size={20} color={theme.primaryColor} />
                <Text style={[styles.imageButtonText, { color: theme.primaryColor }]}>
                  Add Image
                </Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.borderColor }]}
                onPress={() => setShowCreatePostModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: theme.textColor }]}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, { 
                  backgroundColor: isPosting ? theme.borderColor : theme.primaryColor 
                }]}
                onPress={confirmCreatePost}
                disabled={isPosting}
              >
                <Text style={[styles.modalButtonText, { color: 'white' }]}>
                  {isPosting ? 'Posting...' : 'Post'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </ScrollView>

      {/* Floating Action Button */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.primaryColor }]}
        onPress={handleCreatePost}
      >
        <Ionicons name="add" size={24} color="white" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    padding: 12,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  feedHeader: {
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  feedTitle: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  feedSubtitle: {
    fontSize: 16,
    opacity: 0.8,
  },
  feedContent: {
    gap: 12,
  },
  thread: {
    marginBottom: 6,
  },
  post: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.3)',
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  authorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
  },
  avatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  authorText: {
    flex: 1,
  },
  authorNameContainer: {
    alignSelf: 'flex-start',
  },
  authorName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 1,
  },
  timestamp: {
    fontSize: 12,
  },
  postContentArea: {
    // No extra styling needed - keeps the content naturally laid out
  },
  postContent: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 8,
  },
  imageContainer: {
    marginBottom: 8,
  },
  postImage: {
    width: '100%',
    minHeight: 266,
    maxHeight: 665,
    borderRadius: 8,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  postFooter: {
    flexDirection: 'row',
    gap: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 40,
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  replyContext: {
    marginBottom: 8,
  },
  originalContextPost: {
    opacity: 0.8,
    borderLeftWidth: 3,
    borderLeftColor: '#8b5cf6', // Primary purple color
    paddingLeft: 12,
    marginBottom: 0,
  },
  replyIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  replyText: {
    fontSize: 13,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  referenceText: {
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  referencedPostContainer: {
    marginVertical: 8,
  },
  referencedPost: {
    opacity: 0.9,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)', // Light purple border
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  emptyFeed: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 24,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 22,
  },
  replyInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    minHeight: 120,
    marginBottom: 20,
    fontFamily: 'System',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  // Floating Action Button
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    right: 16,
    bottom: 16,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  // Create Post Modal
  createPostModalContainer: {
    width: '100%',
    maxWidth: 500,
    borderRadius: 16,
    padding: 24,
    maxHeight: '90%',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  createPostHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  closeButton: {
    padding: 4,
  },
  createPostInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    minHeight: 120,
    maxHeight: 200,
    marginBottom: 16,
    fontFamily: 'System',
  },
  createPostActions: {
    marginBottom: 20,
  },
  imageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  imageButtonText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  imagePreviewContainer: {
    marginBottom: 16,
  },
  imagePreviewTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  imagePreviewItem: {
    position: 'relative',
    marginBottom: 12,
  },
  imagePreview: {
    width: '100%',
    height: 120,
    borderRadius: 8,
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default FeedScreen;