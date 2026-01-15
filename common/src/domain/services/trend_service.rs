use async_trait::async_trait;

use crate::domain::entities::Trend;

#[async_trait]
pub trait TrendService {
    async fn analyze_trends(&self) -> Result<Vec<Trend>, crate::error::Error>;
    async fn get_current_trends(&self, limit: usize) -> Result<Vec<Trend>, crate::error::Error>;
}
