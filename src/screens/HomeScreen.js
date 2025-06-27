import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  TextInput,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nostrService } from '../services/NostrService';
import { THEMES } from '../utils/constants';

const HomeScreen = ({ navigation, theme = THEMES.DARK }) => {
  const [channels, setChannels] = useState([]);
  const [filteredChannels, setFilteredChannels] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState({ isConnected: false });
  const [pendingInvitations, setPendingInvitations] = useState(0);
  const [userProfiles, setUserProfiles] = useState(new Map());

  useEffect(() => {
    initializeAndLoadChannels();
    loadPendingInvitations();
    
    // Check connection status periodically
    const statusInterval = setInterval(() => {
      setConnectionStatus(nostrService.getConnectionStatus());
    }, 5000);

    return () => clearInterval(statusInterval);
  }, []);

  // Update filtered channels when channels change (only for empty search)
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredChannels(channels);
    }
  }, [channels, searchQuery]);

  // Group channels by type
  const getGroupedChannels = (channelList) => {
    const grouped = {
      nip29: [],
      encrypted: [],
      private_nip28: [],
      public: []
    };

    channelList.forEach(channel => {
      // Use the same detection logic as ChannelScreen
      const isPrivate = channel.private === 'true' || 
                       channel.private === true || 
                       channel.privacy === 'private' ||
                       channel.about?.includes('Private group') || 
                       channel.name?.includes('🔒') ||
                       (channel.tags && channel.tags.some(tag => tag[0] === 'private' && tag[1] === 'true'));
      
      // Detect protocol - check for NIP-29 indicators first, then encrypted, then private
      let protocol = 'public';
      if (channel.kind === 9007) {
        protocol = 'nip29';
      } else if (channel.tags?.some(tag => tag[0] === 'protocol' && tag[1] === 'nip29')) {
        protocol = 'nip29';
      } else if (channel.protocol === 'nip29') {
        protocol = 'nip29';
      } else if (channel.protocol === 'encrypted' || 
                 channel.tags?.some(tag => tag[0] === 'protocol' && tag[1] === 'encrypted') ||
                 (channel.about?.includes('Encrypted group') && !channel.about?.includes('Private group')) ||
                 (channel.encrypted === true && channel.protocol !== 'nip17' && !isPrivate)) {
        protocol = 'encrypted';
      } else if (isPrivate || channel.protocol === 'nip17' || channel.protocol === 'private_nip28') {
        protocol = 'private_nip28';
      }
      
      console.log(`📋 Channel "${channel.name}" detected as protocol: ${protocol}, isPrivate: ${isPrivate}`);
      
      if (protocol === 'nip29') {
        grouped.nip29.push(channel);
      } else if (protocol === 'encrypted') {
        grouped.encrypted.push(channel);
      } else if (protocol === 'private_nip28') {
        grouped.private_nip28.push(channel);
      } else {
        grouped.public.push(channel);
      }
    });

    return grouped;
  };

  // Memoize grouped channels to prevent continuous re-calculation and logging
  const groupedChannels = useMemo(() => {
    return getGroupedChannels(filteredChannels);
  }, [filteredChannels]);

  // Debounced search effect
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredChannels(channels);
      return;
    }

    const searchTimeout = setTimeout(async () => {
      await performNetworkSearch(searchQuery);
    }, 800); // Wait 800ms after user stops typing

    return () => clearTimeout(searchTimeout);
  }, [searchQuery]);

  const performNetworkSearch = async (query) => {
    if (!query.trim()) return;
    
    try {
      setSearching(true);
      console.log('🔍 Performing network search for:', query);
      
      const searchResults = await nostrService.searchChannels(query, 500);
      console.log('📡 Search results from network:', searchResults.length);
      
      setFilteredChannels(searchResults);
    } catch (error) {
      console.error('❌ Search error:', error);
      // Fallback to local filtering
      const localFiltered = channels.filter(channel => {
        const nameMatch = channel.name && channel.name.toLowerCase().includes(query.toLowerCase());
        const aboutMatch = channel.about && channel.about.toLowerCase().includes(query.toLowerCase());
        return nameMatch || aboutMatch;
      });
      setFilteredChannels(localFiltered);
    } finally {
      setSearching(false);
    }
  };

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
      console.log('🚀 Starting channel loading process...');
      
      // Load NIP-29 groups FIRST (higher priority)
      let nip29Groups = [];
      try {
        console.log('🏛️ Loading NIP-29 groups first...');
        nip29Groups = await nostrService.queryNIP29Groups(50);
        console.log('✅ Successfully loaded', nip29Groups.length, 'NIP-29 groups from relays');
        
        // Show NIP-29 groups immediately if found
        if (nip29Groups.length > 0) {
          console.log('🎯 Found NIP-29 groups, showing them immediately:');
          nip29Groups.forEach(group => {
            console.log(`  - ${group.name} (${group.id.substring(0, 8)}...)`);
          });
          setChannels(nip29Groups);
          setFilteredChannels(nip29Groups);
        }
      } catch (nip29Error) {
        console.error('❌ Failed to load NIP-29 groups:', nip29Error);
        // Continue to load regular channels even if NIP-29 fails
      }
      
      // Then load regular channels (NIP-28) and private groups
      try {
        console.log('📡 Loading standard channels...');
        const channelList = await nostrService.queryChannels(200);
        console.log('✅ Successfully loaded', channelList.length, 'standard channels from relays');
        
        // Combine all channels and groups (NIP-29 groups first)
        const allChannels = [...nip29Groups, ...channelList];
        console.log('📅 Total channels loaded:', allChannels.length, '(NIP-29:', nip29Groups.length, ', Standard:', channelList.length, ')');
        
        setChannels(allChannels);
        setFilteredChannels(allChannels);
        
        // Load user profiles for channel creators
        await loadUserProfiles(allChannels);
      } catch (standardError) {
        console.error('❌ Failed to load standard channels:', standardError);
        // If standard channels fail but we have NIP-29 groups, keep showing NIP-29 groups
        if (nip29Groups.length > 0) {
          console.log('🛡️ Keeping NIP-29 groups visible despite standard channel error');
          setChannels(nip29Groups);
          setFilteredChannels(nip29Groups);
          // Still try to load profiles for NIP-29 groups
          await loadUserProfiles(nip29Groups);
        } else {
          throw standardError;
        }
      }
      
    } catch (error) {
      console.error('Failed to load channels:', error);
      Alert.alert('Error', 'Failed to load channels');
    }
  };

  const loadUserProfiles = async (channelList) => {
    try {
      // Extract unique creator pubkeys from channels
      const creatorPubkeys = [...new Set(
        channelList
          .filter(channel => channel.creator)
          .map(channel => channel.creator)
      )];

      if (creatorPubkeys.length === 0) return;

      console.log(`👤 Loading profiles for ${creatorPubkeys.length} channel creators...`);

      // Load profiles from NostrService (returns a Map)
      const profilesMap = await nostrService.getMultipleUserProfiles(creatorPubkeys);
      
      // Update userProfiles state by merging with existing profiles
      const newProfiles = new Map([...userProfiles, ...profilesMap]);

      setUserProfiles(newProfiles);
      console.log(`✅ Loaded ${profilesMap.size} user profiles`);

    } catch (error) {
      console.error('Failed to load user profiles:', error);
      // Don't show error to user - profiles are optional
    }
  };

  const handleSearchChange = (query) => {
    console.log('🔍 Search query changed:', query);
    setSearchQuery(query);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadChannels();
    setRefreshing(false);
  };

  const joinChannel = (channel) => {
    // Check if this is a private group by looking for private group markers
    const isPrivate = channel.about?.includes('Private group') || 
                     channel.name?.includes('🔒') ||
                     (channel.tags && channel.tags.some(tag => tag[0] === 'private' && tag[1] === 'true'));
    
    // Determine protocol
    const protocol = channel.protocol || (isPrivate ? 'private_nip28' : 'public');
    
    navigation.navigate('Channel', { 
      channelId: channel.id,
      channelName: channel.name,
      isPrivate: isPrivate,
      protocol: protocol
    });
  };

  const loadPendingInvitations = async () => {
    try {
      const invitations = await nostrService.getGroupInvitations();
      const pending = invitations.filter(inv => inv.status === 'pending');
      setPendingInvitations(pending.length);
    } catch (error) {
      console.error('Error loading pending invitations:', error);
    }
  };

  const createChannel = () => {
    navigation.navigate('CreateChannel');
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getCreatorName = (creatorPubkey) => {
    const profile = userProfiles.get(creatorPubkey);
    if (profile?.name) return profile.name;
    if (profile?.display_name) return profile.display_name;
    if (profile?.username) return profile.username;
    return `${creatorPubkey.substring(0, 8)}...`;
  };

  const renderChannelItem = ({ item }) => {
    // Use consistent detection logic
    const isPrivate = item.private === 'true' || 
                     item.private === true || 
                     item.privacy === 'private' ||
                     item.about?.includes('Private group') || 
                     item.name?.includes('🔒') ||
                     (item.tags && item.tags.some(tag => tag[0] === 'private' && tag[1] === 'true'));
    
    // Detect protocol - check for NIP-29 indicators first, then encrypted, then private
    let protocol = 'public';
    if (item.kind === 9007) {
      protocol = 'nip29';
    } else if (item.tags?.some(tag => tag[0] === 'protocol' && tag[1] === 'nip29')) {
      protocol = 'nip29';
    } else if (item.protocol === 'nip29') {
      protocol = 'nip29';
    } else if (item.protocol === 'encrypted' || 
               item.tags?.some(tag => tag[0] === 'protocol' && tag[1] === 'encrypted') ||
               (item.about?.includes('Encrypted group') && !item.about?.includes('Private group')) ||
               (item.encrypted === true && item.protocol !== 'nip17' && !isPrivate)) {
      protocol = 'encrypted';
    } else if (isPrivate || item.protocol === 'nip17' || item.protocol === 'private_nip28') {
      protocol = 'private_nip28';
    }
    
    return (
      <TouchableOpacity
        style={[styles.channelItem, { backgroundColor: theme.cardBackgroundColor }]}
        onPress={() => joinChannel(item)}
      >
        <View style={styles.channelInfo}>
          <View style={styles.channelHeader}>
            <Text style={[styles.channelName, { color: theme.textColor }]}>
              #{item.name}
            </Text>
            {/* Protocol indicators */}
            {(isPrivate || protocol === 'encrypted') && (
              <View style={styles.protocolBadges}>
                {protocol === 'encrypted' ? (
                  <View style={[styles.privateBadge, { backgroundColor: `${theme.primaryColor}20`, borderColor: theme.primaryColor }]}>
                    <Ionicons name="shield-checkmark" size={10} color={theme.primaryColor} />
                    <Text style={[styles.privateBadgeText, { color: theme.primaryColor }]}>
                      Encrypted
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.privateBadge, { backgroundColor: `${theme.warningColor}20`, borderColor: theme.warningColor }]}>
                    <Ionicons name="lock-closed" size={10} color={theme.warningColor} />
                    <Text style={[styles.privateBadgeText, { color: theme.warningColor }]}>
                      Private
                    </Text>
                  </View>
                )}
                {protocol === 'nip29' && (
                  <View style={[styles.protocolBadge, { backgroundColor: `${theme.successColor}20`, borderColor: theme.successColor }]}>
                    <Ionicons name="settings" size={10} color={theme.successColor} />
                    <Text style={[styles.protocolBadgeText, { color: theme.successColor }]}>
                      NIP-29
                    </Text>
                  </View>
                )}
                {protocol === 'private_nip28' && (
                  <View style={[styles.protocolBadge, { backgroundColor: `${theme.warningColor}20`, borderColor: theme.warningColor }]}>
                    <Ionicons name="eye-off" size={10} color={theme.warningColor} />
                    <Text style={[styles.protocolBadgeText, { color: theme.warningColor }]}>
                      NIP-28
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
          <Text style={[styles.channelDescription, { color: theme.secondaryTextColor }]}>
            {item.about || 'No description'}
          </Text>
          <View style={styles.channelMetadata}>
            <Text style={[styles.channelCreator, { color: theme.secondaryTextColor }]}>
              Created by: {getCreatorName(item.creator)}
            </Text>
            <Text style={[styles.channelDate, { color: theme.secondaryTextColor }]}>
              • {formatDate(item.createdAt || item.created_at)}
            </Text>
          </View>
          <View style={styles.channelIdContainer}>
            <Text style={[styles.channelId, { color: theme.mutedTextColor }]}>
              ID: {item.id.substring(0, 12)}...
            </Text>
          </View>
          {/* Show protocol info for private groups */}
          {isPrivate && (
            <Text style={[styles.protocolInfo, { color: theme.secondaryTextColor }]}>
              {protocol === 'nip29' 
                ? '🏛️ Managed group with admin controls'
                : '⚠️ Invitation-only, plain text messages, no moderation'
              }
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

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
        <View style={styles.headerButtons}>
          {/* Group Invitations Indicator */}
          {pendingInvitations > 0 && (
            <TouchableOpacity 
              style={[styles.inviteButton, { backgroundColor: theme.warningColor }]}
              onPress={() => {
                Alert.alert(
                  'Group Invitations',
                  `You have ${pendingInvitations} pending group invitation${pendingInvitations > 1 ? 's' : ''}`,
                  [{ text: 'OK' }]
                );
              }}
            >
              <Ionicons name="mail" size={20} color="white" />
              <Text style={styles.inviteBadge}>{pendingInvitations}</Text>
            </TouchableOpacity>
          )}
          
          {/* Create Channel Button */}
          <TouchableOpacity 
            style={[styles.createButton, { backgroundColor: theme.primaryColor }]}
            onPress={createChannel}
          >
            <Ionicons name="add" size={24} color="white" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <View style={[styles.searchInputContainer, { backgroundColor: theme.surfaceColor }]}>
          <Ionicons name="search" size={20} color={theme.secondaryTextColor} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.textColor }]}
            placeholder="Search channels on Nostr network..."
            placeholderTextColor={theme.secondaryTextColor}
            value={searchQuery}
            onChangeText={handleSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searching && (
            <ActivityIndicator 
              size="small" 
              color={theme.primaryColor} 
              style={styles.searchSpinner}
            />
          )}
          {searchQuery.length > 0 && !searching && (
            <TouchableOpacity 
              onPress={() => handleSearchChange('')}
              style={styles.clearButton}
            >
              <Ionicons name="close-circle" size={20} color={theme.secondaryTextColor} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
            Loading channels...
          </Text>
        </View>
      ) : searchQuery ? (
        // Show search results in a single list when searching
        <View>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.textColor }]}>
              Network Search Results
            </Text>
            <Text style={[styles.channelCount, { color: theme.secondaryTextColor }]}>
              {searching ? 'Searching...' : 
                `${filteredChannels.length} channel${filteredChannels.length !== 1 ? 's' : ''} found`
              }
            </Text>
          </View>
          <FlatList
            data={filteredChannels}
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
                  name="search-outline" 
                  size={64} 
                  color={theme.secondaryTextColor} 
                />
                <Text style={[styles.emptyText, { color: theme.textColor }]}>
                  No channels found on Nostr network
                </Text>
                <Text style={[styles.emptySubtext, { color: theme.secondaryTextColor }]}>
                  Try a different search term or create the channel you're looking for
                </Text>
              </View>
            }
          />
        </View>
      ) : (
        // Show grouped channels when not searching
        <FlatList
          data={[{ type: 'grouped', grouped: groupedChannels }]}
          renderItem={({ item }) => {
            const { grouped } = item;
            const totalChannels = grouped.nip29.length + grouped.encrypted.length + grouped.private_nip28.length + grouped.public.length;
            
            if (totalChannels === 0) {
              return (
                <View style={styles.emptyContainer}>
                  <Ionicons 
                    name="chatbubbles-outline" 
                    size={64} 
                    color={theme.secondaryTextColor} 
                  />
                  <Text style={[styles.emptyText, { color: theme.textColor }]}>
                    No channels found
                  </Text>
                  <Text style={[styles.emptySubtext, { color: theme.secondaryTextColor }]}>
                    Create the first channel to get started
                  </Text>
                </View>
              );
            }
            
            return (
              <View>
                {/* NIP-29 Private Groups Section */}
                {grouped.nip29.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionTitleContainer}>
                        <Ionicons name="settings" size={18} color={theme.successColor} />
                        <Text style={[styles.sectionTitle, { color: theme.textColor, marginLeft: 8 }]}>
                          Private Groups - NIP-29 (Managed)
                        </Text>
                      </View>
                      <Text style={[styles.channelCount, { color: theme.secondaryTextColor }]}>
                        {grouped.nip29.length} group{grouped.nip29.length !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.sectionDescription, { color: theme.secondaryTextColor }]}>
                      🏛️ Relay-managed groups with real admin controls and moderation
                    </Text>
                    {grouped.nip29.map(channel => (
                      <View key={channel.id}>
                        {renderChannelItem({ item: channel })}
                      </View>
                    ))}
                  </View>
                )}
                
                {/* Encrypted Groups Section */}
                {grouped.encrypted.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionTitleContainer}>
                        <Ionicons name="shield-checkmark" size={18} color={theme.primaryColor} />
                        <Text style={[styles.sectionTitle, { color: theme.textColor, marginLeft: 8 }]}>
                          Encrypted Groups (E2E Encrypted)
                        </Text>
                      </View>
                      <Text style={[styles.channelCount, { color: theme.secondaryTextColor }]}>
                        {grouped.encrypted.length} group{grouped.encrypted.length !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.sectionDescription, { color: theme.secondaryTextColor }]}>
                      🔐 End-to-end encrypted messages with shared group secrets
                    </Text>
                    {grouped.encrypted.map(channel => (
                      <View key={channel.id}>
                        {renderChannelItem({ item: channel })}
                      </View>
                    ))}
                  </View>
                )}
                
                {/* Private NIP-28 Channels Section */}
                {grouped.private_nip28.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionTitleContainer}>
                        <Ionicons name="eye-off" size={18} color={theme.warningColor} />
                        <Text style={[styles.sectionTitle, { color: theme.textColor, marginLeft: 8 }]}>
                          Private Channels - NIP-28 (Limited Privacy)
                        </Text>
                      </View>
                      <Text style={[styles.channelCount, { color: theme.secondaryTextColor }]}>
                        {grouped.private_nip28.length} channel{grouped.private_nip28.length !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.sectionDescription, { color: theme.secondaryTextColor }]}>
                      ⚠️ Invitation-only access, plain text messages, fake moderation
                    </Text>
                    {grouped.private_nip28.map(channel => (
                      <View key={channel.id}>
                        {renderChannelItem({ item: channel })}
                      </View>
                    ))}
                  </View>
                )}
                
                {/* Public Channels Section */}
                {grouped.public.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionTitleContainer}>
                        <Ionicons name="globe" size={18} color={theme.textColor} />
                        <Text style={[styles.sectionTitle, { color: theme.textColor, marginLeft: 8 }]}>
                          Public Channels
                        </Text>
                      </View>
                      <Text style={[styles.channelCount, { color: theme.secondaryTextColor }]}>
                        {grouped.public.length} channel{grouped.public.length !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.sectionDescription, { color: theme.secondaryTextColor }]}>
                      # Open channels discoverable by anyone on the Nostr network
                    </Text>
                    {grouped.public.map(channel => (
                      <View key={channel.id}>
                        {renderChannelItem({ item: channel })}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          }}
          keyExtractor={() => 'grouped'}
          style={styles.channelList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.primaryColor}
            />
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
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inviteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  inviteBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    backgroundColor: 'red',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    textAlign: 'center',
    lineHeight: 16,
  },
  createButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 4,
  },
  searchSpinner: {
    marginLeft: 8,
  },
  clearButton: {
    marginLeft: 8,
    padding: 2,
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
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  channelName: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  protocolBadges: {
    flexDirection: 'row',
    gap: 4,
  },
  privateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    gap: 2,
  },
  privateBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  protocolBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 1,
    gap: 2,
  },
  protocolBadgeText: {
    fontSize: 9,
    fontWeight: '600',
  },
  channelDescription: {
    fontSize: 14,
    marginBottom: 4,
  },
  protocolInfo: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 2,
  },
  channelMetadata: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  channelCreator: {
    fontSize: 12,
  },
  channelDate: {
    fontSize: 12,
    marginLeft: 4,
  },
  channelIdContainer: {
    marginTop: 4,
  },
  channelId: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontStyle: 'italic',
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
  section: {
    marginBottom: 24,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionDescription: {
    fontSize: 12,
    marginBottom: 12,
    marginHorizontal: 16,
    lineHeight: 16,
    fontStyle: 'italic',
  },
});

export default HomeScreen;