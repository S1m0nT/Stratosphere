use std::collections::HashMap;

use chrono::DateTime;
use chrono::Duration;
use chrono::Utc;
use common::Error as CommonError;
use common::TrendRepository;
use common::domain::Trend;
use reqwest::Client;
use serde::Deserialize;
use serde::Serialize;
use thiserror::Error;
use tracing::error;
use tracing::info;
use tracing::warn;

const MAX_RETRIES: u32 = 2;
const BACKOFF_BASE: std::time::Duration = std::time::Duration::from_secs(1);

#[derive(Debug, Error)]
pub enum SummaryError {
    #[error("Summary generation failed: {0}")]
    Generation(String),
    #[error("HTTP client error: {0}")]
    Http(String),
    #[error("JSON parsing error: {0}")]
    Json(String),
    #[error("Summary validation failed: {0}")]
    Validation(String),
    #[error("Duplicate trend detected: {0}")]
    Duplicate(String),
}

#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    temperature: f32,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
}

#[derive(Debug, Serialize, Clone)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
    json_schema: JsonSchema,
}

#[derive(Debug, Serialize, Clone)]
#[serde(untagged)]
enum JsonSchema {
    Summary(SummarySchema),
    Validation(ValidationSchema),
    Tags(TagsSchema),
}

// Common structs for both schema types
#[derive(Debug, Serialize, Clone)]
struct PropertySchema {
    #[serde(rename = "type")]
    property_type: String,
    description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    items: Option<Box<PropertySchema>>,
}

// Summary-specific schema
#[derive(Debug, Serialize, Clone)]
struct SummarySchema {
    name: String,
    schema: SummarySchemaContent,
    strict: bool,
}

#[derive(Debug, Serialize, Clone)]
struct SummarySchemaContent {
    #[serde(rename = "type")]
    schema_type: String,
    properties: SummaryProperties,
    required: Vec<String>,
    #[serde(rename = "additionalProperties")]
    additional_properties: bool,
}

#[derive(Debug, Serialize, Clone)]
struct SummaryProperties {
    summary: PropertySchema,
}

// Validation-specific schema
#[derive(Debug, Serialize, Clone)]
struct ValidationSchema {
    name: String,
    schema: ValidationSchemaContent,
    strict: bool,
}

#[derive(Debug, Serialize, Clone)]
struct ValidationSchemaContent {
    #[serde(rename = "type")]
    schema_type: String,
    properties: ValidationProperties,
    required: Vec<String>,
    #[serde(rename = "additionalProperties")]
    additional_properties: bool,
}

#[derive(Debug, Serialize, Clone)]
struct ValidationProperties {
    is_valid: PropertySchema,
    reason: PropertySchema,
    improved_keyword: PropertySchema,
}

// Tags-specific schema
#[derive(Debug, Serialize, Clone)]
struct TagsSchema {
    name: String,
    schema: TagsSchemaContent,
    strict: bool,
}

#[derive(Debug, Serialize, Clone)]
struct TagsSchemaContent {
    #[serde(rename = "type")]
    schema_type: String,
    properties: TagsProperties,
    required: Vec<String>,
    #[serde(rename = "additionalProperties")]
    additional_properties: bool,
}

#[derive(Debug, Serialize, Clone)]
struct TagsProperties {
    tags: PropertySchema,
}

#[derive(Debug, Serialize, Clone)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum APIResponse {
    Success(OpenAIResponse),
    Error(OpenRouterError),
}

#[derive(Debug, Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterError {
    error: OpenRouterErrorDetails,
}

