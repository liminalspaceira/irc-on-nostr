import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Switch,
  Modal,
  Clipboard
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPublicKey, nip19 } from 'nostr-tools';
import { nostrService } from '../services/NostrService';
import { notificationService } from '../services/NotificationService';
import { nostrUtils } from '../utils/nostrUtils';
import CacheManager from '../components/CacheManager';
import { STORAGE_KEYS, THEMES, DEFAULT_RELAYS, NIP29_RELAYS } from '../utils/constants';

const SettingsScreen = ({ theme = THEMES.DARK }) => {
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [relays, setRelays] = useState(DEFAULT_RELAYS);
  const [nip29Relays, setNip29Relays] = useState(NIP29_RELAYS);
  const [settings, setSettings] = useState({
    notifications: true,
    soundEnabled: true
  });
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [generateModalVisible, setGenerateModalVisible] = useState(false);
  const [addRelayModalVisible, setAddRelayModalVisible] = useState(false);
  const [newPrivateKey, setNewPrivateKey] = useState('');
  const [newRelayUrl, setNewRelayUrl] = useState('');
  const [relayType, setRelayType] = useState('standard'); // 'standard' or 'nip29'
  const [connectionStatus, setConnectionStatus] = useState({ isConnected: false });

  useEffect(() => {
    loadUserData();
    loadSettings();
    
    // Initialize notification service
    notificationService.initialize();
    
    // Update connection status periodically
    const interval = setInterval(() => {
      setConnectionStatus(nostrService.getConnectionStatus());
    }, 3000);
    
    return () => clearInterval(interval);
  }, []);

  const loadUserData = async () => {
    try {
      const storedPrivateKey = await AsyncStorage.getItem(STORAGE_KEYS.PRIVATE_KEY);
      const storedPublicKey = await AsyncStorage.getItem(STORAGE_KEYS.PUBLIC_KEY);
      const storedRelays = await AsyncStorage.getItem(STORAGE_KEYS.RELAYS);
      const storedNip29Relays = await AsyncStorage.getItem('nip29_relays');
      
      if (storedPrivateKey) setPrivateKey(storedPrivateKey);
      if (storedPublicKey) setPublicKey(storedPublicKey);
      if (storedRelays) setRelays(JSON.parse(storedRelays));
      if (storedNip29Relays) setNip29Relays(JSON.parse(storedNip29Relays));
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const storedSettings = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (storedSettings) {
        setSettings({ ...settings, ...JSON.parse(storedSettings) });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async (newSettings) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
      setSettings(newSettings);
      
      // Update notification service settings
      notificationService.updateSettings({
        notifications: newSettings.notifications,
        soundEnabled: newSettings.soundEnabled
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      Alert.alert('Error', 'Failed to save settings');
    }
  };

  const generateNewKeys = () => {
    console.log('🔄 Generate New Keys button pressed!');
    setGenerateModalVisible(true);
  };

  const confirmGenerateNewKeys = async () => {
    try {
      console.log('🔑 Generating new Nostr identity...');
      setGenerateModalVisible(false);
      
      // Generate new key pair
      const keyPair = nostrUtils.generateKeyPair();
      console.log('✅ New keys generated');
      console.log('📝 Public key:', keyPair.publicKey);
      console.log('🔐 Private key length:', keyPair.privateKey.length);
      
      // Clear all existing data
      console.log('🧹 Clearing existing user data...');
      await AsyncStorage.removeItem(STORAGE_KEYS.PROFILE);
      await AsyncStorage.removeItem('user_liked_posts');
      await AsyncStorage.removeItem('user_reposted_posts');
      
      // Save new keys
      await AsyncStorage.setItem(STORAGE_KEYS.PRIVATE_KEY, keyPair.privateKey);
      await AsyncStorage.setItem(STORAGE_KEYS.PUBLIC_KEY, keyPair.publicKey);
      
      // Update local state
      setPrivateKey(keyPair.privateKey);
      setPublicKey(keyPair.publicKey);
      
      // Reinitialize NostrService with new keys
      console.log('🔄 Reinitializing NostrService...');
      nostrService.privateKey = keyPair.privateKey;
      nostrService.publicKey = keyPair.publicKey;
      
      // Reconnect to relays with new identity
      try {
        await nostrService.initialize();
        console.log('✅ NostrService reinitialized successfully');
      } catch (initError) {
        console.error('⚠️ NostrService initialization warning:', initError);
        // Continue anyway - this is not critical
      }
      
      // Show success message using web-compatible method
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          alert(`New Nostr Identity Created!\n\nYour new Nostr identity has been created successfully!\n\nPublic Key: ${keyPair.publicKey.substring(0, 16)}...\n\nYou can now set up your profile and start fresh on the Nostr network.`);
        } else {
          Alert.alert(
            'New Nostr Identity Created!', 
            `Your new Nostr identity has been created successfully!\n\nPublic Key: ${keyPair.publicKey.substring(0, 16)}...\n\nYou can now set up your profile and start fresh on the Nostr network.`,
            [{ text: 'OK' }]
          );
        }
      }, 100);
      
    } catch (error) {
      console.error('❌ Error generating new identity:', error);
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          alert(`Error: Failed to generate new identity: ${error.message}`);
        } else {
          Alert.alert('Error', `Failed to generate new identity: ${error.message}`);
        }
      }, 100);
    }
  };

  const importPrivateKey = async () => {
    if (!newPrivateKey.trim()) {
      showAlert('Error', 'Please enter a private key');
      return;
    }

    try {
      const input = newPrivateKey.trim();
      let privateKeyHex;
      
      // Check if it's a bech32 format (nsec1...)
      if (input.startsWith('nsec1')) {
        try {
          const decoded = nip19.decode(input);
          if (decoded.type !== 'nsec') {
            showAlert('Error', 'Invalid nsec format');
            return;
          }
          // Convert Uint8Array to hex string
          if (decoded.data instanceof Uint8Array) {
            privateKeyHex = Array.from(decoded.data).map(b => b.toString(16).padStart(2, '0')).join('');
          } else {
            privateKeyHex = decoded.data;
          }
        } catch (error) {
          showAlert('Error', 'Invalid nsec1 private key format');
          return;
        }
      } 
      // Check if it's raw hex (64 characters)
      else if (/^[a-f0-9]{64}$/i.test(input)) {
        privateKeyHex = input;
      } 
      // Invalid format
      else {
        showAlert('Error', 'Invalid private key format. Please use either:\n• nsec1... (bech32 format)\n• 64 hex characters');
        return;
      }

      console.log('Converted private key length:', privateKeyHex.length);
      console.log('Converted private key sample:', privateKeyHex.substring(0, 10) + '...');
      
      const derivedPublicKey = getPublicKey(privateKeyHex);

      await AsyncStorage.setItem(STORAGE_KEYS.PRIVATE_KEY, privateKeyHex);
      await AsyncStorage.setItem(STORAGE_KEYS.PUBLIC_KEY, derivedPublicKey);
      
      setPrivateKey(privateKeyHex);
      setPublicKey(derivedPublicKey);
      setNewPrivateKey('');
      setImportModalVisible(false);
      
      // Update NostrService with new keys
      nostrService.privateKey = privateKeyHex;
      nostrService.publicKey = derivedPublicKey;
      
      showAlert('Success', 'Private key imported successfully!');
    } catch (error) {
      console.error('Error importing private key:', error);
      showAlert('Error', 'Failed to import private key');
    }
  };

  const copyToClipboard = (text, label) => {
    if (Clipboard.setString) {
      Clipboard.setString(text);
      Alert.alert('Copied', `${label} copied to clipboard`);
    } else {
      // Web fallback
      navigator.clipboard.writeText(text);
      Alert.alert('Copied', `${label} copied to clipboard`);
    }
  };

  const showAlert = (title, message, buttons = []) => {
    if (typeof window !== 'undefined') {
      // Web environment - use modal for complex dialogs, simple alert for basic ones
      if (buttons.length > 1) {
        // For confirmation dialogs, we'll handle this in the calling function
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

  const connectToNostr = async () => {
    try {
      await nostrService.initialize();
      showAlert('Success', 'Connected to Nostr relays!');
    } catch (error) {
      console.error('Connection failed:', error);
      showAlert('Error', 'Failed to connect to Nostr relays');
    }
  };

  const validateRelayUrl = (url) => {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'wss:' || urlObj.protocol === 'ws:';
    } catch (error) {
      return false;
    }
  };

  const addNewRelay = async () => {
    const trimmedUrl = newRelayUrl.trim();
    
    if (!trimmedUrl) {
      showAlert('Error', 'Please enter a relay URL');
      return;
    }
    
    if (!validateRelayUrl(trimmedUrl)) {
      showAlert('Error', 'Please enter a valid WebSocket URL (wss:// or ws://)');
      return;
    }
    
    const currentRelays = relayType === 'nip29' ? nip29Relays : relays;
    if (currentRelays.includes(trimmedUrl)) {
      showAlert('Error', 'This relay is already in your list');
      return;
    }

    try {
      if (relayType === 'nip29') {
        const updatedNip29Relays = [...nip29Relays, trimmedUrl];
        setNip29Relays(updatedNip29Relays);
        await AsyncStorage.setItem('nip29_relays', JSON.stringify(updatedNip29Relays));
      } else {
        const updatedRelays = [...relays, trimmedUrl];
        setRelays(updatedRelays);
        await AsyncStorage.setItem(STORAGE_KEYS.RELAYS, JSON.stringify(updatedRelays));
      }
      
      setNewRelayUrl('');
      setAddRelayModalVisible(false);
      setRelayType('standard');
      
      const relayTypeText = relayType === 'nip29' ? 'NIP-29' : 'standard';
      showAlert('Success', `${relayTypeText} relay added successfully! Reconnecting to Nostr network...`);
      
      // Reconnect to include the new relay
      try {
        await nostrService.initialize();
      } catch (error) {
        console.error('Error reconnecting with new relay:', error);
      }
    } catch (error) {
      console.error('Error adding relay:', error);
      showAlert('Error', 'Failed to add relay');
    }
  };

  const renderSection = (title, children) => (
    <View style={[styles.section, { backgroundColor: theme.cardBackgroundColor }]}>
      <Text style={[styles.sectionTitle, { color: theme.textColor }]}>{title}</Text>
      {children}
    </View>
  );

  const renderSettingItem = (label, value, onToggle, description = null) => (
    <View style={styles.settingItem}>
      <View style={styles.settingContent}>
        <Text style={[styles.settingLabel, { color: theme.textColor }]}>{label}</Text>
        {description && (
          <Text style={[styles.settingDescription, { color: theme.secondaryTextColor }]}>
            {description}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: theme.borderColor, true: theme.primaryColor }}
        thumbColor={value ? theme.backgroundColor : theme.secondaryTextColor}
      />
    </View>
  );

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.backgroundColor }]}>
      {/* Connection Status */}
      <View style={[styles.statusCard, { 
        backgroundColor: connectionStatus.isConnected ? theme.successColor : theme.errorColor 
      }]}>
        <Ionicons 
          name={connectionStatus.isConnected ? 'cloud-done' : 'cloud-offline'} 
          size={24} 
          color="white" 
        />
        <Text style={styles.statusText}>
          {connectionStatus.isConnected 
            ? `Connected to ${connectionStatus.connectedRelays?.length || 0} relays`
            : 'Disconnected from Nostr'
          }
        </Text>
        {!connectionStatus.isConnected && (
          <TouchableOpacity onPress={connectToNostr} style={styles.connectButton}>
            <Text style={styles.connectButtonText}>Connect</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Nostr Identity */}
      {renderSection('Nostr Identity', (
        <View>
          <View style={styles.keyItem}>
            <Text style={[styles.keyLabel, { color: theme.textColor }]}>Public Key</Text>
            <TouchableOpacity 
              style={[styles.keyValue, { backgroundColor: theme.surfaceColor }]}
              onPress={() => copyToClipboard(publicKey, 'Public key')}
            >
              <Text style={[styles.keyText, { color: theme.secondaryTextColor }]}>
                {publicKey ? `${publicKey.substring(0, 32)}...` : 'No key found'}
              </Text>
              <Ionicons name="copy" size={16} color={theme.secondaryTextColor} />
            </TouchableOpacity>
          </View>

          <View style={styles.keyItem}>
            <Text style={[styles.keyLabel, { color: theme.textColor }]}>Private Key</Text>
            <TouchableOpacity 
              style={[styles.keyValue, { backgroundColor: theme.surfaceColor }]}
              onPress={() => copyToClipboard(privateKey, 'Private key')}
            >
              <Text style={[styles.keyText, { color: theme.secondaryTextColor }]}>
                {privateKey ? (showPrivateKey ? privateKey : '••••••••••••••••••••••••••••••••') : 'No key found'}
              </Text>
              <TouchableOpacity onPress={() => setShowPrivateKey(!showPrivateKey)}>
                <Ionicons 
                  name={showPrivateKey ? 'eye-off' : 'eye'} 
                  size={16} 
                  color={theme.secondaryTextColor} 
                />
              </TouchableOpacity>
            </TouchableOpacity>
          </View>

          <View style={styles.keyActions}>
            <TouchableOpacity 
              style={[styles.actionButton, { backgroundColor: theme.primaryColor }]}
              onPress={() => setImportModalVisible(true)}
            >
              <Ionicons name="download" size={20} color="white" />
              <Text style={styles.actionButtonText}>Import Key</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.actionButton, { backgroundColor: theme.warningColor }]}
              onPress={generateNewKeys}
            >
              <Ionicons name="refresh" size={20} color="white" />
              <Text style={styles.actionButtonText}>Generate New</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {/* App Settings */}
      {renderSection('App Settings', (
        <View>
          {renderSettingItem(
            'Notifications',
            settings.notifications,
            (value) => saveSettings({ ...settings, notifications: value }),
            'Show notifications for new messages'
          )}
          {renderSettingItem(
            'Sound Effects',
            settings.soundEnabled,
            (value) => saveSettings({ ...settings, soundEnabled: value }),
            'Play sounds for message notifications'
          )}
          
          {/* Test Notification Button */}
          <TouchableOpacity
            style={[styles.testButton, { backgroundColor: theme.primaryColor }]}
            onPress={() => {
              // Enable audio context on user interaction
              notificationService.enableAudio();
              notificationService.testNotification();
            }}
          >
            <Ionicons name="notifications" size={20} color="white" />
            <Text style={styles.testButtonText}>Test Notification</Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* Cache Management */}
      <CacheManager theme={theme} />

      {/* Standard Relays */}
      {renderSection('Standard Nostr Relays', (
        <View>
          <Text style={[styles.relayDescription, { color: theme.secondaryTextColor }]}>
            Used for public channels, private messages (NIP-17), feeds, and general Nostr activity.
          </Text>
          {relays.map((relay, index) => (
            <View key={index} style={styles.relayItem}>
              <Ionicons name="server" size={16} color={theme.primaryColor} />
              <Text style={[styles.relayUrl, { color: theme.textColor }]}>
                {relay}
              </Text>
              <View style={[styles.relayStatus, { 
                backgroundColor: connectionStatus.connectedRelays?.includes(relay) ? 
                  theme.successColor : theme.borderColor 
              }]} />
            </View>
          ))}
          
          {/* Add Standard Relay Button */}
          <TouchableOpacity
            style={[styles.addRelayButton, { backgroundColor: theme.primaryColor }]}
            onPress={() => {
              setRelayType('standard');
              setAddRelayModalVisible(true);
            }}
          >
            <Ionicons name="add" size={20} color="white" />
            <Text style={styles.addRelayButtonText}>Add Standard Relay</Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* NIP-29 Relays */}
      {renderSection('NIP-29 Group Relays', (
        <View>
          <Text style={[styles.relayDescription, { color: theme.secondaryTextColor }]}>
            Used for managed private groups with moderation capabilities (kick/ban/admin controls).
          </Text>
          {nip29Relays.map((relay, index) => (
            <View key={`nip29-${index}`} style={styles.relayItem}>
              <Ionicons name="settings" size={16} color={theme.warningColor} />
              <Text style={[styles.relayUrl, { color: theme.textColor }]}>
                {relay}
              </Text>
              <View style={styles.nip29Badge}>
                <Text style={[styles.nip29BadgeText, { color: theme.warningColor }]}>
                  NIP-29
                </Text>
              </View>
              <View style={[styles.relayStatus, { 
                backgroundColor: connectionStatus.connectedRelays?.includes(relay) ? 
                  theme.successColor : theme.borderColor 
              }]} />
            </View>
          ))}
          
          {/* Add NIP-29 Relay Button */}
          <TouchableOpacity
            style={[styles.addRelayButton, { backgroundColor: theme.warningColor }]}
            onPress={() => {
              setRelayType('nip29');
              setAddRelayModalVisible(true);
            }}
          >
            <Ionicons name="add" size={20} color="white" />
            <Text style={styles.addRelayButtonText}>Add NIP-29 Relay</Text>
          </TouchableOpacity>
          
          {nip29Relays.length === 0 && (
            <View style={styles.emptyRelayNotice}>
              <Ionicons name="information-circle" size={20} color={theme.secondaryTextColor} />
              <Text style={[styles.emptyRelayText, { color: theme.secondaryTextColor }]}>
                No NIP-29 relays configured. Add one to enable managed private groups with moderation.
              </Text>
            </View>
          )}
        </View>
      ))}

      {/* Import Private Key Modal */}
      <Modal
        visible={importModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setImportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBackgroundColor }]}>
            <Text style={[styles.modalTitle, { color: theme.textColor }]}>
              Import Private Key
            </Text>
            <Text style={[styles.modalDescription, { color: theme.secondaryTextColor }]}>
              Enter your existing Nostr private key:
              {'\n'}• nsec1... (bech32 format)
              {'\n'}• or 64 hex characters
            </Text>
            
            <TextInput
              style={[styles.modalInput, { 
                backgroundColor: theme.surfaceColor,
                color: theme.textColor,
                borderColor: theme.borderColor
              }]}
              value={newPrivateKey}
              onChangeText={setNewPrivateKey}
              placeholder="nsec1... or hex private key"
              placeholderTextColor={theme.secondaryTextColor}
              secureTextEntry={!showPrivateKey}
              autoCapitalize="none"
              autoCorrect={false}
            />
            
            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.borderColor }]}
                onPress={() => setImportModalVisible(false)}
              >
                <Text style={[styles.modalButtonText, { color: theme.textColor }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.primaryColor }]}
                onPress={importPrivateKey}
              >
                <Text style={[styles.modalButtonText, { color: 'white' }]}>
                  Import
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Generate New Keys Confirmation Modal */}
      <Modal
        visible={generateModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGenerateModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBackgroundColor }]}>
            <Text style={[styles.modalTitle, { color: theme.textColor }]}>
              Generate New Nostr Identity
            </Text>
            <Text style={[styles.modalDescription, { color: theme.secondaryTextColor }]}>
              This will create a completely new Nostr user identity. Your current profile, follows, and all data will be lost. Are you sure?
            </Text>
            
            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.borderColor }]}
                onPress={() => setGenerateModalVisible(false)}
              >
                <Text style={[styles.modalButtonText, { color: theme.textColor }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.warningColor }]}
                onPress={confirmGenerateNewKeys}
              >
                <Text style={[styles.modalButtonText, { color: 'white' }]}>
                  Generate New Identity
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Relay Modal */}
      <Modal
        visible={addRelayModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddRelayModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBackgroundColor }]}>
            <Text style={[styles.modalTitle, { color: theme.textColor }]}>
              Add {relayType === 'nip29' ? 'NIP-29' : 'Standard'} Relay
            </Text>
            <Text style={[styles.modalDescription, { color: theme.secondaryTextColor }]}>
              {relayType === 'nip29' 
                ? 'Enter a WebSocket URL for a NIP-29 group relay with moderation support:'
                : 'Enter a WebSocket URL for a standard Nostr relay:'
              }
              {'\n'}• wss://relay.example.com
              {'\n'}• Must start with wss:// or ws://
            </Text>
            
            {relayType === 'nip29' && (
              <View style={[styles.warningBox, { backgroundColor: `${theme.warningColor}20`, borderColor: theme.warningColor }]}>
                <Ionicons name="warning" size={16} color={theme.warningColor} />
                <Text style={[styles.warningText, { color: theme.warningColor }]}>
                  NIP-29 relays enable admin controls but require relay support. Verify the relay supports NIP-29 before adding.
                </Text>
              </View>
            )}
            
            <TextInput
              style={[styles.modalInput, { 
                backgroundColor: theme.surfaceColor,
                color: theme.textColor,
                borderColor: theme.borderColor
              }]}
              value={newRelayUrl}
              onChangeText={setNewRelayUrl}
              placeholder="wss://relay.example.com"
              placeholderTextColor={theme.secondaryTextColor}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            
            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.borderColor }]}
                onPress={() => {
                  setAddRelayModalVisible(false);
                  setNewRelayUrl('');
                  setRelayType('standard');
                }}
              >
                <Text style={[styles.modalButtonText, { color: theme.textColor }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: theme.primaryColor }]}
                onPress={addNewRelay}
              >
                <Text style={[styles.modalButtonText, { color: 'white' }]}>
                  Add Relay
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
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  statusText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
    marginLeft: 12,
  },
  connectButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  connectButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  keyItem: {
    marginBottom: 16,
  },
  keyLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  keyValue: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
  },
  keyText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'monospace',
  },
  keyActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  settingContent: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  settingDescription: {
    fontSize: 12,
    marginTop: 2,
  },
  relayItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  relayUrl: {
    flex: 1,
    fontSize: 14,
    marginLeft: 8,
  },
  relayStatus: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  addRelayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
  },
  addRelayButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 14,
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 16,
  },
  testButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  relayDescription: {
    fontSize: 12,
    marginBottom: 12,
    lineHeight: 16,
  },
  nip29Badge: {
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  nip29BadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  emptyRelayNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  emptyRelayText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 12,
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
});

export default SettingsScreen;