import React from 'react';
import { StyleSheet, Text, View, Switch, TouchableOpacity, Alert, Platform } from 'react-native';
import { Bell, Volume2, AlertCircle } from 'react-native-feather';

import { useNotifications } from '@/context/NotificationContext';
import { useColors } from '@/hooks/useColors';
import { colors } from '@/theme/colors';
import { typography, spacing, borderRadius } from '@/theme/designSystem';

const NotificationSettings: React.FC = () => {
  const { settings, updateSettings, requestPermissions } = useNotifications();
  const colors = useColors();

  const handleTogglePush = async (value: boolean) => {
    // If enabling notifications, request permissions first
    if (value) {
      await requestPermissions();
    } else {
      // If disabling, just update the setting
      await updateSettings({ pushEnabled: value });

      if (Platform.OS === 'ios' && value === false) {
        // On iOS, we should inform the user that they'll need to use system settings if they want to re-enable
        Alert.alert(
          'Notification Settings',
          'To re-enable notifications in the future, you may need to also update your device settings.',
          [{ text: 'OK' }]
        );
      }
    }
  };

  const handleToggleSound = async (value: boolean) => {
    await updateSettings({ soundEnabled: value });
  };

  const handleToggleAlerts = async (value: boolean) => {
    await updateSettings({ alertsEnabled: value });
  };

  const testNotification = async () => {
    try {
      await requestPermissions();
      Alert.alert('Test Notification', 'A test notification will be sent in a few seconds', [
        { text: 'OK' },
      ]);
    } catch (error) {
      console.error('Failed to send test notification:', error);
      Alert.alert('Error', 'Failed to send test notification');
    }
  };

  return (
    <>
      <View style={styles.settingRow}>
        <View style={styles.settingInfo}>
          <View style={styles.settingIconContainer}>
            <Bell width={20} height={20} color={colors.primary} />
          </View>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>Push Notifications</Text>
            <Text style={styles.settingDescription}>Receive important updates about trends</Text>
          </View>
        </View>
        <Switch
          value={settings.pushEnabled}
          onValueChange={handleTogglePush}
          trackColor={{ false: colors.borderLight, true: colors.primaryLight }}
          thumbColor={settings.pushEnabled ? colors.primary : colors.backgroundElevated}
          ios_backgroundColor={colors.borderLight}
        />
      </View>

      <View style={styles.settingRow}>
        <View style={styles.settingInfo}>
          <View style={styles.settingIconContainer}>
            <Volume2 width={20} height={20} color={colors.primary} />
          </View>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>Sound</Text>
            <Text style={styles.settingDescription}>Play sound with notifications</Text>
          </View>
        </View>
        <Switch
          value={settings.soundEnabled}
          onValueChange={handleToggleSound}
          trackColor={{ false: colors.borderLight, true: colors.primaryLight }}
          thumbColor={settings.soundEnabled ? colors.primary : colors.backgroundElevated}
          ios_backgroundColor={colors.borderLight}
          disabled={!settings.pushEnabled}
        />
      </View>

      <View style={styles.settingRow}>
        <View style={styles.settingInfo}>
          <View style={styles.settingIconContainer}>
            <AlertCircle width={20} height={20} color={colors.primary} />
          </View>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>In-App Alerts</Text>
            <Text style={styles.settingDescription}>Show alerts inside the app</Text>
          </View>
        </View>
        <Switch
          value={settings.alertsEnabled}
          onValueChange={handleToggleAlerts}
          trackColor={{ false: colors.borderLight, true: colors.primaryLight }}
          thumbColor={settings.alertsEnabled ? colors.primary : colors.backgroundElevated}
          ios_backgroundColor={colors.borderLight}
          disabled={!settings.pushEnabled}
        />
      </View>

      <TouchableOpacity
        style={styles.testButton}
        onPress={testNotification}
        disabled={!settings.pushEnabled}
      >
        <Text style={styles.testButtonText}>Test Notification</Text>
      </TouchableOpacity>
    </>
  );
};

const styles = StyleSheet.create({
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing[4],
  },
  settingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing[3],
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.text,
    marginBottom: spacing[1],
  },
  settingDescription: {
    fontSize: typography.size.sm,
    color: colors.textSecondary,
  },
  testButton: {
    alignSelf: 'center',
    marginVertical: spacing[4],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.full,
  },
  testButtonText: {
    color: colors.primary,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
});

export default NotificationSettings;
