use async_trait::async_trait;
use chrono::DateTime;
use chrono::Duration;
use chrono::Utc;
use serde::Deserialize;
use serde::Serialize;
use tracing::error;
use tracing::info;

use super::ClickhouseClient;
use crate::domain::Trend;
use crate::domain::TrendRepository;
use crate::error::Error;
use crate::validation::sanitize_keyword;

#[derive(Debug, Serialize, Deserialize, clickhouse::Row)]
struct StoredTrend {
    keyword: String,
    post_count: u64,
    post_ids: Vec<String>,
    summary: String,
    detected_at: i32,
    tags: Vec<String>,
}

impl From<StoredTrend> for Trend {
    fn from(stored: StoredTrend) -> Self {
        Self {
            keyword: sanitize_keyword(&stored.keyword),
            post_count: stored.post_count as u32,
            post_ids: stored.post_ids,
            summary: stored.summary,
            detected_at: DateTime::from_timestamp(stored.detected_at as i64, 0).unwrap_or_else(Utc::now),
            tags: stored.tags,
        }
    }
}

#[async_trait]
impl TrendRepository for ClickhouseClient {
    async fn get_trend_history(
        &self,
        keyword: &str,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
    ) -> Result<Vec<Trend>, Error> {
        let query = r#"
            SELECT
                CAST(keyword, 'String') as keyword,
                CAST(post_count, 'UInt64') as post_count,
                CAST(post_ids, 'Array(String)') as post_ids,
                CAST(summary, 'String') as summary,
                CAST(detected_at, 'Int32') as detected_at,
                CAST(tags, 'Array(String)') as tags
            FROM trends
            WHERE LOWER(keyword) = LOWER(?)
                AND detected_at >= toUnixTimestamp(?)
                AND detected_at <= toUnixTimestamp(?)
            ORDER BY detected_at ASC
            SETTINGS max_threads = 2
        "#;

        info!("Fetching trend history for '{}' from {} to {}", keyword, start_time, end_time);

        let trends: Vec<StoredTrend> = self
            .client
            .query(query)
            .bind(keyword)
            .bind(start_time.timestamp())
            .bind(end_time.timestamp())
            .fetch_all()
            .await
            .map_err(|e| {
                error!("Failed to execute trend history query: {}", e);
                Error::Database(e)
            })?;

        info!("Retrieved {} historical trend entries for '{}'", trends.len(), keyword);

        let mut result: Vec<Trend> = trends.into_iter().map(Trend::from).collect();

        // Sort by detected_at to ensure chronological order
        result.sort_by(|a, b| a.detected_at.cmp(&b.detected_at));

        Ok(result)
    }

    async fn detect_trends(
        &self,
        window: std::time::Duration,
        exclude_entity_window: std::time::Duration,
        min_posts: usize,
        max_trends: usize,
        offset: usize,
    ) -> Result<Vec<Trend>, Error> {
        let query = r#"
            SELECT
                text as keyword,
                COUNT(*) as post_count,
                groupArray(CAST(post_id, 'String')) as post_ids,
                CAST('', 'String') as summary,
                CAST(toUnixTimestamp(now()), 'Int32') as detected_at,
                CAST([], 'Array(String)') as tags
            FROM entities
            WHERE timestamp >= toUnixTimestamp(now() - INTERVAL ? SECOND)
            AND text NOT IN (
                SELECT entity
                FROM entities_stats
                WHERE timestamp >= toUnixTimestamp(now() - INTERVAL ? SECOND)
            )
            GROUP BY text
            HAVING post_count >= ?
            ORDER BY post_count DESC
            LIMIT ? OFFSET ?
            SETTINGS max_threads = 2
        "#;

        info!("Executing trend detection query");

        let trends: Vec<StoredTrend> = self
            .client
            .query(query)
            .bind(window.as_secs() as i64)
            .bind(exclude_entity_window.as_secs() as i64)
            .bind(min_posts as u64)
            .bind(max_trends as u64)
            .bind(offset as u64)
            .fetch_all()
            .await
            .map_err(|e| {
                error!("Failed to execute trend detection query: {}", e);
                Error::Database(e)
            })?;

        info!("Retrieved {} potential trends", trends.len());
        Ok(trends.into_iter().map(Trend::from).collect())
    }

