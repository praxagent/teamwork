"""Text processing utilities shared across services."""

import json
import logging
from typing import Any, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


def strip_markdown_json(text: str) -> str:
    """
    Strip markdown code block wrappers from JSON responses.
    
    Handles formats like:
    - ```json\n{...}\n```
    - ```\n{...}\n```
    - Just the raw JSON
    """
    text = text.strip()
    
    # Remove opening code fence with optional language tag
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1:]
        else:
            text = text[3:]  # Just remove ```
    
    # Remove closing code fence
    if text.endswith("```"):
        text = text[:-3]
    
    return text.strip()


def parse_json_or_default(text: str, default: T, context: str = "") -> T | Any:
    """
    Parse JSON from text, returning a default value on failure.
    
    Args:
        text: The text to parse as JSON
        default: Default value to return if parsing fails
        context: Optional context string for logging
    
    Returns:
        Parsed JSON or the default value
    """
    try:
        return json.loads(strip_markdown_json(text))
    except json.JSONDecodeError as e:
        log_context = f" ({context})" if context else ""
        logger.warning(f"JSON parse error{log_context}: {e}")
        return default


def truncate_text(text: str, max_length: int = 100, suffix: str = "...") -> str:
    """Truncate text to a maximum length with a suffix."""
    if len(text) <= max_length:
        return text
    return text[:max_length - len(suffix)] + suffix
