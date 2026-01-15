import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Plus, Check } from 'react-native-feather';

import { useAuth } from '@/context/AuthContext';
import { useTagFilter } from '@/contexts/TagFilterContext';
import { useColors } from '@/hooks/useColors';
import { TrendsService } from '@/services/trendsService';
import { colors } from '@/theme/colors';
import { typography, spacing, borderRadius, shadows } from '@/theme/designSystem';
import type { Trend } from '@/types/trend';

interface TrendItemProps {
  trend: Trend;
  onPress?: () => void;
  trendTimeQuery: any;
  onTagPress?: (tag: string) => void;
}

export const TrendItem: React.FC<TrendItemProps> = ({ trend, onPress, onTagPress }) => {
  const colors = useColors();
  const { user, updateFollowedTopics } = useAuth();
  const { selectedTags } = useTagFilter();

  const isFollowing = user?.followedTopics?.includes(trend.keyword) || false;

  const handleFollow = async (e: any) => {
    e.stopPropagation();

    if (!user) return;

    try {
      const newTopics = isFollowing
        ? user.followedTopics.filter((topic) => topic !== trend.keyword)
        : [...user.followedTopics, trend.keyword];

      await updateFollowedTopics(newTopics);
    } catch (err) {
      console.error('Error updating followed topics:', err);
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.content}>
        <View style={styles.nameContainer}>
          <Text style={styles.name}>{trend.keyword}</Text>
          <View style={[styles.badge, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>
              {TrendsService.formatCount(trend.post_count)}
            </Text>
          </View>
        </View>

        <Text style={styles.count}>{TrendsService.formatCount(trend.post_count)} posts</Text>

        {trend.summary && (
          <Text style={styles.summary} numberOfLines={2}>
            {trend.summary}
          </Text>
        )}

        {trend.tags && trend.tags.length > 0 && (
          <View style={styles.tagsContainer}>
            {trend.tags.map((tag, index) => (
              <Pressable
                key={`${tag}-${index}`}
                style={({ pressed }) => [
                  styles.tagItem,
                  {
                    backgroundColor: selectedTags.includes(tag)
                      ? colors.primary
                      : colors.backgroundTertiary,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
                onPress={(e) => {
                  e.stopPropagation();
                  if (onTagPress) {
                    onTagPress(tag);
                  }
                }}
              >
                <Text
                  style={[
                    styles.tagText,
                    {
                      color: selectedTags.includes(tag) ? colors.white : colors.secondary,
                    },
                  ]}
                >
                  #{tag}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.actionsContainer}>
          <Text style={styles.timestamp}>{TrendsService.formatTimestamp(trend.detected_at)}</Text>

          {user && (
            <Pressable
              onPress={handleFollow}
              style={({ pressed }) => [
                styles.followButton,
                isFollowing
                  ? { backgroundColor: colors.primary }
                  : {
                      backgroundColor: colors.white,
                      borderWidth: 1,
                      borderColor: colors.primary,
                    },
                pressed && { opacity: 0.8 },
              ]}
            >
              {isFollowing ? (
                <Check
                  width={16}
                  height={16}
                  color={colors.white}
                  style={styles.followButtonIcon}
                />
              ) : (
                <Plus
                  width={16}
                  height={16}
                  color={colors.primary}
                  style={styles.followButtonIcon}
                />
              )}
              <Text
                style={[
                  styles.followButtonText,
                  { color: isFollowing ? colors.white : colors.primary },
                ]}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    marginVertical: spacing[3],
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
  },
  content: {
    padding: spacing[4],
  },
  pressed: {
    backgroundColor: colors.backgroundSecondary,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  name: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.text,
  },
  badge: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
  },
  badgeText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  count: {
    fontSize: typography.size.sm,
    color: colors.textSecondary,
    marginBottom: spacing[2],
  },
  timestamp: {
    fontSize: typography.size.sm,
    color: colors.textMuted,
  },
  summary: {
    fontSize: typography.size.md,
    color: colors.text,
    marginBottom: spacing[3],
    lineHeight: typography.lineHeight.relaxed * typography.size.md,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  followButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
    ...shadows.sm,
  },
  followButtonText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  followButtonIcon: {
    marginRight: spacing[1],
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing[2],
  },
  tagItem: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    marginRight: spacing[2],
    marginBottom: spacing[2],
  },
  tagText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
});