    async fn save(&self, origin_entity: String, trend: &Trend, window: std::time::Duration) -> Result<(), Error> {
        if trend.keyword.is_empty() || trend.summary.is_empty() {
            info!("Skipping trend save as keyword or summary is empty");
            return Ok(());
        }

        #[derive(Debug, Serialize, Deserialize, clickhouse::Row)]
        struct TrendCount {
            count: u64,
        }

        let check_query = r#"
            SELECT
                COUNT(*) as count
            FROM trends
            WHERE LOWER(keyword) = LOWER(?)
            AND detected_at >= toUnixTimestamp(now()) - ?
            LIMIT 1
        "#;

        let window_secs = window.as_secs() as i64;
        let count: TrendCount =
            self.client.query(check_query).bind(&trend.keyword).bind(window_secs).fetch_one().await?;

        if count.count > 0 {
            info!("Skipping duplicate trend save - already exists: {}", trend.keyword);
            return Ok(());
        }

        let query = r#"
            INSERT INTO trends
            (keyword, post_count, post_ids, summary, detected_at, tags)
            VALUES (?, ?, ?, ?, ?, ?)
        "#;

        self.client
            .query(query)
            .bind(&trend.keyword)
            .bind(trend.post_count as u64)
            .bind(&trend.post_ids)
            .bind(&trend.summary)
            .bind(trend.detected_at.timestamp())
            .bind(&trend.tags)
            .execute()
            .await?;

        self.add_entity_stats(&origin_entity, &trend.keyword, "", &trend.detected_at).await?;

        info!(
            "Saved trend with summary for {} and entity stats for trend: {}",
            trend.keyword, origin_entity
        );
        Ok(())
    }

    async fn get_trends_at_time(
        &self,
        timestamp: DateTime<Utc>,
        window: Duration,
        limit: usize,
    ) -> Result<Vec<Trend>, Error> {
        let window_start = timestamp - window;

        let query = r#"
            SELECT
                CAST(keyword, 'String') as keyword,
                CAST(post_count, 'UInt64') as post_count,
                CAST(post_ids, 'Array(String)') as post_ids,
                CAST(summary, 'String') as summary,
                CAST(detected_at, 'Int32') as detected_at,
                CAST(tags, 'Array(String)') as tags
            FROM trends
            WHERE detected_at >= toUnixTimestamp(?)
                AND detected_at < toUnixTimestamp(?)
            ORDER BY post_count DESC
            LIMIT ?
            SETTINGS max_threads = 2
        "#;

        let trends: Vec<StoredTrend> = self
            .client
            .query(query)
            .bind(window_start.timestamp())
            .bind(timestamp.timestamp())
            .bind(limit as u64)
            .fetch_all()
            .await
            .map_err(|e| {
                error!("Failed to execute trend lookup query: {}", e);
                Error::Database(e)
            })?;

        info!("Retrieved {} historical trends", trends.len());
        Ok(trends.into_iter().map(Trend::from).collect())
    }

    async fn get_trends(&self, window: Duration) -> Result<Vec<Trend>, Error> {
        let query = r#"
            SELECT
                CAST(keyword, 'String') as keyword,
                CAST(post_count, 'UInt64') as post_count,
                CAST(post_ids, 'Array(String)') as post_ids,
                CAST(summary, 'String') as summary,
                CAST(detected_at, 'Int32') as detected_at,
                CAST(tags, 'Array(String)') as tags
            FROM trends
            WHERE detected_at >= toUnixTimestamp(now()) - ?
            ORDER BY detected_at DESC
            SETTINGS max_threads = 2
        "#;

        let trends: Vec<StoredTrend> =
            self.client.query(query).bind(window.num_seconds()).fetch_all().await.map_err(|e| {
                error!("Failed to execute trend lookup query: {}", e);
                Error::Database(e)
            })?;

        info!("Retrieved {} current trends", trends.len());
        Ok(trends.into_iter().map(Trend::from).collect())
    }

    async fn get_trend(&self, window: Duration, keyword: &str) -> Result<Option<Trend>, Error> {
        let query = r#"
            SELECT
                CAST(keyword, 'String') as keyword,
                CAST(post_count, 'UInt64') as post_count,
                CAST(post_ids, 'Array(String)') as post_ids,
                CAST(summary, 'String') as summary,
                CAST(detected_at, 'Int32') as detected_at,
                CAST(tags, 'Array(String)') as tags
            FROM trends
            WHERE LOWER(keyword) = LOWER(?)
            AND detected_at >= toUnixTimestamp(now()) - ?
            ORDER BY detected_at DESC
            LIMIT 1
            SETTINGS max_threads = 2
        "#;

        let trend: Option<StoredTrend> = self
            .client
            .query(query)
            .bind(keyword)
            .bind(window.num_seconds())
            .fetch_optional()
            .await
            .map_err(|e| {
                error!("Failed to execute trend lookup query: {}", e);
                Error::Database(e)
            })?;

        Ok(trend.map(Trend::from))
    }

    async fn add_entity_stats(
        &self,
        entity: &str,
        trend_id: &str,
        duplicate: &str,
        timestamp: &DateTime<Utc>,
    ) -> Result<(), Error> {
        let query = r#"
            INSERT INTO entities_stats
            (entity, trend_id, duplicate, throttle, timestamp)
            VALUES (?, ?, ?, ?, ?)
        "#;

        self.client
            .query(query)
            .bind(entity)
            .bind(trend_id)
            .bind(duplicate)
            .bind(0_u32)
            .bind(timestamp)
            .execute()
            .await?;

        info!("Added entity stats for {}: {}", entity, trend_id);
        Ok(())
    }
}
