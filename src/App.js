import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Text, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Screens
import HomeScreen from './screens/HomeScreen';
import ChannelScreen from './screens/ChannelScreen';
import CreateChannelScreen from './screens/CreateChannelScreen';
import SettingsScreen from './screens/SettingsScreen';
import ProfileScreen from './screens/ProfileScreen';
import PrivateMessageScreen from './screens/PrivateMessageScreen';
import PrivateConversationScreen from './screens/PrivateConversationScreen';
import FeedScreen from './screens/FeedScreen';
import UserProfileScreen from './screens/UserProfileScreen';
import PostDetailScreen from './screens/PostDetailScreen';
import FollowListScreen from './screens/FollowListScreen';

// Services
import { nostrService } from './services/NostrService';
import { botService } from './services/BotService';
import { notificationService } from './services/NotificationService';
import { nostrUtils } from './utils/nostrUtils';
import { STORAGE_KEYS, THEMES } from './utils/constants';

// Polyfills for web
if (Platform.OS === 'web') {
  require('react-native-url-polyfill/auto');
  require('react-native-get-random-values');
  
  // Suppress useNativeDriver warning on web
  console.warn = (...args) => {
    if (args[0]?.includes?.('useNativeDriver')) return;
    console.log(...args);
  };
}

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Placeholder screen for unimplemented features
function PlaceholderScreen({ title }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: THEMES.DARK.backgroundColor }}>
      <Ionicons name="construct" size={64} color={THEMES.DARK.secondaryTextColor} />
      <Text style={{ color: THEMES.DARK.textColor, fontSize: 18, marginTop: 16 }}>
        {title}
      </Text>
      <Text style={{ color: THEMES.DARK.secondaryTextColor, fontSize: 14, marginTop: 8 }}>
        Coming Soon!
      </Text>
    </View>
  );
}

// Main tab navigator
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === 'Channels') {
            iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          } else if (route.name === 'Messages') {
            iconName = focused ? 'mail' : 'mail-outline';
          } else if (route.name === 'Feed') {
            iconName = focused ? 'newspaper' : 'newspaper-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'person' : 'person-outline';
          } else if (route.name === 'Settings') {
            iconName = focused ? 'settings' : 'settings-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: THEMES.DARK.primaryColor,
        tabBarInactiveTintColor: THEMES.DARK.secondaryTextColor,
        headerStyle: {
          backgroundColor: THEMES.DARK.backgroundColor,
          borderBottomColor: THEMES.DARK.borderColor,
          borderBottomWidth: 1,
        },
        headerTintColor: THEMES.DARK.textColor,
        tabBarStyle: {
          backgroundColor: THEMES.DARK.cardBackgroundColor,
          borderTopColor: THEMES.DARK.borderColor,
          borderTopWidth: 1,
        }
      })}
    >
      <Tab.Screen 
        name="Channels" 
        component={HomeScreen} 
        options={{ title: 'IRC on Nostr' }}
      />
      <Tab.Screen 
        name="Messages" 
        component={PrivateMessageScreen}
        options={{ title: 'Private Messages' }}
      />
      <Tab.Screen 
        name="Feed" 
        component={FeedScreen}
        options={{ title: 'Feed' }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen}
        options={{ title: 'My Profile' }}
      />
      <Tab.Screen 
        name="Settings" 
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </Tab.Navigator>
  );
}

// Main app with stack navigator for modals and overlays
function AppNavigator() {
  return (
    <Stack.Navigator 
      screenOptions={{
        headerStyle: {
          backgroundColor: THEMES.DARK.backgroundColor,
          borderBottomColor: THEMES.DARK.borderColor,
          borderBottomWidth: 1,
        },
        headerTintColor: THEMES.DARK.textColor,
        headerTitleStyle: {
          fontWeight: '600',
        },
      }}
    >
      <Stack.Screen 
        name="MainTabs" 
        component={MainTabs} 
        options={{ headerShown: false }}
      />
      <Stack.Screen 
        name="Channel" 
        component={ChannelScreen}
        options={({ route }) => ({ 
          title: `#${route.params?.channelName || 'Channel'}`,
          presentation: 'card'
        })}
      />
      <Stack.Screen 
        name="CreateChannel" 
        component={CreateChannelScreen}
        options={{ 
          title: 'Create Channel',
          presentation: 'modal'
        }}
      />
      <Stack.Screen 
        name="PrivateConversation" 
        component={PrivateConversationScreen}
        options={({ route }) => ({ 
          title: route.params?.contactName || 'Private Chat',
          presentation: 'card'
        })}
      />
      <Stack.Screen 
        name="UserProfile" 
        component={UserProfileScreen}
        options={({ route }) => ({ 
          title: route.params?.userName || 'User Profile',
          presentation: 'card'
        })}
      />
      <Stack.Screen 
        name="PostDetail" 
        component={PostDetailScreen}
        options={{ 
          title: 'Post',
          presentation: 'card'
        }}
      />
      <Stack.Screen 
        name="FollowList" 
        component={FollowListScreen}
        options={({ route }) => ({ 
          title: `${route.params?.userName || 'User'}'s ${route.params?.type || 'follows'}`,
          presentation: 'card'
        })}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasKeys, setHasKeys] = useState(false);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      console.log('🚀 Initializing IRC on Nostr app...');
      
      // Check if user has keys
      const privateKey = await AsyncStorage.getItem(STORAGE_KEYS.PRIVATE_KEY);
      const publicKey = await AsyncStorage.getItem(STORAGE_KEYS.PUBLIC_KEY);
      
      if (privateKey && publicKey) {
        setHasKeys(true);
        console.log('✅ Existing keys found');
      } else {
        setHasKeys(false);
        console.log('🔑 No keys found - user can import or generate them');
      }
      
      // Initialize Nostr service first (if we have keys)
      if (privateKey && publicKey) {
        try {
          await nostrService.initialize();
          console.log('✅ Nostr service initialized');
        } catch (error) {
          console.error('⚠️ Nostr service initialization failed:', error);
        }
      }
      
      // Initialize bot service after Nostr service
      try {
        await botService.initialize();
        console.log('✅ Bot service initialized');
        
        // Check if bot service is ready
        if (botService.isReady()) {
          console.log('✅ Bot service is ready and running');
        } else {
          console.log('⚠️ Bot service initialized but not ready');
        }
      } catch (error) {
        console.error('⚠️ Bot service initialization failed:', error);
        // Continue without bots
      }

      // Initialize notification service
      try {
        await notificationService.initialize();
        console.log('✅ Notification service initialized');
      } catch (error) {
        console.error('⚠️ Notification service initialization failed:', error);
        // Continue without notifications
      }
      
      console.log('✅ App initialization complete');
      setIsInitialized(true);
    } catch (error) {
      console.error('❌ App initialization failed:', error);
      setIsInitialized(true); // Still show app
    }
  };

  if (!isInitialized) {
    return (
      <View style={{ 
        flex: 1, 
        justifyContent: 'center', 
        alignItems: 'center', 
        backgroundColor: THEMES.DARK.backgroundColor 
      }}>
        <ActivityIndicator size="large" color={THEMES.DARK.primaryColor} />
        <Text style={{ 
          color: THEMES.DARK.textColor, 
          marginTop: 16, 
          fontSize: 16 
        }}>
          Initializing IRC on Nostr...
        </Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" backgroundColor={THEMES.DARK.backgroundColor} />
      <AppNavigator />
    </NavigationContainer>
  );
}