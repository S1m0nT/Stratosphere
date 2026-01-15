use std::sync::Arc;
use std::time::Instant;

use common::domain::BlueskyEvent;
use common::error::Error;
use common::infrastructure::health::ServiceHealth;
use futures_util::StreamExt;
use metrics::counter;
use parking_lot::Mutex;
use rand::Rng;
use tokio::sync::watch;
use tokio::time::sleep;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use tracing::error;
use tracing::info;
use tracing::warn;
use url::Url;

use crate::config::ServiceConfig;

pub struct IngestionService {
    config: ServiceConfig,
    health: Arc<Mutex<ServiceHealth>>,
    last_time_us: i64,
    min_time_us: i64,
    reconnect_attempts: u32,
    nats: async_nats::jetstream::Context,
    rng: rand::rngs::ThreadRng,
}

impl IngestionService {
    pub async fn new(config: ServiceConfig, health: Arc<Mutex<ServiceHealth>>) -> Result<Self, Error> {
        let nats = async_nats::connect(&config.nats_url).await.map_err(|e| Error::Nats(e.to_string()))?;

        let nats_js = async_nats::jetstream::new(nats);
        let stream_cfg = async_nats::jetstream::stream::Config {
            name: config.stream_name.clone(),
            subjects: vec![config.subject.clone()],
            retention: async_nats::jetstream::stream::RetentionPolicy::WorkQueue,
            storage: async_nats::jetstream::stream::StorageType::File,
            max_age: config.max_age,
            ..Default::default()
        };

        nats_js
            .get_or_create_stream(stream_cfg)
            .await
            .map_err(|e| Error::Nats(format!("Failed to create/get stream: {}", e)))?;

        let min_time_us = chrono::Utc::now().timestamp_micros();
        info!(min_time_us, "Setting minimum ingest timestamp");

        Ok(Self {
            config: config.clone(),
            health,
            last_time_us: min_time_us,
            min_time_us,
            reconnect_attempts: 0,
            nats: nats_js,
            rng: rand::rng(),
        })
    }

    async fn connect_to_bluesky(&self) -> Result<Url, Error> {
        Ok(Url::parse_with_params(
            &self.config.jetstream_url,
            &[("collection", "app.bsky.feed.post"), ("cursor", &self.min_time_us.to_string())],
        )?)
    }

    async fn publish_event(&self, event: BlueskyEvent) -> Result<(), Error> {
        let start_time = Instant::now();
        let data = serde_json::to_vec(&event)?;

        info!(message = "Publishing event", event = ?event);

        self.nats
            .publish(self.config.subject.clone(), data.into())
            .await
            .map_err(|e| Error::Nats(format!("Failed to publish: {}", e)))?;

        let elapsed = start_time.elapsed();
        counter!("ingestion_messages_published_total").increment(1);
        metrics::gauge!("ingestion_publish_duration_ms").set(elapsed.as_millis() as f64);

        Ok(())
    }

