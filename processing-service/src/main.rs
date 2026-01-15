use std::sync::Arc;

use common::Error;
use common::infrastructure::health::ServiceHealth;
use metrics_exporter_prometheus::PrometheusBuilder;
use parking_lot::Mutex;
use tokio::sync::watch;
use tracing::error;
use tracing::info;

mod config;
mod processor;
mod service;

use config::ServiceConfig;
use service::ProcessingService;

async fn setup_metrics() -> Result<(), Error> {
    const METRICS_PORT: u16 = 9101;
    PrometheusBuilder::new()
        .with_http_listener(([0, 0, 0, 0], METRICS_PORT))
        .install()
        .map_err(|e| Error::Internal(e.to_string()))?;
    info!(port = METRICS_PORT, "Metrics server started");
    Ok(())
}

fn setup_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_file(true)
        .with_line_number(true)
        .with_thread_ids(true)
        .with_thread_names(true)
        .init();
}

async fn handle_shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    // Initialize tracing
    setup_tracing();

    // Load configuration
    let config = ServiceConfig::from_env();

    info!(
        message = "Starting processing service",
        batch_size = config.batch_size,
        min_word_length = config.min_word_length,
        max_word_length = config.max_word_length,
        version = env!("CARGO_PKG_VERSION")
    );

    // Setup metrics
    if let Err(e) = setup_metrics().await {
        error!(error = %e, "Failed to setup metrics");
        return Err(e);
    }

    // Create health check state
    let health = Arc::new(Mutex::new(ServiceHealth::new()));

    // Create shutdown channel
    let (shutdown_tx, shutdown_rx) = watch::channel(());

    // Initialize service
    let mut service = match ProcessingService::new(config, health).await {
        Ok(service) => service,
        Err(e) => {
            error!(error = %e, "Failed to initialize service");
            return Err(e);
        },
    };

    // Run the service until shutdown
    tokio::select! {
        result = service.start(shutdown_rx) => {
            if let Err(e) = result {
                error!(error = %e, "Service error");
                return Err(e);
            }
        }
        _ = handle_shutdown_signal() => {
            info!("Received shutdown signal");
            let _ = shutdown_tx.send(());
        }
    }

    info!("Service shutdown completed");
    Ok(())
}
