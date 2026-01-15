use std::sync::Arc;

use common::Error;
use common::domain::Trend;
use common::domain::repositories::PostRepository;
use common::domain::repositories::TrendRepository;
use common::infrastructure::adapters::ClickhouseClient;
use common::infrastructure::health::ServiceHealth;
use tokio::time;
use tracing::error;
use tracing::info;

mod config;
mod summarizer;
use config::ServiceConfig;
use summarizer::SummaryError;
use summarizer::TrendSummarizer;

const MIN_TREND_POSTS: usize = 3;

struct AnalysisService {
    config: ServiceConfig,
    summarizer: TrendSummarizer,
    trend_repository: Arc<ClickhouseClient>,
    post_repository: Arc<ClickhouseClient>,
    health: Arc<parking_lot::Mutex<ServiceHealth>>,
}

impl AnalysisService {
    async fn new(config: ServiceConfig) -> Result<Self, Error> {
        let repository = Arc::new(ClickhouseClient::new(&config.clickhouse_url));
        repository.init_database().await?;

        let mut summarizer = TrendSummarizer::new();
        summarizer.initialize(&*repository).await;

        Ok(Self {
            config,
            summarizer,
            trend_repository: repository.clone(),
            post_repository: repository,
            health: Arc::new(parking_lot::Mutex::new(ServiceHealth::new())),
        })
    }

    async fn get_posts_for_trend(&self, trend: &str, post_ids: &[String]) -> Result<Vec<String>, Error> {
        if post_ids.is_empty() {
            info!("No post IDs provided for trend '{}'", trend);
            return Ok(Vec::new());
        }

        let posts = self.post_repository.get_by_ids(post_ids).await?;
        Ok(posts.into_iter().map(|post| post.text).collect())
    }

    async fn process_trend(&mut self, trend: &mut Trend) -> Result<bool, Error> {
        let posts = self.get_posts_for_trend(&trend.keyword, &trend.post_ids).await?;

        let old_keyword = trend.keyword.clone();

        match self.summarizer.summarize_trend(trend, &posts).await {
            Ok(is_valid) => {
                if !is_valid {
                    info!("Trend '{}' was invalid", trend.keyword);
                    self.trend_repository
                        .add_entity_stats(&old_keyword, "__INVALID__", "", &trend.detected_at)
                        .await?;
                    return Ok(false);
                }

                if let Err(e) = self.trend_repository.save(old_keyword, trend, self.config.trend_window).await {
                    error!("Failed to save trend '{}': {}", trend.keyword, e);
                    return Err(e);
                }

                Ok(true)
            },
            Err(e) => match e {
                SummaryError::Http(e) => {
                    error!("LLM API error for trend '{}': {}", trend.keyword, e);
                    Err(Error::Internal(e))
                },
                SummaryError::Validation(reason) => {
                    info!("Trend '{}' failed validation: {}", trend.keyword, reason);
                    Ok(false)
                },
                SummaryError::Duplicate(_) => {
                    info!("Trend '{}' was a duplicate", trend.keyword);
                    self.trend_repository
                        .add_entity_stats(&old_keyword, &trend.keyword, "true", &trend.detected_at)
                        .await?;
                    Ok(false)
                },
                _ => {
                    error!("Error processing trend '{}': {}", trend.keyword, e);
                    Err(Error::Internal(e.to_string()))
                },
            },
        }
    }

    async fn analyze_trends(&mut self) -> Result<(), Error> {
        info!("Starting trend analysis");

        let mut sum_total = 0;
        let mut sum_valid = 0;

        for offset in (0..(self.config.analysis_retries * self.config.max_trends)).step_by(self.config.max_trends) {
            info!("Analyzing trends with offset: {}", offset);
            let mut trends = self
                .trend_repository
                .detect_trends(
                    self.config.trend_window,
                    self.config.exclude_entity_window,
                    MIN_TREND_POSTS.max(self.config.min_post_count),
                    self.config.max_trends,
                    offset,
                )
                .await?;

            let total = trends.len();
            sum_total += total;
            if total == 0 {
                info!("No trends detected in window");
                break; // becaus all other windows will be empty too
            }
            let mut valid_count = 0;

            for trend in trends.iter_mut() {
                match self.process_trend(trend).await {
                    Ok(true) => valid_count += 1,
                    Ok(false) => continue,
                    Err(e) => {
                        error!("Failed to process trend '{}': {}", trend.keyword, e);
                        continue;
                    },
                }
            }

            sum_valid += valid_count;
            if valid_count == 0 {
                info!("No valid trends detected in window - offset: {}", offset);
                continue;
            }

            info!("Validated {}/{} trends in window - offset: {}", valid_count, total, offset);
        }

        info!("Trend analysis completed. Validated {}/{} trends", sum_valid, sum_total);

        Ok(())
    }

    async fn start(&mut self) -> Result<(), Error> {
        let mut interval = time::interval(self.config.analysis_interval);

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    self.health.lock().report_healthy();
                    if let Err(e) = self.analyze_trends().await {
                        error!("Error during trend analysis: {}", e);
                        self.health.lock().report_error(&e.to_string());
                    }
                }
                _ = tokio::signal::ctrl_c() => {
                    info!("Received shutdown signal");
                    break;
                }
            }
        }

        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt::init();

    let config = ServiceConfig::from_env();
    info!(
        message = "Starting analysis service",
        analysis_interval = ?config.analysis_interval,
        trend_window = ?config.trend_window,
        version = env!("CARGO_PKG_VERSION")
    );

    let mut service = match AnalysisService::new(config).await {
        Ok(service) => service,
        Err(e) => {
            error!("Failed to initialize service: {}", e);
            return Err(e);
        },
    };

    service.start().await
}
