use chrono::DateTime;
use chrono::Utc;
use serde::Deserialize;
use serde::Serialize;

use crate::validation::Validate;
use crate::validation::sanitize_keyword;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trend {
    pub keyword: String,
    pub post_count: u32,
    pub post_ids: Vec<String>,
    pub summary: String,
    pub detected_at: DateTime<Utc>,
    pub tags: Vec<String>,
}

impl Trend {
    pub fn new(
        keyword: String,
        post_count: u32,
        post_ids: Vec<String>,
        summary: String,
        detected_at: DateTime<Utc>,
        tags: Option<Vec<String>>,
    ) -> Self {
        Self {
            keyword: sanitize_keyword(&keyword),
            post_count,
            post_ids,
            summary,
            detected_at,
            tags: tags.unwrap_or_default(),
        }
    }
}

impl Validate for Trend {
    fn validate(&self) -> Result<(), crate::error::Error> {
        if self.keyword.is_empty() {
            return Err(crate::error::Error::Validation("Keyword cannot be empty".into()));
        }
        if self.post_count == 0 {
            return Err(crate::error::Error::Validation("Post count must be greater than zero".into()));
        }
        if self.post_ids.is_empty() {
            return Err(crate::error::Error::Validation("Must have at least one post".into()));
        }
        if self.summary.is_empty() {
            return Err(crate::error::Error::Validation("Summary cannot be empty".into()));
        }
        Ok(())
    }
}
