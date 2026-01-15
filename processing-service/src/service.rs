use std::sync::Arc;

use async_nats::jetstream;
use common::Error;
use common::domain::BlueskyEvent;
use common::domain::Post;
use common::domain::repositories::PostRepository;
use common::infrastructure::adapters::ClickhouseClient;
use common::infrastructure::health::ServiceHealth;
use common::validation::sanitize_text;
use futures_util::StreamExt;
use parking_lot::Mutex;
use tokio::sync::watch;
use tracing::error;
use tracing::info;
use tracing::warn;

use crate::config::ServiceConfig;
use crate::processor::EntityProcessor;
use crate::processor::ProcessingError;

pub struct ProcessingService {
    config: ServiceConfig,
    processor: EntityProcessor,
    nats: jetstream::Context,
    repository: Arc<ClickhouseClient>,
    health: Arc<Mutex<ServiceHealth>>,
}

impl ProcessingService {
    pub async fn new(config: ServiceConfig, health: Arc<Mutex<ServiceHealth>>) -> Result<Self, Error> {
        let nats = async_nats::connect(&config.nats_url).await.map_err(|e| Error::Nats(e.to_string()))?;
        let nats_js = jetstream::new(nats);
        let repository = Arc::new(ClickhouseClient::new(&config.clickhouse_url));

        Ok(Self {
            processor: EntityProcessor::new(config.min_word_length, config.max_word_length),
            nats: nats_js,
            repository,
            health,
            config,
        })
    }

    fn extract_post_from_event(event: BlueskyEvent) -> Option<Post> {
        match event {
            BlueskyEvent::Commit { did, time_us, commit } => {
                info!(
                    "Processing commit - collection: {}, operation: {}, rkey: {}",
                    commit.collection, commit.operation, commit.rkey
                );

                if commit.collection != "app.bsky.feed.post" {
                    info!("Skipping non-post commit for collection: {}", commit.collection);
                    return None;
                }

                if commit.operation != "create" {
                    info!("Skipping non-create operation: {}", commit.operation);
                    return None;
                }

                let record = match commit.record {
                    Some(record) => record,
                    None => {
                        info!("No record found in commit");
                        return None;
                    },
                };

                let text = match record.get("text").and_then(|t| t.as_str()) {
                    Some(text) => sanitize_text(text),
                    None => {
                        info!("No text found in record");
                        return None;
                    },
                };

                let id = format!("at://{}/app.bsky.feed.post/{}", did, commit.rkey);

                // Convert microseconds to seconds by dividing by 1_000_000
                let timestamp =
                    chrono::DateTime::from_timestamp(time_us / 1_000_000, 0).unwrap_or_else(chrono::Utc::now);

                info!(
                    "Successfully extracted post - id: {}, text length: {}, timestamp: {}",
                    id,
                    text.len(),
                    timestamp
                );

                Some(Post { id, text, author_did: did, timestamp })
            },
            _ => {
                info!("Skipping non-commit event");
                None
            },
        }
    }

    async fn process_batch(&mut self, posts: &[Post]) -> Result<(), Error> {
        if posts.is_empty() {
            return Ok(());
        }

        let start_time = std::time::Instant::now();
        let mut processed_posts = Vec::with_capacity(posts.len());

        for post in posts {
            match self.processor.process_post(post).await {
                Ok(processed) => {
                    info!(
                        post_id = %post.id,
                        entities = processed.keywords.len(),
                        "Processed post"
                    );
                    processed_posts.push(processed);
                },
                Err(ProcessingError::ModeratedPost) => {
                    info!(post_id = %post.id, "Post was flagged by moderation");
                    continue;
                },
                Err(e) => {
                    error!(
                        post_id = %post.id,
                        error = %e,
                        "Failed to process post"
                    );
                    continue;
                },
            }
        }

        if !processed_posts.is_empty() {
            self.repository.save_batch(&processed_posts).await?;
            info!(
                processed = processed_posts.len(),
                total = posts.len(),
                duration_ms = start_time.elapsed().as_millis(),
                "Saved processed posts"
            );
        }

        Ok(())
    }

    pub async fn start(&mut self, mut shutdown: watch::Receiver<()>) -> Result<(), Error> {
        // Initialize database tables
        info!("Initializing database tables");
        self.repository.init_database().await?;

        info!("Setting up NATS stream");
        let stream = self
            .nats
            .get_or_create_stream(jetstream::stream::Config {
                name: self.config.stream_name.clone(),
                subjects: vec![self.config.subject.clone()],
                storage: jetstream::stream::StorageType::File,
                ..Default::default()
            })
            .await
            .map_err(|e| Error::Nats(e.to_string()))?;

        info!("Creating consumer with name: {}", self.config.consumer_name);
        let consumer = stream
            .create_consumer(jetstream::consumer::pull::Config {
                durable_name: Some(self.config.consumer_name.clone()),
                filter_subject: self.config.subject.clone(),
                ack_policy: jetstream::consumer::AckPolicy::Explicit,
                max_deliver: 1,
                ..Default::default()
            })
            .await
            .map_err(|e| Error::Nats(e.to_string()))?;

        info!(
            "Starting message processing - batch_size: {}, subject: {}",
            self.config.batch_size, self.config.subject
        );

        self.health.lock().report_healthy();

        info!("Subscribing to messages");
        let mut messages = consumer.messages().await.map_err(|e| Error::Nats(e.to_string()))?;
        let mut batch = Vec::new();
        let mut message_count = 0;

        loop {
            tokio::select! {
                Some(msg) = messages.next() => {
                    message_count += 1;
                    if message_count % 100 == 0 {
                        info!("Processed {} messages", message_count);
                    }

                    let msg = msg.map_err(|e| Error::Nats(e.to_string()))?;
                    info!("Received message with subject: {}", msg.subject);

                    match serde_json::from_slice::<BlueskyEvent>(&msg.payload) {
                        Ok(event) => {
                            if let Some(post) = Self::extract_post_from_event(event) {
                                info!("Extracted post - id: {}", post.id);
                                batch.push(post);

                                if batch.len() >= self.config.batch_size {
                                    info!("Processing batch of {} posts", batch.len());
                                    if let Err(e) = self.process_batch(&batch).await {
                                        error!("Failed to process batch: {}", e);
                                        self.health.lock().report_error(&e.to_string());
                                    }
                                    batch.clear();
                                }
                            }
                            msg.ack().await.map_err(|e| Error::Nats(e.to_string()))?;
                        }
                        Err(e) => {
                            warn!("Failed to deserialize message: {}", e);
                            info!("Problematic payload: {}", String::from_utf8_lossy(&msg.payload));
                            msg.ack().await.map_err(|e| Error::Nats(e.to_string()))?;
                        }
                    }
                }
                Ok(()) = shutdown.changed() => {
                    info!("Received shutdown signal");
                    if !batch.is_empty() {
                        info!("Processing final batch of {} posts", batch.len());
                        if let Err(e) = self.process_batch(&batch).await {
                            error!("Failed to process final batch: {}", e);
                        }
                    }
                    return Ok(());
                }
                else => break,
            }
        }

        info!("Message processing loop ended");
        Ok(())
    }
}
