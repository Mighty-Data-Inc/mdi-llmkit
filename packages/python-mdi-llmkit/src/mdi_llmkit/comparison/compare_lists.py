"""Semantic list comparison API (scaffold only).

This module currently defines the public data contracts for list comparison, but
does not yet implement runtime behavior.
"""

from enum import Enum
from typing import NotRequired, Protocol, TypedDict, TypeAlias

from mdi_llmkit.gpt_api.functions import OpenAIClientLike


class ComparableNamedItem(TypedDict):
    """Object-form list item used for semantic comparison.

    Fields:
        name:
            Canonical display/comparison name for the item.
        description:
            Optional extra context for model reasoning. This field is not intended
            to be a unique identifier.
    """

    name: str
    description: NotRequired[str]


SemanticallyComparableListItem: TypeAlias = str | ComparableNamedItem
"""Accepted list item input type.

- ``str``: the string itself is treated as the item name.
- ``ComparableNamedItem``: the ``name`` field is the comparable value and
    ``description`` is optional context.
"""


class ItemComparisonResult(str, Enum):
    """Classification labels used in progress callbacks and final output."""

    REMOVED = "removed"
    ADDED = "added"
    RENAMED = "renamed"
    UNCHANGED = "unchanged"


class OnComparingItemCallback(Protocol):
    """Progress callback signature for per-item comparison lifecycle events.

    The callback is expected to be invoked twice per item:
    1. Start event (``is_starting=True``)
    2. Finish event (``is_starting=False``)

    Parameters:
        item:
            The concrete item currently being evaluated.
        is_from_before_list:
            ``True`` when ``item`` originated from ``list_before``;
            ``False`` when from ``list_after``.
        is_starting:
            ``True`` when evaluation is beginning for this item,
            ``False`` when evaluation has completed for this item.
        result:
            Current/final classification for this event.
        new_name:
            Renamed target when ``result`` is ``ItemComparisonResult.RENAMED``;
            otherwise ``None``.
        error:
            Optional warning/error message associated with this event; otherwise
            ``None``.
        total_processed_so_far:
            Number of items that have fully completed processing.
        total_left_to_process:
            Number of items still remaining after this event.
    """

    def __call__(
        self,
        item: SemanticallyComparableListItem,
        is_from_before_list: bool,
        is_starting: bool,
        result: ItemComparisonResult,
        new_name: str | None,
        error: str | None,
        total_processed_so_far: int,
        total_left_to_process: int,
    ) -> None: ...


class StringListComparison(TypedDict):
    """Final comparison output.

    Fields:
        removed:
            Item names found only in ``list_before``.
        added:
            Item names found only in ``list_after``.
        renamed:
            Mapping of ``old_name -> new_name``.
        unchanged:
            Item names considered equivalent across both lists.
    """

    removed: list[str]
    added: list[str]
    renamed: dict[str, str]
    unchanged: list[str]


def compare_item_lists(
    openai_client: OpenAIClientLike,
    list_before: list[SemanticallyComparableListItem],
    list_after: list[SemanticallyComparableListItem],
    explanation: str | None = None,
    on_comparing_item: OnComparingItemCallback | None = None,
) -> StringListComparison:
    """Compare two semantically comparable lists.

    Args:
        openai_client:
            OpenAI-compatible client used by the eventual implementation.
        list_before:
            Snapshot of items in the "before" state.
        list_after:
            Snapshot of items in the "after" state.
        explanation:
            Optional domain context that may help with semantic decisions.
        on_comparing_item:
            Optional callback that receives start/finish progress events for each
            item being evaluated.

    Returns:
        ``StringListComparison`` containing ``removed``, ``added``, ``renamed``,
        and ``unchanged`` buckets.

    Note:
        This scaffold currently defines signatures only and raises
        ``NotImplementedError``.
    """
    raise NotImplementedError("compare_item_lists is not implemented yet.")
