use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum BlueskyEvent {
    #[serde(rename = "commit")]
    Commit { did: String, time_us: i64, commit: CommitData },
    #[serde(rename = "identity")]
    Identity { did: String, time_us: i64, identity: IdentityData },
    #[serde(rename = "account")]
    Account { did: String, time_us: i64, account: AccountData },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CommitData {
    pub rev: String,
    pub operation: String,
    pub collection: String,
    pub rkey: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IdentityData {
    pub did: String,
    pub handle: String,
    pub seq: i64,
    pub time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AccountData {
    pub did: String,
    pub active: bool,
    pub seq: i64,
    pub time: String,
}
