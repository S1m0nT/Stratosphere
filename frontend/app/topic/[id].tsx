import { format } from 'date-fns';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { AlertCircle, ChevronLeft, Tag, Check, Plus, TrendingUp } from 'react-native-feather';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TrendItem } from '@/components/TrendItem';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { TrendsService } from '@/services/trendsService';
import { colors } from '@/theme/colors';
import { typography, spacing, borderRadius, shadows } from '@/theme/designSystem';
import { Topic, Trend } from '@/types/trend';

export default function TopicDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams();
  const { user, updateFollowedTopics } = useAuth();

  const [topic, setTopic] = useState<Topic | null>(null);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [relatedTopics, setRelatedTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFollowLoading, setIsFollowLoading] = useState(false);

  const fetchTopicData = useCallback(async () => {
    if (!id) return;

    try {
      setError(null);
      setIsLoading(true);

      // Fetch topic details
      const topicData = await TrendsService.getTopicDetail(id as string);
      setTopic(topicData.topic);
      setTrends(topicData.trends);

      // Check if user is following this topic
      if (user) {
        setIsFollowing(user.followedTopics.includes(topicData.topic.name));
      }

      // Fetch related topics
      const relatedTopics = await TrendsService.getRelatedTopics(id as string);
      setRelatedTopics(relatedTopics);
    } catch (error) {
      console.error('Error fetching topic data:', error);
      setError('Failed to load topic data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [id, user]);

  useEffect(() => {
    fetchTopicData();
  }, [fetchTopicData]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchTopicData();
  }, [fetchTopicData]);

  const handleFollowToggle = async () => {
    if (!topic || !user) return;

    setIsFollowLoading(true);
    try {
      const currentTopics = [...user.followedTopics];

      if (isFollowing) {
        // Unfollow topic
        const updatedTopics = currentTopics.filter((t) => t !== topic.name);
        await updateFollowedTopics(updatedTopics);
        setIsFollowing(false);
      } else {
        // Follow topic
        if (!currentTopics.includes(topic.name)) {
          const updatedTopics = [...currentTopics, topic.name];
          await updateFollowedTopics(updatedTopics);
          setIsFollowing(true);
        }
      }
    } catch (error) {
      console.error('Error toggling follow status:', error);
    } finally {
      setIsFollowLoading(false);
    }
  };

  const navigateToRelatedTopic = (topicId: string) => {
    router.push(`/topic/${topicId}`);
  };

  const renderRelatedTopicItem = ({ item }: { item: Topic }) => (
    <Pressable style={styles.relatedTopicItem} onPress={() => navigateToRelatedTopic(item.id)}>
      <Text style={styles.relatedTopicName} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={styles.relatedTopicStats}>
        {TrendsService.formatCount(item.follower_count)} followers
      </Text>
    </Pressable>
  );

  if (isLoading && !isRefreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <AlertCircle width={48} height={48} color={colors.error} />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={handleRefresh}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  if (!topic) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Topic not found</Text>
        <Pressable style={styles.retryButton} onPress={() => router.back()}>
          <Text style={styles.retryButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerTitle: topic.name,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <ChevronLeft width={24} height={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Topic Header Section */}
        <View style={styles.topicHeader}>
          {topic.image_url ? (
            <Image source={{ uri: topic.image_url }} style={styles.topicImage} />
          ) : (
            <View style={styles.topicImagePlaceholder}>
              <Tag width={60} height={60} color={colors.textSecondary} />
            </View>
          )}

          <View style={styles.topicInfo}>
            <Text style={styles.topicName}>{topic.name}</Text>

            {topic.description && <Text style={styles.topicDescription}>{topic.description}</Text>}

            <View style={styles.topicStats}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {TrendsService.formatCount(topic.follower_count)}
                </Text>
                <Text style={styles.statLabel}>Followers</Text>
              </View>

              <View style={styles.statItem}>
                <Text style={styles.statValue}>{TrendsService.formatCount(topic.trend_count)}</Text>
                <Text style={styles.statLabel}>Trends</Text>
              </View>

              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {format(new Date(topic.created_at * 1000), 'MMM d')}
                </Text>
                <Text style={styles.statLabel}>Created</Text>
              </View>
            </View>

            {/* Follow Button */}
            {user && (
              <Pressable
                style={[
                  styles.followButton,
                  isFollowing
                    ? { backgroundColor: colors.primary }
                    : {
                        backgroundColor: 'transparent',
                        borderWidth: 1,
                        borderColor: colors.primary,
                      },
                  isFollowLoading && { opacity: 0.5 },
                ]}
                onPress={handleFollowToggle}
                disabled={isFollowLoading}
              >
                {isFollowLoading ? (
                  <ActivityIndicator
                    size="small"
                    color={isFollowing ? colors.white : colors.primary}
                  />
                ) : (
                  <>
                    {isFollowing ? (
                      <Check
                        width={20}
                        height={20}
                        color={colors.white}
                        style={styles.followButtonIcon}
                      />
                    ) : (
                      <Plus
                        width={20}
                        height={20}
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
                  </>
                )}
              </Pressable>
            )}
          </View>
        </View>

        {/* Related Topics Section */}
        {relatedTopics.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Related Topics</Text>
            <FlatList
              data={relatedTopics}
              renderItem={renderRelatedTopicItem}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.relatedTopicsList}
            />
          </View>
        )}

        {/* Trending Now Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trending in {topic.name}</Text>

          {trends.length > 0 ? (
            <View style={styles.trendsList}>
              {trends.map((trend) => (
                <TrendItem
                  key={trend.keyword}
                  trend={trend}
                  onPress={() => router.push(`/trend/${encodeURIComponent(trend.keyword)}`)}
                  trendTimeQuery={{ window_hours: 24 }}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <TrendingUp width={32} height={32} color={colors.textMuted} />
              <Text style={styles.emptyText}>No trends found for this topic</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[6],
    backgroundColor: colors.backgroundSecondary,
  },
  errorText: {
    fontSize: typography.size.lg,
    textAlign: 'center',
    marginVertical: spacing[4],
    color: colors.error,
  },
  retryButton: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    ...shadows.sm,
  },
  retryButtonText: {
    color: colors.white,
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  backButton: {
    padding: spacing[2],
    marginLeft: spacing[2],
    borderRadius: spacing[4],
  },
  topicHeader: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing[4],
    margin: spacing[4],
    marginBottom: spacing[2],
    ...shadows.sm,
  },
  topicImage: {
    width: '100%',
    height: 200,
    borderRadius: borderRadius.md,
    marginBottom: spacing[4],
  },
  topicImagePlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: borderRadius.md,
    marginBottom: spacing[4],
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundTertiary,
  },
  topicInfo: {
    marginBottom: spacing[2],
  },
  topicName: {
    fontSize: typography.size['2xl'],
    fontWeight: typography.weight.bold,
    marginBottom: spacing[2],
    color: colors.text,
  },
  topicDescription: {
    fontSize: typography.size.md,
    lineHeight: 22,
    marginBottom: spacing[4],
    color: colors.textSecondary,
  },
  topicStats: {
    flexDirection: 'row',
    marginBottom: spacing[4],
  },
  statItem: {
    marginRight: spacing[6],
  },
  statValue: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.text,
  },
  statLabel: {
    fontSize: typography.size.sm,
    marginTop: spacing[1],
    color: colors.textMuted,
  },
  followButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[3],
    borderRadius: borderRadius.full,
    ...shadows.sm,
  },
  followButtonIcon: {
    marginRight: spacing[2],
  },
  followButtonText: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  section: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing[4],
    margin: spacing[4],
    marginBottom: spacing[2],
    ...shadows.sm,
  },
  sectionTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    marginBottom: spacing[3],
    color: colors.text,
  },
  relatedTopicsList: {
    paddingVertical: spacing[2],
    gap: spacing[3],
  },
  relatedTopicItem: {
    padding: spacing[3],
    borderRadius: borderRadius.md,
    width: 160,
    backgroundColor: colors.backgroundTertiary,
  },
  relatedTopicName: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    marginBottom: spacing[1],
    color: colors.text,
  },
  relatedTopicStats: {
    fontSize: typography.size.xs,
    color: colors.textSecondary,
  },
  trendsList: {
    marginTop: spacing[2],
  },
  emptyContainer: {
    padding: spacing[6],
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundTertiary,
  },
  emptyText: {
    marginTop: spacing[3],
    fontSize: typography.size.md,
    textAlign: 'center',
    color: colors.textMuted,
  },
});
