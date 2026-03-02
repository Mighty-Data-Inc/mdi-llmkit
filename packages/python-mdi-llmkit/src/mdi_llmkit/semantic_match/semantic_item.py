"""Shared item primitives and helpers for semantic list comparison.

This module focuses on item-level behavior:

- ``SemanticItem`` defines the accepted item shape (``str`` or
  ``{"name", "description"?}``).
- ``get_item_name`` normalizes an item to its comparable name.
- ``get_item_description`` returns a non-redundant optional description.
- ``item_to_prompt_string`` formats an item for prompt text.
- ``compare_items`` provides case-insensitive ordering by item content.
- ``are_items_equal`` checks comparator-based equality.
- ``remove_item_from_list`` removes all equivalent items from a list.
"""

from __future__ import annotations

import json
from typing import NotRequired, TypeAlias, TypedDict


class ComparableNamedItem(TypedDict):
    """Object-form list item used for semantic comparison."""

    name: str
    description: NotRequired[str]


SemanticItem: TypeAlias = str | ComparableNamedItem
"""Accepted item input type for semantic comparison utilities."""


def get_item_name(item: SemanticItem) -> str:
    """Return the comparable name for an item."""
    if isinstance(item, str):
        return item
    return item["name"]


def get_item_description(item: SemanticItem) -> str | None:
    """Return a non-redundant description for an item.

    Returns ``None`` when the item is a string, has no description,
    or when the description is equivalent to the name after trimming and
    case normalization.
    """
    if isinstance(item, str):
        return None

    description = item.get("description")
    if not description:
        return None

    if description.strip().lower() == item["name"].strip().lower():
        return None

    return description


def item_to_prompt_string(item: SemanticItem) -> str:
    """Format an item for prompt inclusion.

    The output begins with ``- `` and JSON-quoted name text, with optional
    ``(details: ...)`` when a non-redundant description is present.
    """
    prompt_item = f"- {json.dumps(get_item_name(item))}"
    description = get_item_description(item)
    if description:
        prompt_item += f" (details: {json.dumps(description)})"
    return prompt_item


def compare_items(a: SemanticItem, b: SemanticItem) -> int:
    """Comparator for semantic items.

    Comparison order:
    1) Names, case-insensitive after trimming.
    2) If names tie and both items have non-redundant descriptions,
       compare descriptions case-insensitively after trimming.
    """
    name_a = get_item_name(a).strip().lower()
    name_b = get_item_name(b).strip().lower()
    if name_a < name_b:
        return -1
    if name_a > name_b:
        return 1

    description_a = (get_item_description(a) or "").strip().lower()
    description_b = (get_item_description(b) or "").strip().lower()

    if not description_a or not description_b:
        return 0

    if description_a < description_b:
        return -1
    if description_a > description_b:
        return 1
    return 0


def are_items_equal(a: SemanticItem, b: SemanticItem) -> bool:
    """Return whether two items are equal under ``compare_items`` semantics."""
    return compare_items(a, b) == 0


def remove_item_from_list(
    item_list: list[SemanticItem],
    item_to_remove: SemanticItem,
) -> list[SemanticItem]:
    """Return a new list with all equivalent items removed."""
    return [item for item in item_list if not are_items_equal(item, item_to_remove)]
