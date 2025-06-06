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
  FlatList
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrService } from '../services/NostrService';
import { THEMES } from '../utils/constants';

const UserProfileScreen = ({ route, navigation, theme = THEMES.DARK }) => {
  const { userPubkey, userName } = route.params;
  
  const [profile, setProfile] = useState(null);
  const [userPosts, setUserPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [postsLoading, setPostsLoading] = useState(true);

  useEffect(() => {
    loadUserProfile();
    loadUserPosts();
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

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadUserProfile(), loadUserPosts()]);
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
    
    return (
      <View style={[styles.post, { backgroundColor: theme.cardBackgroundColor }]}>
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
    <View style={[styles.container, { backgroundColor: theme.backgroundColor }]}>
      {/* Profile Header */}
      <View style={[styles.profileHeader, { backgroundColor: theme.cardBackgroundColor }]}>
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
          <FlatList
            data={userPosts}
            renderItem={renderPost}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.primaryColor}
              />
            }
            showsVerticalScrollIndicator={false}
          />
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
    marginTop: 16,
    fontSize: 16,
  },
  profileHeader: {
    flexDirection: 'row',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(55, 65, 81, 0.3)',
  },
  avatarContainer: {
    marginRight: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  profilePubkey: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  profileAbout: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  profileField: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  profileFieldText: {
    fontSize: 12,
    marginLeft: 6,
  },
  postsSection: {
    flex: 1,
    padding: 16,
  },
  postsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  postsLoading: {
    padding: 20,
    alignItems: 'center',
  },
  post: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.3)',
  },
  postHeader: {
    marginBottom: 8,
  },
  timestamp: {
    fontSize: 12,
  },
  postContent: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 8,
  },
  imageContainer: {
    marginTop: 8,
  },
  postImage: {
    width: '100%',
    minHeight: 200,
    maxHeight: 400,
    borderRadius: 8,
    marginBottom: 8,
  },
  emptyPosts: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
});

export default UserProfileScreen;