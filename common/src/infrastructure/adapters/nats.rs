use async_nats::jetstream::Context;
use serde::Serialize;

pub struct NatsPublisher {
    context: Context,
}

impl NatsPublisher {
    pub fn new(context: Context) -> Self {
        Self { context }
    }

    pub async fn publish<T: Serialize>(&self, subject: String, data: &T) -> Result<(), crate::error::Error> {
        let payload = serde_json::to_vec(data)?;
        self.context
            .publish(subject, payload.into())
            .await
            .map_err(|e| crate::error::Error::MessageBroker(e.to_string()))?;
        Ok(())
    }
}
