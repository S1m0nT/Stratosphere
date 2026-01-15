import { router } from 'expo-router';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
  RefreshControl,
  ScrollView,
  Image,
} from 'react-native';
import { X, Search, Save, Plus, Check, Tag } from 'react-native-feather';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TagFilter } from '@/components/TagFilter';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { TrendsService } from '@/services/trendsService';
import { colors } from '@/theme/colors';
import { typography, spacing, borderRadius, shadows } from '@/theme/designSystem';
import type { Trend, Topic } from '@/types/trend';

export default function TopicsScreen() {
  const colors = useColors();
  const { user, updateFollowedTopics } = useAuth();
  const [topics, setTopics] = useState<string[]>(user?.followedTopics || []);
  const [newTopic, setNewTopic] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [suggestedTopics, setSuggestedTopics] = useState<string[]>([]);
  const [trendingTopics, setTrendingTopics] = useState<Trend[]>([]);
  const [popularTopics, setPopularTopics] = useState<Topic[]>([]);
  const [topicSearchResults, setTopicSearchResults] = useState<Topic[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<'any' | 'all'>('any');

  // Fetch trending topics to show as suggestions
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Use either multi-select or single-select filtering based on which is active
      const { trends } =
        selectedTags.length > 0
          ? await TrendsService.getTrends({ window_hours: 24 }, selectedTags, filterMode)
          : await TrendsService.getTrends(
              { window_hours: 24 },
              selectedTag ? [selectedTag] : undefined
            );

      setTrendingTopics(trends);

      // Fetch popular topics
      const popularTopics = await TrendsService.getPopularTopics(10);
      setPopularTopics(popularTopics);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedTag, selectedTags, filterMode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchData();
  }, [fetchData]);

  // Filter suggestions based on input
  useEffect(() => {
    if (newTopic.trim()) {
      setIsSearching(true);

      // Extract keywords from trending topics
      const trendKeywords = trendingTopics.map((trend) => trend.keyword);

      // Filter keywords that match the input and aren't already in topics list
      const filtered = trendKeywords.filter(
        (keyword) =>
          keyword.toLowerCase().includes(newTopic.toLowerCase()) && !topics.includes(keyword)
      );

      setSuggestedTopics(filtered.slice(0, 5)); // Limit to 5 suggestions

      // Search for topics in the backend
      const searchTopics = async () => {
        try {
          const results = await TrendsService.searchTopics(newTopic.trim());
          setTopicSearchResults(results);
        } catch (error) {
          console.error('Error searching topics:', error);
        }
      };

      // Debounce search
      const timeoutId = setTimeout(() => {
        searchTopics();
      }, 300);

      return () => clearTimeout(timeoutId);
    } else {
      setIsSearching(false);
      setSuggestedTopics([]);
      setTopicSearchResults([]);
    }
  }, [newTopic, trendingTopics, topics]);

  const handleAddTopic = () => {
    if (!newTopic.trim()) return;

    // Don't add duplicates
    if (topics.includes(newTopic.trim())) {
      Alert.alert('Topic already added');
      return;
    }

    setTopics([...topics, newTopic.trim()]);
    setNewTopic('');
  };

  const handleRemoveTopic = (topic: string) => {
    setTopics(topics.filter((t) => t !== topic));
  };

  const handleAddSuggestion = (topic: string) => {
    if (!topics.includes(topic)) {
      setTopics([...topics, topic]);
    }
    setNewTopic('');
    setSuggestedTopics([]);
    setTopicSearchResults([]);
  };

  const handleSaveTopics = async () => {
    setIsSaving(true);
    try {
      await updateFollowedTopics(topics);
      Alert.alert('Success', 'Your topics have been updated.');
    } catch {
      Alert.alert('Error', 'Failed to update topics.');
    } finally {
      setIsSaving(false);
    }
  };

  const navigateToTopicDetail = (topicId: string) => {
    router.push(`/topic/${topicId}`);
  };

  const renderTopicItem = ({ item }: { item: string }) => (
    <View style={styles.topicItem}>
      <Text style={styles.topicText}>{item}</Text>
      <Pressable
        onPress={() => handleRemoveTopic(item)}
        style={({ pressed }) => [styles.removeButton, { opacity: pressed ? 0.7 : 1 }]}
      >
        <X width={18} height={18} color={colors.error} />
      </Pressable>
    </View>
  );

  const renderTrendingItem = ({ item }: { item: Trend }) => {
    const isFollowed = topics.includes(item.keyword);

    return (
      <Pressable
        style={[styles.trendingItem, isFollowed && styles.trendingItemFollowed]}
        onPress={() => router.push(`/trend/${encodeURIComponent(item.keyword)}`)}
      >
        <View style={styles.trendingContent}>
          <Text style={styles.trendingName}>{item.keyword}</Text>
          <Text style={styles.trendingCount}>
            {TrendsService.formatCount(item.post_count)} posts
          </Text>
        </View>

        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            if (isFollowed) {
              handleRemoveTopic(item.keyword);
            } else {
              handleAddSuggestion(item.keyword);
            }
          }}
          style={({ pressed }) => [
            styles.trendFollowButton,
            isFollowed && styles.trendFollowButtonActive,
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          {isFollowed ? (
            <Check width={18} height={18} color={colors.white} />
          ) : (
            <Plus width={18} height={18} color={colors.primary} />
          )}
          <Text
            style={[styles.trendFollowButtonText, isFollowed && styles.trendFollowButtonTextActive]}
          >
            {isFollowed ? 'Following' : 'Follow'}
          </Text>
        </Pressable>
      </Pressable>
    );
  };

  const renderPopularTopicItem = ({ item }: { item: Topic }) => {
    const isFollowed = topics.includes(item.name);

    return (
      <Pressable style={styles.popularTopicItem} onPress={() => navigateToTopicDetail(item.id)}>
        <View style={styles.popularTopicImageContainer}>
          {item.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.popularTopicImage} />
          ) : (
            <View style={styles.popularTopicImagePlaceholder}>
              <Tag width={24} height={24} color={colors.textSecondary} />
            </View>
          )}
        </View>

        <View style={styles.popularTopicContent}>
          <Text style={styles.popularTopicName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.popularTopicStats}>
            {TrendsService.formatCount(item.follower_count)} followers
          </Text>
        </View>

        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            if (isFollowed) {
              handleRemoveTopic(item.name);
            } else {
              handleAddSuggestion(item.name);
            }
          }}
          style={({ pressed }) => [
            styles.popularFollowButton,
            isFollowed && styles.popularFollowButtonActive,
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          {isFollowed ? (
            <Check width={18} height={18} color={colors.white} />
          ) : (
            <Plus width={18} height={18} color={colors.primary} />
          )}
        </Pressable>
      </Pressable>
    );
  };

  const renderSearchResultItem = ({ item }: { item: Topic }) => {
    const isFollowed = topics.includes(item.name);

    return (
      <Pressable
        style={({ pressed }) => [
          styles.searchResultItem,
          { backgroundColor: pressed ? colors.backgroundTertiary : colors.white },
        ]}
        onPress={() => navigateToTopicDetail(item.id)}
      >
        <View style={styles.searchResultContent}>
          <Text style={styles.searchResultName}>{item.name}</Text>
          {item.description && (
            <Text style={styles.searchResultDescription} numberOfLines={1}>
              {item.description}
            </Text>
          )}
          <Text style={styles.searchResultStats}>
            {TrendsService.formatCount(item.follower_count)} followers
          </Text>
        </View>

        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            if (isFollowed) {
              handleRemoveTopic(item.name);
            } else {
              handleAddSuggestion(item.name);
            }
          }}
          style={({ pressed }) => [
            styles.searchResultFollowButton,
            isFollowed && styles.searchResultFollowButtonActive,
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text
            style={[
              styles.searchResultFollowButtonText,
              isFollowed && styles.searchResultFollowButtonTextActive,
            ]}
          >
            {isFollowed ? 'Following' : 'Follow'}
          </Text>
        </Pressable>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
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
          <View style={styles.header}>
            <Text style={styles.title}>Topics You Follow</Text>
            <Text style={styles.subtitle}>
              Follow topics to personalize your trend recommendations
            </Text>
          </View>

          {/* Tag Filter Component */}
          <TagFilter
            onSelectTag={(tag) => {
              // Single-tag mode
              setSelectedTag(tag);
              setSelectedTags([]); // Clear multi-select when using single-select
              // Clear search when changing filters
              setNewTopic('');
              setIsSearching(false);
            }}
            selectedTag={selectedTag}
            // Multi-tag mode
            multiSelect={true}
            onSelectTags={(tags) => {
              setSelectedTags(tags);
              setSelectedTag(null); // Clear single tag when using multi-select
              // Clear search when changing filters
              setNewTopic('');
              setIsSearching(false);
            }}
            selectedTags={selectedTags}
            filterMode={filterMode}
            onChangeFilterMode={setFilterMode}
          />

          <View style={styles.searchSection}>
            <View style={styles.inputContainer}>
              <Search
                width={20}
                height={20}
                color={colors.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={newTopic}
                onChangeText={setNewTopic}
                placeholder="Search for topics..."
                placeholderTextColor={colors.textMuted}
                returnKeyType="search"
                onSubmitEditing={handleAddTopic}
              />
              {newTopic.length > 0 && (
                <Pressable onPress={() => setNewTopic('')} style={styles.clearButton}>
                  <X width={20} height={20} color={colors.textMuted} />
                </Pressable>
              )}
            </View>

            {isSearching && (
              <View style={styles.searchResultsContainer}>
                {/* Topic search results */}
                {topicSearchResults.length > 0 ? (
                  <>
                    <Text style={styles.searchResultsTitle}>Topics</Text>
                    <FlatList
                      data={topicSearchResults}
                      renderItem={renderSearchResultItem}
                      keyExtractor={(item) => item.id}
                      scrollEnabled={false}
                      style={styles.searchResultsList}
                    />
                  </>
                ) : suggestedTopics.length > 0 ? (
                  // Show trend keyword suggestions if no topic results
                  <>
                    <Text style={styles.searchResultsTitle}>Trending Keywords</Text>
                    {suggestedTopics.map((topic) => (
                      <Pressable
                        key={topic}
                        style={({ pressed }) => [
                          styles.suggestionItem,
                          { backgroundColor: pressed ? colors.backgroundTertiary : colors.white },
                        ]}
                        onPress={() => handleAddSuggestion(topic)}
                      >
                        <Text style={styles.suggestionText}>{topic}</Text>
                        <Plus width={18} height={18} color={colors.primary} />
                      </Pressable>
                    ))}
                  </>
                ) : (
                  <View style={styles.noResultsContainer}>
                    <Text style={styles.noResultsText}>No topics found</Text>
                    <Pressable style={styles.createTopicButton} onPress={handleAddTopic}>
                      <Text style={styles.createTopicText}>
                        Create new topic "{newTopic.trim()}"
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Following list */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Topics</Text>

            {topics.length > 0 ? (
              <FlatList
                data={topics}
                renderItem={renderTopicItem}
                keyExtractor={(item) => item}
                scrollEnabled={false}
                contentContainerStyle={styles.topicsList}
              />
            ) : (
              <View style={styles.emptyContainer}>
                <Tag width={40} height={40} color={colors.textMuted} />
                <Text style={styles.emptyText}>You're not following any topics yet</Text>
              </View>
            )}
          </View>

          {/* Popular Topics Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Popular Topics</Text>

            {isLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
            ) : (
              <FlatList
                data={popularTopics}
                renderItem={renderPopularTopicItem}
                keyExtractor={(item) => item.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              />
            )}
          </View>

          {/* Trending Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Trending Now</Text>

            {isLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
            ) : (
              <FlatList
                data={trendingTopics.slice(0, 8)}
                renderItem={renderTrendingItem}
                keyExtractor={(item) => item.keyword}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              />
            )}
          </View>

          {/* Save Button */}
          {topics.length > 0 && (
            <View style={styles.buttonContainer}>
              <Pressable
                style={({ pressed }) => [
                  styles.saveButton,
                  { opacity: pressed ? 0.9 : isSaving ? 0.7 : 1 },
                ]}
                onPress={handleSaveTopics}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <>
                    <Save
                      width={20}
                      height={20}
                      color={colors.white}
                      style={styles.saveButtonIcon}
                    />
                    <Text style={styles.saveButtonText}>Save Topics</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    padding: spacing[4],
    paddingBottom: spacing[8],
  },
  header: {
    marginBottom: spacing[4],
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.text,
    marginBottom: spacing[2],
  },
  subtitle: {
    fontSize: typography.size.md,
    color: colors.textSecondary,
  },
  searchSection: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    marginBottom: spacing[4],
    ...shadows.sm,
    overflow: 'hidden',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  inputIcon: {
    marginRight: spacing[3],
  },
  input: {
    flex: 1,
    height: 40,
    fontSize: typography.size.md,
    color: colors.text,
  },
  clearButton: {
    padding: spacing[2],
  },
  searchResultsContainer: {
    padding: spacing[3],
  },
  searchResultsList: {
    maxHeight: 300,
  },
  searchResultsTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.text,
    marginBottom: spacing[3],
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  searchResultContent: {
    flex: 1,
    marginRight: spacing[3],
  },
  searchResultName: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.text,
    marginBottom: spacing[1],
  },
  searchResultDescription: {
    fontSize: typography.size.sm,
    color: colors.textSecondary,
    marginBottom: spacing[1],
  },
  searchResultStats: {
    fontSize: typography.size.xs,
    color: colors.textMuted,
  },
  searchResultFollowButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  searchResultFollowButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  searchResultFollowButtonText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.primary,
  },
  searchResultFollowButtonTextActive: {
    color: colors.white,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  suggestionText: {
    fontSize: typography.size.md,
    color: colors.text,
  },
  noResultsContainer: {
    padding: spacing[4],
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: typography.size.md,
    color: colors.textMuted,
    marginBottom: spacing[3],
  },
  createTopicButton: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryLight,
  },
  createTopicText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.primary,
  },
  section: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing[4],
    marginBottom: spacing[4],
    ...shadows.sm,
  },
  sectionTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    color: colors.text,
    marginBottom: spacing[3],
  },
  topicsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  topicItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.full,
  },
  topicText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.text,
    marginRight: spacing[2],
  },
  removeButton: {
    padding: spacing[1],
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[6],
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.md,
  },
  emptyText: {
    marginTop: spacing[3],
    fontSize: typography.size.md,
    color: colors.textMuted,
    textAlign: 'center',
  },
  horizontalList: {
    paddingVertical: spacing[2],
    gap: spacing[3],
  },
  popularTopicItem: {
    width: 160,
    borderRadius: borderRadius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
  },
  popularTopicImageContainer: {
    height: 80,
    width: '100%',
  },
  popularTopicImage: {
    width: '100%',
    height: '100%',
  },
  popularTopicImagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundTertiary,
  },
  popularTopicContent: {
    padding: spacing[3],
  },
  popularTopicName: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.text,
    marginBottom: spacing[1],
  },
  popularTopicStats: {
    fontSize: typography.size.xs,
    color: colors.textSecondary,
  },
  popularFollowButton: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  popularFollowButtonActive: {
    backgroundColor: colors.primary,
  },
  trendingItem: {
    width: 200,
    padding: spacing[3],
    borderRadius: borderRadius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  trendingItemFollowed: {
    borderColor: colors.primary,
  },
  trendingContent: {
    marginBottom: spacing[3],
  },
  trendingName: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.text,
    marginBottom: spacing[1],
  },
  trendingCount: {
    fontSize: typography.size.xs,
    color: colors.textSecondary,
  },
  trendFollowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primary,
    alignSelf: 'flex-start',
  },
  trendFollowButtonActive: {
    backgroundColor: colors.primary,
  },
  trendFollowButtonText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    color: colors.primary,
    marginLeft: spacing[1],
  },
  trendFollowButtonTextActive: {
    color: colors.white,
  },
  buttonContainer: {
    marginTop: spacing[2],
  },
  saveButton: {
    flexDirection: 'row',
    height: 50,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  saveButtonIcon: {
    marginRight: spacing[2],
  },
  saveButtonText: {
    color: colors.white,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  loader: {
    padding: spacing[4],
  },
});
