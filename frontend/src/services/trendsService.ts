import AsyncStorage from '@react-native-async-storage/async-storage';
import { format, formatDistanceToNow, parseISO } from 'date-fns';

import {
  TrendTimeQuery,
  TrendsResponse,
  TrendHistoryResponse,
  Topic,
  TopicsResponse,
  TopicDetailResponse,
  TagsResponse,
} from '@/types/trend';

// Query keys for React Query
export const queryKeys = {
  trends: 'trends',
  trendHistory: (keyword: string) => ['trendHistory', keyword],
  tags: 'tags',
  topics: 'topics',
  topicDetail: (id: string) => ['topic', id],
  popularTopics: 'popularTopics',
  relatedTopics: (id: string) => ['relatedTopics', id],
  trendsByTopic: (id: string) => ['trendsByTopic', id],
};

const API_BASE_URL = 'https://i-love.terrorism.lol/api';

// Auth utils
const getAuthHeaders = async (): Promise<Record<string, string>> => {
  try {
    // Try to get token directly from storage first for efficiency
    const token = await AsyncStorage.getItem('@auth_token');

    if (token) {
      return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
    }

    // Fallback to getting from user object
    const userJson = await AsyncStorage.getItem('@user');
    if (userJson) {
      const user = JSON.parse(userJson);
      if (user.accessToken) {
        return {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        };
      }
    }

    // No auth token available
    return { 'Content-Type': 'application/json' };
  } catch (error) {
    console.error('Error getting auth headers:', error);
    return { 'Content-Type': 'application/json' };
  }
};

// Utility function for authenticated fetch requests
const apiFetch = async (url: string, options: RequestInit = {}) => {
  const headers = await getAuthHeaders();

  // Create a new headers object with proper typing
  const fetchOptions: RequestInit = {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  };

  const response = await fetch(url, fetchOptions);

  // Handle 401 Unauthorized - Could mean token expired
  if (response.status === 401) {
    console.log('Received 401 unauthorized, token may be invalid');

    // Check if we need to refresh the token or redirect to login
    const refreshResult = await refreshToken();

    if (refreshResult) {
      // Try the request again with the new token
      const newHeaders = await getAuthHeaders();
      const retryOptions: RequestInit = {
        ...options,
        headers: {
          ...newHeaders,
          ...(options.headers || {}),
        },
      };

      const retryResponse = await fetch(url, retryOptions);

      if (!retryResponse.ok) {
        try {
          const errorData = await retryResponse.json();
          throw new Error(errorData.error || 'Network response was not ok after token refresh');
        } catch {
          throw new Error(`API error after token refresh: ${retryResponse.status}`);
        }
      }

      return retryResponse;
    } else {
      // Couldn't refresh token, redirect to login
      throw new Error('Authentication required');
    }
  } else if (!response.ok) {
    try {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Network response was not ok');
    } catch {
      throw new Error(`API error: ${response.status}`);
    }
  }

  return response;
};

// A utility function for simple authenticated fetching
const fetchWithAuth = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const fetchOptions: RequestInit = {
    ...options,
    headers: await getAuthHeaders(),
  };

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    try {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Network response was not ok');
    } catch {
      throw new Error(`API error: ${response.status}`);
    }
  }

  return response;
};

