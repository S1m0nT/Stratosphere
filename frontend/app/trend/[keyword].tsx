import { format, subHours } from 'date-fns';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { CSSProperties, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { AlertCircle, ChevronLeft, Calendar, Plus } from 'react-native-feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

import { useColors } from '@/hooks/useColors';
import { TrendsService } from '@/services/trendsService';
import { colors } from '@/theme/colors';
import { typography, spacing, borderRadius, shadows } from '@/theme/designSystem';

// Types remain the same
interface Trend {
  keyword: string;
  post_count: number;
  post_ids: string[];
  summary: string;
  detected_at: string;
}

interface TimelineChartProps {
  data: Trend[];
  height?: number;
}

interface TimelineControlsProps {
  onRangeChange: (startDate: Date, endDate: Date) => void;
  isLoading?: boolean;
  selectedRange: number;
}

// TimelineChart Component
const TimelineChart: React.FC<TimelineChartProps> = ({ data, height = 200 }) => {
  const colors = useColors();
  const chartData = data.map((point) => ({
    timestamp: new Date(point.detected_at).getTime(),
    posts: point.post_count,
    formattedTime: format(new Date(point.detected_at), 'MMM d, HH:mm'),
  }));

  if (data.length === 0) {
    return (
      <View style={styles.emptyChartContainer}>
        <Text style={styles.emptyChartText}>No trend data available</Text>
      </View>
    );
  }

  // Define tooltip styles as CSSProperties
  const tooltipStyles = {
    contentStyle: {
      backgroundColor: colors.white,
      borderColor: colors.border,
      boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
      borderRadius: '8px',
      padding: '8px 12px',
    } as CSSProperties,
    labelStyle: {
      color: colors.text,
      fontWeight: 600,
      marginBottom: '4px',
    } as CSSProperties,
    itemStyle: {
      color: colors.primary,
    } as CSSProperties,
  };

  return (
    <View style={[styles.chartContainer, { height }]}>
      <LineChart
        data={chartData}
        width={Platform.OS === 'web' ? 600 : undefined}
        height={height - 32}
        margin={{ top: 10, right: 20, bottom: 20, left: 20 }}
      >
        <XAxis
          dataKey="timestamp"
          type="number"
          scale="time"
          domain={['auto', 'auto']}
          tickFormatter={(timestamp) => format(new Date(timestamp), 'HH:mm')}
          stroke={colors.textSecondary}
          tick={{ fill: colors.textSecondary, fontSize: 12 }}
        />
        <YAxis stroke={colors.textSecondary} tick={{ fill: colors.textSecondary, fontSize: 12 }} />
        <Tooltip
          labelFormatter={(value) => format(new Date(value), 'MMM d, HH:mm')}
          contentStyle={tooltipStyles.contentStyle}
          labelStyle={tooltipStyles.labelStyle}
          itemStyle={tooltipStyles.itemStyle}
        />
        <Line
          type="monotone"
          dataKey="posts"
          stroke={colors.primary}
          strokeWidth={2}
          dot={{ fill: colors.primary, r: 4 }}
          activeDot={{ r: 6, fill: colors.primary }}
        />
      </LineChart>
    </View>
  );
};

// TimelineControls Component
const TimelineControls: React.FC<TimelineControlsProps> = ({
  onRangeChange,
  isLoading,
  selectedRange,
}) => {
  const timeRanges = [
    { label: '3h', hours: 3 },
    { label: '6h', hours: 6 },
    { label: '12h', hours: 12 },
    { label: '24h', hours: 24 },
  ];

  const handleRangeSelect = useCallback(
    (hours: number) => {
      const endDate = new Date();
      const startDate = subHours(endDate, hours);
      onRangeChange(startDate, endDate);
    },
    [onRangeChange]
  );

  return (
    <View style={styles.timelineControls}>
      {timeRanges.map(({ label, hours }) => (
        <Pressable
          key={hours}
          onPress={() => handleRangeSelect(hours)}
          style={[
            styles.timeRangeButton,
            selectedRange === hours && styles.timeRangeButtonSelected,
            isLoading && styles.timeRangeButtonDisabled,
          ]}
          disabled={isLoading}
        >
          <Text
            style={[
              styles.timeRangeButtonText,
              selectedRange === hours && styles.timeRangeButtonTextSelected,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
};

// TrendDetailScreen Component
export default function TrendDetailScreen() {
  const colors = useColors();
  const { keyword } = useLocalSearchParams();
  const [trendHistory, setTrendHistory] = useState<Trend[]>([]);
  const [currentTrend, setCurrentTrend] = useState<Trend | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<number>(24);
  const { width } = useWindowDimensions();

  const fetchTrendHistory = useCallback(
    async (startDate: Date, endDate: Date) => {
      try {
        setError(null);
        setIsLoading(true);
        const response = await TrendsService.getTrendHistory(
          decodeURIComponent(keyword as string),
          startDate,
          endDate
        );
        // Process history data to match the expected Trend type
        const processedHistory = response.history.map((item) => ({
          keyword: response.keyword,
          post_count: item.post_count,
          post_ids: item.post_ids || [],
          summary: item.summary || '',
          detected_at: item.detected_at,
          tags: item.tags || [],
        }));
        setTrendHistory(processedHistory);
        if (processedHistory.length > 0) {
          setCurrentTrend(processedHistory[processedHistory.length - 1]);
        }
      } catch (err) {
        setError('Failed to load trend history');
        console.error('Error fetching trend history:', err);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [keyword]
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    const endDate = new Date();
    const startDate = subHours(endDate, selectedRange);
    fetchTrendHistory(startDate, endDate);
  }, [fetchTrendHistory, selectedRange]);

  const handleRangeChange = useCallback(
    (startDate: Date, endDate: Date) => {
      // Calculate hours difference to update selected range
      const hoursDiff = Math.round((endDate.getTime() - startDate.getTime()) / (60 * 60 * 1000));
      setSelectedRange(hoursDiff);
      setIsLoading(true);
      fetchTrendHistory(startDate, endDate);
    },
    [fetchTrendHistory]
  );

  useEffect(() => {
    const endDate = new Date();
    const startDate = subHours(endDate, 24);
    fetchTrendHistory(startDate, endDate);
  }, [fetchTrendHistory]);

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
        <Pressable onPress={handleRefresh} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerTitle: decodeURIComponent(keyword as string),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <ChevronLeft width={24} height={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollViewContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {currentTrend && (
          <View style={styles.currentTrendCard}>
            <View style={styles.keywordRow}>
              <Text style={styles.keyword}>{currentTrend.keyword}</Text>
              <TouchableOpacity
                style={styles.followButton}
                onPress={() => {
                  /* Add follow functionality here */
                }}
              >
                <Plus width={16} height={16} color={colors.primary} />
                <Text style={styles.followButtonText}>Follow</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.count}>
              {TrendsService.formatCount(currentTrend.post_count)}{' '}
              <Text style={styles.countLabel}>posts</Text>
            </Text>
            {currentTrend.summary && <Text style={styles.summary}>{currentTrend.summary}</Text>}
          </View>
        )}

        <View style={styles.timelineCard}>
          <View style={styles.timelineHeader}>
            <Text style={styles.timelineTitle}>Trend Timeline</Text>
            <Calendar width={20} height={20} color={colors.textSecondary} />
          </View>

          <TimelineControls
            onRangeChange={handleRangeChange}
            isLoading={isLoading}
            selectedRange={selectedRange}
          />

          <TimelineChart
            data={trendHistory}
            height={Platform.OS === 'web' ? 300 : Math.min(300, width * 0.6)}
          />
        </View>

        <View style={styles.historyCard}>
          <Text style={styles.historyTitle}>History</Text>
          {trendHistory.length > 0 ? (
            trendHistory.map((trend, index) => (
              <View key={`${trend.detected_at}-${index}`} style={styles.historyItem}>
                <View style={styles.historyItemHeader}>
                  <Text style={styles.historyItemTime}>
                    {format(new Date(trend.detected_at), 'MMM d, yyyy HH:mm')}
                  </Text>
                  <Text style={styles.historyItemCount}>
                    {trend.post_count.toLocaleString()} posts
                  </Text>
                </View>
                {trend.summary && <Text style={styles.historyItemSummary}>{trend.summary}</Text>}
              </View>
            ))
          ) : (
            <View style={styles.emptyHistoryContainer}>
              <Text style={styles.emptyHistoryText}>No history data available</Text>
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
  scrollViewContent: {
    padding: spacing[4],
    paddingBottom: spacing[8],
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
    backgroundColor: colors.backgroundSecondary,
    padding: spacing[4],
  },
  backButton: {
    marginLeft: spacing[2],
    padding: spacing[2],
    borderRadius: spacing[4],
  },
  currentTrendCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing[4],
    marginBottom: spacing[4],
    ...shadows.sm,
  },
  keywordRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  keyword: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.text,
  },
  count: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.medium,
    color: colors.text,
    marginBottom: spacing[3],
  },
  countLabel: {
    color: colors.textSecondary,
    fontWeight: typography.weight.regular,
  },
  summary: {
    fontSize: typography.size.md,
    lineHeight: typography.lineHeight.relaxed * typography.size.md,
    color: colors.textSecondary,
  },
  followButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  followButtonText: {
    color: colors.primary,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    marginLeft: spacing[1],
  },
  timelineCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing[4],
    marginBottom: spacing[4],
    ...shadows.sm,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[3],
  },
  timelineTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    color: colors.text,
  },
  timelineControls: {
    flexDirection: 'row',
    marginBottom: spacing[3],
    gap: spacing[2],
  },
  timeRangeButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colors.backgroundTertiary,
  },
  timeRangeButtonSelected: {
    backgroundColor: colors.primary,
  },
  timeRangeButtonDisabled: {
    opacity: 0.5,
  },
  timeRangeButtonText: {
    fontSize: typography.size.sm,
    color: colors.textSecondary,
    fontWeight: typography.weight.medium,
  },
  timeRangeButtonTextSelected: {
    color: colors.white,
  },
  chartContainer: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing[2],
    overflow: 'hidden',
  },
  emptyChartContainer: {
    height: 192,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.md,
  },
  emptyChartText: {
    color: colors.textSecondary,
    fontSize: typography.size.md,
  },
  historyCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing[4],
    ...shadows.sm,
  },
  historyTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    color: colors.text,
    marginBottom: spacing[3],
  },
  historyItem: {
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.md,
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  historyItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  historyItemTime: {
    color: colors.textSecondary,
    fontSize: typography.size.sm,
  },
  historyItemCount: {
    color: colors.primary,
    fontWeight: typography.weight.medium,
    fontSize: typography.size.sm,
  },
  historyItemSummary: {
    color: colors.text,
    fontSize: typography.size.md,
  },
  emptyHistoryContainer: {
    padding: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.md,
  },
  emptyHistoryText: {
    color: colors.textSecondary,
    fontSize: typography.size.md,
  },
  errorText: {
    color: colors.error,
    fontSize: typography.size.lg,
    textAlign: 'center',
    marginVertical: spacing[4],
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    ...shadows.sm,
  },
  retryButtonText: {
    color: colors.white,
    fontWeight: typography.weight.medium,
  },
});
