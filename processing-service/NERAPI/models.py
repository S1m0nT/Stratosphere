from typing import Dict, List, Optional

from pydantic import BaseModel, Field, validator


class Entity(BaseModel):
    """Represents an extracted entity with its metadata."""

    text: str
    label: str
    score: float = Field(ge=0.0, le=2.0)

    @validator("text")
    def clean_text(cls, v: str) -> str:
        """Ensure entity text is properly cleaned."""
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Entity text cannot be empty")
        return cleaned


class TextSource(BaseModel):
    """Source text with optional metadata."""

    text: str
    metadata: dict = Field(default_factory=dict)

    @validator("text")
    def clean_source_text(cls, v: str) -> str:
        """Clean and validate source text."""
        cleaned = " ".join(v.split())
        if not cleaned:
            raise ValueError("Source text cannot be empty")
        if len(cleaned) > 1000:  # Reasonable limit for processing
            raise ValueError("Text too long")
        return cleaned


class ProcessingResult(BaseModel):
    """Result of processing a single text."""

    text: str
    entities: list[Entity]
    metadata: dict = Field(default_factory=dict)


class BatchRequest(BaseModel):
    """Batch processing request."""

    texts: list[TextSource]

    @validator("texts")
    def validate_batch(cls, v: list[TextSource]) -> list[TextSource]:
        """Validate batch size."""
        if not v:
            raise ValueError("Batch cannot be empty")
        if len(v) > 100:  # Reasonable batch size limit
            raise ValueError("Batch size too large")
        return v


class BatchResponse(BaseModel):
    """Response containing all processing results."""

    results: list[ProcessingResult]
