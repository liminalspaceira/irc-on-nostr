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
import { nostrUtils } from '../utils/nostrUtils';
import { STORAGE_KEYS, THEMES, DEFAULT_RELAYS } from '../utils/constants';

const SettingsScreen = ({ theme = THEMES.DARK }) => {
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [relays, setRelays] = useState(DEFAULT_RELAYS);
  const [settings, setSettings] = useState({
    notifications: true,
    soundEnabled: true,
    showJoinLeaveMessages: true,
    showTimestamps: true,
    compactMode: false,
    autoScrollToBottom: true
  });
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [newPrivateKey, setNewPrivateKey] = useState('');
  const [connectionStatus, setConnectionStatus] = useState({ isConnected: false });

  useEffect(() => {
    loadUserData();
    loadSettings();
    
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
      
      if (storedPrivateKey) setPrivateKey(storedPrivateKey);
      if (storedPublicKey) setPublicKey(storedPublicKey);
      if (storedRelays) setRelays(JSON.parse(storedRelays));
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
    } catch (error) {
      console.error('Error saving settings:', error);
      Alert.alert('Error', 'Failed to save settings');
    }
  };

  const generateNewKeys = async () => {
    Alert.alert(
      'Generate New Keys',
      'This will replace your current Nostr identity. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          style: 'destructive',
          onPress: async () => {
            try {
              const keyPair = nostrUtils.generateKeyPair();
              await AsyncStorage.setItem(STORAGE_KEYS.PRIVATE_KEY, keyPair.privateKey);
              await AsyncStorage.setItem(STORAGE_KEYS.PUBLIC_KEY, keyPair.publicKey);
              setPrivateKey(keyPair.privateKey);
              setPublicKey(keyPair.publicKey);
              
              // Update NostrService with new keys
              nostrService.privateKey = keyPair.privateKey;
              nostrService.publicKey = keyPair.publicKey;
              
              Alert.alert('Success', 'New Nostr keys generated!');
            } catch (error) {
              console.error('Error generating keys:', error);
              Alert.alert('Error', 'Failed to generate new keys');
            }
          }
        }
      ]
    );
  };

  const importPrivateKey = async () => {
    if (!newPrivateKey.trim()) {
      Alert.alert('Error', 'Please enter a private key');
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
            Alert.alert('Error', 'Invalid nsec format');
            return;
          }
          // Convert Uint8Array to hex string
          if (decoded.data instanceof Uint8Array) {
            privateKeyHex = Array.from(decoded.data).map(b => b.toString(16).padStart(2, '0')).join('');
          } else {
            privateKeyHex = decoded.data;
          }
        } catch (error) {
          Alert.alert('Error', 'Invalid nsec1 private key format');
          return;
        }
      } 
      // Check if it's raw hex (64 characters)
      else if (/^[a-f0-9]{64}$/i.test(input)) {
        privateKeyHex = input;
      } 
      // Invalid format
      else {
        Alert.alert('Error', 'Invalid private key format. Please use either:\n• nsec1... (bech32 format)\n• 64 hex characters');
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
      
      Alert.alert('Success', 'Private key imported successfully!');
    } catch (error) {
      console.error('Error importing private key:', error);
      Alert.alert('Error', 'Failed to import private key');
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

  const connectToNostr = async () => {
    try {
      await nostrService.initialize();
      Alert.alert('Success', 'Connected to Nostr relays!');
    } catch (error) {
      console.error('Connection failed:', error);
      Alert.alert('Error', 'Failed to connect to Nostr relays');
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
            'Show desktop notifications for new messages'
          )}
          {renderSettingItem(
            'Sound Effects',
            settings.soundEnabled,
            (value) => saveSettings({ ...settings, soundEnabled: value }),
            'Play sounds for message notifications'
          )}
          {renderSettingItem(
            'Show Join/Leave Messages',
            settings.showJoinLeaveMessages,
            (value) => saveSettings({ ...settings, showJoinLeaveMessages: value }),
            'Display when users join or leave channels'
          )}
          {renderSettingItem(
            'Show Timestamps',
            settings.showTimestamps,
            (value) => saveSettings({ ...settings, showTimestamps: value }),
            'Display message timestamps'
          )}
          {renderSettingItem(
            'Compact Mode',
            settings.compactMode,
            (value) => saveSettings({ ...settings, compactMode: value }),
            'Use compact message layout'
          )}
          {renderSettingItem(
            'Auto-scroll to Bottom',
            settings.autoScrollToBottom,
            (value) => saveSettings({ ...settings, autoScrollToBottom: value }),
            'Automatically scroll to new messages'
          )}
        </View>
      ))}

      {/* Relays */}
      {renderSection('Nostr Relays', (
        <View>
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
});

export default SettingsScreen;