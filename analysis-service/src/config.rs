use std::time::Duration;

#[derive(Debug, Clone)]
pub struct ServiceConfig {
    pub clickhouse_url: String,
    pub analysis_interval: Duration,
    pub trend_window: Duration,
    pub exclude_entity_window: Duration,
    pub min_post_count: usize,
    pub max_trends: usize,
    pub analysis_retries: usize,
}

impl ServiceConfig {
    pub fn from_env() -> Self {
        Self {
            clickhouse_url: std::env::var("CLICKHOUSE_URL").unwrap_or_else(|_| "http://localhost:8123".into()),
            analysis_interval: Duration::from_secs(
                std::env::var("ANALYSIS_INTERVAL_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(15), // Check every 15 seconds
            ),
            trend_window: Duration::from_secs(
                std::env::var("TREND_WINDOW_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(86400), // 1 day
            ),
            exclude_entity_window: Duration::from_secs(
                std::env::var("EXCLUDE_ENTITY_WINDOW_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(600), // 10 minutes
            ),
            min_post_count: std::env::var("MIN_POST_COUNT").ok().and_then(|v| v.parse().ok()).unwrap_or(2), // Just need 2 posts
            max_trends: std::env::var("MAX_TRENDS").ok().and_then(|v| v.parse().ok()).unwrap_or(50), // Show more trends
            analysis_retries: std::env::var("ANALYSIS_RETRIES").ok().and_then(|v| v.parse().ok()).unwrap_or(10),
        }
    }
}
