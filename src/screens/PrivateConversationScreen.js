import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrService } from '../services/NostrService';
import { nostrUtils } from '../utils/nostrUtils';
import { THEMES } from '../utils/constants';

const PrivateConversationScreen = ({ route, navigation, theme = THEMES.DARK }) => {
  const { contactPubkey, contactName, initialMessage } = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const scrollViewRef = useRef();
  const subscriptionRef = useRef();

  useEffect(() => {
    navigation.setOptions({ 
      title: contactName,
      headerRight: () => (
        <TouchableOpacity onPress={showContactInfo} style={{ marginRight: 16 }}>
          <Ionicons 
            name="information-circle-outline" 
            size={24} 
            color={theme.textColor} 
          />
        </TouchableOpacity>
      )
    });

    loadMessages();
    subscribeToMessages();
    
    // Mark conversation as read when opened
    markAsRead();

    // If there's an initial message from /msg command, set it and send
    if (initialMessage) {
      setInputText(initialMessage);
      // Auto-send after a short delay to allow UI to settle
      setTimeout(() => {
        if (initialMessage.trim()) {
          sendMessageWithContent(initialMessage.trim());
        }
      }, 500);
    }

    return () => {
      if (subscriptionRef.current) {
        nostrService.unsubscribe(subscriptionRef.current);
      }
    };
  }, [contactPubkey]);

  const loadMessages = async () => {
    try {
      setIsLoading(true);
      const messageHistory = await nostrService.getPrivateMessages(contactPubkey);
      setMessages(messageHistory);
      scrollToBottom();
    } catch (error) {
      console.error('Failed to load messages:', error);
      Alert.alert('Error', 'Failed to load message history');
    } finally {
      setIsLoading(false);
    }
  };

  const subscribeToMessages = () => {
    try {
      subscriptionRef.current = nostrService.subscribeToPrivateMessages(
        contactPubkey,
        onNewMessage
      );
      setIsConnected(true);
    } catch (error) {
      console.error('Failed to subscribe to messages:', error);
      setIsConnected(false);
    }
  };

  const markAsRead = async () => {
    try {
      await nostrService.markConversationAsRead(contactPubkey);
    } catch (error) {
      console.error('Failed to mark conversation as read:', error);
    }
  };

  const onNewMessage = (message) => {
    setMessages(prev => {
      const exists = prev.find(m => m.id === message.id);
      if (exists) return prev;
      
      const updated = [...prev, message].sort((a, b) => a.timestamp - b.timestamp);
      scrollToBottom();
      return updated;
    });
  };

  const scrollToBottom = () => {
    // Web-specific scroll to bottom (same as ChannelScreen)
    setTimeout(() => {
      if (scrollViewRef.current) {
        scrollViewRef.current.scrollTop = scrollViewRef.current.scrollHeight;
      }
    }, 100);
  };

  const sendMessageWithContent = async (content) => {
    if (!content.trim()) return;

    try {
      const messageContent = content.trim();
      
      // Add optimistic message
      const optimisticMessage = {
        id: `temp_${Date.now()}`,
        content: messageContent,
        author: nostrService.publicKey,
        timestamp: Math.floor(Date.now() / 1000),
        isFromMe: true,
        pending: true
      };
      
      setMessages(prev => [...prev, optimisticMessage]);
      setInputText('');
      scrollToBottom();

      // Send the actual message
      const sentEvent = await nostrService.sendPrivateMessage(contactPubkey, messageContent);
      
      // Replace optimistic message with real one
      setMessages(prev => prev.map(msg => 
        msg.id === optimisticMessage.id 
          ? { 
              id: sentEvent.id,
              content: messageContent,
              author: nostrService.publicKey,
              timestamp: sentEvent.created_at,
              isFromMe: true,
              pending: false
            }
          : msg
      ));
      
    } catch (error) {
      console.error('Failed to send message:', error);
      Alert.alert('Error', 'Failed to send message');
      
      // Remove failed optimistic message
      setMessages(prev => prev.filter(msg => !msg.pending));
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    await sendMessageWithContent(inputText.trim());
  };

  const showContactInfo = () => {
    const displayPubkey = contactPubkey.length > 32 
      ? `${contactPubkey.substring(0, 16)}...${contactPubkey.substring(contactPubkey.length - 16)}`
      : contactPubkey;
    
    Alert.alert(
      'Contact Information',
      `Name: ${contactName}\nPublic Key: ${displayPubkey}`,
      [
        {
          text: 'Copy Pubkey',
          onPress: () => {
            // In a real app, you'd copy to clipboard
            Alert.alert('Copied', 'Public key copied to clipboard');
          }
        },
        { text: 'OK' }
      ]
    );
  };

  const renderMessage = (message, index) => {
    const isFromMe = message.isFromMe;
    const showTime = index === 0 || 
      (messages[index - 1] && Math.abs(message.timestamp - messages[index - 1].timestamp) > 300); // 5 minutes

    return (
      <View key={message.id} style={styles.messageWrapper}>
        {showTime && (
          <Text style={[styles.timeStamp, { color: theme.secondaryTextColor }]}>
            {new Date(message.timestamp * 1000).toLocaleTimeString([], { 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </Text>
        )}
        
        <View
          style={[
            styles.messageContainer,
            isFromMe ? styles.myMessage : styles.theirMessage,
            {
              backgroundColor: isFromMe ? theme.primaryColor : theme.cardBackgroundColor,
              borderColor: theme.borderColor
            },
            message.pending && styles.pendingMessage
          ]}
        >
          <Text
            style={[
              styles.messageText,
              { color: isFromMe ? 'white' : theme.textColor }
            ]}
          >
            {message.content}
          </Text>
          
          {message.pending && (
            <View style={styles.pendingIndicator}>
              <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.7)" />
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundColor }]}>
      {/* Connection status */}
      {!isConnected && (
        <View style={[styles.statusBar, { backgroundColor: theme.warningColor }]}>
          <Text style={styles.statusText}>Connecting...</Text>
        </View>
      )}

      {/* Messages area - WEB SCROLLABLE (same as ChannelScreen) */}
      <View 
        ref={scrollViewRef}
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
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
              Loading messages...
            </Text>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons 
              name="chatbubble-outline" 
              size={64} 
              color={theme.secondaryTextColor} 
            />
            <Text style={[styles.emptyTitle, { color: theme.textColor }]}>
              No messages yet
            </Text>
            <Text style={[styles.emptySubtitle, { color: theme.secondaryTextColor }]}>
              Start the conversation by sending a message
            </Text>
          </View>
        ) : (
          messages.map((message, index) => renderMessage(message, index))
        )}
      </View>

      {/* Input area */}
      <View style={[styles.inputContainer, { 
        backgroundColor: theme.cardBackgroundColor,
        borderTopColor: theme.borderColor 
      }]}>
        <TextInput
          style={[styles.textInput, { 
            backgroundColor: theme.surfaceColor,
            color: theme.textColor,
            borderColor: theme.borderColor
          }]}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={sendMessage}
          placeholder="Type a message..."
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statusBar: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  messagesContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  messageWrapper: {
    marginVertical: 2,
  },
  timeStamp: {
    fontSize: 11,
    textAlign: 'center',
    marginVertical: 8,
  },
  messageContainer: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    marginVertical: 2,
    position: 'relative',
  },
  myMessage: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  theirMessage: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  pendingMessage: {
    opacity: 0.7,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  pendingIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'flex-end',
    borderTopWidth: 1,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 12,
    height: 44, // Fixed height for consistency (same as ChannelScreen)
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

export default PrivateConversationScreen;