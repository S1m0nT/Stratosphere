import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import React, { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { useAuth } from './AuthContext';

import notificationService from '@/services/notificationService';
import {
  NotificationData,
  NotificationSettings,
  PushNotificationState,
} from '@/types/notifications';

interface NotificationContextType {
  pushState: PushNotificationState;
  settings: NotificationSettings;
  lastNotification: Notifications.Notification | null;
  updateSettings: (settings: Partial<NotificationSettings>) => Promise<void>;
  requestPermissions: () => Promise<void>;
  clearLastNotification: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

interface NotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const [pushState, setPushState] = useState<PushNotificationState>({});
  const [settings, setSettings] = useState<NotificationSettings>({
    pushEnabled: true,
    soundEnabled: true,
    alertsEnabled: true,
  });
  const [lastNotification, setLastNotification] = useState<Notifications.Notification | null>(null);
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  // Initialize notifications
  useEffect(() => {
    initializeNotifications();

    // Clean up listeners on unmount
    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  // Setup push notifications when user auth state changes
  useEffect(() => {
    if (isAuthenticated && user) {
      setupPushNotifications();
    }
  }, [isAuthenticated, user]);

  const initializeNotifications = async () => {
    // Load settings
    const currentSettings = notificationService.getSettings();
    setSettings(currentSettings);

    // Set up notification handlers
    setupNotificationListeners();
  };

  const setupPushNotifications = async () => {
    if (settings.pushEnabled) {
      try {
        const token = await notificationService.registerForPushNotifications();
        if (token) {
          setPushState((prev) => ({ ...prev, expoPushToken: token }));
          console.log('Push notification token:', token);
        }
      } catch (error) {
        console.error('Failed to register for push notifications:', error);
        // Show an alert only if push is enabled but failed
        if (Platform.OS === 'ios') {
          Alert.alert(
            'Push Notification Permission',
            'Please enable push notifications in your device settings to receive trend alerts.',
            [{ text: 'OK' }]
          );
        }
      }
    }
  };

  const setupNotificationListeners = () => {
    // Listen for incoming notifications when the app is in the foreground
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log('Notification received in foreground:', notification);
      setLastNotification(notification);

      // You could show an in-app alert or banner here
      const data = notification.request.content.data as NotificationData;
      if (data && data.type === 'trend') {
        // Handle trend notification
        console.log('Trend notification received:', data);
      }
    });

    // Listen for user interaction with notifications
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log('Notification response received:', response);
      const data = response.notification.request.content.data as NotificationData;

      // Navigate based on notification type
      if (data && data.type === 'trend') {
        // Navigate to trend detail
        router.push(`/trend/${data.keyword}`);
      }
    });
  };

  const requestPermissions = async () => {
    try {
      await notificationService.registerForPushNotifications();
      // Update settings to ensure they're in sync
      setSettings(notificationService.getSettings());
    } catch (error) {
      console.error('Error requesting notification permissions:', error);
    }
  };

  const updateSettings = async (newSettings: Partial<NotificationSettings>) => {
    try {
      await notificationService.updateSettings(newSettings);
      setSettings(notificationService.getSettings());

      // If enabling push notifications, make sure we're registered
      if (newSettings.pushEnabled && isAuthenticated) {
        setupPushNotifications();
      }
    } catch (error) {
      console.error('Error updating notification settings:', error);
    }
  };

  const clearLastNotification = () => {
    setLastNotification(null);
  };

  return (
    <NotificationContext.Provider
      value={{
        pushState,
        settings,
        lastNotification,
        updateSettings,
        requestPermissions,
        clearLastNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
