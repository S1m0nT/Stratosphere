import logging
import re
from typing import List, Set

import spacy
from fastapi import FastAPI, HTTPException
from models import BatchRequest, BatchResponse, Entity, ProcessingResult
from prometheus_client import Counter, Histogram

logger = logging.getLogger(__name__)

PROCESSING_TIME = Histogram("ner_processing_seconds", "Time spent processing text")
ENTITIES_EXTRACTED = Counter("ner_entities_total", "Total number of entities extracted")
FAILED_REQUESTS = Counter("ner_failures_total", "Total number of failed requests")


class NERProcessor:
    def __init__(self):
        self.model = spacy.load("en_tako_query_analyzer")
        self.hashtag_pattern = re.compile(r"#[\w\d]+")
        self.url_pattern = re.compile(r"https?://\S+")
        self.mention_pattern = re.compile(r"@[\w\d]+")

        # Entity scoring weights
        self.weights = {
            "PERSON": 1.2,
            "ORG": 1.1,
            "PRODUCT": 1.0,
            "EVENT": 1.0,
            "HASHTAG": 1.3,
        }

        # Common false positive parts to remove
        self.false_positive_suffixes = [". #", ", #", " #"]

    def clean_text(self, text: str) -> str:
        """Clean and normalize text for processing."""
        # Remove URLs
        text = self.url_pattern.sub("", text)

        # Preserve hashtags by adding spaces before #
        text = re.sub(r"([^#])#", r"\1 #", text)

        # Normalize whitespace
        text = " ".join(text.split())

        # Remove mentions
        text = self.mention_pattern.sub("", text)

        return text.strip()

    def extract_hashtags(self, text: str) -> list[Entity]:
        """Extract and validate hashtags."""
        hashtags = []
        for match in self.hashtag_pattern.finditer(text):
            tag = match.group()
            # Only process hashtags that are properly formatted
            if len(tag) > 2 and not any(char.isspace() for char in tag):
                # Remove the # for processing
                clean_tag = tag[1:]
                # Don't include pure numbers or very short tags
                if not clean_tag.isdigit() and len(clean_tag) >= 3:
                    hashtags.append(
                        Entity(text=tag, label="HASHTAG", score=self.weights["HASHTAG"])
                    )
        return hashtags

    def is_valid_entity(self, text: str, label: str) -> bool:
        """Validate entity quality with improved checks."""
        # Remove any trailing punctuation or spaces
        text = text.strip().rstrip(".").rstrip(",").strip()

        # Basic validation
        if len(text) < 2:
            return False

        # Check for false positive suffixes
        if any(text.endswith(suffix) for suffix in self.false_positive_suffixes):
            return False

        # Label-specific validation
        if label == "PERSON":
            # Require capitalization for names
            if not text[0].isupper():
                return False

        elif label == "ORG":
            # Organizations should have proper capitalization
            if not any(c.isupper() for c in text):
                return False
            # Check for hashtag contamination
            if "#" in text:
                return False

        elif label == "PRODUCT":
            # Products should have some substance
            if len(text) < 3:
                return False
            # Avoid hashtag contamination
            if "#" in text:
                return False

        return True

    def extract_entities(self, text: str) -> list[Entity]:
        """Extract and validate named entities with improved processing."""
        cleaned_text = self.clean_text(text)
        if not cleaned_text:
            return []

        doc = self.model(cleaned_text)
        entities = []
        seen_texts = set()

        # First extract named entities
        for ent in doc.ents:
            if ent.label_ in self.weights and self.is_valid_entity(
                ent.text, ent.label_
            ):
                clean_text = ent.text.strip()
                if clean_text.lower() not in seen_texts:
                    entities.append(
                        Entity(
                            text=clean_text,
                            label=ent.label_,
                            score=self.weights[ent.label_],
                        )
                    )
                    seen_texts.add(clean_text.lower())

        # Then extract hashtags
        hashtags = self.extract_hashtags(text)
        for hashtag in hashtags:
            if hashtag.text.lower() not in seen_texts:
                entities.append(hashtag)
                seen_texts.add(hashtag.text.lower())

        return entities


app = FastAPI(title="NER Service")
processor = NERProcessor()


@app.post("/process", response_model=BatchResponse)
async def process_batch(request: BatchRequest) -> BatchResponse:
    try:
        with PROCESSING_TIME.time():
            results = []
            for source in request.texts:
                entities = processor.extract_entities(source.text)
                ENTITIES_EXTRACTED.inc(len(entities))
                results.append(
                    ProcessingResult(
                        text=source.text, entities=entities, metadata=source.metadata
                    )
                )
            return BatchResponse(results=results)
    except Exception as e:
        FAILED_REQUESTS.inc()
        logger.error(f"Processing failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/healthz")
async def health_check() -> dict:
    if not processor.model:
        raise HTTPException(status_code=503, detail="NER model not loaded")
    return {"status": "healthy"}