#[derive(Debug, Deserialize)]
struct OpenRouterErrorDetails {
    message: String,
    code: u16,
    metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct OpenAIChoice {
    message: OpenAIResponseMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponseMessage {
    content: String,
    #[serde(default)]
    refusal: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ValidationResult {
    is_valid: bool,
    reason: String,
}

#[derive(Debug, Default)]
struct ValidationStats {
    total_processed: u32,
    valid_trends: u32,
    duplicates: u32,
    insufficient_posts: u32,
    generation_failures: u32,
    last_reset: DateTime<Utc>,
    total_similarity_score: f32,
    similarity_scores_count: u32,
}

impl ValidationStats {
    fn new() -> Self {
        Self {
            last_reset: Utc::now(),
            total_similarity_score: 0.0,
            similarity_scores_count: 0,
            ..Default::default()
        }
    }

    fn calculate_rates(&self) -> (f32, f32, f32) {
        if self.total_processed == 0 {
            return (0.0, 0.0, 0.0);
        }
        let valid_rate = (self.valid_trends as f32 / self.total_processed as f32) * 100.0;
        let duplicate_rate = (self.duplicates as f32 / self.total_processed as f32) * 100.0;
        let avg_similarity = if self.similarity_scores_count > 0 {
            self.total_similarity_score / self.similarity_scores_count as f32
        } else {
            0.0
        };
        (valid_rate, duplicate_rate, avg_similarity)
    }

    fn add_similarity_score(&mut self, score: f32) {
        self.total_similarity_score += score;
        self.similarity_scores_count += 1;
    }
}

pub struct TrendSummarizer {
    client: Client,
    api_url: String,
    api_key: String,
    model: String,
    recent_trends: HashMap<String, (chrono::DateTime<Utc>, String, String)>,
    trend_window: chrono::Duration,
    stats: ValidationStats,
    stats_window: Duration,
}

#[derive(Serialize, Deserialize, Clone)]
struct ExistingTrend {
    keyword: String,
    summary: Option<String>,
}

impl TrendSummarizer {
    pub fn new() -> Self {
        // Use `builder()` with error fallback to default client
        let client = Client::builder().pool_max_idle_per_host(10).build().unwrap_or_else(|e| {
            warn!("Failed to build HTTP client with custom config: {}, using default client", e);
            Client::new()
        });

        let api_key = "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".to_string();
        let (api_url, model) = (
            "https://openrouter.ai/api/v1/chat/completions".to_string(),
            "openai/gpt-4o-mini-2024-07-18".to_string(),
        );

        Self {
            client,
            api_url,
            api_key,
            model,
            recent_trends: HashMap::new(),
            trend_window: chrono::Duration::hours(1),
            stats: ValidationStats::new(),
            stats_window: Duration::hours(24),
        }
    }

    fn reset_stats_if_needed(&mut self) {
        if Utc::now() - self.stats.last_reset > self.stats_window {
            let (valid_rate, duplicate_rate, avg_similarity) = self.stats.calculate_rates();
            info!(
                "24hr Statistics: Processed={}, Valid={:.1}%, Duplicates={:.1}%, Insufficient={}, Failures={}, Avg Similarity={:.3}",
                self.stats.total_processed,
                valid_rate,
                duplicate_rate,
                self.stats.insufficient_posts,
                self.stats.generation_failures,
                avg_similarity
            );
            self.stats = ValidationStats::new();
        }
    }

    pub async fn initialize(&mut self, repository: &dyn TrendRepository) {
        match repository.get_trends(self.trend_window).await {
            Ok(trends) => {
                trends.into_iter().for_each(|trend| {
                    let normalized = self.normalize_keyword(&trend.keyword);
                    self.recent_trends
                        .insert(normalized.clone(), (trend.detected_at, normalized, trend.summary));
                });
                info!("Loaded {} recent trends", self.recent_trends.len());
            },
            Err(e) => {
                error!("Failed to load recent trends: {}", e);
                // Initialize with empty trends rather than panicking
            },
        }
    }

    fn create_summary_schema() -> JsonSchema {
        JsonSchema::Summary(SummarySchema {
            name: "summary".to_string(),
            schema: SummarySchemaContent {
                schema_type: "object".to_string(),
                properties: SummaryProperties {
                    summary: PropertySchema {
                        property_type: "string".to_string(),
                        description: "A 200-280 character summary of the trend".to_string(),
                        items: None,
                    },
                },
                required: vec!["summary".to_string()],
                additional_properties: false,
            },
            strict: true,
        })
    }

    fn create_validation_schema() -> JsonSchema {
        JsonSchema::Validation(ValidationSchema {
            name: "validation".to_string(),
            schema: ValidationSchemaContent {
                schema_type: "object".to_string(),
                properties: ValidationProperties {
                    is_valid: PropertySchema {
                        property_type: "boolean".to_string(),
                        description: "Whether the trend seems reasonable and worthwhile".to_string(),
                        items: None,
                    },
                    reason: PropertySchema {
                        property_type: "string".to_string(),
                        description: "Explanation of the validation decision".to_string(),
                        items: None,
                    },
                    improved_keyword: PropertySchema {
                        property_type: "string".to_string(),
                        description: "A concise keyword/phrase suitable for a trending topics list".to_string(),
                        items: None,
                    },
                },
                required: vec!["is_valid".to_string(), "reason".to_string(), "improved_keyword".to_string()],
                additional_properties: false,
            },
            strict: true,
        })
    }

    fn create_tags_schema() -> JsonSchema {
        JsonSchema::Tags(TagsSchema {
            name: "tags".to_string(),
            schema: TagsSchemaContent {
                schema_type: "object".to_string(),
                properties: TagsProperties {
                    tags: PropertySchema {
                        property_type: "array".to_string(),
                        description: "An array of at most 5 lowercase, English tags/categories that best represents the trend's category or focus".to_string(),
                        items: Some(Box::new(PropertySchema {
                            property_type: "string".to_string(),
                            description: "A lowercase, English tag representing a category".to_string(),
                            items: None,
                        })),
                    },
                },
                required: vec!["tags".to_string()],
                additional_properties: false,
            },
            strict: true,
        })
    }

    fn normalize_keyword(&self, keyword: &str) -> String {
        keyword
            .trim()
            .to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace())
            .collect::<String>()
    }

    fn cleanup_old_trends(&mut self) {
        let cutoff = Utc::now() - self.trend_window;
        self.recent_trends.retain(|_, (detected_at, _, _)| *detected_at > cutoff);
    }

    async fn is_duplicate_via_api(&mut self, new_trend_text: &str) -> Result<(bool, f32), CommonError> {
        #[derive(Serialize)]
        struct DuplicateCheckRequest {
            new_trend_text: String,
            existing_trends: Vec<ExistingTrend>,
            threshold: f32,
        }

        let existing_trends: Vec<ExistingTrend> = self
            .recent_trends
            .iter()
            .map(|(_normalized_key, (_detected_at, normalized_keyword, summary))| ExistingTrend {
                keyword: normalized_keyword.clone(),
                summary: Option::from(summary.clone()),
            })
            .collect();

        let payload = DuplicateCheckRequest {
            new_trend_text: new_trend_text.to_string(),
            existing_trends: existing_trends.to_vec(),
            threshold: 0.95,
        };

        let client = Client::new();
        let res = client
            .post("https://dup-api.app.cloud.cbh.kth.se/detect-duplicate")
            .json(&payload)
            .send()
            .await
            .map_err(|e| CommonError::Network(format!("DuplicateDetectionAPI call failed: {}", e)))?;

        if !res.status().is_success() {
            return Err(CommonError::Network(format!("DuplicateDetectionAPI returned status {}", res.status())));
        }

        #[derive(Deserialize)]
        struct DuplicateCheckResponse {
            is_duplicate: bool,
            similarity_score: f32,
            #[allow(unused)]
            matched_keyword: Option<String>,
        }

        let data: DuplicateCheckResponse = res
            .json()
            .await
            .map_err(|e| CommonError::Network(format!("Failed to parse duplicate check response: {}", e)))?;

        info!(
            "duplicate detection - is_duplicate: {}, matched_keyword: {}, similarity_score: {}",
            data.is_duplicate,
            data.matched_keyword.unwrap_or_default(),
            data.similarity_score
        );

        Ok((data.is_duplicate, data.similarity_score))
    }

    async fn call_llm_with_retry(
        &self,
        messages: Vec<OpenAIMessage>,
        schema: Option<JsonSchema>,
    ) -> Result<String, SummaryError> {
        let mut last_error = None;

        for attempt in 0..=MAX_RETRIES {
            if attempt > 0 {
                let backoff = BACKOFF_BASE * 2u32.pow(attempt - 1);
                tokio::time::sleep(backoff).await;
            }

            let mut request = self.client.post(&self.api_url);
            request = request.header("Authorization", format!("Bearer {}", self.api_key));

            let response_format = schema
                .clone()
                .map(|s| ResponseFormat { format_type: "json_schema".to_string(), json_schema: s });

            let payload = OpenAIRequest {
                model: self.model.clone(),
                messages: messages.clone(),
                temperature: 0.3,
                max_tokens: 300,
                response_format,
            };

            match request.json(&payload).send().await {
                Ok(response) => match response.text().await {
                    Ok(text) => match serde_json::from_str::<APIResponse>(&text) {
                        Ok(APIResponse::Success(chat_response)) => {
                            if let Some(choice) = chat_response.choices.first() {
                                if let Some(refusal) = &choice.message.refusal {
                                    return Err(SummaryError::Generation(refusal.clone()));
                                }
                                return Ok(choice.message.content.clone());
                            } else {
                                last_error = Some(SummaryError::Generation("No choices returned from API".to_string()));
                            }
                        },
                        Ok(APIResponse::Error(error)) => {
                            warn!("API error response: {} (code: {})", error.error.message, error.error.code);
                            if let Some(metadata) = error.error.metadata {
                                warn!(
                                    "Error metadata: {}",
                                    serde_json::to_string_pretty(&metadata).unwrap_or_default()
                                );
                            }
                            last_error = Some(SummaryError::Http(error.error.message));
                        },
                        Err(e) => {
                            warn!("Failed to parse response (attempt {}): {} - Raw response: {}", attempt + 1, e, text);
                            last_error = Some(SummaryError::Json(format!("{} - Raw response: {}", e, text)));
                        },
                    },
                    Err(e) => {
                        warn!("Failed to get response text (attempt {}): {}", attempt + 1, e);
                        last_error = Some(SummaryError::Http(format!("Failed to read response text: {}", e)));
                    },
                },
                Err(e) => {
                    warn!("API error (attempt {}): {}", attempt + 1, e);
                    last_error = Some(SummaryError::Http(e.to_string()));
                },
            }
        }

        Err(last_error.unwrap_or_else(|| SummaryError::Generation("Maximum retry attempts exceeded".to_string())))
    }

    async fn generate_summary(&self, trend: &str, posts: &[String]) -> Result<String, SummaryError> {
        let combined_posts = posts
            .iter()
            .take(5)
            .map(|p| p.replace('\n', " ").chars().take(300).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n");

        let current_date = Utc::now().format("%Y-%m-%d").to_string();

        let system_prompt = OpenAIMessage {
            role: "system".to_string(),
            content: format!(
                r#"You are a precise trend analysis system operating on {current_date}. Your role is to create high-quality summaries of trending topics that inform readers about current events and discussions.

Key points about the current context:
- It is currently {current_date}
- References to today's date in source content are valid and current
- Major ongoing events: Various global political transitions, technological advancements, and social movements
- You should analyze content assuming it reflects real current events and discussions

Your summaries should be:
- Factual and well-supported by the source content
- Balanced in perspective
- Free of speculation or editorial stance
- Focused on explaining significance and context"#
            ),
        };

        let user_prompt = OpenAIMessage {
            role: "user".to_string(),
            content: format!(
                r#"Trending Topic: '{}'

Sample Posts:
{}

Create a compelling 2-3 sentence summary that:
1. Explains why this topic is trending NOW
2. Provides essential context and verified details
3. Stays within 200-280 characters
4. Uses clear, professional language
5. Avoids:
   - Speculation or unverified claims
   - Vague statements
   - Informal language or social media conventions
   - Sensationalism

Respond with valid JSON containing a single 'summary' field with your summary text."#,
                trend, combined_posts
            ),
        };

        let schema = Self::create_summary_schema();
        let response = self.call_llm_with_retry(vec![system_prompt, user_prompt], Some(schema)).await?;

        let response: serde_json::Value = serde_json::from_str(&response)
            .map_err(|e| SummaryError::Json(format!("Failed to parse summary response: {}", e)))?;
        let summary = response["summary"]
            .as_str()
            .ok_or_else(|| SummaryError::Generation("Invalid summary format".into()))?
            .trim()
            .to_string();

        if summary.is_empty() {
            return Err(SummaryError::Generation("Empty summary generated".into()));
        }

        Ok(summary)
    }

    async fn validate_summary(
        &self,
        keyword: &str,
        summary: &str,
        posts: &[String],
    ) -> Result<(bool, String, String), SummaryError> {
        let sample_posts = posts
            .iter()
            .take(3)
            .map(|p| p.replace('\n', " ").chars().take(200).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n");

        let current_date = Utc::now().format("%Y-%m-%d").to_string();
        let system_prompt = OpenAIMessage {
            role: "system".to_string(),
            content: format!(
                r#"You are a trend keyword optimizer operating on {current_date}. Your role is to extract clean, concise keywords that follow trending topics conventions, like those seen on Twitter or other social media platforms.

                Keyword Guidelines:
                - Keep keywords minimal and memorable (1-3 words)
                - No meta terms like "Trending", "Update", "News", "Drama"
                - No descriptions of the trend ("Controversy about", "Discussion of")
                - Capitalize names, brands, acronyms properly (NASA, iPhone, BTS)
                - Include numbers only for specific versions/years (iPhone 15, World Cup 2026)

                BAD Examples:
                × "Trump Political Discussion"     → Should be "Trump"
                × "Controversy About Spotify"      → Should be "Spotify"
                × "Breaking News Ukraine"          → Should be "Ukraine"
                × "Twitter Community Response"     → Should be "Twitter" or specific topic
                × "New iPhone Release Updates"     → Should be "iPhone 15"
                × "Celebrity Drama Updates"        → Should be celebrity's name

                GOOD Examples:
                ✓ Names:         "Taylor Swift", "Elon Musk", "LeBron James"
                ✓ Events:        "Super Bowl", "Met Gala", "Olympics"
                ✓ Tech:          "ChatGPT", "PlayStation 5", "iOS 17"
                ✓ Entertainment: "Barbie", "Stranger Things", "Game of Thrones"
                ✓ Sports:        "Champions League", "NBA Finals", "Formula 1"
                ✓ Brands:        "Nike", "Tesla", "Netflix"
                ✓ Topics:        "Climate Change", "AI", "Bitcoin"

                Extract the actual distinct keyword from the sample posts, but ensure proper capitalization and formatting. When multiple variations exist (e.g., "Donald Trump" vs "Trump"), prefer the most commonly used form in current social media trends.

                DO NOT USE HASHTAGS OR YOU WILL DIE."#
            ),
        };

        let user_prompt = OpenAIMessage {
            role: "user".to_string(),
            content: format!(
                r#"Current Keyword: '{}'
Summary: '{}'
Sample Posts:
{}

Your task:
1. Validate if this represents a genuine trend
2. Convert the keyword into a clean, concise trending topic format
3. Remove any meta-commentary or categorization
4. Preserve hashtags only if they're the actual trend

Remember:
- Keywords should be immediately recognizable
- Don't add context or explanation to the keyword
- Keep it as concise as possible while remaining clear
- Names/brands should use proper capitalization
- Only use hashtags that are actually trending

Respond with JSON containing:
- 'is_valid': Whether this is a genuine trend
- 'reason': Brief explanation of your decision
- 'improved_keyword': Clean, concise keyword following the guidelines"#,
                keyword, summary, sample_posts
            ),
        };

        let schema = Self::create_validation_schema();
        let response = self.call_llm_with_retry(vec![system_prompt, user_prompt], Some(schema)).await?;

        let parsed: serde_json::Value =
            serde_json::from_str(&response).map_err(|e| SummaryError::Json(e.to_string()))?;

        let is_valid = parsed["is_valid"]
            .as_bool()
            .ok_or_else(|| SummaryError::Json("Missing is_valid field".to_string()))?;
        let reason = parsed["reason"]
            .as_str()
            .ok_or_else(|| SummaryError::Json("Missing reason field".to_string()))?
            .to_string();
        let improved_keyword = parsed["improved_keyword"]
            .as_str()
            .ok_or_else(|| SummaryError::Json("Missing improved_keyword field".to_string()))?
            .to_string();

        Ok((is_valid, reason, improved_keyword))
    }

    async fn extract_tags(&self, keyword: &str, summary: &str, posts: &[String]) -> Result<Vec<String>, SummaryError> {
        let sample_posts = posts
            .iter()
            .take(3)
            .map(|p| p.replace('\n', " ").chars().take(200).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n");

        let current_date = Utc::now().format("%Y-%m-%d").to_string();
        let system_prompt = OpenAIMessage {
            role: "system".to_string(),
            content: format!(
                r#"You are a precise topic categorization system operating on {current_date}. Your role is to analyze trending topics and categorize them with accurate, contextually relevant tags that will help users filter content according to their interests.

                Tag Guidelines:
                - Provide 1-5 tags that accurately categorize the content
                - All tags must be lowercase English words or short phrases
                - Tags should represent broad categories that many users might filter by
                - Be specific enough to be useful, but general enough to group similar content
                - Avoid ultra-specific tags that would only apply to this single trend
                - No hashtags, symbols, or special characters

                Category Examples:
                - Domain areas: politics, sports, entertainment, technology, health, business, science
                - Content types: news, opinion, announcement, event, release, update
                - Geographic regions: us, europe, asia, global, local
                - Demographics: celebrity, community, company, government
                - Media types: video, music, social, gaming, streaming

                BEST PRACTICE: Think about how a user would want to filter their feed. What categories would they select to either see or hide this type of content?"#
            ),
        };

        let user_prompt = OpenAIMessage {
            role: "user".to_string(),
            content: format!(
                r#"Trending Topic: '{}'
Summary: '{}'
Sample Posts:
{}

Your task:
1. Analyze this trending topic and determine its key categories
2. Provide 1-5 lowercase tags that accurately represent the categories of this trend
3. Focus on general categories that many users might want to filter by
4. Ensure tags are useful for content discovery and filtering

Respond with JSON containing only:
- 'tags': An array of 1-5 lowercase tag strings"#,
                keyword, summary, sample_posts
            ),
        };

        let schema = Self::create_tags_schema();
        let response = self.call_llm_with_retry(vec![system_prompt, user_prompt], Some(schema)).await?;

        let parsed: serde_json::Value =
            serde_json::from_str(&response).map_err(|e| SummaryError::Json(e.to_string()))?;

        let tags = parsed["tags"]
            .as_array()
            .ok_or_else(|| SummaryError::Json("Missing tags field or not an array".to_string()))?;

        let tags: Vec<String> = tags.iter().filter_map(|t| t.as_str().map(|s| s.to_string())).collect();

        if tags.is_empty() {
            return Err(SummaryError::Generation("No valid tags generated".into()));
        }

        Ok(tags)
    }

    pub async fn summarize_trend(&mut self, trend: &mut Trend, posts: &[String]) -> Result<bool, SummaryError> {
        self.reset_stats_if_needed();
        self.cleanup_old_trends();
        self.stats.total_processed += 1;

        if posts.is_empty() {
            return Err(SummaryError::Validation("No posts provided for summarization".into()));
        }

        if posts.len() < 3 {
            self.stats.insufficient_posts += 1;
            info!("Skipping trend '{}' - insufficient posts ({})", trend.keyword, posts.len());
            return Ok(false);
        }

        let summary = match self.generate_summary(&trend.keyword, posts).await {
            Ok(summary) => summary,
            Err(e) => {
                self.stats.generation_failures += 1;
                warn!("Failed to generate summary for '{}': {}", trend.keyword, e);
                return Ok(false);
            },
        };

        info!("Generated summary for '{}': {}", trend.keyword, summary);

        let (is_valid, reason, improved_keyword) = self.validate_summary(&trend.keyword, &summary, posts).await?;

        if is_valid {
            let (is_duplicate, similarity_score) = match self.is_duplicate_via_api(&summary).await {
                Ok(result) => result,
                Err(e) => {
                    warn!("Failed to check for duplicates: {}", e);
                    // Default to non-duplicate with a low similarity score when the API fails
                    (false, 0.0)
                },
            };
            self.stats.add_similarity_score(similarity_score);

            if is_duplicate {
                self.stats.duplicates += 1;
                return Err(SummaryError::Duplicate(trend.keyword.clone()));
            }

            // Extract tags for the trend
            let tags = match self.extract_tags(&improved_keyword, &summary, posts).await {
                Ok(tags) => {
                    info!("Generated tags for '{}': {:?}", improved_keyword, tags);
                    tags
                },
                Err(e) => {
                    warn!("Failed to generate tags for '{}': {}. Using empty tags.", improved_keyword, e);
                    Vec::new()
                },
            };

            self.stats.valid_trends += 1;
            let normalized = self.normalize_keyword(&improved_keyword);
            self.recent_trends
                .insert(improved_keyword.clone(), (trend.detected_at, normalized, summary.clone()));
            trend.summary = summary;
            trend.keyword = improved_keyword;
            trend.tags = tags;

            let (valid_rate, duplicate_rate, avg_similarity) = self.stats.calculate_rates();
            info!(
                "Summary validated and accepted for '{}'. Current rates: Valid={:.1}%, Duplicates={:.1}%, Avg Similarity={:.3}",
                trend.keyword, valid_rate, duplicate_rate, avg_similarity
            );
            Ok(true)
        } else {
            warn!("Summary rejected for '{}': {}", trend.keyword, reason);
            trend.summary = String::new();
            Ok(false)
        }
    }
}
