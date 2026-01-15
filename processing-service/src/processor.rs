use std::collections::HashSet;

use chrono::Utc;
use common::domain::Post;
use common::domain::ProcessedKeyword;
use common::domain::ProcessedPost;
use common::validation::sanitize_keyword;
use common::validation::sanitize_text;
use reqwest::Client;
use serde::Deserialize;
use serde::Serialize;
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum ProcessingError {
    #[error("API error: {0}")]
    Api(#[from] reqwest::Error),

    #[error("Parse error: {0}")]
    Parse(#[from] serde_json::Error),

    #[error("Post was flagged by moderation")]
    ModeratedPost,
}

#[derive(Debug, Serialize)]
struct ModerationRequest {
    input: String,
}

#[derive(Debug, Deserialize)]
struct ModerationResult {
    flagged: bool,
}

#[derive(Debug, Deserialize)]
struct ModerationResponse {
    results: Vec<ModerationResult>,
}

#[derive(Debug, Serialize)]
struct TextSource {
    text: String,
    metadata: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct BatchRequest {
    texts: Vec<TextSource>,
}

#[derive(Debug, Deserialize)]
struct Entity {
    text: String,
}

#[derive(Debug, Deserialize)]
struct ProcessingResult {
    entities: Vec<Entity>,
}

#[derive(Debug, Deserialize)]
struct BatchResponse {
    results: Vec<ProcessingResult>,
}

pub struct EntityProcessor {
    client: Client,
    ner_api_url: String,
    moderation_api_url: String,
    stop_words: HashSet<String>,
    min_word_length: usize,
    max_word_length: usize,
}

impl EntityProcessor {
    pub fn new(min_word_length: usize, max_word_length: usize) -> Self {
        let stop_words_str = include_str!("../resources/stop_words.txt");
        let stop_words: HashSet<String> = stop_words_str
            .lines()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect();

        Self {
            client: Client::new(),
            ner_api_url: "https://ner-api.app.cloud.cbh.kth.se/process".to_string(),
            moderation_api_url: "https://api.openai.com/v1/moderations".to_string(),
            stop_words,
            min_word_length,
            max_word_length,
        }
    }

    async fn moderate_text(&self, text: &str) -> Result<bool, ProcessingError> {
        let request = ModerationRequest { input: text.to_string() };

        let response = self.client
            .post(&self.moderation_api_url)
            .bearer_auth("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")
            .json(&request)
            .send()
            .await?;

        let response_body = response.text().await?;

        match serde_json::from_str::<ModerationResponse>(&response_body) {
            Ok(moderation_response) => {
                let is_flagged = moderation_response.results.first().map(|result| result.flagged).unwrap_or(false);
                info!("Text flagged: {}", text);
                info!("Moderation response: {}", response_body);
                Ok(is_flagged)
            },
            Err(e) => {
                info!("Failed to parse response: {}", e);
                Err(ProcessingError::Parse(e))
            },
        }
    }

    fn is_valid_entity(&self, text: &str) -> bool {
        let sanitized = sanitize_keyword(text);
        let len = sanitized.chars().count();
        if len < self.min_word_length || len > self.max_word_length {
            return false;
        }
        if self.stop_words.contains(&sanitized.to_lowercase()) {
            return false;
        }
        sanitized.chars().any(|c| c.is_alphabetic())
    }

    pub async fn process_post(&self, post: &Post) -> Result<ProcessedPost, ProcessingError> {
        let sanitized_text = sanitize_text(&post.text);
        let is_flagged = self.moderate_text(&sanitized_text).await?;
        if is_flagged {
            info!(post_id = %post.id, "Post flagged by OpenAI moderation API.");
            return Err(ProcessingError::ModeratedPost);
        }

        let request = BatchRequest {
            texts: vec![TextSource {
                text: sanitized_text.clone(),
                metadata: serde_json::json!({
                    "post_id": post.id,
                    "author_did": post.author_did,
                }),
            }],
        };

        let response = self
            .client
            .post(&self.ner_api_url)
            .json(&request)
            .send()
            .await?
            .json::<BatchResponse>()
            .await?;

        let mut keywords = Vec::new();
        if let Some(result) = response.results.first() {
            for entity in &result.entities {
                let sanitized_entity = sanitize_keyword(&entity.text);
                if self.is_valid_entity(&sanitized_entity) {
                    info!(
                        post_id = %post.id,
                        entity = %sanitized_entity,
                        "Found valid entity"
                    );
                    keywords.push(ProcessedKeyword { word: sanitized_entity });
                } else {
                    info!(
                        post_id = %post.id,
                        entity = %sanitized_entity,
                        "Filtered out invalid entity"
                    );
                }
            }
        }

        info!(
            post_id = %post.id,
            entities = keywords.len(),
            "Extracted entities from post"
        );

        // replace previous timestamp with DateTime now
        Ok(ProcessedPost {
            id: post.id.clone(),
            text: post.text.clone(),
            author_did: post.author_did.clone(),
            // timestamp: post.timestamp,
            timestamp: Utc::now(),
            keywords,
        })
    }
}
