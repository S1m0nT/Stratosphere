export interface TrendTimeQuery {
  window_hours?: number;
}

export interface Trend {
  keyword: string;
  post_count: number;
  detected_at: string;
  summary?: string;
  tags?: string[];
}

export interface TrendsResponse {
  trends: Trend[];
  timestamp: string;
}

export interface TrendHistoryPoint {
  keyword: string;
  post_count: number;
  post_ids: string[];
  summary: string;
  detected_at: string;
  tags: string[];
}

export interface TrendHistoryResponse {
  keyword: string;
  history: TrendHistoryPoint[];
}

export interface Topic {
  id: string;
  name: string;
  description?: string;
  trend_count: number;
  follower_count: number;
  image_url?: string;
  related_topics?: string[];
  created_at: number;
  updated_at: number;
}

export interface TopicsResponse {
  topics: Topic[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TopicDetailResponse {
  topic: Topic;
  trends: Trend[];
}

export interface Tag {
  tag: string;
  count: number;
}

export interface TagsResponse {
  tags: Tag[];
}
