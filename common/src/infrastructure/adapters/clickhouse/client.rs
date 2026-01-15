use clickhouse::Client;
use serde::Serialize;
use tracing::error;
use tracing::info;

use super::types::SCHEMA_ENTITIES;
use super::types::SCHEMA_ENTITIES_STATS;
use super::types::SCHEMA_POSTS;
use super::types::SCHEMA_TRENDS;
use crate::error::Error;

pub struct ClickhouseClient {
    pub client: Client,
}

impl ClickhouseClient {
    pub fn new(url: &str) -> Self {
        let client = Client::default()
            .with_url(url)
            .with_option("async_insert", "1")
            .with_option("wait_for_async_insert", "0")
            .with_option("cancel_http_readonly_queries_on_client_close", "1");

        Self { client }
    }

    pub async fn init_database(&self) -> Result<(), Error> {
        info!("Initializing ClickHouse database tables");
        let schemas = [
            ("posts", SCHEMA_POSTS),
            ("entities", SCHEMA_ENTITIES),
            ("trends", SCHEMA_TRENDS),
            ("entity_stats", SCHEMA_ENTITIES_STATS),
        ];

        for (table_name, schema) in schemas {
            match self.client.query(schema).execute().await {
                Ok(_) => {
                    info!("Table '{}' initialized successfully", table_name);
                },
                Err(e) => {
                    error!("Failed to initialize table '{}': {}", table_name, e);
                    return Err(Error::Database(e));
                },
            }
        }

        // Ensure the tags column exists in the trends table for backward compatibility
        // This is safe to run multiple times as it only adds the column if it doesn't exist
        let alter_trends_table =
            "ALTER TABLE trends ADD COLUMN IF NOT EXISTS tags Array(LowCardinality(String)) DEFAULT []";
        match self.client.query(alter_trends_table).execute().await {
            Ok(_) => {
                info!("Ensured 'tags' column exists in trends table");
            },
            Err(e) => {
                error!("Failed to ensure 'tags' column in trends table: {}", e);
                // Don't fail initialization if this fails - the table may be created correctly by the CREATE TABLE statement
                info!("Continuing with initialization despite ALTER TABLE issue");
            },
        }

        // Add index for tags column if it doesn't exist
        // Note: ClickHouse doesn't have a direct "IF NOT EXISTS" for indexes, so we'll handle errors gracefully
        let add_tags_index = "ALTER TABLE trends ADD INDEX IF NOT EXISTS tags_idx tags TYPE bloom_filter(0.01)";
        match self.client.query(add_tags_index).execute().await {
            Ok(_) => {
                info!("Ensured 'tags_idx' index exists in trends table");
            },
            Err(e) => {
                error!("Failed to ensure 'tags_idx' index in trends table: {}", e);
                // Don't fail initialization if this fails - the index may already exist
                info!("Continuing with initialization despite index issue");
            },
        }

        Ok(())
    }

    pub async fn insert_batch<T>(&self, table: &str, rows: &[T]) -> Result<(), Error>
    where
        T: clickhouse::Row + Serialize,
    {
        if rows.is_empty() {
            return Ok(());
        }

        let mut insert = self.client.insert(table)?;
        for row in rows {
            insert.write(row).await?;
        }
        insert.end().await?;
        Ok(())
    }
}
