import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { cacheService } from '../services/CacheService';
import { THEMES } from '../utils/constants';

const CacheManager = ({ theme = THEMES.DARK }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    loadCacheStats();
  }, []);

  const loadCacheStats = async () => {
    try {
      setLoading(true);
      const cacheStats = await cacheService.getCacheStats();
      setStats(cacheStats);
    } catch (error) {
      console.error('Error loading cache stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearCache = async () => {
    Alert.alert(
      'Clear Cache',
      'This will remove all cached data. The app will need to refetch data from the network. Continue?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              setClearing(true);
              await cacheService.clearCache();
              await loadCacheStats();
              Alert.alert('Success', 'Cache cleared successfully');
            } catch (error) {
              console.error('Error clearing cache:', error);
              Alert.alert('Error', 'Failed to clear cache');
            } finally {
              setClearing(false);
            }
          },
        },
      ]
    );
  };

  const cleanupCache = async () => {
    try {
      setLoading(true);
      await cacheService.cleanupExpiredCache();
      await loadCacheStats();
      Alert.alert('Success', 'Expired cache entries removed');
    } catch (error) {
      console.error('Error cleaning cache:', error);
      Alert.alert('Error', 'Failed to cleanup cache');
    } finally {
      setLoading(false);
    }
  };

  const formatCacheSize = (entries) => {
    if (!entries) return '0';
    if (entries < 1000) return entries.toString();
    if (entries < 1000000) return `${(entries / 1000).toFixed(1)}K`;
    return `${(entries / 1000000).toFixed(1)}M`;
  };

  if (loading && !stats) {
    return (
      <View style={[styles.container, { backgroundColor: theme.cardBackgroundColor }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={theme.primaryColor} />
          <Text style={[styles.loadingText, { color: theme.secondaryTextColor }]}>
            Loading cache stats...
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.cardBackgroundColor }]}>
      <View style={styles.header}>
        <Ionicons name="server-outline" size={24} color={theme.primaryColor} />
        <Text style={[styles.title, { color: theme.textColor }]}>
          Cache Management
        </Text>
      </View>

      {stats && (
        <>
          <View style={styles.statsContainer}>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.secondaryTextColor }]}>
                Total Entries:
              </Text>
              <Text style={[styles.statValue, { color: theme.textColor }]}>
                {formatCacheSize(stats.totalEntries)}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.secondaryTextColor }]}>
                Memory Cache:
              </Text>
              <Text style={[styles.statValue, { color: theme.textColor }]}>
                {formatCacheSize(stats.memoryEntries)}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.secondaryTextColor }]}>
                Profiles:
              </Text>
              <Text style={[styles.statValue, { color: theme.textColor }]}>
                {formatCacheSize(stats.profiles)}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.secondaryTextColor }]}>
                Posts:
              </Text>
              <Text style={[styles.statValue, { color: theme.textColor }]}>
                {formatCacheSize(stats.posts)}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.secondaryTextColor }]}>
                Feed Data:
              </Text>
              <Text style={[styles.statValue, { color: theme.textColor }]}>
                {formatCacheSize(stats.feed)}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.secondaryTextColor }]}>
                Interactions:
              </Text>
              <Text style={[styles.statValue, { color: theme.textColor }]}>
                {formatCacheSize(stats.interactions)}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.secondaryTextColor }]}>
                Private Messages:
              </Text>
              <Text style={[styles.statValue, { color: theme.textColor }]}>
                {formatCacheSize(stats.privateMessages)}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.secondaryTextColor }]}>
                Conversations:
              </Text>
              <Text style={[styles.statValue, { color: theme.textColor }]}>
                {formatCacheSize(stats.conversations)}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.secondaryTextColor }]}>
                Private Groups:
              </Text>
              <Text style={[styles.statValue, { color: theme.textColor }]}>
                {formatCacheSize(stats.privateGroups)}
              </Text>
            </View>

            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.secondaryTextColor }]}>
                Group Members:
              </Text>
              <Text style={[styles.statValue, { color: theme.textColor }]}>
                {formatCacheSize(stats.groupMembers)}
              </Text>
            </View>
          </View>

          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.primaryColor }]}
              onPress={loadCacheStats}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <Ionicons name="refresh-outline" size={16} color="white" />
                  <Text style={styles.actionButtonText}>Refresh</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.surfaceColor, borderColor: theme.primaryColor, borderWidth: 1 }]}
              onPress={cleanupCache}
              disabled={loading || clearing}
            >
              <Ionicons name="trash-outline" size={16} color={theme.primaryColor} />
              <Text style={[styles.actionButtonText, { color: theme.primaryColor }]}>Cleanup</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.errorColor }]}
              onPress={clearCache}
              disabled={loading || clearing}
            >
              {clearing ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <Ionicons name="nuclear-outline" size={16} color="white" />
                  <Text style={styles.actionButtonText}>Clear All</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      <Text style={[styles.description, { color: theme.secondaryTextColor }]}>
        Caching improves app performance by storing frequently accessed data locally. 
        Cleanup removes expired entries, while Clear All removes everything.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  loadingText: {
    fontSize: 14,
  },
  statsContainer: {
    marginBottom: 16,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  statLabel: {
    fontSize: 14,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 4,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
});

export default CacheManager;