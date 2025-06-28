import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  Modal,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrService } from '../services/NostrService';
import { botService } from '../services/BotService';
import { notificationService } from '../services/NotificationService';
import { groupEncryptionService } from '../services/GroupEncryptionService';
import { nostrUtils } from '../utils/nostrUtils';
import { IRC_COMMANDS, BOT_COMMANDS, MESSAGE_TYPES, THEMES } from '../utils/constants';

const ChannelScreen = ({ route, navigation, theme = THEMES.DARK }) => {
  const { channelId, channelName, isPrivate = false, protocol = 'public', groupId } = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [channelInfo, setChannelInfo] = useState(null);
  const [userPermissions, setUserPermissions] = useState({});
  const [channelTopic, setChannelTopic] = useState('');
  const [channelUsers, setChannelUsers] = useState(new Map());
  const [showUserList, setShowUserList] = useState(false);
  const [userProfiles, setUserProfiles] = useState(new Map());
  const [privateGroupMembers, setPrivateGroupMembers] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteePubkey, setInviteePubkey] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [myFollowing, setMyFollowing] = useState([]);
  const [followingProfiles, setFollowingProfiles] = useState(new Map());
  const [isPrivateGroup, setIsPrivateGroup] = useState(isPrivate);
  const [channelProtocol, setChannelProtocol] = useState(protocol);
  const flatListRef = useRef();
  const subscriptionRef = useRef();


  // Update header when navigation-related data changes
  useEffect(() => {
    const operatorIndicator = userPermissions.isOperator ? ' @' : '';
    const protocolIndicator = channelProtocol === 'nip29' ? '🏛️ ' : channelProtocol === 'private_nip28' ? '⚠️ ' : '#';
    navigation.setOptions({ 
      title: `${protocolIndicator}${channelName}${operatorIndicator}`,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* Invite button for private groups and NIP-29 groups */}
          {(isPrivateGroup || channelProtocol === 'nip29') && (
            <TouchableOpacity 
              onPress={openInviteModal}
              style={{ marginRight: 16 }}
            >
              <Ionicons 
                name="person-add-outline" 
                size={24} 
                color={theme.primaryColor} 
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity 
            onPress={() => setShowUserList(!showUserList)}
            style={{ marginRight: 16 }}
          >
            <Ionicons 
              name={showUserList ? "people" : "people-outline"} 
              size={24} 
              color={theme.textColor} 
            />
          </TouchableOpacity>
        </View>
      )
    });
  }, [channelName, channelProtocol, isPrivateGroup, userPermissions.isOperator, showUserList]);

  // Load channel data and set up subscriptions (only when channel changes)
  useEffect(() => {
    loadChannelData();
    subscribeToChannel();
    setupLocalBotResponseListener();

    return () => {
      if (subscriptionRef.current) {
        nostrService.unsubscribe(subscriptionRef.current);
      }
      cleanupLocalBotResponseListener();
    };
  }, [channelId, isPrivateGroup, channelProtocol]);

  // Debounced search effect for username search
  useEffect(() => {
    const delayedSearch = setTimeout(() => {
      if (searchQuery && followingProfiles.size > 0) {
        searchFollowingUsers(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(delayedSearch);
  }, [searchQuery, followingProfiles]);

  const loadChannelData = async () => {
    try {
      setIsLoading(true);
      
      // Use different message loading for NIP-29 groups
      let channelMessages;
      if (channelProtocol === 'nip29') {
        console.log('🏛️ Loading NIP-29 group messages...');
        channelMessages = await nostrService.queryNIP29GroupMessages(channelId, 100);
      } else {
        channelMessages = await nostrService.queryChannelMessages(channelId, 100);
      }
      
      setMessages(channelMessages);
      
      // Track users from initial messages
      channelMessages.forEach(message => {
        if (message.author && message.author !== 'system' && message.author !== 'bot') {
          trackUser(message.author, message.timestamp);
        }
      });
      
      // Load channel info to determine operators
      await loadChannelInfo();
      
      // Load current user's profile so /msg commands work with usernames
      if (nostrService.publicKey && !userProfiles.has(nostrService.publicKey)) {
        await loadUserProfile(nostrService.publicKey);
      }
      
      // Load private group members if this is a private group
      if (isPrivateGroup) {
        await loadPrivateGroupMembers();
      }
      
      // Scroll to bottom after loading messages
      scrollToBottom();
    } catch (error) {
      console.error('Failed to load channel data:', error);
      Alert.alert('Error', 'Failed to load channel messages');
    } finally {
      setIsLoading(false);
    }
  };

  const loadChannelInfo = async () => {
    try {
      // For now, we'll check if current user is channel creator
      const channels = await nostrService.queryChannels(200);
      const currentChannel = channels.find(c => c.id === channelId);
      
      if (currentChannel) {
        setChannelInfo(currentChannel);
        setChannelTopic(currentChannel.about || ''); // Use about as initial topic
        
        // Check if this is a private group by looking for private group markers in the event
        const isChannelPrivate = currentChannel.tags?.some(tag => tag[0] === 'private' && tag[1] === 'true') ||
                                currentChannel.about?.includes('Private group') ||
                                (currentChannel.content && JSON.parse(currentChannel.content)?.type === 'private');
        
        // Check if this is an encrypted group (also needs invite functionality for key distribution)
        const isChannelEncrypted = currentChannel.tags?.some(tag => tag[0] === 'encrypted' && tag[1] === 'true') ||
                                  currentChannel.tags?.some(tag => tag[0] === 'protocol' && tag[1] === 'encrypted') ||
                                  currentChannel.about?.includes('Encrypted group') ||
                                  currentChannel.protocol === 'encrypted' ||
                                  currentChannel.encrypted === true;
        
        // Both private and encrypted channels need invite functionality
        const needsInviteButton = isChannelPrivate || isChannelEncrypted;
        
        // Detect protocol - check for NIP-29 indicators first, then encrypted, then private
        let detectedProtocol = protocol; // Start with passed protocol
        if (currentChannel.kind === 9007) {
          detectedProtocol = 'nip29';
        } else if (currentChannel.tags?.some(tag => tag[0] === 'protocol' && tag[1] === 'nip29')) {
          detectedProtocol = 'nip29';
        } else if (isChannelEncrypted) {
          detectedProtocol = 'encrypted'; // Encrypted groups
        } else if (isChannelPrivate && detectedProtocol === 'public') {
          detectedProtocol = 'private_nip28'; // Default private groups to Private NIP-28
        }
        
        setIsPrivateGroup(needsInviteButton); // Use combined logic for invite button visibility
        setChannelProtocol(detectedProtocol);
        console.log(`🔍 Channel ${channelId.substring(0, 8)}... detected as ${needsInviteButton ? 'private/encrypted' : 'public'} using ${detectedProtocol}`);
        
        // Check if current user is creator (auto-operator)
        const currentUserPubkey = nostrService.publicKey;
        const isCreator = currentChannel.creator === currentUserPubkey;
        
        setUserPermissions({
          isOperator: isCreator,
          canKick: isCreator,
          canBan: isCreator,
          canOp: isCreator,
          canSetTopic: isCreator
        });
        
        console.log('Channel permissions:', {
          isCreator,
          currentUser: currentUserPubkey?.substring(0, 16) + '...',
          creator: currentChannel.creator?.substring(0, 16) + '...'
        });
      }
    } catch (error) {
      console.error('Failed to load channel info:', error);
    }
  };

  const subscribeToChannel = () => {
    if (channelProtocol === 'nip29') {
      console.log('🏛️ Setting up NIP-29 group subscription...');
      subscriptionRef.current = nostrService.subscribeToNIP29Group(
        channelId,
        onNewMessage,
        onModerationEvent
      );
    } else {
      subscriptionRef.current = nostrService.subscribeToChannel(
        channelId,
        onNewMessage,
        onMetadataUpdate,
        onModerationEvent
      );
    }
  };

  const setupLocalBotResponseListener = () => {
    // Set up listener for local bot responses when relay publishing fails
    if (typeof window !== 'undefined') {
      window.nostrLocalBotResponse = (localMessage) => {
        // Only process messages for this channel
        if (localMessage.channelId === channelId) {
          onNewMessage(localMessage);
        }
      };
    }
  };

  const cleanupLocalBotResponseListener = () => {
    if (typeof window !== 'undefined') {
      window.nostrLocalBotResponse = null;
    }
  };

  const scrollToBottom = () => {
    // Web-specific scroll to bottom
    setTimeout(() => {
      if (flatListRef.current) {
        flatListRef.current.scrollTop = flatListRef.current.scrollHeight;
      }
    }, 100);
  };

  const onNewMessage = (message) => {
    console.log('📨 onNewMessage called with:', {
      id: message.id,
      content: message.content.substring(0, 100) + '...',
      author: message.author,
      type: message.type,
      tags: message.tags
    });

    setMessages(prev => {
      const exists = prev.find(m => m.id === message.id);
      if (exists) {
        console.log('⚠️ Duplicate message, ignoring:', message.id);
        return prev;
      }
      
      // Check if this is a bot response by looking at message tags OR JSON content
      let processedMessage = { ...message };
      let isBotResponse = false;
      
      // Method 1: Check for message_type tag
      if (message.tags) {
        const messageTypeTag = message.tags.find(tag => tag[0] === 'message_type');
        if (messageTypeTag && messageTypeTag[1] === MESSAGE_TYPES.BOT_RESPONSE) {
          isBotResponse = true;
        }
      }
      
      // Method 2: Check if content looks like bot response JSON (fallback)
      if (!isBotResponse && message.content.startsWith('{"content":') && message.content.includes('"type":')) {
        try {
          const parsed = JSON.parse(message.content);
          if (parsed.content && parsed.type && parsed.timestamp) {
            isBotResponse = true;
            console.log('🤖 Detected bot response by JSON structure');
          }
        } catch (e) {
          // Not JSON, ignore
        }
      }
      
      if (isBotResponse) {
        console.log('🤖 Processing bot response message:', message.id);
        try {
          // Parse bot response JSON content
          const botResponse = JSON.parse(message.content);
          processedMessage = {
            ...message,
            content: botResponse.content || message.content,
            type: MESSAGE_TYPES.BOT_RESPONSE,
            data: botResponse.data
          };
          console.log('✅ Bot response parsed successfully:', botResponse.content.substring(0, 50) + '...');
        } catch (error) {
          console.error('❌ Error parsing bot response:', error);
        }
      }
      
      const updated = [...prev, processedMessage].sort((a, b) => a.timestamp - b.timestamp);
      
      // Auto-scroll to bottom when new message arrives
      scrollToBottom();
      
      return updated;
    });
    
    // Show notifications for new messages (but not for system messages or own messages)
    if (message.type !== MESSAGE_TYPES.SYSTEM && 
        message.author !== 'system' && 
        message.author !== 'bot' &&
        message.author !== nostrService.publicKey) {
      
      const authorName = getUserDisplayName(message.author) || 'Unknown User';
      
      // Check if this is a mention of the current user
      const currentUserPubkey = nostrService.publicKey;
      const isMention = message.content.includes(`@${currentUserPubkey}`) ||
                       (getUserDisplayName(currentUserPubkey) && 
                        message.content.includes(`@${getUserDisplayName(currentUserPubkey)}`));
      
      if (isMention) {
        notificationService.notifyMention(channelName, authorName, message.content);
      } else {
        notificationService.notifyChannelMessage(channelName, authorName, message.content);
      }
    }

    // Track user if it's not a system message
    if (message.author && message.author !== 'system' && message.author !== 'bot') {
      trackUser(message.author, message.timestamp);
      
      // Track message for bot statistics
      botService.trackMessage(channelId, message.author, message.timestamp);
    }
  };

  const trackUser = (pubkey, lastSeen) => {
    setChannelUsers(prev => {
      const newUsers = new Map(prev);
      const existing = newUsers.get(pubkey);
      
      if (!existing || existing.lastSeen < lastSeen) {
        const user = {
          pubkey,
          lastSeen,
          isOperator: channelInfo?.creator === pubkey,
          displayName: pubkey.substring(0, 8) + '...'
        };
        
        newUsers.set(pubkey, user);
        console.log('Tracked user:', user.displayName, 'Total users:', newUsers.size);
      }
      
      return newUsers;
    });

    // Load user profile if we don't have it
    if (!userProfiles.has(pubkey)) {
      loadUserProfile(pubkey);
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
    return `${pubkey.substring(0, 8)}...`;
  };

  const findUserByUsername = (username) => {
    // First check if username matches the current user
    const currentUserProfile = userProfiles.get(nostrService.publicKey);
    if (currentUserProfile && 
        (currentUserProfile.display_name === username || 
         currentUserProfile.name === username || 
         currentUserProfile.username === username)) {
      return nostrService.publicKey;
    }

    // Then check all other users in the channel
    for (const [pubkey, profile] of userProfiles.entries()) {
      if (profile.display_name === username || 
          profile.name === username || 
          profile.username === username) {
        return pubkey;
      }
    }

    // Also check channel users by their tracked display names
    for (const user of channelUsers.values()) {
      const profile = userProfiles.get(user.pubkey);
      if (profile && 
          (profile.display_name === username || 
           profile.name === username || 
           profile.username === username)) {
        return user.pubkey;
      }
    }

    return null;
  };

  const onMetadataUpdate = (event) => {
    console.log('Channel metadata updated:', event);
    try {
      const metadata = JSON.parse(event.content);
      if (metadata.topic && metadata.topic !== channelTopic) {
        const oldTopic = channelTopic;
        setChannelTopic(metadata.topic);
        
        // Only add system message if topic actually changed
        if (oldTopic !== metadata.topic) {
          const systemMessage = {
            id: event.id + '_topic',
            content: `📋 Topic changed to: ${metadata.topic}`,
            author: 'system',
            channelId: channelId,
            timestamp: event.created_at,
            type: MESSAGE_TYPES.SYSTEM
          };
          onNewMessage(systemMessage);
        }
      }
    } catch (error) {
      console.error('Error parsing metadata update:', error);
    }
  };

  const onModerationEvent = (modEvent) => {
    const actionDescriptions = {
      'kick': '👢 kicked',
      'ban': '🚫 banned',
      'op': '👑 granted operator status to',
      'deop': '👤 removed operator status from',
      'mute': '🔇 muted',
      'unmute': '🔊 unmuted'
    };
    
    const actionText = actionDescriptions[modEvent.action] || modEvent.action;
    const moderatorName = modEvent.moderator.substring(0, 8) + '...';
    const targetName = modEvent.target.substring(0, 8) + '...';
    const reasonText = modEvent.reason ? ` (${modEvent.reason})` : '';
    
    const systemMessage = {
      id: modEvent.id,
      content: `${moderatorName} ${actionText} ${targetName}${reasonText}`,
      author: 'system',
      channelId: modEvent.channelId,
      timestamp: modEvent.timestamp,
      type: MESSAGE_TYPES.SYSTEM
    };
    
    onNewMessage(systemMessage);
  };

  const sendMessage = async () => {
    if (!inputText.trim()) return;

    try {
      const trimmedText = inputText.trim();
      
      // Check if it's an IRC command
      const ircCommand = nostrUtils.parseIRCCommand(trimmedText);
      if (ircCommand) {
        await handleIRCCommand(ircCommand);
        setInputText('');
        return;
      }

      // Check if it's a bot command - but send to chat first for visibility
      const botCommand = nostrUtils.parseBotCommandFromMessage(trimmedText);
      if (botCommand) {
        console.log('Bot command detected:', botCommand);
        try {
          // Send message using protocol-appropriate method
          if (channelProtocol === 'nip29') {
            await sendNIP29Message(channelId, trimmedText);
          } else {
            await nostrService.sendChannelMessage(channelId, trimmedText);
          }
          console.log('✅ Bot command sent to Nostr, framework will pick it up');
        } catch (relayError) {
          console.warn('⚠️ Relay publishing failed for bot command, processing locally:', relayError.message);
          
          // Show the user's command locally since relay failed
          const userCommandMessage = {
            id: `local_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            content: trimmedText,
            author: nostrService.publicKey,
            channelId: channelId,
            timestamp: Math.floor(Date.now() / 1000),
            type: MESSAGE_TYPES.TEXT,
            isLocal: true
          };
          onNewMessage(userCommandMessage);
          
          // Process bot command locally when relay publishing fails
          await handleBotCommandLocally(botCommand);
        }
        setInputText('');
        return;
      }

      // Regular message - use protocol-appropriate method
      if (channelProtocol === 'nip29') {
        await sendNIP29Message(channelId, trimmedText);
      } else {
        await nostrService.sendChannelMessage(channelId, trimmedText);
      }
      setInputText('');
      
    } catch (error) {
      console.error('Failed to send message:', error);
      Alert.alert('Error', 'Failed to send message');
    }
  };

  // Send message specifically to NIP-29 group
  const sendNIP29Message = async (groupId, message) => {
    try {
      console.log('🏛️ Sending NIP-29 group message...');
      
      // Use the dedicated NIP-29 messaging method
      await nostrService.sendNIP29GroupMessage(groupId, message);
      
      console.log('✅ NIP-29 message sent successfully');
    } catch (error) {
      console.error('Error sending NIP-29 message:', error);
      
      // Provide user-friendly error message for NIP-29 specific issues
      if (error.message.includes('NIP-29 relays unreachable')) {
        throw new Error('Unable to reach NIP-29 relay servers. NIP-29 groups require specialized infrastructure that appears to be unavailable right now.');
      } else if (error.message.includes('No NIP-29 relays configured')) {
        throw new Error('NIP-29 relay configuration missing. Please check your settings.');
      } else {
        throw new Error(`Failed to send NIP-29 message: ${error.message}`);
      }
    }
  };

  // Perform NIP-29 specific moderation actions
  const performNIP29ModerationAction = async (action, targetUser, reason = '') => {
    try {
      console.log(`🏛️ Performing NIP-29 ${action} action on ${targetUser}`);
      
      // Use the dedicated NIP-29 moderation method
      await nostrService.performNIP29ModerationAction(channelId, action, targetUser, reason);
      
      // Add a system message indicating this is a NIP-29 action
      const systemMessage = {
        id: `nip29_${action}_${Date.now()}`,
        content: `🏛️ NIP-29 Moderation: ${action} action performed on ${targetUser.substring(0, 8)}...${reason ? ` (${reason})` : ''}`,
        author: 'system',
        channelId: channelId,
        timestamp: Math.floor(Date.now() / 1000),
        type: MESSAGE_TYPES.SYSTEM
      };
      onNewMessage(systemMessage);
      
      console.log(`✅ NIP-29 ${action} action completed`);
    } catch (error) {
      console.error(`Error performing NIP-29 ${action}:`, error);
      throw error;
    }
  };

  // Handle bot commands locally when Nostr relay publishing fails
  const handleBotCommandLocally = async (botCommand) => {
    try {
      console.log('🤖 Processing bot command locally:', botCommand);
      
      // Create context similar to what the bot framework expects
      const context = {
        channelId: channelId,
        userId: nostrService.publicKey,
        timestamp: Math.floor(Date.now() / 1000)
      };

      // Use the bot service to execute the command directly
      const response = await botService.sendBotCommand(
        channelId, 
        botCommand.command, 
        botCommand.args, 
        context.userId
      );

      // If we get a response, display it locally
      if (response) {
        const localBotMessage = {
          id: `local_bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          content: response.content || response,
          author: 'bot',
          channelId: channelId,
          timestamp: context.timestamp,
          type: MESSAGE_TYPES.BOT_RESPONSE,
          data: response.data,
          isLocal: true
        };

        // Add the bot response to the chat
        onNewMessage(localBotMessage);
        console.log('✅ Local bot command processed successfully');
      }
    } catch (error) {
      console.error('❌ Error processing bot command locally:', error);
      
      // Show error message in chat
      const errorMessage = {
        id: `local_error_${Date.now()}`,
        content: `❌ Bot error: ${error.message}`,
        author: 'system',
        channelId: channelId,
        timestamp: Math.floor(Date.now() / 1000),
        type: MESSAGE_TYPES.SYSTEM,
        isLocal: true
      };
      onNewMessage(errorMessage);
    }
  };

  const handleIRCCommand = async (command) => {
    switch (command.command) {
      case 'topic':
        if (!userPermissions.canSetTopic) {
          Alert.alert('Permission Denied', 'You need operator privileges to set the topic');
          return;
        }
        if (command.args.length > 0) {
          const topic = command.args.join(' ');
          try {
            await nostrService.updateChannelMetadata(channelId, { topic });
            setChannelTopic(topic);
            
            // Don't add immediate system message - let the real-time event handle it
            Alert.alert('Success', `Topic updated to: ${topic}`);
          } catch (error) {
            console.error('Error updating topic:', error);
            Alert.alert('Error', 'Failed to update topic');
          }
        } else {
          Alert.alert('Current Topic', channelTopic || 'No topic set');
        }
        break;
        
      case 'users':
        showUserListDialog();
        break;
        
      case 'kick':
        if (!userPermissions.canKick) {
          Alert.alert('Permission Denied', 'You need operator privileges to kick users');
          return;
        }
        if (command.args.length > 0) {
          const targetUser = command.args[0];
          const reason = command.args.slice(1).join(' ') || 'No reason provided';
          
          if (channelProtocol === 'nip29') {
            await performNIP29ModerationAction('kick', targetUser, reason);
            Alert.alert('User Muted', `${targetUser.substring(0, 16)}... has been muted in the NIP-29 group.\n\nThis action is enforced by the relay - the user cannot send messages until unmuted.\n\nUse /unkick to unmute them.`);
          } else {
            await nostrService.performModerationAction(channelId, 'kick', targetUser, reason);
            const protocolName = channelProtocol === 'private_nip28' ? 'Private NIP-28 channel' : 'public channel';
            Alert.alert('⚠️ Fake Kick Only', `This is a ${protocolName} - kick commands are NOT enforced.\n\n"${targetUser.substring(0, 16)}..." can still send messages. Only NIP-29 groups have real moderation.\n\nConsider creating a NIP-29 group for actual admin controls.`);
            
            // Add system message explaining this is fake
            const systemMessage = {
              id: `fake_kick_${Date.now()}`,
              content: `⚠️ FAKE MODERATION: "${targetUser.substring(0, 8)}..." was "kicked" but this has NO EFFECT in ${protocolName}s. User can still send messages. Use NIP-29 groups for real moderation.`,
              author: 'system',
              channelId: channelId,
              timestamp: Math.floor(Date.now() / 1000),
              type: MESSAGE_TYPES.SYSTEM
            };
            onNewMessage(systemMessage);
          }
        } else {
          Alert.alert('Error', 'Usage: /kick <user> [reason]');
        }
        break;
        
      case 'unkick':
        if (!userPermissions.canKick) {
          Alert.alert('Permission Denied', 'You need operator privileges to unkick users');
          return;
        }
        if (command.args.length > 0) {
          const targetUser = command.args[0];
          const reason = command.args.slice(1).join(' ') || 'User unmuted';
          
          if (channelProtocol === 'nip29') {
            await performNIP29ModerationAction('unkick', targetUser, reason);
            Alert.alert('User Unmuted', `${targetUser.substring(0, 16)}... has been unmuted in the NIP-29 group.\n\nThis action is enforced by the relay - the user can now send messages again.`);
          } else {
            const protocolName = channelProtocol === 'private_nip28' ? 'Private NIP-28 channel' : 'public channel';
            Alert.alert('⚠️ No Effect', `This is a ${protocolName} - unkick commands have no effect.\n\nUsers are never actually muted in non-NIP-29 groups, so unmuting does nothing.\n\nOnly NIP-29 groups have real mute/unmute functionality.`);
          }
        } else {
          Alert.alert('Error', 'Usage: /unkick <user> [reason]');
        }
        break;
        
      case 'ban':
        if (!userPermissions.canBan) {
          Alert.alert('Permission Denied', 'You need operator privileges to ban users');
          return;
        }
        if (command.args.length > 0) {
          const targetUser = command.args[0];
          const reason = command.args.slice(1).join(' ') || 'No reason provided';
          
          if (channelProtocol === 'nip29') {
            await performNIP29ModerationAction('ban', targetUser, reason);
            Alert.alert('User Removed', `${targetUser.substring(0, 16)}... has been permanently removed from the NIP-29 group.\n\nThis action is enforced by the relay - the user cannot send messages anymore.`);
          } else {
            await nostrService.performModerationAction(channelId, 'ban', targetUser, reason);
            const protocolName = channelProtocol === 'private_nip28' ? 'Private NIP-28 channel' : 'public channel';
            Alert.alert('⚠️ Fake Ban Only', `This is a ${protocolName} - ban commands are NOT enforced.\n\n"${targetUser.substring(0, 16)}..." can still send messages and rejoin. Only NIP-29 groups have real moderation.\n\nConsider creating a NIP-29 group for actual admin controls.`);
            
            // Add system message explaining this is fake
            const systemMessage = {
              id: `fake_ban_${Date.now()}`,
              content: `⚠️ FAKE MODERATION: "${targetUser.substring(0, 8)}..." was "banned" but this has NO EFFECT in ${protocolName}s. User can still send messages and rejoin. Use NIP-29 groups for real moderation.`,
              author: 'system',
              channelId: channelId,
              timestamp: Math.floor(Date.now() / 1000),
              type: MESSAGE_TYPES.SYSTEM
            };
            onNewMessage(systemMessage);
          }
        } else {
          Alert.alert('Error', 'Usage: /ban <user> [reason]');
        }
        break;

      case 'op':
        if (!userPermissions.canOp) {
          Alert.alert('Permission Denied', 'You need operator privileges to grant operator status');
          return;
        }
        if (command.args.length > 0) {
          const targetUser = command.args[0];
          
          if (channelProtocol === 'nip29') {
            await performNIP29ModerationAction('op', targetUser);
            Alert.alert('Operator Granted', `${targetUser.substring(0, 16)}... is now an operator in the NIP-29 group.\n\nThey have real admin powers enforced by the relay.`);
          } else {
            await nostrService.performModerationAction(channelId, 'op', targetUser);
            const protocolName = channelProtocol === 'private_nip28' ? 'Private NIP-28 channel' : 'public channel';
            Alert.alert('⚠️ Fake Op Only', `This is a ${protocolName} - op commands are NOT enforced.\n\n"${targetUser.substring(0, 16)}..." has no real admin powers. Only NIP-29 groups have actual operator privileges.`);
            
            // Add system message explaining this is fake
            const systemMessage = {
              id: `fake_op_${Date.now()}`,
              content: `⚠️ FAKE MODERATION: "${targetUser.substring(0, 8)}..." was "opped" but this has NO EFFECT in ${protocolName}s. User has no real admin powers. Use NIP-29 groups for real operator privileges.`,
              author: 'system',
              channelId: channelId,
              timestamp: Math.floor(Date.now() / 1000),
              type: MESSAGE_TYPES.SYSTEM
            };
            onNewMessage(systemMessage);
          }
        } else {
          Alert.alert('Error', 'Usage: /op <user>');
        }
        break;

      case 'deop':
        if (!userPermissions.canOp) {
          Alert.alert('Permission Denied', 'You need operator privileges to remove operator status');
          return;
        }
        if (command.args.length > 0) {
          const targetUser = command.args[0];
          
          if (channelProtocol === 'nip29') {
            await performNIP29ModerationAction('deop', targetUser);
            Alert.alert('Operator Removed', `${targetUser.substring(0, 16)}... is no longer an operator in the NIP-29 group.\n\nTheir admin powers have been revoked by the relay.`);
          } else {
            await nostrService.performModerationAction(channelId, 'deop', targetUser);
            const protocolName = channelProtocol === 'private_nip28' ? 'Private NIP-28 channel' : 'public channel';
            Alert.alert('⚠️ Fake Deop Only', `This is a ${protocolName} - deop commands are NOT enforced.\n\n"${targetUser.substring(0, 16)}..." status unchanged. Only NIP-29 groups have actual operator management.`);
            
            // Add system message explaining this is fake
            const systemMessage = {
              id: `fake_deop_${Date.now()}`,
              content: `⚠️ FAKE MODERATION: "${targetUser.substring(0, 8)}..." was "deopped" but this has NO EFFECT in ${protocolName}s. User status unchanged. Use NIP-29 groups for real operator management.`,
              author: 'system',
              channelId: channelId,
              timestamp: Math.floor(Date.now() / 1000),
              type: MESSAGE_TYPES.SYSTEM
            };
            onNewMessage(systemMessage);
          }
        } else {
          Alert.alert('Error', 'Usage: /deop <user>');
        }
        break;

      case 'msg':
        if (command.args.length < 2) {
          Alert.alert('Error', 'Usage: /msg <user> <message>');
          return;
        }
        
        const targetUser = command.args[0];
        const message = command.args.slice(1).join(' ');
        
        let recipientPubkey = null;
        let recipientName = targetUser;
        
        // First try to find user by username/display name
        const userPubkey = findUserByUsername(targetUser);
        if (userPubkey) {
          recipientPubkey = userPubkey;
          recipientName = getUserDisplayName(userPubkey);
        }
        // If not found by username, try pubkey/npub validation
        else if (nostrUtils.isValidPubkey(targetUser)) {
          recipientPubkey = targetUser;
          recipientName = targetUser.substring(0, 8) + '...';
        }
        else if (nostrUtils.isValidNpub(targetUser)) {
          try {
            recipientPubkey = nostrUtils.npubToPubkey(targetUser);
            recipientName = targetUser.substring(0, 8) + '...';
          } catch (error) {
            Alert.alert('Error', 'Invalid npub format');
            return;
          }
        }
        else {
          Alert.alert('Error', `User "${targetUser}" not found. Use username, pubkey, or npub format.`);
          return;
        }
        
        // Navigate to private conversation
        navigation.navigate('PrivateConversation', {
          contactPubkey: recipientPubkey,
          contactName: recipientName,
          initialMessage: message
        });
        break;
        
      case 'help':
        showHelp();
        break;
        
      default:
        Alert.alert('Unknown Command', `Command /${command.command} not recognized`);
    }
  };

  const loadPrivateGroupMembers = async () => {
    try {
      const members = await nostrService.getPrivateGroupMembers(channelId);
      setPrivateGroupMembers(members);
      console.log(`🔒 Loaded ${members.length} private group members`);
    } catch (error) {
      console.error('Failed to load private group members:', error);
    }
  };

  // Load the current user's following list for user search
  const loadFollowingList = async () => {
    try {
      const currentUserPubkey = nostrService.publicKey;
      if (!currentUserPubkey) {
        console.log('❌ No public key found for current user');
        return;
      }

      console.log('🔍 Loading following list for user search...');
      const following = await nostrService.getUserContacts(currentUserPubkey);
      console.log(`📋 Following list: ${following.length} contacts`, following);
      setMyFollowing(following);

      if (following.length > 0) {
        console.log(`👥 Loaded ${following.length} contacts, fetching profiles...`);
        const profiles = await nostrService.getMultipleUserProfiles(following);
        console.log(`✅ Loaded ${profiles.size} profiles for search`);
        
        // Debug: Log first few profiles
        let debugCount = 0;
        for (const [pubkey, profile] of profiles) {
          if (debugCount < 3) {
            console.log(`👤 Profile ${debugCount + 1}:`, {
              pubkey: pubkey.substring(0, 16) + '...',
              name: profile.name,
              display_name: profile.display_name
            });
            debugCount++;
          }
        }
        
        setFollowingProfiles(profiles);
      } else {
        console.log('📝 No following contacts found');
      }
    } catch (error) {
      console.error('❌ Failed to load following list:', error);
    }
  };

  // Search through following users by username/display name
  const searchFollowingUsers = async (query) => {
    console.log(`🔍 Searching for: "${query}"`);
    
    if (!query.trim()) {
      console.log('🔍 Empty query, clearing results');
      setSearchResults([]);
      return;
    }

    if (followingProfiles.size === 0) {
      console.log('⚠️ No following profiles loaded yet');
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const normalizedQuery = query.toLowerCase().trim();
      console.log(`🔍 Normalized query: "${normalizedQuery}"`);
      console.log(`🔍 Searching through ${followingProfiles.size} profiles...`);
      
      const results = [];

      // Search through following profiles
      for (const [pubkey, profile] of followingProfiles) {
        const displayName = profile.display_name || profile.name || '';
        const username = profile.name || '';
        
        console.log(`👤 Checking profile: ${displayName || username || 'No name'} (${pubkey.substring(0, 8)}...)`);
        
        // Check if query matches display name or username
        if (displayName.toLowerCase().includes(normalizedQuery) || 
            username.toLowerCase().includes(normalizedQuery)) {
          
          const result = {
            pubkey,
            profile,
            displayName: displayName || username || `User ${pubkey.substring(0, 8)}...`,
            username: username || pubkey.substring(0, 8) + '...'
          };
          
          results.push(result);
          console.log(`✅ Match found: ${result.displayName}`);
        }
      }

      console.log(`🔍 Search complete: ${results.length} matches found`);

      // Sort by relevance (exact matches first, then partial matches)
      results.sort((a, b) => {
        const aExact = a.displayName.toLowerCase() === normalizedQuery || a.username.toLowerCase() === normalizedQuery;
        const bExact = b.displayName.toLowerCase() === normalizedQuery || b.username.toLowerCase() === normalizedQuery;
        
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return a.displayName.localeCompare(b.displayName);
      });

      const limitedResults = results.slice(0, 10);
      console.log(`📋 Setting ${limitedResults.length} results`);
      setSearchResults(limitedResults);
    } catch (error) {
      console.error('❌ Error searching following users:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle user selection from search results
  const selectUserFromSearch = (user) => {
    setInviteePubkey(user.pubkey);
    setSearchQuery(user.displayName);
    setSearchResults([]);
  };

  // Reset invite modal state when opening
  const openInviteModal = () => {
    setInviteePubkey('');
    setInviteMessage('');
    setSearchQuery('');
    setSearchResults([]);
    setShowInviteModal(true);
    loadFollowingList(); // Load following list when modal opens
  };

  const sendGroupInvitation = async () => {
    if (!inviteePubkey.trim()) {
      Alert.alert('Error', 'Please enter a public key or npub');
      return;
    }

    try {
      let pubkey = inviteePubkey.trim();
      
      // Handle npub format
      if (pubkey.startsWith('npub')) {
        pubkey = nostrUtils.npubToPubkey(pubkey);
      }

      // Validate pubkey format
      if (!nostrUtils.isValidPubkey(pubkey)) {
        Alert.alert('Error', 'Invalid public key format');
        return;
      }

      // Check if user is already a member
      if (privateGroupMembers.includes(pubkey)) {
        Alert.alert('Error', 'User is already a member of this group');
        return;
      }

      // Handle different channel protocols
      if (channelProtocol === 'nip29') {
        console.log('🏛️ Sending NIP-29 group invitation...');
        // Use groupId for NIP-29 groups, fall back to channelId if groupId is not available
        const nip29GroupId = groupId || channelId;
        await nostrService.inviteToNIP29Group(nip29GroupId, pubkey, inviteMessage);
        Alert.alert('Success', 'NIP-29 group invitation sent successfully!');
      } else if (channelProtocol === 'encrypted') {
        console.log('🔐 Sending encrypted channel invitation with key distribution...');
        
        // Get the current group encryption key
        const groupKey = await groupEncryptionService.getGroupKey(channelId);
        if (!groupKey) {
          Alert.alert('Error', 'Could not retrieve encryption key for this channel');
          return;
        }
        
        // Distribute the group key to the new member
        const keyDistribution = await groupEncryptionService.distributeGroupKey(
          channelId,
          groupKey.key,
          groupKey.version,
          [pubkey],
          nostrService
        );
        
        // Check if key distribution was successful
        const distributionResult = keyDistribution.find(result => result.member === pubkey);
        if (!distributionResult || !distributionResult.success) {
          Alert.alert('Error', 'Failed to distribute encryption key to invited user');
          return;
        }
        
        // Also send the regular invitation message
        await nostrService.inviteToPrivateGroup(channelId, pubkey, inviteMessage);
        
        Alert.alert('Success', 'Encrypted channel invitation and encryption key sent successfully!');
      } else {
        // Regular private channel invitation
        await nostrService.inviteToPrivateGroup(channelId, pubkey, inviteMessage);
        Alert.alert('Success', 'Invitation sent successfully!');
      }
      setShowInviteModal(false);
      setInviteePubkey('');
      setInviteMessage('');
      setSearchQuery('');
      setSearchResults([]);
      
      // Refresh member list
      await loadPrivateGroupMembers();
    } catch (error) {
      console.error('Error sending invitation:', error);
      Alert.alert('Error', 'Failed to send invitation');
    }
  };

  const renderInviteModal = () => {
    if (!showInviteModal) return null;

    return (
      <Modal
        visible={showInviteModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: theme.cardBackgroundColor }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textColor }]}>
                {channelProtocol === 'nip29' ? 'Invite to NIP-29 Group' : 'Invite to Private Group'}
              </Text>
              <TouchableOpacity
                onPress={() => setShowInviteModal(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color={theme.textColor} />
              </TouchableOpacity>
            </View>

            {/* Username Search Section */}
            <Text style={[styles.modalLabel, { color: theme.textColor }]}>
              Search Following Users ({followingProfiles.size} loaded)
            </Text>
            <View style={styles.searchContainer}>
              <TextInput
                style={[styles.modalInput, {
                  backgroundColor: theme.surfaceColor,
                  color: theme.textColor,
                  borderColor: theme.borderColor,
                  paddingRight: isSearching ? 50 : 16
                }]}
                value={searchQuery}
                onChangeText={(text) => {
                  console.log(`📝 Search input changed: "${text}"`);
                  setSearchQuery(text);
                  // Also trigger immediate search for testing
                  if (text.trim() && followingProfiles.size > 0) {
                    setTimeout(() => searchFollowingUsers(text), 100);
                  }
                }}
                placeholder="Search by username or display name..."
                placeholderTextColor={theme.secondaryTextColor}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {isSearching && (
                <View style={styles.searchLoadingIndicator}>
                  <ActivityIndicator size="small" color={theme.primaryColor} />
                </View>
              )}
            </View>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <ScrollView 
                style={[styles.searchResults, { backgroundColor: theme.surfaceColor }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {searchResults.map((user, index) => (
                  <TouchableOpacity
                    key={user.pubkey}
                    style={[styles.searchResultItem, { 
                      borderBottomColor: theme.borderColor,
                      borderBottomWidth: index < searchResults.length - 1 ? 1 : 0
                    }]}
                    onPress={() => selectUserFromSearch(user)}
                  >
                    <View style={styles.searchResultContent}>
                      <Text style={[styles.searchResultName, { color: theme.textColor }]}>
                        {user.displayName}
                      </Text>
                      <Text style={[styles.searchResultUsername, { color: theme.secondaryTextColor }]}>
                        @{user.username}
                      </Text>
                      <Text style={[styles.searchResultPubkey, { color: theme.mutedTextColor }]}>
                        {user.pubkey.substring(0, 16)}...
                      </Text>
                    </View>
                    <Ionicons 
                      name="person-add" 
                      size={20} 
                      color={theme.primaryColor} 
                    />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Pubkey Input Section */}
            <Text style={[styles.modalLabel, { color: theme.textColor, marginTop: 16 }]}>
              Or Enter Public Key/npub *
            </Text>
            <TextInput
              style={[styles.modalInput, {
                backgroundColor: theme.surfaceColor,
                color: theme.textColor,
                borderColor: theme.borderColor
              }]}
              value={inviteePubkey}
              onChangeText={setInviteePubkey}
              placeholder="npub... or hex public key"
              placeholderTextColor={theme.secondaryTextColor}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {/* Personal Message Section */}
            <Text style={[styles.modalLabel, { color: theme.textColor }]}>
              Personal Message (optional)
            </Text>
            <TextInput
              style={[styles.modalInput, styles.modalTextArea, {
                backgroundColor: theme.surfaceColor,
                color: theme.textColor,
                borderColor: theme.borderColor
              }]}
              value={inviteMessage}
              onChangeText={setInviteMessage}
              placeholder="Add a personal message to your invitation..."
              placeholderTextColor={theme.secondaryTextColor}
              multiline
              numberOfLines={3}
            />

            {/* Action Buttons */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: theme.borderColor }]}
                onPress={() => setShowInviteModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: theme.textColor }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.sendButton, { backgroundColor: theme.primaryColor }]}
                onPress={sendGroupInvitation}
              >
                <Text style={[styles.modalButtonText, { color: 'white' }]}>Send Invite</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const showChannelInfo = () => {
    const operatorStatus = userPermissions.isOperator ? 'Yes' : 'No';
    const creator = channelInfo?.creator?.substring(0, 16) + '...' || 'Unknown';
    const topic = channelTopic || 'No topic set';
    const protocolName = channelProtocol === 'nip29' ? 'NIP-29 (Managed Group)' : 
                        channelProtocol === 'private_nip28' ? 'Private NIP-28 (Basic Privacy)' : 
                        'Public Channel';
    const protocolDescription = channelProtocol === 'nip29' ? 
                               'Relay-managed with full admin controls' :
                               channelProtocol === 'private_nip28' ? 
                               'Invitation-only access, plain text messages' :
                               'Public channel on Nostr network';
    
    Alert.alert(
      'Channel Info',
      `Channel: #${channelName}\nProtocol: ${protocolName}\nFeatures: ${protocolDescription}\nCreator: ${creator}\nTopic: ${topic}\nMessages: ${messages.length}\nYou are operator: ${operatorStatus}`,
      [{ text: 'OK' }]
    );
  };

  const showUserListDialog = () => {
    const userArray = Array.from(channelUsers.values())
      .sort((a, b) => b.lastSeen - a.lastSeen);
    
    let userListContent;
    
    if (userArray.length === 0) {
      userListContent = '👥 No users found. Users will appear here as they send messages.';
    } else {
      const userListText = userArray.map(user => {
        const timeStr = nostrUtils.formatTimestamp(user.lastSeen);
        const displayName = getUserDisplayName(user.pubkey);
        return `  ${user.isOperator ? '@' : ''}${displayName} (${timeStr})`;
      }).join('\n');
      
      userListContent = `👥 Users in channel (${userArray.length}):\n${userListText}`;
    }
    
    // Add as system message to chat
    const systemMessage = {
      id: Date.now().toString() + '_userlist',
      content: userListContent,
      author: 'system',
      channelId: channelId,
      timestamp: Math.floor(Date.now() / 1000),
      type: MESSAGE_TYPES.SYSTEM
    };
    
    onNewMessage(systemMessage);
  };

  const showHelp = () => {
    const protocolInfo = channelProtocol === 'nip29' ? 
      '\n\n🏛️ NIP-29 Group - REAL Moderation:\n• Kick command mutes users (temporary silence)\n• Unkick command unmutes users\n• Ban command permanently removes users\n• Relay enforces all admin actions\n• Operator privileges have real power' :
      channelProtocol === 'private_nip28' ? 
        '\n\n⚠️ Private NIP-28 Channel - FAKE Moderation:\n• Kick/ban commands are visual only\n• No real enforcement - users can still message\n• Encrypted invitations, plain text messages\n• Create NIP-29 group for real moderation' :
        '\n\n# Public Channel - FAKE Moderation:\n• Kick/ban commands are visual only\n• No real enforcement - users can still message\n• Anyone can join and participate\n• Create NIP-29 group for real moderation';
    
    const operatorCommands = userPermissions.isOperator ? 
      (channelProtocol === 'nip29' ? 
        '\n\n🛡️ Operator Commands (ENFORCED):\n/topic [text] - Set/view channel topic\n/kick [user] [reason] - Mute user (temporary silence)\n/unkick [user] [reason] - Unmute user\n/ban [user] [reason] - Permanently ban user\n/op [user] - Grant real operator status\n/deop [user] - Remove real operator status' :
        '\n\n⚠️ Operator Commands (VISUAL ONLY):\n/topic [text] - Set channel topic\n/kick [user] [reason] - Fake mute (no effect)\n/unkick [user] [reason] - Fake unmute (no effect)\n/ban [user] [reason] - Fake ban (no effect)\n/op [user] - Fake op status (no power)\n/deop [user] - Fake deop (no effect)\n\n⚠️ These don\'t actually work in non-NIP-29 groups!'
      ) : 
      '';
    
    const helpContent = `📋 IRC on Nostr - Command Reference

🔧 IRC Commands (8 total):
/help - Show this IRC command help
/users - List active channel users
/msg [username|pubkey|npub] [message] - Send private message
/topic [text] - Set/view channel topic${operatorCommands ? '' : ' (operators only)'}
/kick [user] [reason] - Mute user${operatorCommands ? '' : ' (operators only)'}
/unkick [user] [reason] - Unmute user${operatorCommands ? '' : ' (operators only)'}
/ban [user] [reason] - Ban user${operatorCommands ? '' : ' (operators only)'}
/op [user] - Grant operator status${operatorCommands ? '' : ' (operators only)'}
/deop [user] - Remove operator status${operatorCommands ? '' : ' (operators only)'}

🤖 Bot Commands (32 total):
• Helper: !help, !commands, !about, !time
• Stats: !stats, !uptime  
• Weather: !weather, !forecast
• Games: !roll, !flip, !8ball, !rps, !number
• Poker: !poker, !solo, !join, !commit, !reveal, !start, !bet, !call, !check, !fold, !raise, !verify, !games, !hand, !chips, !status, !cards

💡 Examples:
• !help - Complete bot command reference
• !weather New York - Get weather for New York  
• !poker 100 4 - Start 4-player poker game
• !roll 2d10+5 - Roll dice with modifier

Total: 40 commands available${operatorCommands}${protocolInfo}`;
    
    // Add help as system message to chat
    const systemMessage = {
      id: Date.now().toString() + '_help',
      content: helpContent,
      author: 'system',
      channelId: channelId,
      timestamp: Math.floor(Date.now() / 1000),
      type: MESSAGE_TYPES.SYSTEM
    };
    
    onNewMessage(systemMessage);
  };

  const renderMessage = ({ item }) => {
    const isSystem = item.type === MESSAGE_TYPES.SYSTEM;
    const isBot = item.type === MESSAGE_TYPES.BOT_RESPONSE;
    const isOperator = channelInfo && item.author === channelInfo.creator;
    
    return (
      <View style={[
        styles.messageContainer,
        isSystem && styles.systemMessage,
        isBot && styles.botMessage
      ]}>
        {!isSystem && !isBot && (
          <View style={styles.messageHeader}>
            <Text style={[styles.messageAuthor, { color: theme.secondaryTextColor }]}>
              {getUserDisplayName(item.author)}
              {isOperator && <Text style={[styles.operatorBadge, { color: theme.successColor }]}> @</Text>}
            </Text>
          </View>
        )}
        {isBot && (
          <View style={styles.messageHeader}>
            <Text style={[styles.messageAuthor, { color: theme.primaryColor }]}>
              🤖 Bot
            </Text>
          </View>
        )}
        <Text style={[
          styles.messageContent,
          { 
            color: isSystem ? theme.warningColor : 
                   isBot ? theme.primaryColor : 
                   theme.textColor 
          },
          isSystem && styles.systemMessageText,
          isBot && styles.botMessageText
        ]}>
          {typeof item.content === 'string' ? item.content : JSON.stringify(item.content)}
        </Text>
        <Text style={[styles.messageTime, { color: theme.secondaryTextColor }]}>
          {nostrUtils.formatTimestamp(item.timestamp)}
        </Text>
      </View>
    );
  };

  const removeMemberFromGroup = async (memberPubkey) => {
    Alert.alert(
      'Remove Member',
      `Are you sure you want to remove this member from the private group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              // Note: In a full implementation, we would create a "remove member" event
              // For now, we'll just remove them from the local list and show a message
              console.log(`🚫 Removing member ${memberPubkey.substring(0, 8)}... from private group`);
              
              // TODO: Implement actual member removal event in NostrService
              // await nostrService.removeMemberFromPrivateGroup(channelId, memberPubkey);
              
              // For now, just update the local state
              setPrivateGroupMembers(prev => prev.filter(pubkey => pubkey !== memberPubkey));
              
              Alert.alert('Success', 'Member removed from the group');
            } catch (error) {
              console.error('Error removing member:', error);
              Alert.alert('Error', 'Failed to remove member');
            }
          }
        }
      ]
    );
  };

  const renderUserList = () => {
    // For private groups, show member list; for public channels, show active users
    const displayUsers = isPrivateGroup ? 
      privateGroupMembers.map(pubkey => ({ 
        pubkey, 
        lastSeen: Date.now() / 1000, 
        isOperator: channelInfo?.creator === pubkey,
        isMember: true
      })) : 
      Array.from(channelUsers.values()).sort((a, b) => b.lastSeen - a.lastSeen);

    const title = isPrivateGroup ? `Members (${displayUsers.length})` : `Users (${displayUsers.length})`;

    return (
      <View style={[styles.userListContainer, { backgroundColor: theme.cardBackgroundColor }]}>
        <View style={[styles.userListHeader, { borderBottomColor: theme.borderColor }]}>
          <Text style={[styles.userListTitle, { color: theme.textColor }]}>
            {title}
          </Text>
          <View style={styles.userListHeaderButtons}>
            {isPrivateGroup && (
              <TouchableOpacity 
                onPress={() => {
                  setShowUserList(false);
                  setShowInviteModal(true);
                }}
                style={styles.inviteHeaderButton}
              >
                <Ionicons name="person-add" size={18} color={theme.primaryColor} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setShowUserList(false)}>
              <Ionicons name="close" size={20} color={theme.secondaryTextColor} />
            </TouchableOpacity>
          </View>
        </View>
        <FlatList
          data={displayUsers}
          keyExtractor={(item) => item.pubkey}
          renderItem={({ item }) => (
            <View style={styles.userItem}>
              <View style={styles.userInfo}>
                <Text style={[styles.userName, { color: theme.textColor }]}>
                  {item.isOperator && <Text style={[styles.operatorBadge, { color: theme.successColor }]}>@ </Text>}
                  {isPrivateGroup && item.isMember && <Text style={[styles.memberBadge, { color: theme.primaryColor }]}>👤 </Text>}
                  {getUserDisplayName(item.pubkey)}
                </Text>
                {!isPrivateGroup && (
                  <Text style={[styles.userLastSeen, { color: theme.secondaryTextColor }]}>
                    {nostrUtils.formatTimestamp(item.lastSeen)}
                  </Text>
                )}
                {isPrivateGroup && (
                  <Text style={[styles.memberStatus, { color: theme.secondaryTextColor }]}>
                    {item.pubkey === nostrService.publicKey ? 'You' : 'Member'}
                  </Text>
                )}
              </View>
              {isPrivateGroup && item.pubkey !== nostrService.publicKey && userPermissions.isOperator && (
                <TouchableOpacity
                  style={[styles.removeButton, { backgroundColor: theme.errorColor }]}
                  onPress={() => removeMemberFromGroup(item.pubkey)}
                >
                  <Ionicons name="remove" size={16} color="white" />
                </TouchableOpacity>
              )}
            </View>
          )}
          style={styles.userList}
        />
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundColor }]}>
      {/* Topic bar */}
      {channelTopic ? (
        <View style={[styles.topicContainer, { backgroundColor: theme.surfaceColor }]}>
          <Ionicons name="bookmark-outline" size={16} color={theme.primaryColor} />
          <Text style={[styles.topicText, { color: theme.textColor }]} numberOfLines={2}>
            {channelTopic}
          </Text>
        </View>
      ) : null}
      
      {/* Messages area - WEB SCROLLABLE */}
      <View 
        ref={flatListRef}
        style={[
          styles.messagesContainer,
          { 
            backgroundColor: theme.backgroundColor,
            overflow: 'auto', // Better scroll control
            overflowX: 'hidden', // No horizontal scroll
            maxHeight: 'calc(100vh - 200px)' // CSS calc for proper height
          }
        ]}
      >
        {/* Render messages directly */}
        {messages.map((message) => renderMessage({ item: message }))}
        
        {/* Empty state */}
        {messages.length === 0 && !isLoading && (
          <View style={styles.emptyContainer}>
            <Ionicons 
              name="chatbubble-outline" 
              size={48} 
              color={theme.secondaryTextColor} 
            />
            <Text style={[styles.emptyText, { color: theme.secondaryTextColor }]}>
              No messages yet
            </Text>
            <Text style={[styles.emptySubtext, { color: theme.secondaryTextColor }]}>
              Start the conversation!
            </Text>
          </View>
        )}
        
        {/* Loading state */}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
              Loading messages...
            </Text>
          </View>
        )}
      </View>

      {/* Input area - FIXED AT BOTTOM */}
      <View style={[styles.inputContainer, { backgroundColor: theme.cardBackgroundColor }]}>
        <TextInput
          style={[styles.textInput, { 
            backgroundColor: theme.surfaceColor,
            color: theme.textColor,
            borderColor: theme.borderColor
          }]}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={sendMessage}
          placeholder="Type a message or /help for commands..."
          placeholderTextColor={theme.secondaryTextColor}
          multiline={false}
          maxLength={1000}
          blurOnSubmit={false}
          returnKeyType="send"
          enablesReturnKeyAutomatically={true}
        />
        <TouchableOpacity
          style={[styles.sendButton, { 
            backgroundColor: inputText.trim() ? theme.primaryColor : theme.borderColor 
          }]}
          onPress={sendMessage}
          disabled={!inputText.trim()}
        >
          <Ionicons name="send" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {showUserList && renderUserList()}
      
      {/* Invite Modal for Private Groups */}
      {renderInviteModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  topicContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  topicText: {
    flex: 1,
    fontSize: 14,
    fontStyle: 'italic',
    marginLeft: 8,
  },
  userListContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 250,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.1)',
  },
  userListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  userListTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  userList: {
    flex: 1,
  },
  userItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  userName: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  userLastSeen: {
    fontSize: 10,
    marginLeft: 8,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexGrow: 1,
  },
  messageContainer: {
    paddingVertical: 8,
    marginBottom: 4,
  },
  systemMessage: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  botMessage: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
    paddingLeft: 12,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  messageAuthor: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  operatorBadge: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  messageContent: {
    fontSize: 16,
    lineHeight: 20,
  },
  systemMessageText: {
    fontStyle: 'italic',
    fontSize: 14,
  },
  botMessageText: {
    fontSize: 15,
    fontWeight: '500',
  },
  messageTime: {
    fontSize: 10,
    marginTop: 2,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 12,
    height: 44, // Fixed height for consistency
    fontSize: 16,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 8,
  },
  modalTextArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 24,
  },
  modalButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sendButton: {
    // Already defined above, but may need to add more styles if needed
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  
  // Search functionality styles for invite modal
  searchContainer: {
    position: 'relative',
  },
  searchLoadingIndicator: {
    position: 'absolute',
    right: 16,
    top: '50%',
    transform: [{ translateY: -10 }],
  },
  searchResults: {
    maxHeight: 200,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 8,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchResultContent: {
    flex: 1,
  },
  searchResultName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  searchResultUsername: {
    fontSize: 14,
    marginBottom: 2,
  },
  searchResultPubkey: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  
  // User list styles for private groups
  userListHeaderButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inviteHeaderButton: {
    padding: 4,
  },
  userInfo: {
    flex: 1,
  },
  memberBadge: {
    fontSize: 12,
    fontWeight: '600',
  },
  memberStatus: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
});

export default ChannelScreen;