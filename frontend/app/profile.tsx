import { router } from 'expo-router';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Tag, ChevronRight, Info, LogOut } from 'react-native-feather';
import { SafeAreaView } from 'react-native-safe-area-context';

import NotificationSettings from '@/components/NotificationSettings';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useColors } from '@/hooks/useColors';
import { colors } from '@/theme/colors';
import { typography, spacing, borderRadius, shadows } from '@/theme/designSystem';

export default function ProfileScreen() {
  const colors = useColors();
  const { user, logout, isLoading } = useAuth();
  useNotifications();

  const handleManageTopics = () => {
    router.push('/topics');
  };

  const handleSignOut = async () => {
    if (Platform.OS === 'web') {
      // For web, use a simple confirmation instead of Alert
      // @ts-ignore
      if (window.confirm('Are you sure you want to sign out?')) {
        await logout();
      }
    } else {
      // For mobile, use Alert as before
      Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: logout },
      ]);
    }
  };

  if (isLoading || !user) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            {user.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarLetter}>{user.handle.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>

          <Text style={styles.displayName}>{user.displayName || user.handle}</Text>

          <Text style={styles.handle}>@{user.handle}</Text>

          <View style={styles.statsContainer}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{user.followedTopics?.length || 0}</Text>
              <Text style={styles.statLabel}>Topics</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>

          <Pressable
            style={({ pressed }) => [
              styles.option,
              { backgroundColor: pressed ? colors.backgroundTertiary : colors.white },
            ]}
            onPress={handleManageTopics}
          >
            <View style={styles.optionIconContainer}>
              <Tag width={22} height={22} color={colors.primary} />
            </View>
            <View style={styles.optionTextContainer}>
              <Text style={styles.optionTitle}>Manage Topics</Text>
              <Text style={styles.optionDescription}>Follow topics to get personalized trends</Text>
            </View>
            <ChevronRight width={20} height={20} color={colors.textMuted} />
          </Pressable>

          <NotificationSettings />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App Info</Text>

          <View style={styles.option}>
            <View style={styles.optionIconContainer}>
              <Info width={22} height={22} color={colors.primary} />
            </View>
            <View style={styles.optionTextContainer}>
              <Text style={styles.optionTitle}>Version</Text>
              <Text style={styles.optionDescription}>1.0.0</Text>
            </View>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.signOutButton, { opacity: pressed ? 0.9 : 1 }]}
          onPress={handleSignOut}
        >
          <LogOut width={20} height={20} color={colors.white} style={styles.signOutButtonIcon} />
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: spacing[4],
    paddingBottom: spacing[8],
    gap: spacing[4],
  },
  profileHeader: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing[6],
    alignItems: 'center',
    ...shadows.sm,
  },
  avatarContainer: {
    marginBottom: spacing[3],
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: colors.white,
    ...shadows.sm,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
    ...shadows.sm,
  },
  avatarLetter: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.white,
  },
  displayName: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.text,
    marginBottom: spacing[1],
  },
  handle: {
    fontSize: typography.size.md,
    color: colors.textSecondary,
    marginBottom: spacing[3],
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  stat: {
    alignItems: 'center',
    paddingHorizontal: spacing[4],
  },
  statValue: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.text,
    marginBottom: spacing[1],
  },
  statLabel: {
    fontSize: typography.size.sm,
    color: colors.textSecondary,
  },
  section: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    ...shadows.sm,
  },
  sectionTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.text,
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  optionIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.text,
    marginBottom: spacing[1],
  },
  optionDescription: {
    fontSize: typography.size.sm,
    color: colors.textSecondary,
  },
  signOutButton: {
    flexDirection: 'row',
    height: 50,
    borderRadius: borderRadius.full,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[2],
    ...shadows.sm,
  },
  signOutButtonIcon: {
    marginRight: spacing[2],
  },
  signOutButtonText: {
    color: colors.white,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
});
