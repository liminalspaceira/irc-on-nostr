import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrUtils } from '../utils/nostrUtils';
import { MESSAGE_TYPES, THEMES } from '../utils/constants';

const MessageItem = ({ 
  message, 
  onReply, 
  onUserPress,
  theme = THEMES.DARK 
}) => {
  const isSystem = message.type === MESSAGE_TYPES.SYSTEM;
  const isBot = message.type === MESSAGE_TYPES.BOT_RESPONSE;
  const isAction = message.type === MESSAGE_TYPES.ACTION;

  const handleUserPress = () => {
    if (onUserPress && !isSystem) {
      onUserPress(message.author);
    }
  };

  const handleReply = () => {
    if (onReply && !isSystem) {
      onReply(message);
    }
  };

  if (isSystem) {
    return (
      <View style={styles.systemMessageContainer}>
        <Text style={[styles.systemMessage, { color: theme.secondaryTextColor }]}>
          {message.content}
        </Text>
        <Text style={[styles.timestamp, { color: theme.secondaryTextColor }]}>
          {nostrUtils.formatTimestamp(message.timestamp)}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.messageContainer}>
      <View style={styles.messageHeader}>
        <TouchableOpacity onPress={handleUserPress}>
          <Text style={[styles.author, { 
            color: isBot ? theme.successColor : theme.primaryColor 
          }]}>
            {isBot ? '🤖 ' : ''}{message.author.substring(0, 8)}...
          </Text>
        </TouchableOpacity>
        <Text style={[styles.timestamp, { color: theme.secondaryTextColor }]}>
          {nostrUtils.formatTimestamp(message.timestamp)}
        </Text>
        {!isSystem && (
          <TouchableOpacity onPress={handleReply} style={styles.replyButton}>
            <Ionicons name="arrow-undo" size={14} color={theme.secondaryTextColor} />
          </TouchableOpacity>
        )}
      </View>
      
      {message.replyTo && (
        <View style={[styles.replyIndicator, { borderLeftColor: theme.borderColor }]}>
          <Text style={[styles.replyText, { color: theme.secondaryTextColor }]}>
            Replying to message...
          </Text>
        </View>
      )}
      
      <Text style={[styles.content, { 
        color: theme.textColor,
        fontStyle: isAction ? 'italic' : 'normal'
      }]}>
        {isAction ? `* ${message.content}` : message.content}
      </Text>
      
      {isBot && (
        <View style={[styles.botIndicator, { backgroundColor: theme.successColor }]}>
          <Text style={styles.botText}>Bot Response</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  messageContainer: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  systemMessageContainer: {
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  author: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  timestamp: {
    fontSize: 10,
    flex: 1,
  },
  replyButton: {
    padding: 4,
  },
  replyIndicator: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    marginBottom: 4,
  },
  replyText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  content: {
    fontSize: 16,
    lineHeight: 22,
  },
  systemMessage: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  botIndicator: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
  },
  botText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
});

export default MessageItem;