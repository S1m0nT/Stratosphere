import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Animated,
  Pressable,
} from 'react-native';
import { X, Search, Filter, Check, AlertCircle } from 'react-native-feather';

import { useColors } from '@/hooks/useColors';
import { TrendsService, queryKeys } from '@/services/trendsService';
import { colors } from '@/theme/colors';
import { typography, spacing, borderRadius } from '@/theme/designSystem';

interface TagFilterProps {
  onSelectTag: (tag: string | null) => void;
  selectedTag: string | null;
  onSelectTags?: (tags: string[]) => void;
  selectedTags?: string[];
  filterMode?: 'any' | 'all';
  onChangeFilterMode?: (mode: 'any' | 'all') => void;
  multiSelect?: boolean;
}

export const TagFilter: React.FC<TagFilterProps> = ({
  onSelectTag,
  selectedTag,
  onSelectTags,
  selectedTags = [],
  filterMode = 'any',
  onChangeFilterMode,
  multiSelect = false,
}) => {
  const colors = useColors();
  const [searchText, setSearchText] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const animatedHeight = new Animated.Value(1);

  // Fetch all available tags with React Query
  const {
    data: tagsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: [queryKeys.tags],
    queryFn: () => TrendsService.getTags(),
    staleTime: 1000 * 60 * 15, // 15 minutes
  });

  const handleTagPress = (tag: string) => {
    if (multiSelect && onSelectTags) {
      // Handle multiple tag selection
      if (selectedTags.includes(tag)) {
        // Remove the tag if already selected
        onSelectTags(selectedTags.filter((t) => t !== tag));
      } else {
        // Add the tag to the selection
        onSelectTags([...selectedTags, tag]);
      }
    } else {
      // Single tag selection
      if (selectedTag === tag) {
        onSelectTag(null);
      } else {
        onSelectTag(tag);
      }
    }
  };

  const clearAllTags = () => {
    if (multiSelect && onSelectTags) {
      onSelectTags([]);
    } else {
      onSelectTag(null);
    }
  };

  const toggleExpanded = () => {
    const toValue = isExpanded ? 0 : 1;
    Animated.timing(animatedHeight, {
      toValue,
      duration: 300,
      useNativeDriver: false,
    }).start();
    setIsExpanded(!isExpanded);
  };

  // Filter tags based on search input
  const allTags = tagsData?.tags || [];
  const availableTags = allTags
    .map((t) => t.tag)
    .filter((tag) => tag.toLowerCase().includes(searchText.toLowerCase()));

  // Empty state handling
  if (allTags.length === 0 && !isLoading && !error) {
    return null;
  }

  const hasActiveFilters = selectedTag || (selectedTags && selectedTags.length > 0);

  return (
    <View style={styles.container}>
      {/* Header with toggle and title */}
      <Pressable
        onPress={toggleExpanded}
        style={[
          styles.header,
          { borderBottomColor: isExpanded ? colors.borderLight : 'transparent' },
        ]}
      >
        <View style={styles.headerTitleContainer}>
          <Filter width={18} height={18} color={colors.primary} />
          <Text style={styles.headerTitle}>Filter by Categories</Text>
        </View>

        {hasActiveFilters && (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{multiSelect ? selectedTags.length : '1'}</Text>
          </View>
        )}
      </Pressable>

      <Animated.View
        style={[
          styles.contentContainer,
          {
            maxHeight: animatedHeight.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1000],
            }),
            opacity: animatedHeight,
          },
        ]}
      >
        {/* Search input */}
        <View style={styles.searchContainer}>
          <Search width={16} height={16} color={colors.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search tags..."
            value={searchText}
            onChangeText={setSearchText}
            placeholderTextColor={colors.textTertiary}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')} style={styles.clearSearchButton}>
              <X width={14} height={14} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter mode selector - only show in multi-select mode */}
        {multiSelect && onChangeFilterMode && (
          <View style={styles.filterModeContainer}>
            <Text style={styles.filterModeLabel}>Filter mode:</Text>

            <View style={styles.filterModeToggle}>
              <Pressable
                style={[
                  styles.filterModeOption,
                  filterMode === 'any' && styles.filterModeOptionSelected,
                ]}
                onPress={() => onChangeFilterMode('any')}
              >
                <Text
                  style={[
                    styles.filterModeText,
                    filterMode === 'any' && styles.filterModeTextSelected,
                  ]}
                >
                  Any tag
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.filterModeOption,
                  filterMode === 'all' && styles.filterModeOptionSelected,
                ]}
                onPress={() => onChangeFilterMode('all')}
              >
                <Text
                  style={[
                    styles.filterModeText,
                    filterMode === 'all' && styles.filterModeTextSelected,
                  ]}
                >
                  All tags
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Loading state */}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.loadingText}>Loading categories...</Text>
          </View>
        )}

        {/* Error state */}
        {error && (
          <View style={styles.errorContainer}>
            <AlertCircle width={20} height={20} color={colors.error} />
            <Text style={styles.errorText}>Failed to load categories</Text>
            <TouchableOpacity style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tags display */}
        {!isLoading && !error && availableTags.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.scrollView}
            contentContainerStyle={styles.scrollViewContent}
          >
            {availableTags.map((tag) => {
              const isSelected = multiSelect ? selectedTags.includes(tag) : selectedTag === tag;
              return (
                <TouchableOpacity
                  key={tag}
                  style={[styles.tagContainer, isSelected && styles.tagContainerSelected]}
                  onPress={() => handleTagPress(tag)}
                  activeOpacity={0.7}
                >
                  {isSelected && (
                    <Check width={12} height={12} color={colors.white} style={styles.tagIcon} />
                  )}
                  <Text style={[styles.tagText, isSelected && styles.tagTextSelected]}>{tag}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Empty search results */}
        {!isLoading && !error && searchText.length > 0 && availableTags.length === 0 && (
          <View style={styles.emptyResultContainer}>
            <Text style={styles.emptyResultText}>No tags found matching "{searchText}"</Text>
          </View>
        )}

        {/* Active filters and clear button */}
        {hasActiveFilters && (
          <View style={styles.activeFiltersContainer}>
            <View style={styles.activeFiltersInfo}>
              <Text style={styles.activeFiltersText}>
                {multiSelect
                  ? `${selectedTags.length} ${selectedTags.length === 1 ? 'tag' : 'tags'} selected`
                  : '1 tag selected'}
                {multiSelect && selectedTags.length > 1 && ` (${filterMode} mode)`}
              </Text>
            </View>
            <TouchableOpacity style={styles.clearButton} onPress={clearAllTags} activeOpacity={0.7}>
              <X width={12} height={12} color={colors.white} style={styles.clearButtonIcon} />
              <Text style={styles.clearButtonText}>Clear all</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    marginBottom: spacing[5],
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[4],
    borderBottomWidth: 1,
    // borderBottomColor is now applied dynamically in the component
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    color: colors.text,
    marginLeft: spacing[2],
  },
  headerBadge: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1] / 2,
    minWidth: 24,
    alignItems: 'center',
  },
  headerBadgeText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
    color: colors.white,
  },
  contentContainer: {
    overflow: 'hidden',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: borderRadius.md,
    marginHorizontal: spacing[4],
    marginTop: spacing[3],
    paddingHorizontal: spacing[3],
    height: 40,
  },
  searchIcon: {
    marginRight: spacing[2],
  },
  searchInput: {
    flex: 1,
    fontSize: typography.size.sm,
    color: colors.text,
    padding: 0,
    height: '100%',
  },
  clearSearchButton: {
    padding: spacing[1],
  },
  filterModeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing[4],
    marginTop: spacing[3],
  },
  filterModeLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.textSecondary,
  },
  filterModeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: borderRadius.full,
    padding: spacing[1],
  },
  filterModeOption: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
  },
  filterModeOptionSelected: {
    backgroundColor: colors.primary,
  },
  filterModeText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    color: colors.textSecondary,
  },
  filterModeTextSelected: {
    color: colors.white,
    fontWeight: typography.weight.bold,
  },
  scrollView: {
    marginVertical: spacing[3],
  },
  scrollViewContent: {
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  tagContainer: {
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginRight: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagContainerSelected: {
    backgroundColor: colors.primary,
  },
  tagIcon: {
    marginRight: spacing[1],
  },
  tagText: {
    fontSize: typography.size.sm,
    color: colors.secondary,
    fontWeight: typography.weight.medium,
  },
  tagTextSelected: {
    color: colors.white,
    fontWeight: typography.weight.bold,
  },
  loadingContainer: {
    flexDirection: 'row',
    padding: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  loadingText: {
    fontSize: typography.size.sm,
    color: colors.textSecondary,
    marginLeft: spacing[2],
  },
  errorContainer: {
    padding: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  errorText: {
    fontSize: typography.size.sm,
    color: colors.error,
    marginVertical: spacing[2],
  },
  retryButton: {
    backgroundColor: colors.backgroundSecondary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.md,
    marginTop: spacing[2],
  },
  retryButtonText: {
    fontSize: typography.size.sm,
    color: colors.primary,
    fontWeight: typography.weight.medium,
  },
  emptyResultContainer: {
    padding: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60,
  },
  emptyResultText: {
    fontSize: typography.size.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  activeFiltersContainer: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    marginTop: spacing[1],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeFiltersInfo: {
    flex: 1,
  },
  activeFiltersText: {
    fontSize: typography.size.sm,
    color: colors.primary,
    fontWeight: typography.weight.medium,
  },
  clearButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    flexDirection: 'row',
    alignItems: 'center',
  },
  clearButtonIcon: {
    marginRight: spacing[1],
  },
  clearButtonText: {
    fontSize: typography.size.xs,
    color: colors.white,
    fontWeight: typography.weight.bold,
  },
});
