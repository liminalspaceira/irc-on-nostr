import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Image,
  Modal
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nostrService } from '../services/NostrService';
import { nostrUtils } from '../utils/nostrUtils';
import { STORAGE_KEYS, THEMES, EVENT_KINDS } from '../utils/constants';

const ProfileScreen = ({ navigation, theme = THEMES.DARK }) => {
  const [publicKey, setPublicKey] = useState('');
  const [profile, setProfile] = useState({
    name: '',
    about: '',
    picture: '',
    nip05: '',
    website: ''
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedProfile, setEditedProfile] = useState({});
  const [following, setFollowing] = useState([]);
  const [followingProfiles, setFollowingProfiles] = useState(new Map());
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(false);
  const [followers, setFollowers] = useState([]);
  const [followerProfiles, setFollowerProfiles] = useState(new Map());
  const [isLoadingFollowers, setIsLoadingFollowers] = useState(false);
  const [unfollowModalVisible, setUnfollowModalVisible] = useState(false);
  const [userToUnfollow, setUserToUnfollow] = useState(null);

  useEffect(() => {
    loadProfile();
    loadFollowing();
    loadFollowers();
  }, []);

  const loadProfile = async () => {
    try {
      const storedPublicKey = await AsyncStorage.getItem(STORAGE_KEYS.PUBLIC_KEY);
      const storedProfile = await AsyncStorage.getItem(STORAGE_KEYS.PROFILE);
      
      console.log('📝 Loading profile...');
      console.log('🔑 Public key:', storedPublicKey?.substring(0, 8) + '...');
      
      if (storedPublicKey) {
        setPublicKey(storedPublicKey);
        
        // Try to load profile from storage first
        if (storedProfile) {
          const parsedProfile = JSON.parse(storedProfile);
          console.log('💽 Loaded profile from storage:', parsedProfile);
          setProfile(parsedProfile);
          setEditedProfile(parsedProfile);
        }
        
        // Then try to fetch from Nostr
        try {
          const nostrProfile = await nostrService.queryUserProfile(storedPublicKey);
          if (nostrProfile) {
            console.log('📡 Fetched profile from Nostr:', nostrProfile);
            setProfile(nostrProfile);
            setEditedProfile(nostrProfile);
            await AsyncStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(nostrProfile));
          }
        } catch (error) {
          console.error('Failed to fetch profile from Nostr:', error);
        }
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  const loadFollowing = async () => {
    try {
      const storedPublicKey = await AsyncStorage.getItem(STORAGE_KEYS.PUBLIC_KEY);
      if (!storedPublicKey) return;

      setIsLoadingFollowing(true);
      
      // Get the user's contact list
      const contacts = await nostrService.getUserContacts(storedPublicKey);
      setFollowing(contacts);

      if (contacts.length > 0) {
        // Get profiles for all contacts
        const profiles = await nostrService.getMultipleUserProfiles(contacts);
        setFollowingProfiles(profiles);
        
        console.log(`Loaded ${contacts.length} contacts, got ${profiles.size} profiles`);
      }
    } catch (error) {
      console.error('Error loading following:', error);
    } finally {
      setIsLoadingFollowing(false);
    }
  };

  const loadFollowers = async () => {
    try {
      const storedPublicKey = await AsyncStorage.getItem(STORAGE_KEYS.PUBLIC_KEY);
      if (!storedPublicKey) return;

      setIsLoadingFollowers(true);
      
      // Get users who follow this user
      const followersList = await nostrService.getUserFollowers(storedPublicKey);
      setFollowers(followersList);

      if (followersList.length > 0) {
        // Get profiles for all followers
        const profiles = await nostrService.getMultipleUserProfiles(followersList);
        setFollowerProfiles(profiles);
        
        console.log(`Loaded ${followersList.length} followers, got ${profiles.size} profiles`);
      }
    } catch (error) {
      console.error('Error loading followers:', error);
    } finally {
      setIsLoadingFollowers(false);
    }
  };

  const saveProfile = async () => {
    if (!editedProfile.name?.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }

    try {
      setIsSaving(true);
      console.log('💾 Saving profile:', editedProfile);
      
      // Create Nostr profile event
      const profileEvent = nostrUtils.createEvent(
        EVENT_KINDS.METADATA,
        JSON.stringify(editedProfile)
      );
      
      // Publish to Nostr
      await nostrService.publishEvent(profileEvent);
      console.log('📡 Profile published to Nostr');
      
      // Save locally
      await AsyncStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(editedProfile));
      console.log('💽 Profile saved locally');
      
      // Update profile state immediately
      setProfile({ ...editedProfile });
      setIsEditing(false);
      
      console.log('✅ Profile state updated:', editedProfile);
      Alert.alert('Success', 'Profile updated successfully!');
    } catch (error) {
      console.error('Error saving profile:', error);
      Alert.alert('Error', 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditedProfile(profile);
    setIsEditing(false);
  };

  const updateField = (field, value) => {
    setEditedProfile(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Log when picture URL is being updated for debugging
    if (field === 'picture') {
      console.log('🖼️ Profile picture URL updated:', value);
    }
  };

  const showAlert = (title, message, buttons = []) => {
    if (typeof window !== 'undefined') {
      // Web environment - use modal for confirmation dialogs
      if (buttons.length > 1) {
        return false; // Indicates to use modal instead
      } else {
        alert(`${title}\n\n${message}`);
        return true;
      }
    } else {
      // React Native environment
      Alert.alert(title, message, buttons.length > 0 ? buttons : [{ text: 'OK' }]);
      return true;
    }
  };

  const copyPublicKey = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(publicKey);
      showAlert('Copied', 'Public key copied to clipboard');
    }
  };

  const handleUnfollowPress = (pubkey, userName) => {
    console.log('👋 Unfollow button pressed for:', userName);
    const userInfo = { pubkey, name: userName };
    setUserToUnfollow(userInfo);
    
    // Try using native alert first, fallback to modal if needed
    const alertShown = showAlert(
      'Unfollow User',
      `Are you sure you want to unfollow ${userName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unfollow', style: 'destructive', onPress: () => confirmUnfollow(userInfo) }
      ]
    );
    
    if (!alertShown) {
      // Use modal for web
      setUnfollowModalVisible(true);
    }
  };

  const confirmUnfollow = async (userInfo) => {
    try {
      console.log('🚫 Unfollowing user:', userInfo.name);
      
      // Remove from following list
      const updatedFollowing = following.filter(pubkey => pubkey !== userInfo.pubkey);
      setFollowing(updatedFollowing);
      
      // Remove from profiles map
      const updatedProfiles = new Map(followingProfiles);
      updatedProfiles.delete(userInfo.pubkey);
      setFollowingProfiles(updatedProfiles);
      
      // Update contacts list on Nostr
      const contactsEvent = nostrUtils.createEvent(
        EVENT_KINDS.CONTACTS,
        '',
        updatedFollowing.map(pubkey => ['p', pubkey])
      );
      
      await nostrService.publishEvent(contactsEvent);
      console.log('✅ Updated contacts list published to Nostr');
      
      showAlert('Success', `You have unfollowed ${userInfo.name}`);
      
    } catch (error) {
      console.error('❌ Error unfollowing user:', error);
      showAlert('Error', 'Failed to unfollow user');
      
      // Revert the UI changes on error
      loadFollowing();
    } finally {
      setUnfollowModalVisible(false);
      setUserToUnfollow(null);
    }
  };

  const navigateToUserProfile = (userPubkey, userName) => {
    if (navigation) {
      console.log('👤 Navigating to user profile:', userName, userPubkey.substring(0, 8) + '...');
      navigation.navigate('UserProfile', {
        userPubkey,
        userName: userName || 'Unknown User'
      });
    }
  };

  const renderProfileField = (label, field, placeholder, multiline = false) => {
    const value = isEditing ? editedProfile[field] || '' : profile[field] || '';
    
    if (isEditing) {
      return (
        <View style={styles.fieldContainer}>
          <Text style={[styles.fieldLabel, { color: theme.textColor }]}>{label}</Text>
          <TextInput
            style={[styles.fieldInput, { 
              backgroundColor: theme.surfaceColor,
              color: theme.textColor,
              borderColor: theme.borderColor,
              height: multiline ? 80 : 44
            }]}
            value={value}
            onChangeText={(text) => updateField(field, text)}
            placeholder={placeholder}
            placeholderTextColor={theme.secondaryTextColor}
            multiline={multiline}
            textAlignVertical={multiline ? 'top' : 'center'}
          />
        </View>
      );
    }

    return (
      <View style={styles.fieldContainer}>
        <Text style={[styles.fieldLabel, { color: theme.textColor }]}>{label}</Text>
        <Text style={[styles.fieldValue, { color: value ? theme.textColor : theme.secondaryTextColor }]}>
          {value || `No ${label.toLowerCase()} set`}
        </Text>
      </View>
    );
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.backgroundColor }]}>
      <View style={[styles.header, { backgroundColor: theme.cardBackgroundColor }]}>
        <View style={styles.avatarContainer}>
          {/* Show editedProfile picture if editing and has value, otherwise use saved profile picture */}
          {(isEditing ? editedProfile.picture : profile.picture) ? (
            <Image 
              source={{ uri: isEditing ? editedProfile.picture : profile.picture }} 
              style={styles.avatar}
              onError={(error) => {
                console.log('❌ Error loading profile image:', error.nativeEvent.error);
              }}
              onLoad={() => {
                console.log('✅ Profile image loaded successfully');
              }}
            />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: theme.primaryColor }]}>
              <Ionicons name="person" size={40} color="white" />
            </View>
          )}
        </View>
        
        <View style={styles.headerInfo}>
          <Text style={[styles.displayName, { color: theme.textColor }]}>
            {profile.name || 'Unnamed User'}
          </Text>
          <TouchableOpacity onPress={copyPublicKey} style={styles.publicKeyContainer}>
            <Text style={[styles.publicKey, { color: theme.secondaryTextColor }]}>
              {publicKey ? `${publicKey.substring(0, 16)}...` : 'No key'}
            </Text>
            <Ionicons name="copy" size={16} color={theme.secondaryTextColor} />
          </TouchableOpacity>
        </View>
        
        <TouchableOpacity
          style={[styles.editButton, { backgroundColor: theme.primaryColor }]}
          onPress={() => setIsEditing(!isEditing)}
        >
          <Ionicons name={isEditing ? "close" : "pencil"} size={20} color="white" />
        </TouchableOpacity>
      </View>

      <View style={[styles.content, { backgroundColor: theme.cardBackgroundColor }]}>
        <Text style={[styles.sectionTitle, { color: theme.textColor }]}>
          Profile Information
        </Text>
        
        {renderProfileField('Name', 'name', 'Your display name')}
        {renderProfileField('About', 'about', 'Tell people about yourself...', true)}
        {renderProfileField('Website', 'website', 'https://yourwebsite.com')}
        {renderProfileField('Profile Picture', 'picture', 'https://example.com/avatar.jpg')}
        {renderProfileField('NIP-05 Identifier', 'nip05', 'name@domain.com')}

        {isEditing && (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.borderColor }]}
              onPress={cancelEdit}
            >
              <Text style={[styles.actionButtonText, { color: theme.textColor }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.actionButton, { 
                backgroundColor: isSaving ? theme.borderColor : theme.primaryColor 
              }]}
              onPress={saveProfile}
              disabled={isSaving}
            >
              <Text style={[styles.actionButtonText, { color: 'white' }]}>
                {isSaving ? 'Saving...' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={[styles.content, { backgroundColor: theme.cardBackgroundColor }]}>
        <View style={styles.followingSectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.textColor }]}>
            Following ({following.length})
          </Text>
          {isLoadingFollowing && (
            <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
              Loading...
            </Text>
          )}
        </View>
        
        {following.length > 0 ? (
          <View style={styles.followingGrid}>
            {following.map((pubkey) => {
              const profile = followingProfiles.get(pubkey);
              return (
                <View key={pubkey} style={[styles.followingItem, { backgroundColor: theme.surfaceColor }]}>
                  <TouchableOpacity
                    style={styles.followingUserInfo}
                    onPress={() => navigateToUserProfile(pubkey, profile?.name || profile?.display_name)}
                  >
                    <View style={styles.followingAvatar}>
                      {profile?.picture ? (
                        <Image source={{ uri: profile.picture }} style={styles.followingAvatarImage} />
                      ) : (
                        <View style={[styles.followingAvatarPlaceholder, { backgroundColor: theme.primaryColor }]}>
                          <Ionicons name="person" size={20} color="white" />
                        </View>
                      )}
                    </View>
                    <View style={styles.followingInfo}>
                      <Text style={[styles.followingName, { color: theme.textColor }]} numberOfLines={1}>
                        {profile?.name || profile?.display_name || 'Unnamed'}
                      </Text>
                      <Text style={[styles.followingPubkey, { color: theme.secondaryTextColor }]} numberOfLines={1}>
                        {pubkey.substring(0, 8)}...
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.unfollowButton, { backgroundColor: theme.errorColor }]}
                    onPress={() => handleUnfollowPress(pubkey, profile?.name || profile?.display_name || 'Unnamed')}
                  >
                    <Ionicons name="person-remove" size={16} color="white" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ) : (
          !isLoadingFollowing && (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={48} color={theme.secondaryTextColor} />
              <Text style={[styles.emptyStateText, { color: theme.secondaryTextColor }]}>
                You're not following anyone yet
              </Text>
              <Text style={[styles.emptyStateSubtext, { color: theme.secondaryTextColor }]}>
                Start following people to see them here
              </Text>
            </View>
          )
        )}
      </View>

      <View style={[styles.content, { backgroundColor: theme.cardBackgroundColor }]}>
        <View style={styles.followingSectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.textColor }]}>
            Followers ({followers.length})
          </Text>
          {isLoadingFollowers && (
            <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
              Loading...
            </Text>
          )}
        </View>
        
        {followers.length > 0 ? (
          <View style={styles.followingGrid}>
            {followers.map((pubkey) => {
              const profile = followerProfiles.get(pubkey);
              return (
                <TouchableOpacity
                  key={pubkey}
                  style={[styles.followingItem, { backgroundColor: theme.surfaceColor }]}
                  onPress={() => navigateToUserProfile(pubkey, profile?.name || profile?.display_name)}
                >
                  <View style={styles.followingAvatar}>
                    {profile?.picture ? (
                      <Image source={{ uri: profile.picture }} style={styles.followingAvatarImage} />
                    ) : (
                      <View style={[styles.followingAvatarPlaceholder, { backgroundColor: theme.primaryColor }]}>
                        <Ionicons name="person" size={20} color="white" />
                      </View>
                    )}
                  </View>
                  <View style={styles.followingInfo}>
                    <Text style={[styles.followingName, { color: theme.textColor }]} numberOfLines={1}>
                      {profile?.name || profile?.display_name || 'Unnamed'}
                    </Text>
                    <Text style={[styles.followingPubkey, { color: theme.secondaryTextColor }]} numberOfLines={1}>
                      {pubkey.substring(0, 8)}...
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          !isLoadingFollowers && (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={48} color={theme.secondaryTextColor} />
              <Text style={[styles.emptyStateText, { color: theme.secondaryTextColor }]}>
                No followers yet
              </Text>
              <Text style={[styles.emptyStateSubtext, { color: theme.secondaryTextColor }]}>
                Share your profile to get followers
              </Text>
            </View>
          )
        )}
      </View>

      <View style={[styles.infoCard, { backgroundColor: theme.cardBackgroundColor }]}>
        <Ionicons name="information-circle" size={24} color={theme.primaryColor} />
        <View style={styles.infoContent}>
          <Text style={[styles.infoTitle, { color: theme.textColor }]}>
            About Nostr Profiles
          </Text>
          <Text style={[styles.infoText, { color: theme.secondaryTextColor }]}>
            Your profile is stored on the Nostr network and can be seen by anyone. 
            Changes may take a few moments to propagate across relays.
          </Text>
        </View>
      </View>

      {/* Unfollow Confirmation Modal */}
      <Modal
        visible={unfollowModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setUnfollowModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: theme.cardBackgroundColor }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="person-remove" size={48} color={theme.errorColor} />
              <Text style={[styles.modalTitle, { color: theme.textColor }]}>
                Unfollow User
              </Text>
            </View>
            
            <Text style={[styles.modalMessage, { color: theme.secondaryTextColor }]}>
              Are you sure you want to unfollow {userToUnfollow?.name}? You won't see their posts in your feed anymore.
            </Text>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: theme.borderColor }]}
                onPress={() => {
                  setUnfollowModalVisible(false);
                  setUserToUnfollow(null);
                }}
              >
                <Text style={[styles.modalButtonText, { color: theme.textColor }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: theme.errorColor }]}
                onPress={() => confirmUnfollow(userToUnfollow)}
              >
                <Text style={[styles.modalButtonText, { color: 'white' }]}>
                  Unfollow
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
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
  headerInfo: {
    flex: 1,
  },
  displayName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  publicKeyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  publicKey: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginRight: 8,
  },
  editButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  fieldContainer: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  fieldValue: {
    fontSize: 16,
    lineHeight: 22,
  },
  fieldInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  infoCard: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    alignItems: 'flex-start',
  },
  infoContent: {
    flex: 1,
    marginLeft: 12,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
  },
  followingSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  followingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  followingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    minWidth: '48%',
    flexBasis: '48%',
    maxWidth: '48%',
    position: 'relative',
  },
  followingAvatar: {
    marginRight: 12,
  },
  followingAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  followingAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  followingUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  followingInfo: {
    flex: 1,
    marginRight: 8,
  },
  followingName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  followingPubkey: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  unfollowButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 12,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
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
});

export default ProfileScreen;