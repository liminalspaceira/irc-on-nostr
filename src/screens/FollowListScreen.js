import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrService } from '../services/NostrService';
import { THEMES } from '../utils/constants';

const FollowListScreen = ({ route, navigation, theme = THEMES.DARK }) => {
  const { userPubkey, userName, type } = route.params; // type: 'following' or 'followers'
  
  const [users, setUsers] = useState([]);
  const [userProfiles, setUserProfiles] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      title: type === 'following' ? `Following` : `Followers`,
      headerBackTitleVisible: false,
    });
    
    loadUserList();
  }, []);

  const loadUserList = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      console.log(`📋 Loading ${type} for user:`, userPubkey.substring(0, 8) + '...');

      let userList = [];
      if (type === 'following') {
        userList = await nostrService.getFollowing(userPubkey);
      } else {
        userList = await nostrService.getFollowers(userPubkey);
      }

      console.log(`✅ Found ${userList.length} ${type}`);
      setUsers(userList);

      // Load profiles for all users
      if (userList.length > 0) {
        console.log(`📊 Loading profiles for ${userList.length} users...`);
        const profilesMap = new Map();
        
        for (const pubkey of userList) {
          try {
            const profile = await nostrService.getUserProfile(pubkey);
            if (profile) {
              profilesMap.set(pubkey, profile);
            }
          } catch (error) {
            console.error(`Error loading profile for ${pubkey.substring(0, 8)}:`, error);
          }
        }
        
        setUserProfiles(profilesMap);
        console.log(`✅ Loaded ${profilesMap.size} profiles`);
      }
    } catch (error) {
      console.error(`Error loading ${type}:`, error);
      Alert.alert('Error', `Failed to load ${type}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const navigateToUserProfile = (userPubkey, userName) => {
    navigation.push('UserProfile', {
      userPubkey,
      userName: userName || 'Unknown User'
    });
  };

  const renderUser = (userPubkey) => {
    const profile = userProfiles.get(userPubkey);
    
    return (
      <TouchableOpacity
        key={userPubkey}
        style={[styles.userItem, { backgroundColor: theme.cardBackgroundColor }]}
        onPress={() => navigateToUserProfile(userPubkey, profile?.name || profile?.display_name)}
        activeOpacity={0.7}
      >
        <View style={styles.userInfo}>
          {profile?.picture ? (
            <Image source={{ uri: profile.picture }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: theme.primaryColor }]}>
              <Ionicons name="person" size={20} color="white" />
            </View>
          )}
          <View style={styles.userDetails}>
            <Text style={[styles.userName, { color: theme.textColor }]}>
              {profile?.name || profile?.display_name || 'Unknown User'}
            </Text>
            <Text style={[styles.userPubkey, { color: theme.secondaryTextColor }]}>
              {userPubkey.substring(0, 16)}...
            </Text>
            {profile?.about && (
              <Text 
                style={[styles.userBio, { color: theme.secondaryTextColor }]}
                numberOfLines={2}
              >
                {profile.about}
              </Text>
            )}
          </View>
        </View>
        <Ionicons 
          name="chevron-forward" 
          size={20} 
          color={theme.secondaryTextColor} 
        />
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: theme.backgroundColor }]}>
        <ActivityIndicator size="large" color={theme.primaryColor} />
        <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
          Loading {type}...
        </Text>
      </View>
    );
  }

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={[styles.headerTitle, { color: theme.textColor }]}>
        {type === 'following' ? 'Following' : 'Followers'}
      </Text>
      <Text style={[styles.headerSubtitle, { color: theme.secondaryTextColor }]}>
        {users.length} {type === 'following' ? 'people' : 'followers'}
      </Text>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Ionicons 
        name={type === 'following' ? "people-outline" : "person-add-outline"} 
        size={64} 
        color={theme.secondaryTextColor} 
      />
      <Text style={[styles.emptyTitle, { color: theme.textColor }]}>
        No {type} yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: theme.secondaryTextColor }]}>
        {type === 'following' 
          ? "This user isn't following anyone yet" 
          : "This user doesn't have any followers yet"
        }
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundColor }]}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadUserList(true)}
            tintColor={theme.primaryColor}
          />
        }
      >
        {renderHeader()}
        {users.length > 0 ? (
          <View style={styles.usersList}>
            {users.map(userPubkey => renderUser(userPubkey))}
          </View>
        ) : (
          renderEmpty()
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
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(55, 65, 81, 0.1)',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    opacity: 0.8,
  },
  usersList: {
    paddingHorizontal: 16,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.1)',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  userPubkey: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  userBio: {
    fontSize: 14,
    lineHeight: 18,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
});

export default FollowListScreen;