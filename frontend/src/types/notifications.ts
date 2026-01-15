import * as Notifications from 'expo-notifications';

export interface PushNotificationState {
  expoPushToken?: string;
  notification?: Notifications.Notification;
}

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  trigger?: Notifications.NotificationTriggerInput;
}

export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface NotificationSettings {
  pushEnabled: boolean;
  soundEnabled: boolean;
  alertsEnabled: boolean;
}

export type NotificationType = 'trend' | 'system' | 'update';

export interface TrendNotification {
  type: 'trend';
  keyword: string;
  postCount: number;
  summary?: string;
}

export interface SystemNotification {
  type: 'system';
  message: string;
}

export interface UpdateNotification {
  type: 'update';
  version: string;
  features: string[];
}

export type NotificationData = TrendNotification | SystemNotification | UpdateNotification;
