use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct ServiceConfig {
    pub nats_url: String,
    pub clickhouse_url: String,
    pub stream_name: String,
    pub consumer_name: String,
    pub subject: String,
    pub batch_size: usize,
    pub min_word_length: usize,
    pub max_word_length: usize,
}

impl ServiceConfig {
    pub fn from_env() -> Self {
        Self {
            nats_url: std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into()),
            clickhouse_url: std::env::var("CLICKHOUSE_URL").unwrap_or_else(|_| "http://localhost:8123".into()),
            stream_name: std::env::var("STREAM_NAME").unwrap_or_else(|_| "BLUESKY_POSTS".into()),
            consumer_name: std::env::var("CONSUMER_NAME").unwrap_or_else(|_| "processor-1".into()),
            subject: std::env::var("SUBJECT").unwrap_or_else(|_| "posts.raw".into()),
            batch_size: std::env::var("BATCH_SIZE").ok().and_then(|v| v.parse().ok()).unwrap_or(50),
            min_word_length: std::env::var("MIN_WORD_LENGTH").ok().and_then(|v| v.parse().ok()).unwrap_or(3),
            max_word_length: std::env::var("MAX_WORD_LENGTH").ok().and_then(|v| v.parse().ok()).unwrap_or(50),
        }
    }
}
