"""Semantic comparison for before/after item lists."""

from __future__ import annotations

from enum import Enum
from typing import NotRequired, TypedDict

from mdi_llmkit.gpt_api.functions import OpenAIClientLike

from .find import find_semantic_match
from .semantic_item import SemanticItem, are_items_equal, get_item_name


class ItemComparisonClassification(str, Enum):
    """Final classification of an item during comparison."""

    REMOVED = "removed"
    ADDED = "added"
    RENAMED = "renamed"
    UNCHANGED = "unchanged"


class ItemComparisonResult(TypedDict):
    """Comparison output record for one item."""

    item: SemanticItem
    classification: ItemComparisonClassification
    new_name: NotRequired[str | None]


def compare_item_lists(
    openai_client: OpenAIClientLike,
    list_before: list[SemanticItem],
    list_after: list[SemanticItem],
    explanation: str | None = None,
) -> list[ItemComparisonResult]:
    """Compare list versions and classify items as removed/renamed/unchanged/added."""
    list_after = list(list_after)
    result: list[ItemComparisonResult] = []

    for item_before in list_before:
        index_matched_in_after = find_semantic_match(
            openai_client,
            list_after,
            item_before,
            explanation,
        )

        if index_matched_in_after == -1:
            result.append(
                {
                    "item": item_before,
                    "classification": ItemComparisonClassification.REMOVED,
                    "new_name": None,
                }
            )
            continue

        item_after = list_after[index_matched_in_after]
        if are_items_equal(item_before, item_after):
            result.append(
                {
                    "item": item_before,
                    "classification": ItemComparisonClassification.UNCHANGED,
                    "new_name": None,
                }
            )
        else:
            result.append(
                {
                    "item": item_before,
                    "classification": ItemComparisonClassification.RENAMED,
                    "new_name": get_item_name(item_after),
                }
            )

        del list_after[index_matched_in_after]

    for item_after in list_after:
        result.append(
            {
                "item": item_after,
                "classification": ItemComparisonClassification.ADDED,
                "new_name": None,
            }
        )

    return result
