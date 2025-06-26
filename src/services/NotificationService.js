import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../utils/constants';

class NotificationService {
  constructor() {
    this.settings = {
      notifications: true,
      soundEnabled: true
    };
    this.audioContext = null;
    this.sounds = {};
    this.isInitialized = false;
  }

  async initialize() {
    try {
      await this.loadSettings();
      await this.initializeSounds();
      this.requestNotificationPermission();
      this.isInitialized = true;
      console.log('🔔 NotificationService initialized');
    } catch (error) {
      console.error('Failed to initialize NotificationService:', error);
    }
  }

  async loadSettings() {
    try {
      const storedSettings = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (storedSettings) {
        const parsedSettings = JSON.parse(storedSettings);
        this.settings = {
          notifications: parsedSettings.notifications ?? true,
          soundEnabled: parsedSettings.soundEnabled ?? true
        };
      }
    } catch (error) {
      console.error('Error loading notification settings:', error);
    }
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    console.log('🔔 Notification settings updated:', this.settings);
  }

  requestNotificationPermission() {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
          console.log('🔔 Notification permission:', permission);
        });
      }
    }
  }

  async initializeSounds() {
    if (typeof window !== 'undefined' && 'AudioContext' in window) {
      try {
        // Create audio context for web
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Create notification sounds
        await this.createNotificationSounds();
      } catch (error) {
        console.warn('Audio not supported:', error);
      }
    }
  }

  async createNotificationSounds() {
    // Create simple beep sounds using Web Audio API
    this.sounds = {
      message: this.createBeepSound(800, 200), // Higher pitch for messages
      mention: this.createBeepSound(1000, 150), // Even higher for mentions
      join: this.createBeepSound(600, 100), // Lower for joins
      privateMessage: this.createBeepSound(900, 250) // Distinct for DMs
    };
  }

  createBeepSound(frequency, duration) {
    return () => {
      if (!this.audioContext || !this.settings.soundEnabled) return;

      try {
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.1, this.audioContext.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration / 1000);

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + duration / 1000);
      } catch (error) {
        console.warn('Failed to play sound:', error);
      }
    };
  }

  playSound(soundType) {
    if (!this.settings.soundEnabled || !this.sounds[soundType]) return;

    try {
      // Resume audio context if suspended (required by some browsers)
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      
      this.sounds[soundType]();
      console.log(`🔊 Played ${soundType} sound`);
    } catch (error) {
      console.warn('Failed to play sound:', error);
    }
  }

  showNotification(title, body, options = {}) {
    if (!this.settings.notifications) return;

    try {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          const notification = new Notification(title, {
            body,
            icon: '/favicon.ico', // You can add a custom icon
            badge: '/favicon.ico',
            tag: options.tag || 'nostr-message',
            requireInteraction: false,
            silent: !this.settings.soundEnabled,
            ...options
          });

          // Auto close after 5 seconds
          setTimeout(() => {
            notification.close();
          }, 5000);

          // Handle click
          notification.onclick = () => {
            window.focus();
            notification.close();
            if (options.onClick) options.onClick();
          };

          console.log('🔔 Notification shown:', title);
          return notification;
        } else {
          console.log('🔔 Notifications not permitted');
        }
      } else {
        console.log('🔔 Notifications not supported');
      }
    } catch (error) {
      console.error('Failed to show notification:', error);
    }
  }

  // Specific notification methods
  notifyChannelMessage(channelName, authorName, message) {
    if (!this.isInitialized) return;

    const title = `#${channelName}`;
    const body = `${authorName}: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`;
    
    this.showNotification(title, body, {
      tag: `channel-${channelName}`,
      icon: '/favicon.ico'
    });
    
    this.playSound('message');
  }

  notifyPrivateMessage(senderName, message) {
    if (!this.isInitialized) return;

    const title = `Private Message from ${senderName}`;
    const body = message.substring(0, 100) + (message.length > 100 ? '...' : '');
    
    this.showNotification(title, body, {
      tag: 'private-message',
      icon: '/favicon.ico',
      requireInteraction: true // Keep DM notifications visible longer
    });
    
    this.playSound('privateMessage');
  }

  notifyMention(channelName, authorName, message) {
    if (!this.isInitialized) return;

    const title = `Mentioned in #${channelName}`;
    const body = `${authorName}: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`;
    
    this.showNotification(title, body, {
      tag: `mention-${channelName}`,
      icon: '/favicon.ico',
      requireInteraction: true
    });
    
    this.playSound('mention');
  }

  notifyUserJoin(channelName, username) {
    if (!this.isInitialized) return;

    // Only show join notifications for small channels to avoid spam
    const title = `User Joined #${channelName}`;
    const body = `${username} joined the channel`;
    
    this.showNotification(title, body, {
      tag: `join-${channelName}`,
      icon: '/favicon.ico'
    });
    
    this.playSound('join');
  }

  notifyInvitation(groupName, inviterName) {
    if (!this.isInitialized) return;

    const title = 'Private Group Invitation';
    const body = `${inviterName} invited you to join "${groupName}"`;
    
    this.showNotification(title, body, {
      tag: 'group-invitation',
      icon: '/favicon.ico',
      requireInteraction: true
    });
    
    this.playSound('mention');
  }

  // Test notification method
  testNotification() {
    this.showNotification('Test Notification', 'This is a test notification from Nostr IRC app', {
      tag: 'test'
    });
    this.playSound('message');
  }

  // Check if notifications are enabled
  areNotificationsEnabled() {
    return this.settings.notifications && 
           (typeof window === 'undefined' || 
            (window.Notification && Notification.permission === 'granted'));
  }

  // Check if sounds are enabled
  areSoundsEnabled() {
    return this.settings.soundEnabled;
  }

  // Enable user interaction with audio (required by browsers)
  enableAudio() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;