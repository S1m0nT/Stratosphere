use serde::Deserialize;
use serde::Serialize;

use crate::validation::Validate;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProcessedKeyword {
    pub word: String,
}

impl ProcessedKeyword {
    pub fn new(word: String) -> Self {
        Self { word }
    }
}

impl Validate for ProcessedKeyword {
    fn validate(&self) -> Result<(), crate::error::Error> {
        if self.word.is_empty() {
            return Err(crate::error::Error::Validation("Keyword cannot be empty".into()));
        }
        Ok(())
    }
}
