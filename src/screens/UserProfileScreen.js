import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  FlatList,
  Modal,
  TextInput,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nostrService } from '../services/NostrService';
import { THEMES } from '../utils/constants';

const UserProfileScreen = ({ route, navigation, theme = THEMES.DARK }) => {
  const { userPubkey, userName } = route.params;
  
  const [profile, setProfile] = useState(null);
  const [userPosts, setUserPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [postsLoading, setPostsLoading] = useState(true);
  
  // Interaction state
  const [likedPosts, setLikedPosts] = useState(new Set());
  const [repostedPosts, setRepostedPosts] = useState(new Set());
  const [actionInProgress, setActionInProgress] = useState(new Set());
  const [postInteractions, setPostInteractions] = useState({
    likes: new Map(),
    reposts: new Map(),
    replies: new Map()
  });
  
  // Modal state
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [showRepostModal, setShowRepostModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    loadUserProfile();
    loadUserPosts();
    loadUserInteractions();
  }, [userPubkey]);

  const loadUserProfile = async () => {
    try {
      console.log('👤 Loading profile for user:', userPubkey.substring(0, 8) + '...');
      const userProfile = await nostrService.queryUserProfile(userPubkey);
      if (userProfile) {
        setProfile(userProfile);
        console.log('✅ User profile loaded:', userProfile.name);
      } else {
        // Fallback profile if not found
        setProfile({
          name: userName || 'Unknown User',
          about: 'No profile information available',
          picture: null
        });
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
      setProfile({
        name: userName || 'Unknown User',
        about: 'Error loading profile',
        picture: null
      });
    } finally {
      setLoading(false);
    }
  };

  const loadUserPosts = async () => {
    try {
      console.log('📝 Loading posts for user:', userPubkey.substring(0, 8) + '...');
      const posts = await nostrService.getUserPosts(userPubkey, 50);
      console.log('✅ Loaded', posts.length, 'posts for user');
      setUserPosts(posts.sort((a, b) => b.created_at - a.created_at));
    } catch (error) {
      console.error('Error loading user posts:', error);
      setUserPosts([]);
    } finally {
      setPostsLoading(false);
    }
  };

  const loadUserInteractions = async () => {
    try {
      // Load liked posts
      const likedPostsJson = await AsyncStorage.getItem('likedPosts');
      if (likedPostsJson) {
        const likedPostsArray = JSON.parse(likedPostsJson);
        setLikedPosts(new Set(likedPostsArray));
      }
      
      // Load reposted posts
      const repostedPostsJson = await AsyncStorage.getItem('repostedPosts');
      if (repostedPostsJson) {
        const repostedPostsArray = JSON.parse(repostedPostsJson);
        setRepostedPosts(new Set(repostedPostsArray));
      }
      
      console.log('✅ Loaded user interactions from storage');
    } catch (error) {
      console.error('❌ Error loading user interactions:', error);
    }
  };
  
  const saveUserInteractions = async (likes, reposts) => {
    try {
      await AsyncStorage.setItem('likedPosts', JSON.stringify(Array.from(likes)));
      await AsyncStorage.setItem('repostedPosts', JSON.stringify(Array.from(reposts)));
      console.log('✅ Saved user interactions to storage');
    } catch (error) {
      console.error('❌ Error saving user interactions:', error);
    }
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
        loadUserPosts();
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

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadUserProfile(), loadUserPosts(), loadUserInteractions()]);
    setRefreshing(false);
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
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString();
  };

  const renderPost = ({ item: post }) => {
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
      <View key={post.id} style={[styles.post, { backgroundColor: theme.cardBackgroundColor || theme.backgroundColor }]}>
        <View style={styles.postHeader}>
          <Text style={[styles.timestamp, { color: theme.secondaryTextColor }]}>
            {formatTime(post.created_at)}
          </Text>
        </View>
        
        {textContent && (
          <Text style={[styles.postContent, { color: theme.textColor }]}>
            {textContent}
          </Text>
        )}
        
        {images.length > 0 && (
          <View style={styles.imageContainer}>
            {images.map((imageUrl, index) => (
              <Image
                key={index}
                source={{ uri: imageUrl }}
                style={styles.postImage}
                resizeMode="contain"
              />
            ))}
          </View>
        )}
        
        {/* Post interaction buttons */}
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
                color={isLiked ? (theme.likeColor || '#ff4757') : theme.secondaryTextColor} 
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
              <Ionicons name="chatbubble-outline" size={16} color={theme.replyColor || theme.secondaryTextColor} />
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
                color={isReposted ? (theme.repostColor || '#2ed573') : theme.secondaryTextColor} 
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

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: theme.backgroundColor }]}>
        <ActivityIndicator size="large" color={theme.primaryColor} />
        <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
          Loading profile...
        </Text>
      </View>
    );
  }

  return (
    <>
      <View style={[styles.container, { backgroundColor: theme.backgroundColor }]}>
        {/* Profile Header */}
        <View style={[styles.profileHeader, { backgroundColor: theme.cardBackgroundColor || theme.backgroundColor }]}>
          <View style={styles.avatarContainer}>
            {profile?.picture ? (
              <Image source={{ uri: profile.picture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: theme.primaryColor }]}>
                <Ionicons name="person" size={32} color="white" />
              </View>
            )}
          </View>
          
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: theme.textColor }]}>
              {profile?.name || profile?.display_name || 'Unknown User'}
            </Text>
            <Text style={[styles.profilePubkey, { color: theme.secondaryTextColor }]}>
              {userPubkey.substring(0, 16)}...
            </Text>
            {profile?.about && (
              <Text style={[styles.profileAbout, { color: theme.secondaryTextColor }]}>
                {profile.about}
              </Text>
            )}
            {profile?.website && (
              <View style={styles.profileField}>
                <Ionicons name="globe-outline" size={14} color={theme.secondaryTextColor} />
                <Text style={[styles.profileFieldText, { color: theme.secondaryTextColor }]}>
                  {profile.website}
                </Text>
              </View>
            )}
            {profile?.nip05 && (
              <View style={styles.profileField}>
                <Ionicons name="at-outline" size={14} color={theme.secondaryTextColor} />
                <Text style={[styles.profileFieldText, { color: theme.secondaryTextColor }]}>
                  {profile.nip05}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Posts Section */}
        <View style={styles.postsSection}>
          <View style={styles.postsSectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.textColor }]}>
              Posts ({userPosts.length})
            </Text>
            {postsLoading && (
              <ActivityIndicator size="small" color={theme.primaryColor} />
            )}
          </View>

          {postsLoading ? (
            <View style={styles.postsLoading}>
              <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
                Loading posts...
              </Text>
            </View>
          ) : userPosts.length > 0 ? (
            <ScrollView 
              style={[
                styles.postsScrollContainer,
                { 
                  backgroundColor: theme.backgroundColor,
                }
              ]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={theme.primaryColor}
                />
              }
            >
              {/* Render posts directly */}
              {userPosts.map(post => renderPost({ item: post }))}
            </ScrollView>
          ) : (
            <View style={styles.emptyPosts}>
              <Ionicons name="document-text-outline" size={48} color={theme.secondaryTextColor} />
              <Text style={[styles.emptyText, { color: theme.textColor }]}>
                No posts found
              </Text>
              <Text style={[styles.emptySubtext, { color: theme.secondaryTextColor }]}>
                This user hasn't posted anything yet
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Reply Modal */}
      <Modal
        visible={showReplyModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowReplyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBackgroundColor || theme.backgroundColor }]}>
            <Text style={[styles.modalTitle, { color: theme.textColor }]}>Reply to Post</Text>
            
            <TextInput
              style={[
                styles.replyInput, 
                { 
                  color: theme.textColor, 
                  backgroundColor: theme.inputBackgroundColor || theme.backgroundColor,
                  borderColor: theme.secondaryTextColor
                }
              ]}
              placeholder="Write your reply..."
              placeholderTextColor={theme.secondaryTextColor}
              multiline={true}
              value={replyText}
              onChangeText={setReplyText}
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.cancelButtonColor || '#666' }]}
                onPress={() => setShowReplyModal(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.primaryColor }]}
                onPress={confirmReply}
                disabled={!replyText.trim()}
              >
                <Text style={styles.modalButtonText}>Reply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      
      {/* Repost Modal */}
      <Modal
        visible={showRepostModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowRepostModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBackgroundColor || theme.backgroundColor }]}>
            <Text style={[styles.modalTitle, { color: theme.textColor }]}>Repost</Text>
            <Text style={[styles.modalText, { color: theme.secondaryTextColor }]}>
              Are you sure you want to repost this?
            </Text>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.cancelButtonColor || '#666' }]}
                onPress={() => setShowRepostModal(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.primaryColor }]}
                onPress={confirmRepost}
              >
                <Text style={styles.modalButtonText}>Repost</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  profileHeader: {
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  avatarContainer: {
    alignItems: 'center',
  },
  profileInfo: {
    alignItems: 'center',
    marginTop: 10,
  },
  profileName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  profilePubkey: {
    fontSize: 12,
    marginBottom: 10,
  },
  profileAbout: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 20,
  },
  profileField: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  profileFieldText: {
    fontSize: 12,
    marginLeft: 5,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 10,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  postsSection: {
    flex: 1,
  },
  postsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  postsLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  postsScrollContainer: {
    flex: 1,
  },
  emptyPosts: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
  post: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    marginBottom: 5,
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  timestamp: {
    fontSize: 12,
  },
  postContent: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  imageContainer: {
    marginTop: 10,
  },
  postImage: {
    width: '100%',
    height: 200,
    marginBottom: 10,
    borderRadius: 8,
  },
  postFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: '#444',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 5,
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionCount: {
    fontSize: 12,
    marginLeft: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 500,
    borderRadius: 10,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  modalText: {
    fontSize: 16,
    marginBottom: 20,
  },
  replyInput: {
    borderWidth: 1,
    borderRadius: 5,
    padding: 10,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 5,
    marginLeft: 10,
  },
  modalButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});

export default UserProfileScreen;