// Helper to refresh the token
const refreshToken = async (): Promise<boolean> => {
  try {
    const userJson = await AsyncStorage.getItem('@user');
    if (!userJson) return false;

    const user = JSON.parse(userJson);
    if (!user.refreshToken) return false;

    // Call refresh endpoint
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.accessToken}`,
      },
      body: JSON.stringify({ refresh_token: user.refreshToken }),
    });

    if (!response.ok) return false;

    const data = await response.json();

    if (data.access_token) {
      // Update the stored token
      await AsyncStorage.setItem('@auth_token', data.access_token);

      // Update user object
      user.accessToken = data.access_token;
      if (data.refresh_token) {
        user.refreshToken = data.refresh_token;
      }

      await AsyncStorage.setItem('@user', JSON.stringify(user));
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error refreshing token:', error);
    return false;
  }
};

export const TrendsService = {
  async getTrends(
    query?: TrendTimeQuery,
    tags?: string[],
    filterMode: 'any' | 'all' = 'any'
  ): Promise<TrendsResponse> {
    try {
      const queryParams = new URLSearchParams();

      if (query?.window_hours) {
        queryParams.append('window', query.window_hours.toString());
      }

      // Handle tag filtering
      if (tags && tags.length > 0) {
        if (tags.length === 1) {
          // For backward compatibility, use the 'tag' parameter for single tag
          queryParams.append('tag', tags[0]);
        } else {
          // Use 'tags' parameter for multiple tags with comma separation
          queryParams.append('tags', tags.join(','));
          // Add filter mode parameter
          queryParams.append('filter_mode', filterMode);
        }
      }

      const url = `${API_BASE_URL}/trends${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

      const response = await apiFetch(url);
      return response.json();
    } catch (error) {
      console.error('Error fetching trends:', error);
      throw error;
    }
  },

  async getTrendHistory(
    keyword: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<TrendHistoryResponse> {
    try {
      const queryParams = new URLSearchParams();

      if (startTime) {
        queryParams.append('start', startTime.toISOString());
      }

      if (endTime) {
        queryParams.append('end', endTime.toISOString());
      }

      const url = `${API_BASE_URL}/trends/${encodeURIComponent(keyword)}/history${
        queryParams.toString() ? `?${queryParams.toString()}` : ''
      }`;

      const response = await fetchWithAuth(url);

      return response.json();
    } catch (error) {
      console.error('Error fetching trend history:', error);
      throw error;
    }
  },

  formatCount(count?: number): string {
    if (count === undefined || count === null) {
      return '0';
    }
    if (count >= 1_000_000) {
      return `${(count / 1_000_000).toFixed(1)}M`;
    }
    if (count >= 1_000) {
      return `${(count / 1_000).toFixed(1)}K`;
    }
    return count.toString();
  },

  formatTimestamp(timestamp: string): string {
    try {
      const date = parseISO(timestamp);

      // Format relative time (e.g. "5 minutes ago")
      return formatDistanceToNow(date, { addSuffix: true });
    } catch (error) {
      console.error('Error formatting timestamp:', error);
      return 'Unknown time';
    }
  },

  formatDateTime(timestamp: string): string {
    try {
      const date = parseISO(timestamp);
      return format(date, 'MMM d, yyyy HH:mm');
    } catch (error) {
      console.error('Error formatting date time:', error);
      return 'Unknown date';
    }
  },

  getTimeWindowOptions(): { label: string; hours: number }[] {
    return [
      { label: 'Last Hour', hours: 1 },
      { label: '3 Hours', hours: 3 },
      { label: '6 Hours', hours: 6 },
      { label: '12 Hours', hours: 12 },
      { label: '24 Hours', hours: 24 },
    ];
  },

  // Topic Management Methods
  async getFollowedTopics(): Promise<string[]> {
    try {
      const user = await AsyncStorage.getItem('@user');
      if (!user) return [];

      const userData = JSON.parse(user);
      return userData.followedTopics || [];
    } catch (error) {
      console.error('Error getting followed topics:', error);
      return [];
    }
  },

  async saveFollowedTopics(topics: string[]): Promise<void> {
    try {
      await apiFetch(`${API_BASE_URL}/topics/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ topics }),
      });

      // Update local storage
      const user = await AsyncStorage.getItem('@user');
      if (user) {
        const userData = JSON.parse(user);
        userData.followedTopics = topics;
        await AsyncStorage.setItem('@user', JSON.stringify(userData));
      }
    } catch (error) {
      console.error('Error saving followed topics:', error);
      throw error;
    }
  },

  // New enhanced topic methods
  async getTopics(
    page: number = 1,
    pageSize: number = 20,
    query?: string
  ): Promise<TopicsResponse> {
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      });

      if (query) {
        queryParams.append('q', query);
      }

      const url = `${API_BASE_URL}/topics${
        queryParams.toString() ? `?${queryParams.toString()}` : ''
      }`;

      const response = await fetchWithAuth(url);

      return response.json();
    } catch (error) {
      console.error('Error fetching topics:', error);
      throw error;
    }
  },

  async getTopicDetail(topicId: string): Promise<TopicDetailResponse> {
    try {
      const url = `${API_BASE_URL}/topics/${encodeURIComponent(topicId)}`;
      const response = await fetchWithAuth(url);

      return response.json();
    } catch (error) {
      console.error('Error fetching topic details:', error);
      throw error;
    }
  },

  async getPopularTopics(limit: number = 10): Promise<Topic[]> {
    try {
      const url = `${API_BASE_URL}/topics/popular?limit=${limit}`;
      const response = await fetchWithAuth(url);

      return response.json().then((data) => data.topics);
    } catch (error) {
      console.error('Error fetching popular topics:', error);
      throw error;
    }
  },

  async followTopic(topicId: string): Promise<void> {
    try {
      await apiFetch(`${API_BASE_URL}/topics/${topicId}/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Update local storage
      const user = await AsyncStorage.getItem('@user');
      if (user) {
        const userData = JSON.parse(user);
        const topic = await this.getTopicDetail(topicId).then((data) => data.topic.name);
        if (!userData.followedTopics.includes(topic)) {
          userData.followedTopics.push(topic);
          await AsyncStorage.setItem('@user', JSON.stringify(userData));
        }
      }
    } catch (error) {
      console.error('Error following topic:', error);
      throw error;
    }
  },

  async unfollowTopic(topicId: string): Promise<void> {
    try {
      await apiFetch(`${API_BASE_URL}/topics/${topicId}/unfollow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Update local storage
      const user = await AsyncStorage.getItem('@user');
      if (user) {
        const userData = JSON.parse(user);
        const topic = await this.getTopicDetail(topicId).then((data) => data.topic.name);
        userData.followedTopics = userData.followedTopics.filter((t: string) => t !== topic);
        await AsyncStorage.setItem('@user', JSON.stringify(userData));
      }
    } catch (error) {
      console.error('Error unfollowing topic:', error);
      throw error;
    }
  },

  async getRelatedTopics(topicId: string): Promise<Topic[]> {
    try {
      const url = `${API_BASE_URL}/topics/${encodeURIComponent(topicId)}/related`;
      const response = await fetchWithAuth(url);

      return response.json().then((data) => data.topics);
    } catch (error) {
      console.error('Error fetching related topics:', error);
      throw error;
    }
  },

  async getTrendsByTopic(topicId: string, limit: number = 10): Promise<TrendsResponse> {
    try {
      const url = `${API_BASE_URL}/topics/${encodeURIComponent(topicId)}/trends?limit=${limit}`;
      const response = await fetchWithAuth(url);

      return response.json();
    } catch (error) {
      console.error('Error fetching trends by topic:', error);
      throw error;
    }
  },

  async searchTopics(query: string, limit: number = 20): Promise<Topic[]> {
    try {
      const url = `${API_BASE_URL}/topics/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const response = await fetchWithAuth(url);

      return response.json().then((data) => data.topics);
    } catch (error) {
      console.error('Error searching topics:', error);
      throw error;
    }
  },

  // Tag-related methods
  async getTags(windowDays: number = 7): Promise<TagsResponse> {
    try {
      const url = `${API_BASE_URL}/tags?window=${windowDays}`;
      const response = await fetchWithAuth(url);

      return response.json();
    } catch (error) {
      console.error('Error fetching tags:', error);
      throw error;
    }
  },

  async getPreferredTags(): Promise<string[]> {
    try {
      const user = await AsyncStorage.getItem('@user');
      if (!user) return [];

      const userData = JSON.parse(user);
      return userData.preferredTags || [];
    } catch (error) {
      console.error('Error getting preferred tags:', error);
      return [];
    }
  },

  async savePreferredTags(tags: string[]): Promise<void> {
    try {
      await apiFetch(`${API_BASE_URL}/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preferred_tags: tags }),
      });

      // Update local storage
      const user = await AsyncStorage.getItem('@user');
      if (user) {
        const userData = JSON.parse(user);
        userData.preferredTags = tags;
        await AsyncStorage.setItem('@user', JSON.stringify(userData));
      }
    } catch (error) {
      console.error('Error saving preferred tags:', error);
      throw error;
    }
  },
};
