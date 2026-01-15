use clickhouse::Row;
use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Row, Serialize, Deserialize)]
pub struct PostRow {
    pub id: String,
    pub text: String,
    pub author_did: String,
    pub timestamp: i32,
}

#[derive(Debug, Row, Serialize, Deserialize)]
pub struct EntityRow {
    pub text: String,
    pub post_id: String,
    pub timestamp: i32,
}

#[derive(Debug, Row, Serialize, Deserialize)]
pub struct TrendRow {
    pub keyword: String,
    pub post_count: u32,
    pub post_ids: Vec<String>,
    pub summary: String,
    pub detected_at: i32,
    pub tags: Vec<String>,
}

#[derive(Debug, Row, Serialize, Deserialize)]
pub struct EntityStatsRow {
    pub entity: String,
    pub trend_id: String,
    pub duplicate: String,
    pub throttle: u32,
    pub timestamp: i32,
}

pub const SCHEMA_POSTS: &str = r#"
    CREATE TABLE IF NOT EXISTS posts (
        id LowCardinality(String),
        text String,
        author_did LowCardinality(String),
        timestamp Int32,
        INDEX text_idx text TYPE bloom_filter(0.01),
        INDEX author_idx author_did TYPE bloom_filter(0.01)
    )
    ENGINE = ReplacingMergeTree(timestamp)
    PARTITION BY toYYYYMM(fromUnixTimestamp(timestamp))
    ORDER BY (id, timestamp)
    PRIMARY KEY (id)
    SETTINGS index_granularity = 8192"#;

pub const SCHEMA_ENTITIES: &str = r#"
    CREATE TABLE IF NOT EXISTS entities (
        text LowCardinality(String),
        post_id LowCardinality(String),
        timestamp Int32,
        INDEX text_idx text TYPE bloom_filter(0.01)
    )
    ENGINE = ReplacingMergeTree(timestamp)
    PARTITION BY toYYYYMM(fromUnixTimestamp(timestamp))
    ORDER BY (post_id, text, timestamp)
    PRIMARY KEY (post_id, text)
    SETTINGS index_granularity = 8192"#;

pub const SCHEMA_TRENDS: &str = r#"
    CREATE TABLE IF NOT EXISTS trends (
        keyword LowCardinality(String),
        post_count UInt32,
        post_ids Array(String),
        summary String,
        detected_at Int32,
        tags Array(LowCardinality(String)) DEFAULT [],
        INDEX keyword_idx keyword TYPE bloom_filter(0.01),
        INDEX tags_idx tags TYPE bloom_filter(0.01)
    )
    ENGINE = ReplacingMergeTree(detected_at)
    PARTITION BY toYYYYMM(fromUnixTimestamp(detected_at))
    ORDER BY (keyword, detected_at)
    PRIMARY KEY (keyword, detected_at)
    SETTINGS index_granularity = 8192"#;

pub const SCHEMA_ENTITIES_STATS: &str = r#"
    CREATE TABLE IF NOT EXISTS entities_stats (
        entity LowCardinality(String),
        trend_id LowCardinality(String),
        duplicate LowCardinality(String),
        throttle UInt32,
        timestamp Int32,
        INDEX entity_idx entity TYPE bloom_filter(0.01)
    )
    ENGINE = ReplacingMergeTree(timestamp)
    PARTITION BY toYYYYMM(fromUnixTimestamp(timestamp))
    ORDER BY (entity, trend_id, timestamp)
    PRIMARY KEY (entity, trend_id)
    SETTINGS index_granularity = 8192"#;
