use std::error::Error as StdError;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("NATS error: {0}")]
    Nats(String),

    #[error("Database error: {0}")]
    Database(#[from] clickhouse::error::Error),

    #[error("Message broker error: {0}")]
    MessageBroker(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Rate limit exceeded: {0}")]
    RateLimit(String),

    #[error("Service unavailable: {0}")]
    Unavailable(String),

    #[error("Recovery error: {0}")]
    Recovery(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("WebSocket error: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),

    #[error("Watch channel error: {0}")]
    WatchChannel(#[from] tokio::sync::watch::error::RecvError),

    #[error("Other error: {0}")]
    Other(Box<dyn StdError + Send + Sync>),
}

impl From<url::ParseError> for Error {
    fn from(err: url::ParseError) -> Self {
        Error::Internal(err.to_string())
    }
}
