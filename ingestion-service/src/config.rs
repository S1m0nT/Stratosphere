use std::time::Duration;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct ServiceConfig {
    pub nats_url: String,
    pub jetstream_url: String,
    pub stream_name: String,
    pub subject: String,
    pub max_age: Duration,
    pub max_reconnect_attempts: u32,
    pub initial_reconnect_delay: Duration,
    pub max_reconnect_delay: Duration,
    pub batch_size: usize,
    pub flush_interval: Duration,
    pub sampling_rate: f64,
}

impl ServiceConfig {
    pub fn from_env() -> Self {
        Self {
            nats_url: std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into()),
            jetstream_url: std::env::var("BLUESKY_URL")
                .unwrap_or_else(|_| "wss://jetstream2.us-east.bsky.network/subscribe".into()),
            stream_name: std::env::var("STREAM_NAME").unwrap_or_else(|_| "BLUESKY_POSTS".into()),
            subject: std::env::var("SUBJECT").unwrap_or_else(|_| "posts.raw".into()),
            max_age: Duration::from_secs(
                std::env::var("MAX_AGE_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(86400),
            ),
            max_reconnect_attempts: std::env::var("MAX_RECONNECT_ATTEMPTS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5),
            initial_reconnect_delay: Duration::from_secs(
                std::env::var("INITIAL_RECONNECT_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(1),
            ),
            max_reconnect_delay: Duration::from_secs(
                std::env::var("MAX_RECONNECT_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(30),
            ),
            batch_size: std::env::var("BATCH_SIZE").ok().and_then(|v| v.parse().ok()).unwrap_or(1000),
            flush_interval: Duration::from_secs(
                std::env::var("FLUSH_INTERVAL_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(5),
            ),
            sampling_rate: std::env::var("SAMPLING_RATE").ok().and_then(|v| v.parse().ok()).unwrap_or(0.2),
        }
    }

    pub fn validate(&self) -> Result<String, String> {
        if self.nats_url.is_empty() {
            return Err("NATS URL cannot be empty".to_string());
        }
        if self.jetstream_url.is_empty() {
            return Err("Jetstream URL cannot be empty".to_string());
        }
        if self.stream_name.is_empty() {
            return Err("Stream name cannot be empty".to_string());
        }
        if self.subject.is_empty() {
            return Err("Subject cannot be empty".to_string());
        }
        if self.max_age.as_secs() == 0 {
            return Err("Max age must be greater than zero".to_string());
        }
        if self.max_reconnect_attempts == 0 {
            return Err("Max reconnect attempts must be greater than zero".to_string());
        }
        if self.initial_reconnect_delay >= self.max_reconnect_delay {
            return Err("Initial reconnect delay must be less than max reconnect delay".to_string());
        }
        if self.batch_size == 0 {
            return Err("Batch size must be greater than zero".to_string());
        }
        if self.flush_interval.as_secs() == 0 {
            return Err("Flush interval must be greater than zero".to_string());
        }
        if self.sampling_rate <= 0.0 {
            return Err("Sample rate must be greater than zero".to_string());
        }
        Ok("Configuration is valid".to_string())
    }
}
