use async_trait::async_trait;
use chrono::DateTime;
use chrono::Duration;
use chrono::Utc;

use crate::domain::entities::Post;
use crate::domain::entities::ProcessedPost;
use crate::domain::entities::Trend;
use crate::error::Error;

#[async_trait]
pub trait PostRepository: Send + Sync {
    async fn save_batch(&self, posts: &[ProcessedPost]) -> Result<(), Error>;
    async fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Post>, Error>;
}

#[async_trait]
pub trait TrendRepository: Send + Sync {
    async fn detect_trends(
        &self,
        window: std::time::Duration,
        exclude_entity_window: std::time::Duration,
        min_posts: usize,
        max_trends: usize,
        offset: usize,
    ) -> Result<Vec<Trend>, Error>;

    async fn save(&self, origin_entity: String, trend: &Trend, window: std::time::Duration) -> Result<(), Error>;

    async fn get_trends_at_time(
        &self,
        timestamp: DateTime<Utc>,
        window: Duration,
        limit: usize,
    ) -> Result<Vec<Trend>, Error>;

    async fn get_trends(&self, window: Duration) -> Result<Vec<Trend>, Error>;

    async fn get_trend(&self, window: Duration, keyword: &str) -> Result<Option<Trend>, Error>;

    async fn get_trend_history(
        &self,
        keyword: &str,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
    ) -> Result<Vec<Trend>, Error>;

    async fn add_entity_stats(
        &self,
        entity: &str,
        trend_id: &str,
        duplicate: &str,
        timestamp: &DateTime<Utc>,
    ) -> Result<(), Error>;
}
