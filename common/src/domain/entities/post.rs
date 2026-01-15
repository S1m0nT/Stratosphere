use chrono::DateTime;
use chrono::Utc;
use serde::Deserialize;
use serde::Serialize;
use uuid::Uuid;

use super::ProcessedKeyword;
use crate::validation::Validate;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Post {
    pub id: String,
    pub text: String,
    pub author_did: String,
    pub timestamp: DateTime<Utc>,
}

impl Post {
    pub fn new(text: String, author_did: String) -> Self {
        Self { id: Uuid::new_v4().to_string(), text, author_did, timestamp: Utc::now() }
    }
}

impl Validate for Post {
    fn validate(&self) -> Result<(), crate::error::Error> {
        if self.text.is_empty() {
            return Err(crate::error::Error::Validation("Post text cannot be empty".into()));
        }
        if self.text.len() > 300 {
            return Err(crate::error::Error::Validation("Post text exceeds maximum length".into()));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessedPost {
    pub id: String,
    pub text: String,
    pub author_did: String,
    pub timestamp: DateTime<Utc>,
    pub keywords: Vec<ProcessedKeyword>,
}
