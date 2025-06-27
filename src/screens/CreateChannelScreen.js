import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Modal
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrService } from '../services/NostrService';
import { THEMES } from '../utils/constants';

const CreateChannelScreen = ({ navigation, theme = THEMES.DARK }) => {
  const [channelName, setChannelName] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [channelPicture, setChannelPicture] = useState('');
  const [channelType, setChannelType] = useState('public'); // 'public' or 'private'
  const [privateGroupProtocol, setPrivateGroupProtocol] = useState('private_nip28'); // 'private_nip28', 'encrypted', or 'nip29'
  const [isCreating, setIsCreating] = useState(false);
  
  // Modal states
  const [modalVisible, setModalVisible] = useState(false);
  const [modalConfig, setModalConfig] = useState({
    title: '',
    message: '',
    buttons: [],
    type: 'info' // 'info', 'success', 'error'
  });

  const validateChannelName = (name) => {
    // Remove # if user types it
    const cleanName = name.replace(/^#/, '');
    
    // Check if name is valid (alphanumeric, underscore, hyphen)
    const isValid = /^[a-zA-Z0-9_-]+$/.test(cleanName);
    
    return { cleanName, isValid };
  };

  const showAlert = (title, message, buttons = [], type = 'info') => {
    if (typeof window !== 'undefined') {
      // Web environment - use modal
      setModalConfig({
        title,
        message,
        buttons: buttons.length > 0 ? buttons : [{ text: 'OK', onPress: () => setModalVisible(false) }],
        type
      });
      setModalVisible(true);
    } else {
      // React Native environment - use native alerts
      Alert.alert(title, message, buttons.length > 0 ? buttons : [{ text: 'OK' }]);
    }
  };

  const closeModal = () => {
    setModalVisible(false);
  };

  const createChannel = async () => {
    console.log('🔧 Creating channel with name:', channelName, 'type:', channelType);
    const { cleanName, isValid } = validateChannelName(channelName);
    
    if (!cleanName.trim()) {
      showAlert('Error', 'Please enter a channel name', [], 'error');
      return;
    }
    
    if (!isValid) {
      showAlert(
        'Invalid Name', 
        'Channel name can only contain letters, numbers, underscores, and hyphens',
        [],
        'error'
      );
      return;
    }
    
    if (cleanName.length < 3) {
      showAlert('Error', 'Channel name must be at least 3 characters long', [], 'error');
      return;
    }
    
    if (cleanName.length > 32) {
      showAlert('Error', 'Channel name must be 32 characters or less', [], 'error');
      return;
    }

    try {
      setIsCreating(true);
      console.log(`🚀 Starting ${channelType} channel creation...`);
      
      let event;
      if (channelType === 'private') {
        // Create private group with selected protocol
        if (privateGroupProtocol === 'nip29') {
          event = await nostrService.createNIP29Group(
            cleanName,
            channelDescription.trim() || `Private group: ${cleanName}`,
            channelPicture.trim()
          );
        } else if (privateGroupProtocol === 'encrypted') {
          // Real encrypted group with shared secret
          event = await nostrService.createRealEncryptedGroup(
            cleanName,
            channelDescription.trim() || `Encrypted group: ${cleanName}`,
            channelPicture.trim(),
            [] // No initial members for now - could add member selection UI
          );
        } else {
          // Private NIP-28 channel (basic privacy flag)
          event = await nostrService.createPrivateGroup(
            cleanName,
            channelDescription.trim() || `Private group: ${cleanName}`,
            channelPicture.trim()
          );
        }
      } else {
        // Create public channel
        event = await nostrService.createChannel(
          cleanName,
          channelDescription.trim() || `Channel #${cleanName}`,
          channelPicture.trim()
        );
      }
      
      console.log('✅ Channel created successfully:', event.id);
      
      const channelTypeText = channelType === 'private' ? 'Private group' : 'Channel';
      showAlert(
        'Success!', 
        `${channelTypeText} "${cleanName}" created successfully!`,
        [
          {
            text: `Join ${channelType === 'private' ? 'Group' : 'Channel'}`,
            onPress: () => {
              closeModal();
              navigation.replace('Channel', {
                channelId: event.id,
                channelName: cleanName,
                isPrivate: channelType === 'private',
                protocol: channelType === 'private' ? privateGroupProtocol : 'public'
              });
            }
          }
        ],
        'success'
      );
      
    } catch (error) {
      console.error('❌ Failed to create channel:', error);
      showAlert('Error', `Failed to create ${channelType} group. Please try again.`, [], 'error');
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
          Set up a new {channelType} chat {channelType === 'private' ? 'group' : 'channel'} on Nostr
        </Text>
      </View>

      <View style={styles.form}>
        {/* Channel Type Selection */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: theme.textColor }]}>
            Channel Type *
          </Text>
          <View style={styles.typeSelectionContainer}>
            <TouchableOpacity
              style={[
                styles.typeButton,
                {
                  backgroundColor: channelType === 'public' ? theme.primaryColor : theme.surfaceColor,
                  borderColor: channelType === 'public' ? theme.primaryColor : theme.borderColor
                }
              ]}
              onPress={() => setChannelType('public')}
            >
              <Ionicons 
                name="globe-outline" 
                size={20} 
                color={channelType === 'public' ? 'white' : theme.secondaryTextColor} 
              />
              <Text style={[
                styles.typeButtonText,
                { color: channelType === 'public' ? 'white' : theme.textColor }
              ]}>
                Public Channel
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.typeButton,
                {
                  backgroundColor: channelType === 'private' ? theme.primaryColor : theme.surfaceColor,
                  borderColor: channelType === 'private' ? theme.primaryColor : theme.borderColor
                }
              ]}
              onPress={() => setChannelType('private')}
            >
              <Ionicons 
                name="lock-closed-outline" 
                size={20} 
                color={channelType === 'private' ? 'white' : theme.secondaryTextColor} 
              />
              <Text style={[
                styles.typeButtonText,
                { color: channelType === 'private' ? 'white' : theme.textColor }
              ]}>
                Private Group
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.helpText, { color: theme.secondaryTextColor }]}>
            {channelType === 'public' 
              ? 'Anyone can discover and join this channel'
              : 'Invitation-only encrypted group chat'
            }
          </Text>
        </View>

        {/* Private Group Protocol Selection */}
        {channelType === 'private' && (
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme.textColor }]}>
              Group Protocol *
            </Text>
            <View style={styles.protocolSelectionContainer}>
              <TouchableOpacity
                style={[
                  styles.protocolButton,
                  {
                    backgroundColor: privateGroupProtocol === 'private_nip28' ? theme.warningColor : theme.surfaceColor,
                    borderColor: privateGroupProtocol === 'private_nip28' ? theme.warningColor : theme.borderColor
                  }
                ]}
                onPress={() => setPrivateGroupProtocol('private_nip28')}
              >
                <Ionicons 
                  name="eye-off-outline" 
                  size={18} 
                  color={privateGroupProtocol === 'private_nip28' ? 'white' : theme.secondaryTextColor} 
                />
                <View style={styles.protocolInfo}>
                  <Text style={[
                    styles.protocolButtonText,
                    { color: privateGroupProtocol === 'private_nip28' ? 'white' : theme.textColor }
                  ]}>
                    Private NIP-28 (Basic)
                  </Text>
                  <Text style={[
                    styles.protocolSubtext,
                    { color: privateGroupProtocol === 'private_nip28' ? 'rgba(255,255,255,0.8)' : theme.secondaryTextColor }
                  ]}>
                    Invitation-only • Fake moderation
                  </Text>
                </View>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.protocolButton,
                  {
                    backgroundColor: privateGroupProtocol === 'encrypted' ? theme.successColor : theme.surfaceColor,
                    borderColor: privateGroupProtocol === 'encrypted' ? theme.successColor : theme.borderColor
                  }
                ]}
                onPress={() => setPrivateGroupProtocol('encrypted')}
              >
                <Ionicons 
                  name="shield-checkmark-outline" 
                  size={18} 
                  color={privateGroupProtocol === 'encrypted' ? 'white' : theme.secondaryTextColor} 
                />
                <View style={styles.protocolInfo}>
                  <Text style={[
                    styles.protocolButtonText,
                    { color: privateGroupProtocol === 'encrypted' ? 'white' : theme.textColor }
                  ]}>
                    Encrypted (Real)
                  </Text>
                  <Text style={[
                    styles.protocolSubtext,
                    { color: privateGroupProtocol === 'encrypted' ? 'rgba(255,255,255,0.8)' : theme.secondaryTextColor }
                  ]}>
                    End-to-end encrypted • Real privacy
                  </Text>
                </View>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.protocolButton,
                  {
                    backgroundColor: privateGroupProtocol === 'nip29' ? theme.primaryColor : theme.surfaceColor,
                    borderColor: privateGroupProtocol === 'nip29' ? theme.primaryColor : theme.borderColor
                  }
                ]}
                onPress={() => setPrivateGroupProtocol('nip29')}
              >
                <Ionicons 
                  name="settings-outline" 
                  size={18} 
                  color={privateGroupProtocol === 'nip29' ? 'white' : theme.secondaryTextColor} 
                />
                <View style={styles.protocolInfo}>
                  <Text style={[
                    styles.protocolButtonText,
                    { color: privateGroupProtocol === 'nip29' ? 'white' : theme.textColor }
                  ]}>
                    NIP-29 (Managed)
                  </Text>
                  <Text style={[
                    styles.protocolSubtext,
                    { color: privateGroupProtocol === 'nip29' ? 'rgba(255,255,255,0.8)' : theme.secondaryTextColor }
                  ]}>
                    Relay-based • Full moderation
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
            <Text style={[styles.helpText, { color: theme.secondaryTextColor }]}>
              {privateGroupProtocol === 'private_nip28' 
                ? 'Encrypted invitations, plain text messages. No moderation. Use Encrypted or NIP-29 for real features.'
                : privateGroupProtocol === 'encrypted'
                ? 'All messages encrypted with shared secret. Real end-to-end privacy. No moderation capabilities.'
                : 'Relay-managed groups with admin controls like kick/ban. Requires NIP-29 compatible relays.'
              }
            </Text>
          </View>
        )}
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
          <Ionicons 
            name={channelType === 'private' ? "shield-checkmark" : "information-circle"} 
            size={20} 
            color={theme.primaryColor} 
          />
          <Text style={[styles.infoText, { color: theme.secondaryTextColor }]}>
            {channelType === 'private' 
              ? (privateGroupProtocol === 'nip29' 
                  ? 'Your NIP-29 group will be relay-managed with full moderation capabilities. You\'ll have admin controls to manage members, delete messages, and enforce rules.'
                  : privateGroupProtocol === 'encrypted'
                  ? 'Your Encrypted group will use shared secrets for real end-to-end encryption. All messages fully encrypted. Maximum privacy with no moderation.'
                  : 'Your Private NIP-28 channel has encrypted invitations but plain text messages. No real moderation. For full features, use Encrypted or NIP-29.'
                )
              : 'Your channel will be public and discoverable by anyone on the Nostr network. You\'ll automatically become the channel operator.'
            }
          </Text>
        </View>
      </View>

      {/* Custom Modal for Web Compatibility */}
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: theme.cardBackgroundColor }]}>
            <View style={styles.modalHeader}>
              <Ionicons 
                name={
                  modalConfig.type === 'success' ? 'checkmark-circle' :
                  modalConfig.type === 'error' ? 'alert-circle' : 'information-circle'
                } 
                size={48} 
                color={
                  modalConfig.type === 'success' ? theme.successColor :
                  modalConfig.type === 'error' ? theme.errorColor : theme.primaryColor
                } 
              />
              <Text style={[styles.modalTitle, { color: theme.textColor }]}>
                {modalConfig.title}
              </Text>
            </View>
            
            <Text style={[styles.modalMessage, { color: theme.secondaryTextColor }]}>
              {modalConfig.message}
            </Text>
            
            <View style={styles.modalButtons}>
              {modalConfig.buttons.map((button, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.modalButton,
                    index === 0 && modalConfig.buttons.length > 1 ? 
                      { backgroundColor: theme.primaryColor } : 
                      { backgroundColor: theme.borderColor }
                  ]}
                  onPress={() => {
                    if (button.onPress) {
                      button.onPress();
                    } else {
                      closeModal();
                    }
                  }}
                >
                  <Text style={[
                    styles.modalButtonText,
                    { color: index === 0 && modalConfig.buttons.length > 1 ? 'white' : theme.textColor }
                  ]}>
                    {button.text}
                  </Text>
                </TouchableOpacity>
              ))}
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
  typeSelectionContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    gap: 8,
  },
  typeButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  protocolSelectionContainer: {
    gap: 12,
    marginBottom: 8,
  },
  protocolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    gap: 12,
  },
  protocolInfo: {
    flex: 1,
  },
  protocolButtonText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  protocolSubtext: {
    fontSize: 12,
    fontWeight: '400',
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

export default CreateChannelScreen;