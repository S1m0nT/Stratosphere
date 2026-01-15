import { router } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Bell, TrendingUp, RefreshCw, X } from 'react-native-feather';

import { useNotifications } from '@/context/NotificationContext';
import { useColors } from '@/hooks/useColors';
import { colors } from '@/theme/colors';
import { spacing, borderRadius, typography, shadows } from '@/theme/designSystem';
import { NotificationData } from '@/types/notifications';

const NotificationBanner: React.FC = () => {
  const { lastNotification, clearLastNotification } = useNotifications();
  const colors = useColors();
  const translateY = useRef(new Animated.Value(-100)).current;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Extract notification data
  const notificationData = lastNotification?.request.content.data as NotificationData | undefined;
  const title = lastNotification?.request.content.title || 'New Notification';
  const body = lastNotification?.request.content.body || '';

  useEffect(() => {
    if (lastNotification) {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Animate banner in
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        speed: 12,
        bounciness: 8,
      }).start();

      // Set timeout to hide the banner after 5 seconds
      timeoutRef.current = setTimeout(() => {
        hideBanner();
      }, 5000);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [lastNotification]);

  const hideBanner = () => {
    Animated.timing(translateY, {
      toValue: -100,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      clearLastNotification();
    });
  };

  const handlePress = () => {
    if (!notificationData) return;

    // Navigate based on notification type
    if (notificationData.type === 'trend') {
      router.push(`/trend/${notificationData.keyword}`);
    }

    // Hide the banner
    hideBanner();
  };

  if (!lastNotification) return null;

  // Get appropriate icon based on notification type
  let IconComponent = Bell;
  if (notificationData?.type === 'trend') {
    IconComponent = TrendingUp;
  } else if (notificationData?.type === 'update') {
    IconComponent = RefreshCw;
  }

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY }] }]}>
      <TouchableOpacity style={styles.content} onPress={handlePress} activeOpacity={0.9}>
        <View style={styles.iconContainer}>
          <IconComponent width={22} height={22} color={colors.primary} />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {body}
          </Text>
        </View>
        <TouchableOpacity style={styles.closeButton} onPress={hideBanner}>
          <X width={20} height={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    margin: spacing[2],
    marginTop: Platform.OS === 'ios' ? 50 : 16, // Account for status bar
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
    zIndex: 999,
    ...shadows.md,
  },
  content: {
    flexDirection: 'row',
    padding: spacing[3],
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing[3],
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontWeight: typography.weight.semibold,
    fontSize: typography.size.md,
  },
  body: {
    color: colors.textSecondary,
    fontSize: typography.size.sm,
    marginTop: spacing[1],
  },
  closeButton: {
    padding: spacing[1],
    marginLeft: spacing[2],
  },
});

export default NotificationBanner;
