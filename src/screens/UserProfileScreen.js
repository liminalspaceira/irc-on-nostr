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
  Dimensions,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nostrService } from '../services/NostrService';
import { nostrUtils } from '../utils/nostrUtils';
import { THEMES } from '../utils/constants';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const UserProfileScreen = ({ route, navigation, theme = THEMES.DARK }) => {
  const { userPubkey, userName } = route.params;
  
  const [profile, setProfile] = useState(null);
  const [userPosts, setUserPosts] = useState([]);
  const [userReplies, setUserReplies] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [postsLoading, setPostsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('posts'); // 'posts', 'replies'
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  
  // Interaction state
  const [likedPosts, setLikedPosts] = useState(new Set());
  const [repostedPosts, setRepostedPosts] = useState(new Set());
  const [actionInProgress, setActionInProgress] = useState(new Set());
  const [postInteractions, setPostInteractions] = useState({
    likes: new Map(),
    reposts: new Map(),
    replies: new Map()
  });
  const [userProfiles, setUserProfiles] = useState(new Map());

  useEffect(() => {
    navigation.setOptions({
      title: profile?.name || profile?.display_name || userName || 'Profile',
      headerBackTitleVisible: false,
    });
  }, [profile, userName]);

  useEffect(() => {
    loadUserProfile();
    loadUserPosts(); // This now handles both posts and replies
    loadUserInteractions();
    loadFollowInfo();
    checkIfFollowing();
  }, [userPubkey]);

  const loadUserProfile = async () => {
    try {
      setLoading(true);
      const profileData = await nostrService.getUserProfile(userPubkey);
      setProfile(profileData);
      
      // Update navigation title when profile loads
      if (profileData) {
        navigation.setOptions({
          title: profileData.name || profileData.display_name || userName || 'Profile'
        });
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
      Alert.alert('Error', 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const loadUserPosts = async () => {
    try {
      setPostsLoading(true);
      console.log('🔄 Loading posts for user:', userPubkey.substring(0, 8) + '...');
      
      // Get ALL posts (including replies) from the service
      const allPosts = await nostrService.getUserPosts(userPubkey, 500);
      console.log('📊 Total posts received from service:', allPosts.length);
      
      // Separate posts and replies
      const mainPosts = [];
      const replies = [];
      
      allPosts.forEach(post => {
        const replyTag = post.tags?.find(tag => tag[0] === 'e');
        if (replyTag) {
          replies.push(post);
        } else {
          mainPosts.push(post);
        }
      });
      
      console.log('📝 Main posts:', mainPosts.length, 'Replies:', replies.length);
      
      // Set both at the same time to avoid double API calls
      setUserPosts(mainPosts);
      setUserReplies(replies);
      
      // Load interaction counts for all posts
      const allPostIds = allPosts.map(post => post.id);
      if (allPostIds.length > 0) {
        console.log('📊 Loading interactions for', allPostIds.length, 'posts...');
        const interactions = await nostrService.getPostInteractions(allPostIds);
        setPostInteractions(interactions);
      }
    } catch (error) {
      console.error('Error loading user posts:', error);
    } finally {
      setPostsLoading(false);
    }
  };

  const loadUserReplies = async () => {
    // This is now handled in loadUserPosts to avoid duplicate API calls
    console.log('📝 Replies already loaded in loadUserPosts');
  };

  const loadFollowInfo = async () => {
    try {
      // Load user's following list
      const userFollowing = await nostrService.getUserContacts(userPubkey);
      setFollowing(userFollowing);
      setFollowingCount(userFollowing.length);

      // Load followers (users who follow this user)
      const userFollowers = await nostrService.getUserFollowers(userPubkey);
      setFollowers(userFollowers);
      setFollowersCount(userFollowers.length);
    } catch (error) {
      console.error('Error loading follow info:', error);
    }
  };

  const checkIfFollowing = async () => {
    try {
      const currentUserPubkey = await AsyncStorage.getItem('nostr_public_key');
      if (currentUserPubkey && currentUserPubkey !== userPubkey) {
        const currentUserFollowing = await nostrService.getUserContacts(currentUserPubkey);
        setIsFollowing(currentUserFollowing.includes(userPubkey));
      }
    } catch (error) {
      console.error('Error checking follow status:', error);
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

  const handleFollowToggle = async () => {
    try {
      if (isFollowing) {
        await nostrService.unfollowUser(userPubkey);
        setIsFollowing(false);
        setFollowersCount(prev => Math.max(0, prev - 1));
      } else {
        await nostrService.followUser(userPubkey);
        setIsFollowing(true);
        setFollowersCount(prev => prev + 1);
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
      Alert.alert('Error', `Failed to ${isFollowing ? 'unfollow' : 'follow'} user`);
    }
  };

  const handleLikePost = async (post) => {
    if (actionInProgress.has(post.id)) return;
    
    try {
      setActionInProgress(prev => new Set(prev).add(post.id));
      
      if (likedPosts.has(post.id)) {
        await nostrService.unlikePost(post.id, post.pubkey);
        const newLikedPosts = new Set(likedPosts);
        newLikedPosts.delete(post.id);
        setLikedPosts(newLikedPosts);
        
        setPostInteractions(prev => {
          const newInteractions = { ...prev };
          const currentLikes = newInteractions.likes.get(post.id) || { count: 0, userLiked: false };
          newInteractions.likes.set(post.id, {
            ...currentLikes,
            userLiked: false,
            count: Math.max(0, currentLikes.count - 1)
          });
          return newInteractions;
        });
      } else {
        await nostrService.likePost(post.id, post.pubkey);
        const newLikedPosts = new Set(likedPosts).add(post.id);
        setLikedPosts(newLikedPosts);
        
        setPostInteractions(prev => {
          const newInteractions = { ...prev };
          const currentLikes = newInteractions.likes.get(post.id) || { count: 0, userLiked: false };
          newInteractions.likes.set(post.id, {
            ...currentLikes,
            userLiked: true,
            count: currentLikes.count + 1
          });
          return newInteractions;
        });
      }
    } catch (error) {
      console.error('Error liking post:', error);
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
    
    try {
      setActionInProgress(prev => new Set(prev).add(post.id));
      await nostrService.repostPost(post.id, post.pubkey, '');
      const newRepostedPosts = new Set(repostedPosts).add(post.id);
      setRepostedPosts(newRepostedPosts);
      Alert.alert('Success', 'Post reposted!');
    } catch (error) {
      console.error('Error reposting post:', error);
      Alert.alert('Error', `Failed to repost: ${error.message}`);
    } finally {
      setActionInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(post.id);
        return newSet;
      });
    }
  };

  const navigateToPostDetail = (post) => {
    navigation.navigate('PostDetail', {
      post,
      userProfiles
    });
  };

  const navigateToFollowList = (type) => {
    navigation.navigate('FollowList', {
      userPubkey,
      userName: profile?.name || profile?.display_name || userName || 'Unknown User',
      type // 'following' or 'followers'
    });
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
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });
  };

  const renderPost = (post) => {
    const images = extractImages(post.content);
    const textContent = removeImageUrls(post.content);
    
    const likesData = postInteractions.likes.get(post.id) || { count: 0, userLiked: false };
    const repostsData = postInteractions.reposts.get(post.id) || { count: 0, userReposted: false };
    const repliesData = postInteractions.replies.get(post.id) || { count: 0 };
    
    const isLiked = likesData.userLiked || likedPosts.has(post.id);
    const isReposted = repostsData.userReposted || repostedPosts.has(post.id);
    
    return (
      <TouchableOpacity 
        key={post.id} 
        style={[styles.post, { backgroundColor: theme.cardBackgroundColor }]}
        onPress={() => navigateToPostDetail(post)}
        activeOpacity={0.95}
      >
        <View style={styles.postHeader}>
          <Text style={[styles.postDate, { color: theme.secondaryTextColor }]}>
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
                style={[styles.postImage, { maxWidth: screenWidth - 32 }]}
                resizeMode="contain"
              />
            ))}
          </View>
        )}
        
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
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => {}} // Reply functionality
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
      </TouchableOpacity>
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadUserProfile(),
      loadUserPosts(), // This now handles both posts and replies
      loadFollowInfo(),
      checkIfFollowing()
    ]);
    setRefreshing(false);
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

  const currentData = activeTab === 'posts' ? userPosts : userReplies;

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
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primaryColor}
          />
        }
      >
        {/* Banner Image */}
        <View style={styles.bannerContainer}>
          {profile?.banner ? (
            <Image source={{ uri: profile.banner }} style={styles.banner} />
          ) : (
            <View style={[styles.bannerPlaceholder, { backgroundColor: theme.surfaceColor }]} />
          )}
        </View>

        {/* Profile Header */}
        <View style={[styles.profileSection, { backgroundColor: theme.backgroundColor }]}>
          {/* Avatar */}
          <View style={styles.avatarContainer}>
            {profile?.picture ? (
              <Image source={{ uri: profile.picture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: theme.primaryColor }]}>
                <Ionicons name="person" size={40} color="white" />
              </View>
            )}
          </View>

          {/* Follow Button */}
          <View style={styles.actionButtonContainer}>
            <TouchableOpacity
              style={[
                styles.followButton,
                {
                  backgroundColor: isFollowing ? theme.borderColor : theme.primaryColor,
                  borderColor: theme.primaryColor
                }
              ]}
              onPress={handleFollowToggle}
            >
              <Text style={[
                styles.followButtonText,
                { color: isFollowing ? theme.textColor : 'white' }
              ]}>
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Profile Info */}
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: theme.textColor }]}>
              {profile?.name || profile?.display_name || 'Unknown User'}
            </Text>
            <Text style={[styles.profileUsername, { color: theme.secondaryTextColor }]}>
              {userPubkey.substring(0, 16)}...
            </Text>
            
            {profile?.about && (
              <Text style={[styles.profileBio, { color: theme.textColor }]}>
                {profile.about}
              </Text>
            )}

            {/* Profile Fields */}
            <View style={styles.profileFields}>
              {profile?.website && (
                <View style={styles.profileField}>
                  <Ionicons name="link-outline" size={16} color={theme.secondaryTextColor} />
                  <Text style={[styles.profileFieldText, { color: theme.primaryColor }]}>
                    {profile.website}
                  </Text>
                </View>
              )}
              
              {profile?.nip05 && (
                <View style={styles.profileField}>
                  <Ionicons name="at-outline" size={16} color={theme.secondaryTextColor} />
                  <Text style={[styles.profileFieldText, { color: theme.secondaryTextColor }]}>
                    {profile.nip05}
                  </Text>
                </View>
              )}
            </View>

            {/* Follow Stats */}
            <View style={styles.followStats}>
              <TouchableOpacity 
                style={styles.followStat}
                onPress={() => navigateToFollowList('following')}
                activeOpacity={0.7}
              >
                <Text style={[styles.followCount, { color: theme.textColor }]}>
                  {followingCount}
                </Text>
                <Text style={[styles.followLabel, { color: theme.secondaryTextColor }]}>
                  Following
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.followStat}
                onPress={() => navigateToFollowList('followers')}
                activeOpacity={0.7}
              >
                <Text style={[styles.followCount, { color: theme.textColor }]}>
                  {followersCount}
                </Text>
                <Text style={[styles.followLabel, { color: theme.secondaryTextColor }]}>
                  Followers
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Tabs */}
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === 'posts' && styles.activeTab,
                { borderBottomColor: theme.primaryColor }
              ]}
              onPress={() => setActiveTab('posts')}
            >
              <Text style={[
                styles.tabText,
                { color: activeTab === 'posts' ? theme.primaryColor : theme.secondaryTextColor }
              ]}>
                Posts ({userPosts.length})
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === 'replies' && styles.activeTab,
                { borderBottomColor: theme.primaryColor }
              ]}
              onPress={() => setActiveTab('replies')}
            >
              <Text style={[
                styles.tabText,
                { color: activeTab === 'replies' ? theme.primaryColor : theme.secondaryTextColor }
              ]}>
                Replies ({userReplies.length})
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Posts/Replies Content */}
        <View style={styles.postsContainer}>
          {postsLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.primaryColor} />
              <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
                Loading {activeTab}...
              </Text>
            </View>
          ) : currentData.length > 0 ? (
            currentData.map(post => renderPost(post))
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons 
                name={activeTab === 'posts' ? "document-outline" : "chatbubble-outline"} 
                size={64} 
                color={theme.secondaryTextColor} 
              />
              <Text style={[styles.emptyTitle, { color: theme.textColor }]}>
                No {activeTab} yet
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.secondaryTextColor }]}>
                {activeTab === 'posts' 
                  ? 'This user hasn\'t posted anything yet' 
                  : 'This user hasn\'t replied to any posts yet'
                }
              </Text>
            </View>
          )}
        </View>
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
  bannerContainer: {
    height: 200,
    width: '100%',
  },
  banner: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  bannerPlaceholder: {
    width: '100%',
    height: '100%',
  },
  profileSection: {
    marginTop: -40, // Overlap with banner
    paddingHorizontal: 16,
    paddingBottom: 0,
  },
  avatarContainer: {
    marginBottom: 12,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: 'white',
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonContainer: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  followButton: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  followButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  profileInfo: {
    marginTop: 8,
    marginBottom: 16,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  profileUsername: {
    fontSize: 15,
    marginBottom: 12,
  },
  profileBio: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 12,
  },
  profileFields: {
    marginBottom: 12,
  },
  profileField: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  profileFieldText: {
    fontSize: 15,
  },
  followStats: {
    flexDirection: 'row',
    gap: 20,
  },
  followStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  followCount: {
    fontSize: 15,
    fontWeight: '700',
  },
  followLabel: {
    fontSize: 15,
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    marginTop: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
  },
  postsContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  post: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.3)',
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  postDate: {
    fontSize: 14,
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
    minHeight: 200,
    maxHeight: 400,
    borderRadius: 8,
    marginBottom: 8,
  },
  postFooter: {
    flexDirection: 'row',
    gap: 24,
    paddingTop: 8,
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
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default UserProfileScreen;