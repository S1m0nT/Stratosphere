import logging
import time
from typing import List, Optional

import spacy
from fastapi import FastAPI, HTTPException
from prometheus_client import Counter, Histogram
from pydantic import BaseModel
from torchgen.static_runtime.generator import is_supported

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Metrics
PROCESSING_TIME = Histogram("ner_processing_seconds", "Time spent processing text")
ENTITIES_EXTRACTED = Counter("ner_entities_total", "Total number of entities extracted")
FAILED_REQUESTS = Counter("ner_failures_total", "Total number of failed requests")

# Initialize FastAPI app
app = FastAPI(
    title="DuplicateDetectionAPI",
    description="Detects semantic duplicates using spaCy embeddings.",
    version="1.0.0",
)

try:
    nlp = spacy.load("en_core_web_md")
    logger.info("Successfully loaded spaCy model")
except Exception as e:
    logger.error(f"Failed to load spaCy model: {e}")
    raise RuntimeError("Failed to initialize NLP model")


class ExistingTrend(BaseModel):
    keyword: str
    summary: Optional[str] = None


class DuplicateCheckRequest(BaseModel):
    new_trend_text: str
    existing_trends: List[ExistingTrend]
    threshold: float = 0.8


class DuplicateCheckResponse(BaseModel):
    is_duplicate: bool
    similarity_score: float
    matched_keyword: Optional[str] = None


@app.get("/healthz")
def health_check():
    if not nlp:
        raise HTTPException(
            status_code=503, detail="Semantic similarity model not loaded"
        )
    return {"status": "OK"}


@app.post("/detect-duplicate", response_model=DuplicateCheckResponse)
def detect_duplicate(payload: DuplicateCheckRequest):
    try:
        with PROCESSING_TIME.time():
            # Process new trend text
            new_doc = nlp(payload.new_trend_text)
            best_score = 0.0
            best_match = None

            # Compare with existing trends
            for trend in payload.existing_trends:
                compare_text = f"{trend.keyword} {trend.summary or ''}"
                try:
                    existing_doc = nlp(compare_text)
                    similarity = new_doc.similarity(existing_doc)

                    if similarity > best_score:
                        best_score = similarity
                        best_match = trend.keyword
                except Exception as e:
                    logger.warning(f"Error comparing with trend '{trend.keyword}': {e}")
                    continue

            is_dup = best_score >= payload.threshold

            return DuplicateCheckResponse(
                is_duplicate=is_dup,
                similarity_score=best_score,
                matched_keyword=best_match if is_dup else None,
            )

    except Exception as e:
        FAILED_REQUESTS.inc()
        logger.error(f"Error processing duplicate detection request: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process duplicate detection request: {str(e)}",
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
