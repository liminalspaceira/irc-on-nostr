import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrService } from '../services/NostrService';
import { THEMES } from '../utils/constants';

const CreateChannelScreen = ({ navigation, theme = THEMES.DARK }) => {
  const [channelName, setChannelName] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [channelPicture, setChannelPicture] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const validateChannelName = (name) => {
    // Remove # if user types it
    const cleanName = name.replace(/^#/, '');
    
    // Check if name is valid (alphanumeric, underscore, hyphen)
    const isValid = /^[a-zA-Z0-9_-]+$/.test(cleanName);
    
    return { cleanName, isValid };
  };

  const createChannel = async () => {
    const { cleanName, isValid } = validateChannelName(channelName);
    
    if (!cleanName.trim()) {
      Alert.alert('Error', 'Please enter a channel name');
      return;
    }
    
    if (!isValid) {
      Alert.alert(
        'Invalid Name', 
        'Channel name can only contain letters, numbers, underscores, and hyphens'
      );
      return;
    }
    
    if (cleanName.length < 3) {
      Alert.alert('Error', 'Channel name must be at least 3 characters long');
      return;
    }
    
    if (cleanName.length > 32) {
      Alert.alert('Error', 'Channel name must be 32 characters or less');
      return;
    }

    try {
      setIsCreating(true);
      
      const event = await nostrService.createChannel(
        cleanName,
        channelDescription.trim() || `Channel #${cleanName}`,
        channelPicture.trim()
      );
      
      Alert.alert(
        'Success!', 
        `Channel #${cleanName} created successfully!`,
        [
          {
            text: 'Join Channel',
            onPress: () => {
              navigation.replace('Channel', {
                channelId: event.id,
                channelName: cleanName
              });
            }
          }
        ]
      );
      
    } catch (error) {
      console.error('Failed to create channel:', error);
      Alert.alert('Error', 'Failed to create channel. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleChannelNameChange = (text) => {
    const { cleanName } = validateChannelName(text);
    setChannelName(cleanName);
  };

  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: theme.backgroundColor }]}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.header}>
        <Ionicons 
          name="add-circle-outline" 
          size={64} 
          color={theme.primaryColor} 
        />
        <Text style={[styles.title, { color: theme.textColor }]}>
          Create New Channel
        </Text>
        <Text style={[styles.subtitle, { color: theme.secondaryTextColor }]}>
          Set up a new public chat channel on Nostr
        </Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: theme.textColor }]}>
            Channel Name *
          </Text>
          <View style={styles.nameInputContainer}>
            <Text style={[styles.hashSymbol, { color: theme.secondaryTextColor }]}>
              #
            </Text>
            <TextInput
              style={[styles.textInput, { 
                backgroundColor: theme.surfaceColor,
                color: theme.textColor,
                borderColor: theme.borderColor
              }]}
              value={channelName}
              onChangeText={handleChannelNameChange}
              placeholder="general"
              placeholderTextColor={theme.secondaryTextColor}
              maxLength={32}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Text style={[styles.helpText, { color: theme.secondaryTextColor }]}>
            Letters, numbers, underscores, and hyphens only
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: theme.textColor }]}>
            Description
          </Text>
          <TextInput
            style={[styles.textInput, styles.multilineInput, { 
              backgroundColor: theme.surfaceColor,
              color: theme.textColor,
              borderColor: theme.borderColor
            }]}
            value={channelDescription}
            onChangeText={setChannelDescription}
            placeholder="What's this channel about?"
            placeholderTextColor={theme.secondaryTextColor}
            multiline
            numberOfLines={3}
            maxLength={200}
          />
          <Text style={[styles.characterCount, { color: theme.secondaryTextColor }]}>
            {channelDescription.length}/200
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: theme.textColor }]}>
            Channel Picture URL (optional)
          </Text>
          <TextInput
            style={[styles.textInput, { 
              backgroundColor: theme.surfaceColor,
              color: theme.textColor,
              borderColor: theme.borderColor
            }]}
            value={channelPicture}
            onChangeText={setChannelPicture}
            placeholder="https://example.com/image.jpg"
            placeholderTextColor={theme.secondaryTextColor}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.createButton, { 
            backgroundColor: channelName.trim() ? theme.primaryColor : theme.borderColor 
          }]}
          onPress={createChannel}
          disabled={!channelName.trim() || isCreating}
        >
          {isCreating ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <>
              <Ionicons name="add" size={24} color="white" />
              <Text style={styles.createButtonText}>
                Create Channel
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.cancelButton, { borderColor: theme.borderColor }]}
          onPress={() => navigation.goBack()}
          disabled={isCreating}
        >
          <Text style={[styles.cancelButtonText, { color: theme.secondaryTextColor }]}>
            Cancel
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoBox}>
        <View style={[styles.infoContainer, { backgroundColor: theme.cardBackgroundColor }]}>
          <Ionicons name="information-circle" size={20} color={theme.primaryColor} />
          <Text style={[styles.infoText, { color: theme.secondaryTextColor }]}>
            Your channel will be public and discoverable by anyone on the Nostr network. 
            You'll automatically become the channel operator.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  form: {
    marginBottom: 32,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  nameInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hashSymbol: {
    fontSize: 18,
    fontWeight: 'bold',
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  multilineInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  helpText: {
    fontSize: 12,
    marginTop: 4,
  },
  characterCount: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 4,
  },
  footer: {
    marginBottom: 20,
  },
  createButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  createButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  cancelButton: {
    borderWidth: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  infoBox: {
    marginTop: 20,
  },
  infoContainer: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    marginLeft: 12,
  },
});

export default CreateChannelScreen;