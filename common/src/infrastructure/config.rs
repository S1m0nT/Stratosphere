use std::time::Duration;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct BaseConfig {
    pub service_name: String,
    pub environment: String,
    pub nats: NatsConfig,
    pub metrics: MetricsConfig,
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NatsConfig {
    pub url: String,
    pub stream_name: String,
    pub subject: String,
    pub consumer_name: Option<String>,
    pub batch_size: usize,
    pub flush_interval: Duration,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MetricsConfig {
    pub enabled: bool,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoggingConfig {
    pub level: String,
    pub json: bool,
}

impl BaseConfig {
    pub fn validate(&self) -> Result<(), crate::error::Error> {
        if self.service_name.is_empty() {
            return Err(crate::error::Error::Config("Service name cannot be empty".into()));
        }
        if self.nats.url.is_empty() {
            return Err(crate::error::Error::Config("NATS URL cannot be empty".into()));
        }
        if self.nats.stream_name.is_empty() {
            return Err(crate::error::Error::Config("Stream name cannot be empty".into()));
        }
        Ok(())
    }

    pub fn from_env() -> Result<Self, crate::error::Error> {
        envy::from_env().map_err(|e| crate::error::Error::Config(e.to_string()))
    }
}
