import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrService } from '../services/NostrService';
import { nostrUtils } from '../utils/nostrUtils';
import { THEMES } from '../utils/constants';

const PrivateMessageScreen = ({ navigation, theme = THEMES.DARK }) => {
  const [conversations, setConversations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newContactInput, setNewContactInput] = useState('');
  const [showNewContact, setShowNewContact] = useState(false);
  const [userProfiles, setUserProfiles] = useState(new Map());
  const [dmSubscriptionId, setDmSubscriptionId] = useState(null);
  const [markingAllAsRead, setMarkingAllAsRead] = useState(false);

  useEffect(() => {
    loadConversations();
    setupDMSubscription();

    return () => {
      // Cleanup subscription when component unmounts
      if (dmSubscriptionId) {
        nostrService.unsubscribe(dmSubscriptionId);
      }
    };
  }, []);

  useEffect(() => {
    // Refresh conversations when screen gains focus (user returns from conversation)
    const unsubscribe = navigation.addListener('focus', () => {
      loadConversations();
    });

    return unsubscribe;
  }, [navigation]);

  const setupDMSubscription = async () => {
    try {
      // Subscribe to new private messages for real-time updates
      const subId = nostrService.subscribeToAllPrivateMessages(onNewPrivateMessage);
      setDmSubscriptionId(subId);
    } catch (error) {
      console.error('Failed to setup DM subscription:', error);
    }
  };

  const onNewPrivateMessage = async (newMessage, contactPubkey) => {
    console.log('💬 New private message received from:', contactPubkey.substring(0, 8));
    
    // Update conversations with the new message
    setConversations(prev => {
      const updated = [...prev];
      let conversation = updated.find(conv => conv.pubkey === contactPubkey);
      
      if (!conversation) {
        // Create new conversation
        conversation = {
          pubkey: contactPubkey,
          messages: [],
          lastMessage: null,
          unreadCount: 0
        };
        updated.push(conversation);
      }
      
      // Check if message already exists
      const messageExists = conversation.messages?.some(msg => msg.id === newMessage.id);
      if (messageExists) return prev;
      
      // Add the new message
      if (!conversation.messages) conversation.messages = [];
      conversation.messages.push(newMessage);
      conversation.messages.sort((a, b) => a.timestamp - b.timestamp);
      
      // Update last message
      conversation.lastMessage = newMessage;
      
      // Increment unread count (will be recalculated properly on next load)
      conversation.unreadCount = (conversation.unreadCount || 0) + 1;
      
      // Sort conversations by last message timestamp
      updated.sort((a, b) => {
        const aTime = a.lastMessage ? a.lastMessage.timestamp : 0;
        const bTime = b.lastMessage ? b.lastMessage.timestamp : 0;
        return bTime - aTime;
      });
      
      return updated;
    });

    // Load profile for the message sender if we don't have it
    if (!userProfiles.has(contactPubkey)) {
      loadUserProfile(contactPubkey);
    }
  };

  const loadConversations = async () => {
    try {
      setIsLoading(true);
      // Load private message conversations
      const convos = await nostrService.getPrivateConversations();
      setConversations(convos);
      
      // Load profiles for all conversation participants
      for (const convo of convos) {
        if (!userProfiles.has(convo.pubkey)) {
          loadUserProfile(convo.pubkey);
        }
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
      Alert.alert('Error', 'Failed to load private messages');
    } finally {
      setIsLoading(false);
    }
  };

  const loadUserProfile = async (pubkey) => {
    try {
      const profile = await nostrService.getUserProfile(pubkey);
      if (profile) {
        setUserProfiles(prev => new Map(prev).set(pubkey, profile));
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const getUserDisplayName = (pubkey) => {
    const profile = userProfiles.get(pubkey);
    if (profile) {
      return profile.display_name || profile.name || profile.username || `${pubkey.substring(0, 8)}...`;
    }
    return `${pubkey.substring(0, 16)}...`;
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadConversations();
    setIsRefreshing(false);
  };

  const startNewConversation = async () => {
    if (!newContactInput.trim()) {
      Alert.alert('Error', 'Please enter a public key or npub');
      return;
    }

    try {
      let pubkey = newContactInput.trim();
      
      // Handle npub format
      if (pubkey.startsWith('npub')) {
        pubkey = nostrUtils.npubToPubkey(pubkey);
      }

      // Validate pubkey format
      if (!nostrUtils.isValidPubkey(pubkey)) {
        Alert.alert('Error', 'Invalid public key format');
        return;
      }

      // Navigate to conversation
      navigation.navigate('PrivateConversation', {
        contactPubkey: pubkey,
        contactName: pubkey.substring(0, 8) + '...'
      });

      setNewContactInput('');
      setShowNewContact(false);
    } catch (error) {
      console.error('Error starting conversation:', error);
      Alert.alert('Error', 'Failed to start conversation');
    }
  };

  const openConversation = (conversation) => {
    navigation.navigate('PrivateConversation', {
      contactPubkey: conversation.pubkey,
      contactName: getUserDisplayName(conversation.pubkey)
    });
  };

  const markAllAsRead = async () => {
    try {
      setMarkingAllAsRead(true);
      const count = await nostrService.markAllConversationsAsRead();
      
      // Update local state to reflect all conversations as read
      setConversations(prev => prev.map(conv => ({
        ...conv,
        unreadCount: 0
      })));
      
      Alert.alert('Success', `Marked ${count} conversations as read`);
    } catch (error) {
      console.error('Error marking all as read:', error);
      Alert.alert('Error', 'Failed to mark all conversations as read');
    } finally {
      setMarkingAllAsRead(false);
    }
  };

  const renderConversation = ({ item }) => {
    const timeStr = item.lastMessage ? nostrUtils.formatTimestamp(item.lastMessage.timestamp) : '';
    const hasUnread = item.unreadCount > 0;

    return (
      <TouchableOpacity
        style={[
          styles.conversationItem,
          { borderBottomColor: theme.borderColor },
          hasUnread && { backgroundColor: theme.surfaceColor }
        ]}
        onPress={() => openConversation(item)}
      >
        <View style={styles.conversationContent}>
          <View style={styles.conversationHeader}>
            <Text style={[styles.contactName, { color: theme.textColor }]}>
              {getUserDisplayName(item.pubkey)}
            </Text>
            <Text style={[styles.timestamp, { color: theme.secondaryTextColor }]}>
              {timeStr}
            </Text>
          </View>
          
          <View style={styles.conversationBody}>
            <Text 
              style={[
                styles.lastMessage, 
                { color: theme.secondaryTextColor },
                hasUnread && { fontWeight: '600', color: theme.textColor }
              ]}
              numberOfLines={2}
            >
              {item.lastMessage ? item.lastMessage.content : 'No messages yet'}
            </Text>
            
            {hasUnread && (
              <View style={[styles.unreadBadge, { backgroundColor: theme.primaryColor }]}>
                <Text style={styles.unreadCount}>
                  {item.unreadCount > 99 ? '99+' : item.unreadCount}
                </Text>
              </View>
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

  const renderNewContactInput = () => {
    if (!showNewContact) return null;

    return (
      <View style={[styles.newContactContainer, { backgroundColor: theme.cardBackgroundColor }]}>
        <TextInput
          style={[styles.newContactInput, { 
            backgroundColor: theme.surfaceColor,
            color: theme.textColor,
            borderColor: theme.borderColor
          }]}
          value={newContactInput}
          onChangeText={setNewContactInput}
          placeholder="Enter public key (npub... or hex)"
          placeholderTextColor={theme.secondaryTextColor}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.newContactButtons}>
          <TouchableOpacity
            style={[styles.cancelButton, { backgroundColor: theme.borderColor }]}
            onPress={() => {
              setShowNewContact(false);
              setNewContactInput('');
            }}
          >
            <Text style={[styles.buttonText, { color: theme.textColor }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.startButton, { backgroundColor: theme.primaryColor }]}
            onPress={startNewConversation}
          >
            <Text style={styles.buttonText}>Start Chat</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundColor }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.cardBackgroundColor }]}>
        <Text style={[styles.headerTitle, { color: theme.textColor }]}>
          Private Messages
        </Text>
        <View style={styles.headerButtons}>
          {/* Mark All as Read Button */}
          {conversations.some(conv => conv.unreadCount > 0) && (
            <TouchableOpacity
              style={[styles.markAllReadButton, { backgroundColor: theme.primaryColor }]}
              onPress={markAllAsRead}
              disabled={markingAllAsRead}
            >
              {markingAllAsRead ? (
                <Ionicons name="sync" size={16} color="white" />
              ) : (
                <Ionicons name="checkmark-done" size={16} color="white" />
              )}
              <Text style={styles.markAllReadText}>
                {markingAllAsRead ? 'Reading...' : 'Mark All Read'}
              </Text>
            </TouchableOpacity>
          )}
          
          {/* New Message Button */}
          <TouchableOpacity
            style={styles.newMessageButton}
            onPress={() => setShowNewContact(!showNewContact)}
          >
            <Ionicons 
              name={showNewContact ? "close" : "add"} 
              size={24} 
              color={theme.primaryColor} 
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* New contact input */}
      {renderNewContactInput()}

      {/* Conversations list */}
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.pubkey}
        renderItem={renderConversation}
        style={styles.conversationsList}
        contentContainerStyle={conversations.length === 0 ? styles.emptyContainer : null}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.primaryColor}
          />
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Ionicons 
                name="mail-outline" 
                size={64} 
                color={theme.secondaryTextColor} 
              />
              <Text style={[styles.emptyTitle, { color: theme.textColor }]}>
                No Private Messages
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.secondaryTextColor }]}>
                Start a new conversation by tapping the + button
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  markAllReadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  markAllReadText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  newMessageButton: {
    padding: 8,
  },
  newContactContainer: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  newContactInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 12,
  },
  newContactButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  startButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
  },
  conversationsList: {
    flex: 1,
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  conversationContent: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  timestamp: {
    fontSize: 12,
    marginLeft: 8,
  },
  conversationBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lastMessage: {
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadCount: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 64,
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

export default PrivateMessageScreen;