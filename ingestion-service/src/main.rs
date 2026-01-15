mod config;
mod service;

use std::sync::Arc;

use common::error::Error;
use common::infrastructure::health::ServiceHealth;
use metrics_exporter_prometheus::PrometheusBuilder;
use parking_lot::Mutex;
use tokio::sync::watch;
use tracing::error;
use tracing::info;

use crate::config::ServiceConfig;
use crate::service::IngestionService;

#[tokio::main]
async fn main() -> Result<(), Error> {
    setup_tracing();
    setup_metrics()?;

    let config = ServiceConfig::from_env();
    info!(message = "Starting ingestion service", ?config, version = env!("CARGO_PKG_VERSION"));

    if let Err(e) = config.validate() {
        error!(error = %e, "Invalid configuration");
        return Err(Error::Config(e));
    }

    let health = Arc::new(Mutex::new(ServiceHealth::new()));
    let (shutdown_tx, shutdown_rx) = watch::channel(());
    let mut service = IngestionService::new(config, health).await?;

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

fn setup_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_file(true)
        .with_line_number(true)
        .with_thread_ids(true)
        .with_thread_names(true)
        .init();
}

fn setup_metrics() -> Result<(), Error> {
    const METRICS_PORT: u16 = 9100;

    PrometheusBuilder::new()
        .with_http_listener(([0, 0, 0, 0], METRICS_PORT))
        .install()
        .map_err(|e| Error::Internal(e.to_string()))?;

    info!(port = METRICS_PORT, "Metrics server started");
    Ok(())
}

async fn handle_shutdown_signal() {
    tokio::signal::ctrl_c().await.expect("Failed to listen for ctrl-c signal");
}
