use async_trait::async_trait;

use crate::domain::entities::Post;
use crate::domain::entities::ProcessedKeyword;
use crate::domain::entities::ProcessedPost;

#[async_trait]
pub trait PostService {
    async fn process_post(&self, post: Post) -> Result<ProcessedPost, crate::error::Error>;
    async fn extract_keywords(&self, text: &str) -> Vec<ProcessedKeyword>;
}
