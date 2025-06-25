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
import { nostrUtils } from '../utils/nostrUtils';
import { IRC_COMMANDS, BOT_COMMANDS, MESSAGE_TYPES, THEMES } from '../utils/constants';

const ChannelScreen = ({ route, navigation, theme = THEMES.DARK }) => {
  const { channelId, channelName, isPrivate = false } = route.params;
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
  const flatListRef = useRef();
  const subscriptionRef = useRef();


  useEffect(() => {
    const operatorIndicator = userPermissions.isOperator ? ' @' : '';
    const groupPrefix = isPrivate ? '🔒 ' : '#';
    navigation.setOptions({ 
      title: `${groupPrefix}${channelName}${operatorIndicator}`,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* Invite button for private groups */}
          {isPrivate && (
            <TouchableOpacity 
              onPress={() => setShowInviteModal(true)}
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
          <TouchableOpacity onPress={showChannelInfo}>
            <Ionicons 
              name={userPermissions.isOperator ? "shield" : "information-circle-outline"} 
              size={24} 
              color={userPermissions.isOperator ? theme.successColor : theme.textColor} 
            />
          </TouchableOpacity>
        </View>
      )
    });

    loadChannelData();
    subscribeToChannel();
    setupLocalBotResponseListener();

    return () => {
      if (subscriptionRef.current) {
        nostrService.unsubscribe(subscriptionRef.current);
      }
      cleanupLocalBotResponseListener();
    };
  }, [channelId]);

  const loadChannelData = async () => {
    try {
      setIsLoading(true);
      const channelMessages = await nostrService.queryChannelMessages(channelId, 100);
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
      if (isPrivate) {
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
    subscriptionRef.current = nostrService.subscribeToChannel(
      channelId,
      onNewMessage,
      onMetadataUpdate,
      onModerationEvent
    );
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
          // First try to send the command as a regular message so everyone can see it
          await nostrService.sendChannelMessage(channelId, trimmedText);
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

      // Regular message
      await nostrService.sendChannelMessage(channelId, trimmedText);
      setInputText('');
      
    } catch (error) {
      console.error('Failed to send message:', error);
      Alert.alert('Error', 'Failed to send message');
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
          await nostrService.performModerationAction(channelId, 'kick', targetUser, reason);
          Alert.alert('User Kicked', `${targetUser.substring(0, 16)}... has been kicked: ${reason}`);
        } else {
          Alert.alert('Error', 'Usage: /kick <user> [reason]');
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
          await nostrService.performModerationAction(channelId, 'ban', targetUser, reason);
          Alert.alert('User Banned', `${targetUser.substring(0, 16)}... has been banned: ${reason}`);
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
          await nostrService.performModerationAction(channelId, 'op', targetUser);
          Alert.alert('Operator Granted', `${targetUser.substring(0, 16)}... is now an operator`);
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
          await nostrService.performModerationAction(channelId, 'deop', targetUser);
          Alert.alert('Operator Removed', `${targetUser.substring(0, 16)}... is no longer an operator`);
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

      await nostrService.inviteToPrivateGroup(channelId, pubkey, inviteMessage);
      
      Alert.alert('Success', 'Invitation sent successfully!');
      setShowInviteModal(false);
      setInviteePubkey('');
      setInviteMessage('');
      
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
                Invite to Private Group
              </Text>
              <TouchableOpacity
                onPress={() => setShowInviteModal(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color={theme.textColor} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalLabel, { color: theme.textColor }]}>
              User Public Key or npub *
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
    
    Alert.alert(
      'Channel Info',
      `Channel: #${channelName}\nCreator: ${creator}\nTopic: ${topic}\nMessages: ${messages.length}\nYou are operator: ${operatorStatus}`,
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
    const operatorCommands = userPermissions.isOperator ? 
      '\n\nOperator Commands:\n/topic <text> - Set channel topic\n/kick <user> [reason] - Kick user\n/ban <user> [reason] - Ban user\n/op <user> - Grant operator status\n/deop <user> - Remove operator status' : 
      '';
    
    const helpContent = `📋 Available Commands\n\nBasic Commands:\n/users - List users\n/msg <username|pubkey> <message> - Send private message\n/help - Show this help\n\nBot Commands:\n!help - Show bot help\n!weather <location> - Get weather\n!roll <dice> - Roll dice${operatorCommands}`;
    
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
    const displayUsers = isPrivate ? 
      privateGroupMembers.map(pubkey => ({ 
        pubkey, 
        lastSeen: Date.now() / 1000, 
        isOperator: channelInfo?.creator === pubkey,
        isMember: true
      })) : 
      Array.from(channelUsers.values()).sort((a, b) => b.lastSeen - a.lastSeen);

    const title = isPrivate ? `Members (${displayUsers.length})` : `Users (${displayUsers.length})`;

    return (
      <View style={[styles.userListContainer, { backgroundColor: theme.cardBackgroundColor }]}>
        <View style={[styles.userListHeader, { borderBottomColor: theme.borderColor }]}>
          <Text style={[styles.userListTitle, { color: theme.textColor }]}>
            {title}
          </Text>
          <View style={styles.userListHeaderButtons}>
            {isPrivate && (
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
                  {isPrivate && item.isMember && <Text style={[styles.memberBadge, { color: theme.primaryColor }]}>👤 </Text>}
                  {getUserDisplayName(item.pubkey)}
                </Text>
                {!isPrivate && (
                  <Text style={[styles.userLastSeen, { color: theme.secondaryTextColor }]}>
                    {nostrUtils.formatTimestamp(item.lastSeen)}
                  </Text>
                )}
                {isPrivate && (
                  <Text style={[styles.memberStatus, { color: theme.secondaryTextColor }]}>
                    {item.pubkey === nostrService.publicKey ? 'You' : 'Member'}
                  </Text>
                )}
              </View>
              {isPrivate && item.pubkey !== nostrService.publicKey && userPermissions.isOperator && (
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