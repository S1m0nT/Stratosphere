use crate::error::Error;

pub trait Validate {
    fn validate(&self) -> Result<(), Error>;
}

/// Sanitizes text to ensure valid UTF-8 and remove problematic characters
pub fn sanitize_text(text: &str) -> String {
    // Replace invalid UTF-8 sequences with the replacement character
    let cleaned = text
        .chars()
        .filter(|&c| {
            // Filter out control characters except newline and tab
            !c.is_control() || c == '\n' || c == '\t'
        })
        .collect::<String>();

    // Normalize Unicode (NFC form)
    use unicode_normalization::UnicodeNormalization;
    cleaned.nfc().collect::<String>()
}

pub fn sanitize_keyword(text: &str) -> String {
    text.trim()
        .lines()
        .map(|line| line.trim())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|&c| !c.is_control())
        .collect::<String>()
}
