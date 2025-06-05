import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrService } from '../services/NostrService';
import { THEMES } from '../utils/constants';

const HomeScreen = ({ navigation, theme = THEMES.DARK }) => {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState({ isConnected: false });

  useEffect(() => {
    initializeAndLoadChannels();
    
    // Check connection status periodically
    const statusInterval = setInterval(() => {
      setConnectionStatus(nostrService.getConnectionStatus());
    }, 5000);

    return () => clearInterval(statusInterval);
  }, []);

  const initializeAndLoadChannels = async () => {
    try {
      if (!nostrService.isConnected) {
        await nostrService.initialize();
      }
      await loadChannels();
    } catch (error) {
      console.error('Failed to initialize:', error);
      Alert.alert('Connection Error', 'Failed to connect to Nostr network');
    } finally {
      setLoading(false);
    }
  };

  const loadChannels = async () => {
    try {
      const channelList = await nostrService.queryChannels(50);
      setChannels(channelList);
    } catch (error) {
      console.error('Failed to load channels:', error);
      Alert.alert('Error', 'Failed to load channels');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadChannels();
    setRefreshing(false);
  };

  const joinChannel = (channel) => {
    navigation.navigate('Channel', { 
      channelId: channel.id,
      channelName: channel.name 
    });
  };

  const createChannel = () => {
    navigation.navigate('CreateChannel');
  };

  const renderChannelItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.channelItem, { backgroundColor: theme.cardBackgroundColor }]}
      onPress={() => joinChannel(item)}
    >
      <View style={styles.channelInfo}>
        <Text style={[styles.channelName, { color: theme.textColor }]}>
          #{item.name}
        </Text>
        <Text style={[styles.channelDescription, { color: theme.secondaryTextColor }]}>
          {item.about || 'No description'}
        </Text>
        <Text style={[styles.channelCreator, { color: theme.secondaryTextColor }]}>
          Created by: {item.creator.substring(0, 8)}...
        </Text>
      </View>
      <Ionicons 
        name="chevron-forward" 
        size={20} 
        color={theme.secondaryTextColor} 
      />
    </TouchableOpacity>
  );

  const renderConnectionStatus = () => (
    <View style={[styles.statusBar, { 
      backgroundColor: connectionStatus.isConnected ? theme.successColor : theme.errorColor 
    }]}>
      <Text style={styles.statusText}>
        {connectionStatus.isConnected 
          ? `Connected to ${connectionStatus.connectedRelays?.length || 0} relays`
          : 'Disconnected'
        }
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundColor }]}>
      {renderConnectionStatus()}
      
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.textColor }]}>
          IRC on Nostr
        </Text>
        <TouchableOpacity 
          style={[styles.createButton, { backgroundColor: theme.primaryColor }]}
          onPress={createChannel}
        >
          <Ionicons name="add" size={24} color="white" />
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.textColor }]}>
          Public Channels
        </Text>
        <Text style={[styles.channelCount, { color: theme.secondaryTextColor }]}>
          {channels.length} channels
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
            Loading channels...
          </Text>
        </View>
      ) : (
        <FlatList
          data={channels}
          renderItem={renderChannelItem}
          keyExtractor={(item) => item.id}
          style={styles.channelList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.primaryColor}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons 
                name="chatbubbles-outline" 
                size={64} 
                color={theme.secondaryTextColor} 
              />
              <Text style={[styles.emptyText, { color: theme.secondaryTextColor }]}>
                No channels found
              </Text>
              <Text style={[styles.emptySubtext, { color: theme.secondaryTextColor }]}>
                Create the first channel to get started
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statusBar: {
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '500',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  createButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  channelCount: {
    fontSize: 14,
  },
  channelList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  channelItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    marginBottom: 8,
    borderRadius: 12,
  },
  channelInfo: {
    flex: 1,
  },
  channelName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  channelDescription: {
    fontSize: 14,
    marginBottom: 4,
  },
  channelCreator: {
    fontSize: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
});

export default HomeScreen;