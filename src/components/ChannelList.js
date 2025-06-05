import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { THEMES } from '../utils/constants';

const ChannelList = ({ 
  channels = [], 
  onChannelPress, 
  theme = THEMES.DARK,
  style 
}) => {
  const renderChannelItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.channelItem, { backgroundColor: theme.cardBackgroundColor }]}
      onPress={() => onChannelPress && onChannelPress(item)}
    >
      <View style={styles.channelIcon}>
        <Ionicons name="chatbubble" size={20} color={theme.primaryColor} />
      </View>
      <View style={styles.channelInfo}>
        <Text style={[styles.channelName, { color: theme.textColor }]}>
          #{item.name}
        </Text>
        <Text style={[styles.channelDescription, { color: theme.secondaryTextColor }]} numberOfLines={1}>
          {item.about || 'No description'}
        </Text>
      </View>
      <View style={styles.channelMeta}>
        <Text style={[styles.memberCount, { color: theme.secondaryTextColor }]}>
          {item.memberCount || 0} members
        </Text>
        <Ionicons name="chevron-forward" size={16} color={theme.secondaryTextColor} />
      </View>
    </TouchableOpacity>
  );

  if (channels.length === 0) {
    return (
      <View style={[styles.emptyContainer, style]}>
        <Ionicons name="chatbubbles-outline" size={48} color={theme.secondaryTextColor} />
        <Text style={[styles.emptyText, { color: theme.secondaryTextColor }]}>
          No channels available
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={channels}
      renderItem={renderChannelItem}
      keyExtractor={(item) => item.id}
      style={[styles.container, style]}
      showsVerticalScrollIndicator={false}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginHorizontal: 8,
    marginVertical: 2,
    borderRadius: 8,
  },
  channelIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  channelInfo: {
    flex: 1,
  },
  channelName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  channelDescription: {
    fontSize: 14,
  },
  channelMeta: {
    alignItems: 'flex-end',
  },
  memberCount: {
    fontSize: 12,
    marginBottom: 2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 12,
  },
});

export default ChannelList;