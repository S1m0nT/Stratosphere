use async_trait::async_trait;
use chrono::DateTime;
use chrono::Utc;

use super::ClickhouseClient;
use super::EntityRow;
use super::PostRow;
use crate::Post;
use crate::domain::PostRepository;
use crate::domain::ProcessedPost;
use crate::error::Error;

#[async_trait]
impl PostRepository for ClickhouseClient {
    async fn save_batch(&self, posts: &[ProcessedPost]) -> Result<(), Error> {
        if posts.is_empty() {
            return Ok(());
        }

        let post_rows: Vec<PostRow> = posts
            .iter()
            .map(|p| PostRow {
                id: p.id.clone(),
                text: p.text.clone(),
                author_did: p.author_did.clone(),
                timestamp: p.timestamp.timestamp() as i32,
            })
            .collect();

        let mut entity_rows = Vec::new();
        for post in posts {
            for keyword in &post.keywords {
                entity_rows.push(EntityRow {
                    text: keyword.word.clone(),
                    post_id: post.id.clone(),
                    timestamp: post.timestamp.timestamp() as i32,
                });
            }
        }

        self.insert_batch("posts", &post_rows).await?;

        if !entity_rows.is_empty() {
            self.insert_batch("entities", &entity_rows).await?;
        }

        Ok(())
    }

    async fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Post>, Error> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let query = format!(
            r#"
            SELECT DISTINCT ON (id)
                id,
                text,
                author_did,
                timestamp
            FROM posts
            WHERE id IN ('{}')
            ORDER BY id, timestamp DESC
            "#,
            ids.join("','")
        );

        let rows: Vec<PostRow> = self.client.query(&query).fetch_all().await?;

        Ok(rows
            .into_iter()
            .map(|r| Post {
                id: r.id,
                text: r.text,
                author_did: r.author_did,
                timestamp: DateTime::from_timestamp(r.timestamp as i64, 0).unwrap_or_else(Utc::now),
            })
            .collect())
    }
}
