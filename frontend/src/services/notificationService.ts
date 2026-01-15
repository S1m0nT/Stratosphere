import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { isDevice } from 'expo-device';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  NotificationPayload,
  NotificationPermissionStatus,
  NotificationSettings,
} from '@/types/notifications';

// API Base URL - must match the one from AuthContext
const API_BASE_URL = 'https://i-love.terrorism.lol';

class NotificationService {
  private static instance: NotificationService;
  private notificationSettings: NotificationSettings = {
    pushEnabled: true,
    soundEnabled: true,
    alertsEnabled: true,
  };
  private notificationListener: any;
  private responseListener: any;

  private constructor() {
    // Load notification settings from storage
    this.loadSettings();

    // Configure notification handler
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: this.notificationSettings.alertsEnabled,
        shouldPlaySound: this.notificationSettings.soundEnabled,
        shouldSetBadge: false,
      }),
    });

    // Set up notification listeners
    this.setupNotificationListeners();
  }

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  private async loadSettings(): Promise<void> {
    try {
      const settings = await AsyncStorage.getItem('@notification_settings');
      if (settings) {
        this.notificationSettings = JSON.parse(settings);
      }
    } catch (error) {
      console.error('Failed to load notification settings:', error);
    }
  }

  private async saveSettings(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        '@notification_settings',
        JSON.stringify(this.notificationSettings)
      );
    } catch (error) {
      console.error('Failed to save notification settings:', error);
    }
  }

  getSettings(): NotificationSettings {
    return { ...this.notificationSettings };
  }

  async updateSettings(settings: Partial<NotificationSettings>): Promise<void> {
    this.notificationSettings = {
      ...this.notificationSettings,
      ...settings,
    };
    await this.saveSettings();

    // If push notifications are enabled, ensure we're registered
    if (settings.pushEnabled && this.notificationSettings.pushEnabled) {
      await this.registerForPushNotifications();
    }
  }

  private setupNotificationListeners(): void {
    // Remove any existing listeners
    this.removeNotificationListeners();

    // Set up new listeners
    this.notificationListener = Notifications.addNotificationReceivedListener((notification) => {
      console.log('Notification received:', notification);
      // You can trigger actions here when a notification is received
    });

    this.responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log('Notification response received:', response);
      const data = response.notification.request.content.data;

      // Handle notification taps based on the data
      // For example, navigate to a specific trend if the notification is about a trend
      if (data.trendKeyword) {
        // Navigation would be handled here, but we need context to do that
        // This would typically be done through a navigation service or context
      }
    });
  }

  removeNotificationListeners(): void {
    if (this.notificationListener) {
      Notifications.removeNotificationSubscription(this.notificationListener);
    }
    if (this.responseListener) {
      Notifications.removeNotificationSubscription(this.responseListener);
    }
  }

  async registerForPushNotifications(): Promise<string | undefined> {
    if (!isDevice) {
      console.warn(
        'Push notifications are only available in development builds or physical devices'
      );
      return;
    }

    // Don't proceed if notifications are disabled in settings
    if (!this.notificationSettings.pushEnabled) {
      console.log('Push notifications are disabled in app settings');
      return;
    }

    try {
      const permission = await this.requestPermissions();
      if (permission !== 'granted') {
        console.log('Failed to get push token - permission not granted');
        return;
      }

      const token = await this.getExpoPushToken();

      // Register token with the backend
      await this.registerTokenWithBackend(token);

      return token;
    } catch (error) {
      console.error('Error registering for push notifications:', error);
      return undefined;
    }
  }

  private async registerTokenWithBackend(token: string): Promise<void> {
    // Check if we're logged in
    const userJson = await AsyncStorage.getItem('@user');
    if (!userJson) {
      console.log('Not registering push token - user not logged in');
      return;
    }

    try {
      // Send token to backend
      const response = await fetch(`${API_BASE_URL}/api/notifications/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_token: token,
          device_info: {
            os: Platform.OS,
            model: Device.modelName || 'Unknown',
            osVersion: Platform.Version,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to register token with backend: ${response.status}`);
      }

      console.log('Successfully registered push token with backend');
    } catch (error) {
      console.error('Error registering token with backend:', error);
      throw error;
    }
  }

  private async requestPermissions(): Promise<NotificationPermissionStatus> {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: 'default',
      });

      // Create additional channel for trend alerts
      await Notifications.setNotificationChannelAsync('trends', {
        name: 'Trend Alerts',
        description: 'Notifications about trending topics',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#5856D6',
        sound: 'default',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    return finalStatus;
  }

  private async getExpoPushToken(): Promise<string> {
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    });

    return token;
  }

  async scheduleLocalNotification(payload: NotificationPayload): Promise<string> {
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: payload.title,
          body: payload.body,
          data: payload.data || {},
          // Use a custom sound if available
          sound: this.notificationSettings.soundEnabled ? 'notification-sound.wav' : undefined,
          // Add badge number - you could keep track of unread notifications
          badge: 1,
        },
        trigger: payload.trigger || null,
      });
      return id;
    } catch (error) {
      console.error('Failed to schedule notification:', error);
      throw error;
    }
  }

  async scheduleDelayedNotification(
    payload: NotificationPayload,
    seconds: number
  ): Promise<string> {
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: payload.title,
          body: payload.body,
          data: payload.data || {},
          sound: this.notificationSettings.soundEnabled ? 'notification-sound.wav' : undefined,
        },
        trigger: {
          seconds,
        } as Notifications.TimeIntervalTriggerInput,
      });
      return id;
    } catch (error) {
      console.error('Failed to schedule delayed notification:', error);
      throw error;
    }
  }

  async cancelNotification(notificationId: string): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  }

  async cancelAllNotifications(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  async getBadgeCount(): Promise<number> {
    return await Notifications.getBadgeCountAsync();
  }

  async setBadgeCount(count: number): Promise<void> {
    await Notifications.setBadgeCountAsync(count);
  }

  // Helper method to handle notification responses
  async handleNotificationResponse(response: Notifications.NotificationResponse): Promise<void> {
    // This will be called when a user taps on a notification
    const data = response.notification.request.content.data;
    console.log('Handling notification response:', data);

    // You can handle different notification types based on the data
    // This would need to be integrated with navigation in the app
  }
}

export default NotificationService.getInstance();
