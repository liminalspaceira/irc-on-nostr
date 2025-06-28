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
  Modal,
  Dimensions,
  Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrService } from '../services/NostrService';
import { THEMES } from '../utils/constants';

const CreateChannelScreen = ({ navigation, theme = THEMES.DARK }) => {
  const [channelName, setChannelName] = useState('');
  const [channelDescription, setChannelDescription] = useState('');
  const [channelPicture, setChannelPicture] = useState('');
  const [channelType, setChannelType] = useState('public'); // 'public', 'private', or 'nip29'
  const [privateChannelProtocol, setPrivateChannelProtocol] = useState('private_nip28'); // 'private_nip28', 'encrypted', or 'nip29'
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
      if (channelType === 'nip29') {
        // Create NIP-29 group via external website
        console.log('🌐 Opening NIP-29 group creation website...');
        console.log('📝 User wants to create:');
        console.log(`   Group name: ${cleanName}`);
        console.log(`   Description: ${channelDescription.trim() || `NIP-29 group: ${cleanName}`}`);
        
        showAlert(
            'Create NIP-29 Group',
            `Opening the NIP-29 group creation form in your browser.\n\n📝 Suggested details:\n• Group name: "${cleanName}"\n• Description: "${channelDescription.trim() || `Private channel: ${cleanName}`}"\n\nAfter creating the group, return here and use "Join Channel" to join it.`,
            [
              {
                text: 'Open Form',
                onPress: async () => {
                  closeModal();
                  try {
                    await Linking.openURL('https://relay.groups.nip29.com/');
                    
                    // Show follow-up instructions after browser opens
                    setTimeout(() => {
                      showAlert(
                        'Next Steps',
                        `After creating your NIP-29 group:\n\n1. Complete the form with your group details\n2. Solve the CAPTCHA verification\n3. Copy the Group ID from the confirmation\n4. Return to this app\n5. Use "Join Channel" and enter the Group ID\n\nYou'll then be able to use all NIP-29 moderation features!`,
                        [{ text: 'Got it!' }],
                        'success'
                      );
                    }, 1000);
                  } catch (error) {
                    console.error('Error opening browser:', error);
                    showAlert('Error', 'Failed to open the NIP-29 group creation form.', [], 'error');
                  }
                }
              },
              {
                text: 'Cancel',
                onPress: () => closeModal()
              }
            ],
            'info'
          );
          return;
        } else if (channelType === 'private') {
        if (privateChannelProtocol === 'encrypted') {
          // Real encrypted channel with shared secret
          event = await nostrService.createRealEncryptedGroup(
            cleanName,
            channelDescription.trim() || `Encrypted channel: ${cleanName}`,
            channelPicture.trim(),
            [] // No initial members for now - could add member selection UI
          );
        } else {
          // Private NIP-28 channel (basic privacy flag)
          event = await nostrService.createPrivateGroup(
            cleanName,
            channelDescription.trim() || `Private channel: ${cleanName}`,
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
      
      const channelTypeText = channelType === 'nip29' ? 'NIP-29 group' : channelType === 'private' ? 'Private channel' : 'Channel';
      showAlert(
        'Success!', 
        `${channelTypeText} "${cleanName}" created successfully!`,
        [
          {
            text: `Join Channel`,
            onPress: () => {
              closeModal();
              navigation.replace('Channel', {
                channelId: event.id,
                channelName: cleanName,
                isPrivate: channelType === 'private',
                protocol: channelType === 'nip29' ? 'nip29' : channelType === 'private' ? privateChannelProtocol : 'public'
              });
            }
          }
        ],
        'success'
      );
      
    } catch (error) {
      console.error('❌ Failed to create channel:', error);
      showAlert('Error', `Failed to create ${channelType} channel. Please try again.`, [], 'error');
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
          {channelType === 'public' 
            ? 'Create a public channel anyone can discover and join'
            : channelType === 'nip29'
            ? 'Create a managed NIP-29 group with real moderation powers'
            : channelType === 'private' && privateChannelProtocol === 'encrypted'
            ? 'Create an encrypted channel with end-to-end privacy'
            : 'Create an invitation-only private channel'
          }
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
                Private Channel
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.typeButton,
                {
                  backgroundColor: channelType === 'nip29' ? theme.primaryColor : theme.surfaceColor,
                  borderColor: channelType === 'nip29' ? theme.primaryColor : theme.borderColor
                }
              ]}
              onPress={() => setChannelType('nip29')}
            >
              <Ionicons 
                name="settings-outline" 
                size={20} 
                color={channelType === 'nip29' ? 'white' : theme.secondaryTextColor} 
              />
              <Text style={[
                styles.typeButtonText,
                { color: channelType === 'nip29' ? 'white' : theme.textColor }
              ]}>
                NIP-29 Group
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.helpText, { color: theme.secondaryTextColor }]}>
            {channelType === 'public' 
              ? 'Anyone can discover and join this channel'
              : channelType === 'nip29'
              ? 'Relay-managed group with real moderation powers (public)'
              : 'Invitation-only encrypted channel chat'
            }
          </Text>
        </View>

        {/* Private Channel Protocol Selection */}
        {channelType === 'private' && (
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: theme.textColor }]}>
              Channel Protocol *
            </Text>
            <View style={styles.protocolSelectionContainer}>
              <TouchableOpacity
                style={[
                  styles.protocolButton,
                  {
                    backgroundColor: privateChannelProtocol === 'private_nip28' ? theme.warningColor : theme.surfaceColor,
                    borderColor: privateChannelProtocol === 'private_nip28' ? theme.warningColor : theme.borderColor
                  }
                ]}
                onPress={() => setPrivateChannelProtocol('private_nip28')}
              >
                <Ionicons 
                  name="eye-off-outline" 
                  size={18} 
                  color={privateChannelProtocol === 'private_nip28' ? 'white' : theme.secondaryTextColor} 
                />
                <View style={styles.protocolInfo}>
                  <Text style={[
                    styles.protocolButtonText,
                    { color: privateChannelProtocol === 'private_nip28' ? 'white' : theme.textColor }
                  ]}>
                    Private NIP-28 (Basic)
                  </Text>
                  <Text style={[
                    styles.protocolSubtext,
                    { color: privateChannelProtocol === 'private_nip28' ? 'rgba(255,255,255,0.8)' : theme.secondaryTextColor }
                  ]}>
                    Invitation-only • Fake moderation
                  </Text>
                </View>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.protocolButton,
                  {
                    backgroundColor: privateChannelProtocol === 'encrypted' ? theme.successColor : theme.surfaceColor,
                    borderColor: privateChannelProtocol === 'encrypted' ? theme.successColor : theme.borderColor
                  }
                ]}
                onPress={() => setPrivateChannelProtocol('encrypted')}
              >
                <Ionicons 
                  name="shield-checkmark-outline" 
                  size={18} 
                  color={privateChannelProtocol === 'encrypted' ? 'white' : theme.secondaryTextColor} 
                />
                <View style={styles.protocolInfo}>
                  <Text style={[
                    styles.protocolButtonText,
                    { color: privateChannelProtocol === 'encrypted' ? 'white' : theme.textColor }
                  ]}>
                    Encrypted (Real)
                  </Text>
                  <Text style={[
                    styles.protocolSubtext,
                    { color: privateChannelProtocol === 'encrypted' ? 'rgba(255,255,255,0.8)' : theme.secondaryTextColor }
                  ]}>
                    End-to-end encrypted • Real privacy
                  </Text>
                </View>
              </TouchableOpacity>
              
            </View>
            <Text style={[styles.helpText, { color: theme.secondaryTextColor }]}>
              {privateChannelProtocol === 'private_nip28' 
                ? 'Encrypted invitations, plain text messages. No moderation. Use Encrypted for real features.'
                : 'All messages encrypted with shared secret. Real end-to-end privacy. No moderation capabilities.'
              }
            </Text>
          </View>
        )}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { 
            color: channelType === 'nip29' 
              ? theme.borderColor 
              : theme.textColor 
          }]}>
            Channel Name {channelType === 'nip29' ? '' : '*'}
          </Text>
          <View style={styles.nameInputContainer}>
            <Text style={[styles.hashSymbol, { 
              color: channelType === 'nip29' 
                ? theme.borderColor 
                : theme.secondaryTextColor 
            }]}>
              #
            </Text>
            <TextInput
              style={[styles.textInput, { 
                backgroundColor: channelType === 'nip29' 
                  ? theme.borderColor + '20' 
                  : theme.surfaceColor,
                color: channelType === 'nip29' 
                  ? theme.borderColor 
                  : theme.textColor,
                borderColor: channelType === 'nip29' 
                  ? theme.borderColor 
                  : theme.borderColor
              }]}
              value={channelName}
              onChangeText={handleChannelNameChange}
              placeholder={channelType === 'nip29' 
                ? "Set on relay website" 
                : "general"
              }
              placeholderTextColor={channelType === 'nip29' 
                ? theme.borderColor 
                : theme.secondaryTextColor
              }
              editable={!(channelType === 'nip29')}
              maxLength={32}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Text style={[styles.helpText, { color: theme.secondaryTextColor }]}>
            {channelType === 'nip29' 
              ? 'Channel details will be set on the relay website'
              : 'Letters, numbers, underscores, and hyphens only'
            }
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { 
            color: channelType === 'nip29' 
              ? theme.borderColor 
              : theme.textColor 
          }]}>
            Description
          </Text>
          <TextInput
            style={[styles.textInput, styles.multilineInput, { 
              backgroundColor: channelType === 'nip29' 
                ? theme.borderColor + '20' 
                : theme.surfaceColor,
              color: channelType === 'nip29' 
                ? theme.borderColor 
                : theme.textColor,
              borderColor: channelType === 'nip29' 
                ? theme.borderColor 
                : theme.borderColor
            }]}
            value={channelDescription}
            onChangeText={setChannelDescription}
            placeholder={channelType === 'nip29' 
              ? "Set on relay website" 
              : "What's this channel about?"
            }
            placeholderTextColor={channelType === 'nip29' 
              ? theme.borderColor 
              : theme.secondaryTextColor
            }
            editable={!(channelType === 'nip29')}
            multiline
            numberOfLines={3}
            maxLength={200}
          />
          <Text style={[styles.characterCount, { color: theme.secondaryTextColor }]}>
            {channelType === 'nip29' 
              ? 'Set on website' 
              : `${channelDescription.length}/200`
            }
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { 
            color: channelType === 'nip29' 
              ? theme.borderColor 
              : theme.textColor 
          }]}>
            Channel Picture URL (optional)
          </Text>
          <TextInput
            style={[styles.textInput, { 
              backgroundColor: channelType === 'nip29' 
                ? theme.borderColor + '20' 
                : theme.surfaceColor,
              color: channelType === 'nip29' 
                ? theme.borderColor 
                : theme.textColor,
              borderColor: channelType === 'nip29' 
                ? theme.borderColor 
                : theme.borderColor
            }]}
            value={channelPicture}
            onChangeText={setChannelPicture}
            placeholder={channelType === 'nip29' 
              ? "Set on relay website" 
              : "https://example.com/image.jpg"
            }
            placeholderTextColor={channelType === 'nip29' 
              ? theme.borderColor 
              : theme.secondaryTextColor
            }
            editable={!(channelType === 'nip29')}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.createButton, { 
            backgroundColor: (channelName.trim() || (channelType === 'nip29')) 
              ? theme.primaryColor 
              : theme.borderColor 
          }]}
          onPress={createChannel}
          disabled={!(channelName.trim() || (channelType === 'nip29')) || isCreating}
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
            name={channelType === 'nip29' ? "settings" : channelType === 'private' ? "shield-checkmark" : "information-circle"} 
            size={20} 
            color={theme.primaryColor} 
          />
          <Text style={[styles.infoText, { color: theme.secondaryTextColor }]}>
            {channelType === 'nip29' 
              ? 'Your NIP-29 group will be relay-managed with full moderation capabilities. You\'ll have admin controls to manage members, delete messages, and enforce rules.'
              : channelType === 'private' 
              ? (privateChannelProtocol === 'encrypted'
                  ? 'Your Encrypted channel will use shared secrets for real end-to-end encryption. All messages fully encrypted. Maximum privacy with no moderation.'
                  : 'Your Private NIP-28 channel has encrypted invitations but plain text messages. No real moderation. For full features, use Encrypted.'
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