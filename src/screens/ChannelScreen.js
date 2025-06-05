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
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrService } from '../services/NostrService';
import { nostrUtils } from '../utils/nostrUtils';
import { IRC_COMMANDS, BOT_COMMANDS, MESSAGE_TYPES, THEMES } from '../utils/constants';

const ChannelScreen = ({ route, navigation, theme = THEMES.DARK }) => {
  const { channelId, channelName } = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const flatListRef = useRef();
  const subscriptionRef = useRef();

  useEffect(() => {
    navigation.setOptions({ 
      title: `#${channelName}`,
      headerRight: () => (
        <TouchableOpacity onPress={showChannelInfo}>
          <Ionicons name="information-circle-outline" size={24} color={theme.textColor} />
        </TouchableOpacity>
      )
    });

    loadChannelData();
    subscribeToChannel();

    return () => {
      if (subscriptionRef.current) {
        nostrService.unsubscribe(subscriptionRef.current);
      }
    };
  }, [channelId]);

  const loadChannelData = async () => {
    try {
      setIsLoading(true);
      const channelMessages = await nostrService.queryChannelMessages(channelId, 100);
      setMessages(channelMessages);
    } catch (error) {
      console.error('Failed to load channel data:', error);
      Alert.alert('Error', 'Failed to load channel messages');
    } finally {
      setIsLoading(false);
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

  const onNewMessage = (message) => {
    setMessages(prev => {
      const exists = prev.find(m => m.id === message.id);
      if (exists) return prev;
      
      const updated = [...prev, message].sort((a, b) => a.timestamp - b.timestamp);
      return updated;
    });
  };

  const onMetadataUpdate = (event) => {
    console.log('Channel metadata updated:', event);
  };

  const onModerationEvent = (modEvent) => {
    const systemMessage = {
      id: modEvent.id,
      content: `${modEvent.moderator.substring(0, 8)}... ${modEvent.action} ${modEvent.target.substring(0, 8)}...${modEvent.reason ? `: ${modEvent.reason}` : ''}`,
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

      // Check if it's a bot command
      const botCommand = nostrUtils.parseBotCommandFromMessage(trimmedText);
      if (botCommand) {
        await nostrService.sendBotCommand(channelId, botCommand.command, botCommand.args);
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

  const handleIRCCommand = async (command) => {
    switch (command.command) {
      case 'topic':
        if (command.args.length > 0) {
          const topic = command.args.join(' ');
          await nostrService.updateChannelMetadata(channelId, { topic });
        }
        break;
        
      case 'users':
        showUserList();
        break;
        
      case 'kick':
        if (command.args.length > 0) {
          const targetUser = command.args[0];
          const reason = command.args.slice(1).join(' ');
          await nostrService.performModerationAction(channelId, 'kick', targetUser, reason);
        }
        break;
        
      case 'ban':
        if (command.args.length > 0) {
          const targetUser = command.args[0];
          const reason = command.args.slice(1).join(' ');
          await nostrService.performModerationAction(channelId, 'ban', targetUser, reason);
        }
        break;
        
      case 'help':
        showHelp();
        break;
        
      default:
        Alert.alert('Unknown Command', `Command /${command.command} not recognized`);
    }
  };

  const showChannelInfo = () => {
    Alert.alert(
      'Channel Info',
      `Channel: #${channelName}\nID: ${channelId}\nMessages: ${messages.length}`,
      [{ text: 'OK' }]
    );
  };

  const showUserList = () => {
    const uniqueUsers = [...new Set(messages.map(m => m.author))];
    Alert.alert(
      'Users in Channel',
      `${uniqueUsers.length} users:\n${uniqueUsers.map(u => u.substring(0, 8) + '...').join('\n')}`,
      [{ text: 'OK' }]
    );
  };

  const showHelp = () => {
    Alert.alert(
      'Available Commands',
      'IRC Commands:\n/topic <text> - Set channel topic\n/users - List users\n/kick <user> - Kick user\n/ban <user> - Ban user\n\nBot Commands:\n!help - Show this help\n!users - List active users\n!weather <location> - Get weather\n!roll <dice> - Roll dice',
      [{ text: 'OK' }]
    );
  };

  const renderMessage = ({ item }) => {
    const isSystem = item.type === MESSAGE_TYPES.SYSTEM;
    const isBot = item.type === MESSAGE_TYPES.BOT_RESPONSE;
    
    return (
      <View style={[
        styles.messageContainer,
        isSystem && styles.systemMessage
      ]}>
        {!isSystem && (
          <Text style={[styles.messageAuthor, { color: theme.secondaryTextColor }]}>
            {item.author.substring(0, 8)}...
          </Text>
        )}
        <Text style={[
          styles.messageContent,
          { color: isSystem ? theme.secondaryTextColor : theme.textColor },
          isSystem && styles.systemMessageText
        ]}>
          {item.content}
        </Text>
        <Text style={[styles.messageTime, { color: theme.secondaryTextColor }]}>
          {nostrUtils.formatTimestamp(item.timestamp)}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: theme.backgroundColor }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        style={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingContainer}>
              <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
                Loading messages...
              </Text>
            </View>
          ) : (
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
          )
        }
      />

      <View style={[styles.inputContainer, { backgroundColor: theme.cardBackgroundColor }]}>
        <TextInput
          style={[styles.textInput, { 
            backgroundColor: theme.surfaceColor,
            color: theme.textColor,
            borderColor: theme.borderColor
          }]}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message or /help for commands..."
          placeholderTextColor={theme.secondaryTextColor}
          multiline
          maxLength={1000}
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
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messagesList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  messageContainer: {
    paddingVertical: 8,
    marginBottom: 4,
  },
  systemMessage: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  messageAuthor: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  messageContent: {
    fontSize: 16,
    lineHeight: 20,
  },
  systemMessageText: {
    fontStyle: 'italic',
    fontSize: 14,
  },
  messageTime: {
    fontSize: 10,
    marginTop: 2,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'flex-end',
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 12,
    maxHeight: 100,
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
});

export default ChannelScreen;