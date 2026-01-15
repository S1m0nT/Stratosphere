use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;

#[derive(Debug, Default)]
pub struct ServiceMetrics {
    pub messages_received: AtomicU64,
    pub messages_processed: AtomicU64,
    pub processing_errors: AtomicU64,
    pub processing_time_ms: AtomicU64,
    pub batch_size: AtomicU64,
    pub batch_processing_time_ms: AtomicU64,
}

impl ServiceMetrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_message_received(&self) {
        self.messages_received.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_message_processed(&self) {
        self.messages_processed.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_processing_error(&self) {
        self.processing_errors.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_processing_time(&self, ms: u64) {
        self.processing_time_ms.fetch_add(ms, Ordering::Relaxed);
    }

    pub fn record_batch(&self, size: u64, time_ms: u64) {
        self.batch_size.store(size, Ordering::Relaxed);
        self.batch_processing_time_ms.store(time_ms, Ordering::Relaxed);
    }
}
