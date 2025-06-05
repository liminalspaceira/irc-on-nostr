import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Image
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nostrService } from '../services/NostrService';
import { nostrUtils } from '../utils/nostrUtils';
import { STORAGE_KEYS, THEMES, EVENT_KINDS } from '../utils/constants';

const ProfileScreen = ({ theme = THEMES.DARK }) => {
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

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const storedPublicKey = await AsyncStorage.getItem(STORAGE_KEYS.PUBLIC_KEY);
      const storedProfile = await AsyncStorage.getItem(STORAGE_KEYS.PROFILE);
      
      if (storedPublicKey) {
        setPublicKey(storedPublicKey);
        
        // Try to load profile from storage first
        if (storedProfile) {
          const parsedProfile = JSON.parse(storedProfile);
          setProfile(parsedProfile);
          setEditedProfile(parsedProfile);
        }
        
        // Then try to fetch from Nostr
        try {
          const nostrProfile = await nostrService.queryUserProfile(storedPublicKey);
          if (nostrProfile) {
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

  const saveProfile = async () => {
    if (!editedProfile.name?.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }

    try {
      setIsSaving(true);
      
      // Create Nostr profile event
      const profileEvent = nostrUtils.createEvent(
        EVENT_KINDS.METADATA,
        JSON.stringify(editedProfile)
      );
      
      // Publish to Nostr
      await nostrService.publishEvent(profileEvent);
      
      // Save locally
      await AsyncStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(editedProfile));
      
      setProfile(editedProfile);
      setIsEditing(false);
      
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
  };

  const copyPublicKey = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(publicKey);
      Alert.alert('Copied', 'Public key copied to clipboard');
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
          {profile.picture ? (
            <Image source={{ uri: profile.picture }} style={styles.avatar} />
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
});

export default ProfileScreen;