import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { THEMES } from '../utils/constants';

const MessageInput = ({ 
  onSendMessage, 
  placeholder = "Type a message...",
  theme = THEMES.DARK,
  style 
}) => {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;
    
    if (onSendMessage) {
      onSendMessage(trimmedMessage);
    }
    setMessage('');
  };

  const handleSubmitEditing = () => {
    handleSend();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.cardBackgroundColor }, style]}>
      <TextInput
        style={[styles.input, { 
          backgroundColor: theme.surfaceColor,
          color: theme.textColor,
          borderColor: theme.borderColor
        }]}
        value={message}
        onChangeText={setMessage}
        placeholder={placeholder}
        placeholderTextColor={theme.secondaryTextColor}
        multiline
        maxLength={1000}
        onSubmitEditing={handleSubmitEditing}
        blurOnSubmit={false}
      />
      <TouchableOpacity
        style={[styles.sendButton, { 
          backgroundColor: message.trim() ? theme.primaryColor : theme.borderColor 
        }]}
        onPress={handleSend}
        disabled={!message.trim()}
      >
        <Ionicons name="send" size={20} color="white" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'flex-end',
  },
  input: {
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
});

export default MessageInput;