use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;

use chrono::DateTime;
use chrono::Utc;

#[derive(Debug)]
pub struct ServiceHealth {
    healthy: AtomicBool,
    last_check: DateTime<Utc>,
    error_count: AtomicU64,
    last_error: parking_lot::RwLock<Option<String>>,
}

impl ServiceHealth {
    pub fn new() -> Self {
        Self {
            healthy: AtomicBool::new(true),
            last_check: Utc::now(),
            error_count: AtomicU64::new(0),
            last_error: parking_lot::RwLock::new(None),
        }
    }

    pub fn report_healthy(&mut self) {
        self.healthy.store(true, Ordering::Release);
        self.last_check = Utc::now();
    }

    pub fn report_error(&mut self, error: &str) {
        self.healthy.store(false, Ordering::Release);
        self.error_count.fetch_add(1, Ordering::Relaxed);
        *self.last_error.write() = Some(error.to_string());
        self.last_check = Utc::now();
    }

    pub fn is_healthy(&self) -> bool {
        self.healthy.load(Ordering::Acquire)
    }

    pub fn error_count(&self) -> u64 {
        self.error_count.load(Ordering::Relaxed)
    }

    pub fn last_error(&self) -> Option<String> {
        self.last_error.read().clone()
    }

    pub fn last_check(&self) -> DateTime<Utc> {
        self.last_check
    }
}

impl Default for ServiceHealth {
    fn default() -> Self {
        Self::new()
    }
}
