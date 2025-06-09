import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
  Alert,
  TextInput,
  RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nostrService } from '../services/NostrService';
import { nostrUtils } from '../utils/nostrUtils';
import { THEMES } from '../utils/constants';

const { width: screenWidth } = Dimensions.get('window');

const PostDetailScreen = ({ route, navigation, theme = THEMES.DARK }) => {
  const { post, userProfiles: initialProfiles = new Map() } = route.params;
  
  const [replies, setReplies] = useState([]);
  const [userProfiles, setUserProfiles] = useState(initialProfiles);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [likedPosts, setLikedPosts] = useState(new Set());
  const [repostedPosts, setRepostedPosts] = useState(new Set());
  const [actionInProgress, setActionInProgress] = useState(new Set());
  const [postInteractions, setPostInteractions] = useState({
    likes: new Map(),
    reposts: new Map(),
    replies: new Map()
  });

  useEffect(() => {
    navigation.setOptions({
      title: 'Post',
      headerBackTitleVisible: false,
    });
    
    loadPostDetails();
    loadUserInteractions();
  }, []);

  const loadUserInteractions = async () => {
    try {
      // Load user's likes and reposts from storage
      const storedLikes = await AsyncStorage.getItem('user_liked_posts');
      const storedReposts = await AsyncStorage.getItem('user_reposted_posts');
      
      if (storedLikes) {
        setLikedPosts(new Set(JSON.parse(storedLikes)));
      }
      
      if (storedReposts) {
        setRepostedPosts(new Set(JSON.parse(storedReposts)));
      }

      // Load interaction counts for the main post and replies
      const allPostIds = [post.id];
      const interactions = await nostrService.getPostInteractions(allPostIds);
      setPostInteractions(interactions);
    } catch (error) {
      console.error('Error loading user interactions:', error);
    }
  };

  const loadPostDetails = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      console.log(`📖 Loading details for post ${post.id.substring(0, 8)}...`);

      // Get all replies to this post
      const replyEvents = await nostrService.pool.querySync(
        Array.from(nostrService.connectedRelays), 
        {
          kinds: [1], // Text notes
          '#e': [post.id], // Replies to this post
          limit: 100
        }
      );

      // Process replies
      const processedReplies = replyEvents.map(event => ({
        id: event.id,
        content: event.content,
        pubkey: event.pubkey,
        created_at: event.created_at,
        tags: event.tags || [],
        sig: event.sig
      }));

      // Sort replies by timestamp (oldest first for Twitter-like threading)
      processedReplies.sort((a, b) => a.created_at - b.created_at);
      setReplies(processedReplies);

      // Get profiles for all users (main post + replies)
      const allUserPubkeys = new Set([post.pubkey]);
      processedReplies.forEach(reply => allUserPubkeys.add(reply.pubkey));

      for (const pubkey of allUserPubkeys) {
        if (!userProfiles.has(pubkey)) {
          try {
            const profile = await nostrService.getUserProfile(pubkey);
            if (profile) {
              setUserProfiles(prev => new Map(prev).set(pubkey, profile));
            }
          } catch (error) {
            console.error('Error loading profile:', error);
          }
        }
      }

      // Load interaction counts for all posts (main + replies)
      const allPostIds = [post.id, ...processedReplies.map(r => r.id)];
      const interactions = await nostrService.getPostInteractions(allPostIds);
      setPostInteractions(interactions);

      console.log(`✅ Loaded ${processedReplies.length} replies`);
    } catch (error) {
      console.error('❌ Error loading post details:', error);
      Alert.alert('Error', 'Failed to load post details');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim()) {
      Alert.alert('Error', 'Reply cannot be empty');
      return;
    }

    try {
      setIsReplying(true);
      console.log('💬 Posting reply to:', post.id);

      const result = await nostrService.replyToPost(post.id, post.pubkey, replyText.trim());
      console.log('✅ Reply posted:', result);

      // Clear reply text
      setReplyText('');

      // Refresh to show the new reply
      setTimeout(() => {
        loadPostDetails(true);
      }, 1000);

      Alert.alert('Success', 'Reply posted successfully!');
    } catch (error) {
      console.error('❌ Error posting reply:', error);
      Alert.alert('Error', `Failed to post reply: ${error.message}`);
    } finally {
      setIsReplying(false);
    }
  };

  const handleLikePost = async (targetPost) => {
    if (actionInProgress.has(targetPost.id)) return;
    
    try {
      setActionInProgress(prev => new Set(prev).add(targetPost.id));
      
      if (likedPosts.has(targetPost.id)) {
        await nostrService.unlikePost(targetPost.id, targetPost.pubkey);
        const newLikedPosts = new Set(likedPosts);
        newLikedPosts.delete(targetPost.id);
        setLikedPosts(newLikedPosts);
      } else {
        await nostrService.likePost(targetPost.id, targetPost.pubkey);
        const newLikedPosts = new Set(likedPosts).add(targetPost.id);
        setLikedPosts(newLikedPosts);
      }
      
      // Update interaction counts
      setPostInteractions(prev => {
        const newInteractions = { ...prev };
        const currentLikes = newInteractions.likes.get(targetPost.id) || { count: 0, userLiked: false };
        const wasLiked = likedPosts.has(targetPost.id);
        
        newInteractions.likes.set(targetPost.id, {
          ...currentLikes,
          userLiked: !wasLiked,
          count: wasLiked ? Math.max(0, currentLikes.count - 1) : currentLikes.count + 1
        });
        return newInteractions;
      });
      
    } catch (error) {
      console.error('❌ Error liking post:', error);
      Alert.alert('Error', `Failed to like post: ${error.message}`);
    } finally {
      setActionInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(targetPost.id);
        return newSet;
      });
    }
  };

  const handleRepostPost = async (targetPost) => {
    if (actionInProgress.has(targetPost.id)) return;
    
    try {
      setActionInProgress(prev => new Set(prev).add(targetPost.id));
      
      await nostrService.repostPost(targetPost.id, targetPost.pubkey, '');
      const newRepostedPosts = new Set(repostedPosts).add(targetPost.id);
      setRepostedPosts(newRepostedPosts);
      
      Alert.alert('Success', 'Post reposted successfully!');
    } catch (error) {
      console.error('❌ Error reposting post:', error);
      Alert.alert('Error', `Failed to repost: ${error.message}`);
    } finally {
      setActionInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(targetPost.id);
        return newSet;
      });
    }
  };

  const navigateToUserProfile = (userPubkey, userName) => {
    navigation.navigate('UserProfile', {
      userPubkey,
      userName: userName || 'Unknown User'
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

  const renderContentWithReferences = (content, isMainPost = false) => {
    const contentParts = nostrUtils.replaceNostrReferences(content, userProfiles, handleReferencePress);
    
    return (
      <Text style={[
        styles.postContent, 
        { color: theme.textColor },
        isMainPost && styles.mainPostContent
      ]}>
        {contentParts.map((part, index) => {
          if (part.type === 'reference') {
            return (
              <Text
                key={index}
                style={[styles.referenceText, { color: theme.primaryColor }]}
                onPress={() => handleReferencePress(part.clickData)}
              >
                {part.content}
              </Text>
            );
          } else {
            return (
              <Text key={index} style={{ color: theme.textColor }}>
                {part.content}
              </Text>
            );
          }
        })}
      </Text>
    );
  };

  const extractImages = (content) => {
    if (!content) return [];
    const imageRegex = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?/gi;
    return content.match(imageRegex) || [];
  };

  const removeImageUrls = (content) => {
    if (!content) return '';
    const imageRegex = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?/gi;
    return content.replace(imageRegex, '').trim();
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderPost = (targetPost, isMainPost = false) => {
    const profile = userProfiles.get(targetPost.pubkey);
    const images = extractImages(targetPost.content);
    const textContent = removeImageUrls(targetPost.content);
    
    // Get interaction counts
    const likesData = postInteractions.likes.get(targetPost.id) || { count: 0, userLiked: false };
    const repostsData = postInteractions.reposts.get(targetPost.id) || { count: 0, userReposted: false };
    const repliesData = postInteractions.replies.get(targetPost.id) || { count: 0 };
    
    const isLiked = likesData.userLiked || likedPosts.has(targetPost.id);
    const isReposted = repostsData.userReposted || repostedPosts.has(targetPost.id);
    
    return (
      <View 
        key={targetPost.id} 
        style={[
          isMainPost ? styles.mainPost : styles.replyPost,
          { backgroundColor: theme.cardBackgroundColor }
        ]}
      >
        <View style={styles.postHeader}>
          <View style={styles.authorInfo}>
            {profile?.picture ? (
              <Image source={{ uri: profile.picture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: theme.primaryColor }]}>
                <Ionicons name="person" size={isMainPost ? 16 : 12} color="white" />
              </View>
            )}
            <View style={styles.authorText}>
              <TouchableOpacity 
                onPress={() => navigateToUserProfile(targetPost.pubkey, profile?.name || profile?.display_name)}
                style={styles.authorNameContainer}
              >
                <Text style={[
                  styles.authorName, 
                  { color: theme.primaryColor },
                  isMainPost && styles.mainPostAuthorName
                ]}>
                  {profile?.name || profile?.display_name || 'Unnamed'}
                </Text>
              </TouchableOpacity>
              <Text style={[
                styles.timestamp, 
                { color: theme.secondaryTextColor },
                isMainPost && styles.mainPostTimestamp
              ]}>
                {formatTime(targetPost.created_at)}
              </Text>
            </View>
          </View>
        </View>
        
        {textContent && renderContentWithReferences(textContent, isMainPost)}
        
        {images.length > 0 && (
          <View style={styles.imageContainer}>
            {images.map((imageUrl, index) => (
              <Image
                key={index}
                source={{ uri: imageUrl }}
                style={[
                  styles.postImage, 
                  { maxWidth: screenWidth - 32 },
                  isMainPost && styles.mainPostImage
                ]}
                resizeMode="contain"
              />
            ))}
          </View>
        )}
        
        <View style={styles.postFooter}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => handleLikePost(targetPost)}
            disabled={actionInProgress.has(targetPost.id)}
          >
            <View style={styles.actionButtonContent}>
              <Ionicons 
                name={isLiked ? "heart" : "heart-outline"} 
                size={isMainPost ? 20 : 16} 
                color={isLiked ? theme.likeColor : theme.secondaryTextColor} 
              />
              {likesData.count > 0 && (
                <Text style={[styles.actionCount, { color: theme.secondaryTextColor }]}>
                  {likesData.count}
                </Text>
              )}
            </View>
          </TouchableOpacity>
          
          {isMainPost && (
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => {}} // Reply button for main post (handled by reply composer)
            >
              <View style={styles.actionButtonContent}>
                <Ionicons name="chatbubble-outline" size={20} color={theme.replyColor} />
                {repliesData.count > 0 && (
                  <Text style={[styles.actionCount, { color: theme.secondaryTextColor }]}>
                    {repliesData.count}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => handleRepostPost(targetPost)}
            disabled={actionInProgress.has(targetPost.id)}
          >
            <View style={styles.actionButtonContent}>
              <Ionicons 
                name={isReposted ? "repeat" : "repeat-outline"} 
                size={isMainPost ? 20 : 16} 
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

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: theme.backgroundColor }]}>
        <ActivityIndicator size="large" color={theme.primaryColor} />
        <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
          Loading post details...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundColor }]}>
      <ScrollView 
        style={[
          styles.scrollView,
          {
            overflow: 'auto', // Better scroll control for web
            overflowX: 'hidden', // No horizontal scroll
            maxHeight: 'calc(100vh - 100px)' // CSS calc for proper height on web
          }
        ]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => loadPostDetails(true)}
            tintColor={theme.primaryColor}
          />
        }
      >
        {/* Main Post - Larger and prominent */}
        {renderPost(post, true)}
        
        {/* Reply Composer */}
        <View style={[styles.replyComposer, { 
          backgroundColor: theme.cardBackgroundColor,
          borderTopColor: theme.borderColor 
        }]}>
          <TextInput
            style={[styles.replyInput, { 
              backgroundColor: theme.surfaceColor,
              color: theme.textColor,
              borderColor: theme.borderColor
            }]}
            value={replyText}
            onChangeText={setReplyText}
            placeholder="Post your reply..."
            placeholderTextColor={theme.secondaryTextColor}
            multiline={true}
            numberOfLines={3}
            textAlignVertical="top"
          />
          <TouchableOpacity
            style={[styles.replyButton, { 
              backgroundColor: replyText.trim() ? theme.primaryColor : theme.borderColor 
            }]}
            onPress={handleReply}
            disabled={!replyText.trim() || isReplying}
          >
            {isReplying ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text style={styles.replyButtonText}>Reply</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Replies Section */}
        {replies.length > 0 && (
          <View style={styles.repliesSection}>
            <Text style={[styles.repliesHeader, { color: theme.textColor }]}>
              Replies ({replies.length})
            </Text>
            {replies.map(reply => renderPost(reply, false))}
          </View>
        )}

        {replies.length === 0 && !isLoading && (
          <View style={styles.noReplies}>
            <Ionicons name="chatbubble-outline" size={48} color={theme.secondaryTextColor} />
            <Text style={[styles.noRepliesText, { color: theme.secondaryTextColor }]}>
              No replies yet
            </Text>
            <Text style={[styles.noRepliesSubtext, { color: theme.secondaryTextColor }]}>
              Be the first to reply!
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 20,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  mainPost: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(55, 65, 81, 0.3)',
  },
  replyPost: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(55, 65, 81, 0.1)',
    marginLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(139, 92, 246, 0.3)',
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  authorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  authorText: {
    flex: 1,
  },
  authorNameContainer: {
    alignSelf: 'flex-start',
  },
  authorName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  mainPostAuthorName: {
    fontSize: 18,
    fontWeight: '700',
  },
  timestamp: {
    fontSize: 14,
  },
  mainPostTimestamp: {
    fontSize: 15,
  },
  postContent: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 12,
  },
  mainPostContent: {
    fontSize: 18,
    lineHeight: 26,
    marginBottom: 16,
  },
  imageContainer: {
    marginBottom: 12,
  },
  postImage: {
    width: '100%',
    minHeight: 200,
    maxHeight: 400,
    borderRadius: 12,
    marginBottom: 8,
  },
  mainPostImage: {
    minHeight: 250,
    maxHeight: 500,
    borderRadius: 16,
  },
  postFooter: {
    flexDirection: 'row',
    gap: 24,
    paddingTop: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 50,
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionCount: {
    fontSize: 14,
    fontWeight: '500',
  },
  referenceText: {
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  replyComposer: {
    padding: 16,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  replyInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    maxHeight: 100,
  },
  replyButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  repliesSection: {
    paddingTop: 8,
  },
  repliesHeader: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  noReplies: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  noRepliesText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  noRepliesSubtext: {
    fontSize: 16,
    textAlign: 'center',
  },
});

export default PostDetailScreen;