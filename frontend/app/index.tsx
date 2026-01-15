import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';
import { TrendingUp, AlertCircle } from 'react-native-feather';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TagFilter } from '@/components/TagFilter';
import { TrendItem } from '@/components/TrendItem';
import { useTagFilter } from '@/contexts/TagFilterContext';
import { useColors } from '@/hooks/useColors';
import { TrendsService, queryKeys } from '@/services/trendsService';
import { colors } from '@/theme/colors';
import { typography, spacing, borderRadius, shadows } from '@/theme/designSystem';
import type { Trend, TrendTimeQuery } from '@/types/trend';

export default function TrendsScreen() {
  const colors = useColors();
  const { selectedTags, filterMode, clearTags, toggleTag, setFilterMode } = useTagFilter();
  const [timeQuery, setTimeQuery] = useState<TrendTimeQuery>({});
  const [selectedWindow, setSelectedWindow] = useState<number>(1);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const timeWindows = TrendsService.getTimeWindowOptions();

  // Use React Query for trends data
  const {
    data: trendsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [queryKeys.trends, timeQuery, selectedTags, filterMode],
    queryFn: () =>
      TrendsService.getTrends(
        timeQuery,
        selectedTags.length > 0 ? selectedTags : undefined,
        filterMode
      ),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const handleTimeWindowChange = (hours: number) => {
    setSelectedWindow(hours);
    setTimeQuery((prev) => ({
      ...prev,
      window_hours: hours,
    }));
  };

  const handleTrendPress = useCallback((trend: Trend) => {
    router.push({
      pathname: '/trend/[keyword]',
      params: { keyword: encodeURIComponent(trend.keyword) },
    });
  }, []);

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.titleContainer}>
        <Text style={styles.title}>Trending Now</Text>
        <View style={styles.timeWindowContainer}>
          {timeWindows.map((window) => (
            <Pressable
              key={window.hours}
              style={[
                styles.timeWindowButton,
                selectedWindow === window.hours && styles.timeWindowButtonSelected,
              ]}
              onPress={() => handleTimeWindowChange(window.hours)}
            >
              <Text
                style={[
                  styles.timeWindowText,
                  selectedWindow === window.hours && styles.timeWindowTextSelected,
                ]}
              >
                {window.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Tag Filter Component for multi-selecting tags */}
      <TagFilter
        multiSelect={true}
        onSelectTags={(tags) => {
          clearTags();
          tags.forEach(toggleTag);
        }}
        selectedTags={selectedTags}
        filterMode={filterMode}
        onChangeFilterMode={setFilterMode}
        onSelectTag={() => {}} // Not used in multi-select mode
        selectedTag={null} // Not used in multi-select mode
      />
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <TrendingUp width={48} height={48} color={colors.textMuted} />
      <Text style={styles.emptyText}>No trends found for this time period</Text>
      <Pressable
        style={styles.tryAgainButton}
        onPress={() => {
          clearTags();
          refetch();
        }}
      >
        <Text style={styles.tryAgainText}>Clear filters & refresh</Text>
      </Pressable>
    </View>
  );

  const trends = trendsData?.trends || [];

  if (isLoading && !isRefreshing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <AlertCircle width={48} height={48} color={colors.error} />
        <Text style={styles.errorText}>Unable to load trends</Text>
        <Pressable style={styles.tryAgainButton} onPress={() => refetch()}>
          <Text style={styles.tryAgainText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={trends}
        keyExtractor={(item) => item.keyword + item.detected_at}
        renderItem={({ item }) => (
          <TrendItem
            trend={item}
            onPress={() => handleTrendPress(item)}
            trendTimeQuery={timeQuery}
            onTagPress={toggleTag}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        style={styles.list}
        contentContainerStyle={[styles.listContent, trends.length === 0 && styles.emptyListContent]}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[6],
  },
  emptyListContent: {
    flex: 1,
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[5],
    backgroundColor: colors.backgroundSecondary,
  },
  errorText: {
    textAlign: 'center',
    fontSize: typography.size.lg,
    color: colors.error,
    marginVertical: spacing[4],
  },
  header: {
    marginTop: spacing[4],
    marginBottom: spacing[4],
  },
  titleContainer: {
    marginBottom: spacing[4],
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.text,
    marginBottom: spacing[3],
  },
  timeWindowContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing[2],
    gap: spacing[2],
  },
  timeWindowButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
    backgroundColor: colors.backgroundTertiary,
  },
  timeWindowButtonSelected: {
    backgroundColor: colors.primary,
  },
  timeWindowText: {
    fontSize: typography.size.sm,
    color: colors.textSecondary,
  },
  timeWindowTextSelected: {
    color: colors.white,
    fontWeight: typography.weight.medium,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  emptyText: {
    fontSize: typography.size.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginVertical: spacing[4],
  },
  tryAgainButton: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    ...shadows.sm,
  },
  tryAgainText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.white,
  },
});
