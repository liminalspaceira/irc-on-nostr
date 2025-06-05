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

const UserList = ({ 
  users = [], 
  onUserPress,
  currentUser,
  operators = [],
  theme = THEMES.DARK,
  style 
}) => {
  const renderUserItem = ({ item }) => {
    const isOperator = operators.includes(item.pubkey);
    const isCurrentUser = item.pubkey === currentUser;
    
    return (
      <TouchableOpacity
        style={[styles.userItem, { backgroundColor: theme.cardBackgroundColor }]}
        onPress={() => onUserPress && onUserPress(item)}
      >
        <View style={styles.userInfo}>
          <View style={styles.userHeader}>
            <Text style={[styles.username, { color: theme.textColor }]}>
              {item.displayName || `${item.pubkey.substring(0, 8)}...`}
            </Text>
            {isOperator && (
              <Ionicons name="shield" size={14} color={theme.warningColor} />
            )}
            {isCurrentUser && (
              <Text style={[styles.youLabel, { color: theme.primaryColor }]}>
                (you)
              </Text>
            )}
          </View>
          <Text style={[styles.userStatus, { color: theme.secondaryTextColor }]}>
            {item.status || 'Online'}
          </Text>
        </View>
        <View style={[styles.statusIndicator, { 
          backgroundColor: item.status === 'offline' ? theme.borderColor : theme.successColor 
        }]} />
      </TouchableOpacity>
    );
  };

  const sortedUsers = users.sort((a, b) => {
    // Operators first
    const aIsOp = operators.includes(a.pubkey);
    const bIsOp = operators.includes(b.pubkey);
    if (aIsOp && !bIsOp) return -1;
    if (!aIsOp && bIsOp) return 1;
    
    // Then by status (online first)
    if (a.status === 'offline' && b.status !== 'offline') return 1;
    if (a.status !== 'offline' && b.status === 'offline') return -1;
    
    // Then alphabetically
    const aName = a.displayName || a.pubkey;
    const bName = b.displayName || b.pubkey;
    return aName.localeCompare(bName);
  });

  if (users.length === 0) {
    return (
      <View style={[styles.emptyContainer, style]}>
        <Ionicons name="people-outline" size={32} color={theme.secondaryTextColor} />
        <Text style={[styles.emptyText, { color: theme.secondaryTextColor }]}>
          No users online
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <View style={styles.header}>
        <Text style={[styles.headerText, { color: theme.textColor }]}>
          Users ({users.length})
        </Text>
      </View>
      <FlatList
        data={sortedUsers}
        renderItem={renderUserItem}
        keyExtractor={(item) => item.pubkey}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerText: {
    fontSize: 16,
    fontWeight: '600',
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 8,
    marginVertical: 1,
    borderRadius: 6,
  },
  userInfo: {
    flex: 1,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  username: {
    fontSize: 14,
    fontWeight: '500',
    marginRight: 4,
  },
  youLabel: {
    fontSize: 12,
    fontStyle: 'italic',
    marginLeft: 4,
  },
  userStatus: {
    fontSize: 12,
    marginTop: 2,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    marginTop: 8,
  },
});

export default UserList;