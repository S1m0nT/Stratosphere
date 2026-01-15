use std::future::Future;
use std::time::Duration;

use tokio::time::sleep;
use tracing::info;
use tracing::warn;

pub async fn with_retry<F, Fut, T, E>(f: F, max_retries: u32, initial_delay: Duration, operation: &str) -> Result<T, E>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let mut delay = initial_delay;
    let mut attempts = 0;

    loop {
        match f().await {
            Ok(value) => {
                if attempts > 0 {
                    info!("Operation '{}' succeeded after {} retries", operation, attempts);
                }
                return Ok(value);
            },
            Err(e) if attempts < max_retries => {
                attempts += 1;
                warn!(
                    "Operation '{}' failed (attempt {}/{}): {}. Retrying in {:?}...",
                    operation,
                    attempts,
                    max_retries + 1,
                    e,
                    delay
                );
                sleep(delay).await;
                delay *= 2;
            },
            Err(e) => {
                warn!("Operation '{}' failed after {} attempts: {}", operation, attempts + 1, e);
                return Err(e);
            },
        }
    }
}

pub struct RetryConfig {
    pub max_retries: u32,
    pub initial_delay: Duration,
    pub max_delay: Duration,
    pub timeout: Duration,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_delay: Duration::from_millis(100),
            max_delay: Duration::from_secs(5),
            timeout: Duration::from_secs(30),
        }
    }
}

pub async fn with_retry_and_timeout<F, Fut, T, E>(
    f: F,
    config: &RetryConfig,
    operation: &str,
) -> Result<T, crate::error::Error>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let retry_future = with_retry(f, config.max_retries, config.initial_delay, operation);

    tokio::time::timeout(config.timeout, retry_future)
        .await
        .map_err(|_| crate::error::Error::Internal(format!("Operation '{}' timed out", operation)))?
        .map_err(|e| crate::error::Error::Internal(e.to_string()))
}