    async fn process_message(&mut self, msg: Message) -> Result<(), Error> {
        if !self.rng.random_bool(self.config.sampling_rate) {
            return Ok(());
        }

        if let Message::Text(text) = msg {
            match serde_json::from_str::<BlueskyEvent>(&text) {
                Ok(event) => {
                    if let BlueskyEvent::Commit { time_us, commit, .. } = &event {
                        if *time_us < self.min_time_us {
                            info!(time_us = time_us, min_time_us = self.min_time_us, "Skipping old event");
                            return Ok(());
                        }

                        if commit.collection == "app.bsky.feed.post" {
                            if let Some(record) = &commit.record {
                                if let Some(text) = record.get("text").and_then(|t| t.as_str()) {
                                    if let Some(info) = whatlang::detect(text) {
                                        if info.lang() == whatlang::Lang::Eng {
                                            self.publish_event(event.clone()).await?;
                                            self.last_time_us = *time_us;
                                            counter!("ingestion_messages_received_total").increment(1);
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                Err(e) => {
                    warn!(message = "Failed to parse Bluesky event", error = %e);
                    counter!("ingestion_parse_errors_total").increment(1);
                },
            }
        }
        Ok(())
    }

    async fn run_websocket(&mut self, url: Url) -> Result<(), Error> {
        info!(message = "Connecting to Bluesky Jetstream", url = %url);

        let (ws_stream, _) = connect_async(url.as_str()).await?;

        let (_, mut read) = ws_stream.split();
        info!(message = "Connected successfully");
        self.health.lock().report_healthy();
        counter!("ingestion_websocket_connections_total").increment(1);

        while let Some(msg_result) = read.next().await {
            match msg_result {
                Ok(msg) => {
                    if let Err(e) = self.process_message(msg).await {
                        error!(message = "Failed to process message", error = %e);
                        counter!("ingestion_processing_errors_total").increment(1);
                        self.health.lock().report_error(&e.to_string());
                        // Continue processing next message despite error
                        continue;
                    }
                },
                Err(e) => {
                    // All WebSocket errors are now treated as recoverable
                    warn!(message = "WebSocket error, will attempt reconnect", error = %e);
                    counter!("ingestion_websocket_errors_total").increment(1);
                    self.health.lock().report_error(&e.to_string());
                    return Err(Error::Recovery(e.to_string()));
                },
            }
        }

        warn!(message = "WebSocket stream ended, will attempt reconnect");
        Err(Error::Recovery("WebSocket stream ended".to_string()))
    }

    pub async fn start(&mut self, mut shutdown: watch::Receiver<()>) -> Result<(), Error> {
        let mut reconnect_delay = self.config.initial_reconnect_delay;

        loop {
            if shutdown.has_changed()? {
                info!(message = "Received shutdown signal");
                return Ok(());
            }

            match self.connect_to_bluesky().await {
                Ok(url) => {
                    match self.run_websocket(url).await {
                        Ok(_) => {
                            info!(message = "WebSocket connection closed normally");
                            // Reset reconnection parameters on successful connection
                            self.reconnect_attempts = 0;
                            reconnect_delay = self.config.initial_reconnect_delay;
                        },
                        Err(Error::Recovery(reason)) => {
                            warn!(
                                message = "Recoverable error, attempting reconnect",
                                reason = %reason,
                                attempt = self.reconnect_attempts + 1,
                                max_attempts = self.config.max_reconnect_attempts
                            );

                            self.reconnect_attempts += 1;
                            if self.reconnect_attempts >= self.config.max_reconnect_attempts {
                                return Err(Error::RateLimit(format!(
                                    "Exceeded maximum reconnection attempts ({})",
                                    self.config.max_reconnect_attempts
                                )));
                            }
                        },
                        Err(e) => {
                            error!(message = "Unrecoverable error", error = %e);
                            return Err(e);
                        },
                    }
                },
                Err(e) => {
                    error!(message = "Failed to connect to Bluesky", error = %e);
                    counter!("ingestion_connection_errors_total").increment(1);
                    self.health.lock().report_error(&e.to_string());

                    self.reconnect_attempts += 1;
                    if self.reconnect_attempts >= self.config.max_reconnect_attempts {
                        return Err(Error::RateLimit(format!(
                            "Exceeded maximum reconnection attempts ({})",
                            self.config.max_reconnect_attempts
                        )));
                    }
                },
            }

            info!(
                message = "Applying reconnection delay",
                delay = ?reconnect_delay,
                attempt = self.reconnect_attempts,
            );

            tokio::select! {
                _ = sleep(reconnect_delay) => {
                    reconnect_delay = std::cmp::min(
                        reconnect_delay * 2,
                        self.config.max_reconnect_delay
                    );
                }
                Ok(()) = shutdown.changed() => {
                    info!(message = "Received shutdown signal during reconnect delay");
                    return Ok(());
                }
            }
        }
    }
}
