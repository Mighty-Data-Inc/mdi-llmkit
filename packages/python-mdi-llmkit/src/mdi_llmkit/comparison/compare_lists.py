"""Semantic list comparison utilities backed by LLM-guided decisions."""

from functools import cmp_to_key
from enum import Enum
import json
from typing import Literal, NotRequired, Protocol, TypedDict, TypeAlias

from mdi_llmkit.gpt_api.functions import OpenAIClientLike
from mdi_llmkit.gpt_api.gpt_conversation import GptConversation
from mdi_llmkit.gpt_api.json_schema_format import JSONSchemaFormat


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


def _get_item_name(item: SemanticallyComparableListItem) -> str:
    if isinstance(item, str):
        return item
    return item["name"]


def _assert_unique_names_in_list(
    list_to_check: list[SemanticallyComparableListItem],
    list_name: Literal["before", "after"],
) -> None:
    seen_names: set[str] = set()
    duplicate_names: set[str] = set()

    for item in list_to_check:
        name = _get_item_name(item).strip().lower()
        if name in seen_names:
            duplicate_names.add(name)
        else:
            seen_names.add(name)

    if len(duplicate_names) > 0:
        raise ValueError(
            f"compareItemLists: Duplicate item names found in {list_name} list (case-insensitive): "
            + ", ".join(json.dumps(name) for name in sorted(duplicate_names))
        )


def _item_to_prompt_string(item: SemanticallyComparableListItem) -> str:
    if isinstance(item, str):
        return f"- {json.dumps(item)}"
    s = f"- {json.dumps(item['name'])}"
    description = item.get("description")
    if description and description.strip().lower() != item["name"].strip().lower():
        s += f" (details: {json.dumps(description)})"
    return s


def _compare_items_by_name(
    a: SemanticallyComparableListItem,
    b: SemanticallyComparableListItem,
) -> int:
    name_a = _get_item_name(a).lower()
    name_b = _get_item_name(b).lower()
    if name_a < name_b:
        return -1
    if name_a > name_b:
        return 1
    return 0


def _are_names_equivalent(a: str, b: str) -> bool:
    a = a.strip().lower()
    b = b.strip().lower()
    if a == b or a == json.dumps(b) or json.dumps(a) == b:
        return True
    return False


def _remove_items_by_name(
    list_to_modify: list[SemanticallyComparableListItem],
    item_name_to_remove: str,
) -> list[SemanticallyComparableListItem]:
    item_name_to_remove = item_name_to_remove.strip().lower()
    return [
        item
        for item in list_to_modify
        if not _are_names_equivalent(
            _get_item_name(item).strip().lower(), item_name_to_remove
        )
    ]


def compare_item_lists(
    openai_client: OpenAIClientLike,
    list_before: list[SemanticallyComparableListItem],
    list_after: list[SemanticallyComparableListItem],
    explanation: str | None = None,
    on_comparing_item: OnComparingItemCallback | None = None,
) -> StringListComparison:
    """Compare two semantically comparable lists and classify changed items."""
    list_before = json.loads(json.dumps(list_before))
    list_after = json.loads(json.dumps(list_after))

    retval: StringListComparison = {
        "removed": [],
        "added": [],
        "renamed": {},
        "unchanged": [],
    }

    _assert_unique_names_in_list(list_before, "before")
    _assert_unique_names_in_list(list_after, "after")
    list_before.sort(key=cmp_to_key(_compare_items_by_name))
    list_after.sort(key=cmp_to_key(_compare_items_by_name))

    set_strings_before = {_get_item_name(item) for item in list_before}
    set_strings_after = {_get_item_name(item) for item in list_after}

    set_strings_common: set[str] = set()
    for str_before in set_strings_before:
        for str_after in set_strings_after:
            if str_before.lower() == str_after.lower():
                set_strings_common.add(str_before)
                break

    retval["unchanged"] = sorted(set_strings_common)

    for str_common in set_strings_common:
        list_before = _remove_items_by_name(list_before, str_common)
        list_after = _remove_items_by_name(list_after, str_common)

    convo = GptConversation([], openai_client=openai_client)
    convo.add_system_message(
        """
You are a data analyst who has been hired to try to preserve the integrity of a list of
data items that have recently undergone migration from one data system to another.

You will be given two lists of items: a "before" list and an "after" list.
(The exact nature of the items is not important. They could be names of products from
receipts or purchase orders, for example.)

In the migration from the old data system to the new, some items may have been removed,
some items may have been added, and some items may have been renamed. We can't tell
just by performing string comparisons on the two lists, because the renames may be subtle.

We're going to go through the items in the "before" list, one by one. For each one,
you will look for the best matching item in the "after" list. If you find a good match,
you will consider that item to be a rename of the original item. If you don't find a
good match, you will consider that item to have been removed.
"""
    )

    if explanation:
        convo.add_system_message(
            f"""
Here is some additional context that may help you make better decisions about which items
have been renamed versus removed/added:

{explanation}
"""
        )

    convo.add_user_message(
        f"""
"BEFORE" LIST:

{'\n'.join(_item_to_prompt_string(item) for item in list_before)}
"""
    )

    total_processed_items = 0

    for i_item, item_before in enumerate(list_before):
        if on_comparing_item:
            on_comparing_item(
                item_before,
                True,
                True,
                ItemComparisonResult.UNCHANGED,
                None,
                None,
                total_processed_items,
                len(list_before) - i_item + len(list_after),
            )

        try:
            convo_iter = convo.clone()
            convo_iter.add_user_message(
                f"""
"AFTER" LIST:

{'\n'.join(_item_to_prompt_string(item) for item in list_after)}
"""
            )

            convo_iter.add_user_message(
                f"""
For the moment, let's focus on this item from the "before" list:

{_item_to_prompt_string(item_before)}

Look through the entire "after" list and try to find an item that might be a rename 
or alternative version of this item.

Feel free to think aloud, brainstorm, and reason through the possibilities. Later on,
I'll ask you to formalize your decision in JSON format; but for now, just explore the options.

If you find an item that seems like a good match, tell us what it is.
!IMPORTANT: You may only pick *one* item from the "after" list as a potential rename of this item.

If you don't find any good match, simply say that no good match was found. In this situation,
we'll consider this item as having been removed/deleted.

Naturally, if you have any higher-level instructions or context that apply to this item,
please take them into account as you reason through the possibilities.
"""
            )
            convo_iter.submit()

            convo_iter.submit(
                json_response=JSONSchemaFormat(
                    {
                        "is_renamed": (
                            bool,
                            'Whether the item from the "before" list has been renamed in the "after" list.',
                        ),
                        "new_name": (
                            str,
                            'The new name of the item in the "after" list, if it has been renamed. '
                            + "This needs to be an *exact character-for-character match* of the name of "
                            + 'exactly *one* item in the "after" list, written *exactly* as it appears '
                            + 'in the "after" list. If the item was not renamed, this should be an empty string.',
                        ),
                        "is_deleted": (
                            bool,
                            'Whether the item from the "before" list has been deleted/removed in the '
                            + '"after" list. Presumably, if is_renamed is true, this should be false, '
                            + "and vice versa.",
                        ),
                    },
                    name="list_comparison_item_rename_exploration",
                )
            )

            is_item_deleted = convo_iter.get_last_reply_dict_field("is_deleted")
            is_item_renamed = convo_iter.get_last_reply_dict_field("is_renamed")

            if not is_item_deleted and not is_item_renamed:
                warning_message = (
                    "LLM indicated item is neither renamed nor deleted, which should not happen. "
                    + f"Marking as unchanged: {_get_item_name(item_before)}"
                )
                retval["unchanged"].append(_get_item_name(item_before))
                total_processed_items += 1
                if on_comparing_item:
                    on_comparing_item(
                        item_before,
                        True,
                        False,
                        ItemComparisonResult.UNCHANGED,
                        None,
                        warning_message,
                        total_processed_items,
                        len(list_before) - (i_item + 1) + len(list_after),
                    )
                continue

            if is_item_deleted:
                retval["removed"].append(_get_item_name(item_before))
                total_processed_items += 1
                if on_comparing_item:
                    on_comparing_item(
                        item_before,
                        True,
                        False,
                        ItemComparisonResult.REMOVED,
                        None,
                        None,
                        total_processed_items,
                        len(list_before) - (i_item + 1) + len(list_after),
                    )
                continue

            if is_item_renamed:
                new_name_according_to_llm = (
                    f"{convo_iter.get_last_reply_dict_field('new_name', '')}"
                ).strip()

                if not new_name_according_to_llm:
                    warning_message = (
                        "LLM indicated item was renamed but did not provide a new name. "
                        + f"Skipping rename for item: {_get_item_name(item_before)}"
                    )
                    retval["unchanged"].append(_get_item_name(item_before))
                    total_processed_items += 1
                    if on_comparing_item:
                        on_comparing_item(
                            item_before,
                            True,
                            False,
                            ItemComparisonResult.UNCHANGED,
                            None,
                            warning_message,
                            total_processed_items,
                            len(list_before) - (i_item + 1) + len(list_after),
                        )
                    continue

                name_of_matched_item: str | None = None
                for item_after in list_after:
                    name_after = _get_item_name(item_after)
                    if _are_names_equivalent(name_after, new_name_according_to_llm):
                        name_of_matched_item = name_after
                        break

                if not name_of_matched_item:
                    warning_message = (
                        f'LLM indicated item was renamed to "{new_name_according_to_llm}", '
                        + 'but no matching item was found in the "after" list. '
                        + f"Skipping rename for item: {_get_item_name(item_before)}"
                    )
                    retval["unchanged"].append(_get_item_name(item_before))
                    total_processed_items += 1
                    if on_comparing_item:
                        on_comparing_item(
                            item_before,
                            True,
                            False,
                            ItemComparisonResult.UNCHANGED,
                            None,
                            warning_message,
                            total_processed_items,
                            len(list_before) - (i_item + 1) + len(list_after),
                        )
                    continue

                retval["renamed"][_get_item_name(item_before)] = name_of_matched_item
                list_after = _remove_items_by_name(list_after, name_of_matched_item)
                total_processed_items += 1
                if on_comparing_item:
                    on_comparing_item(
                        item_before,
                        True,
                        False,
                        ItemComparisonResult.RENAMED,
                        name_of_matched_item,
                        None,
                        total_processed_items,
                        len(list_before) - (i_item + 1) + len(list_after),
                    )
        except Exception:
            warning_message = (
                f'LLM processing failed for "before" item {json.dumps(_get_item_name(item_before))}; '
                + "marking as unchanged."
            )
            retval["unchanged"].append(_get_item_name(item_before))
            total_processed_items += 1
            if on_comparing_item:
                on_comparing_item(
                    item_before,
                    True,
                    False,
                    ItemComparisonResult.UNCHANGED,
                    None,
                    warning_message,
                    total_processed_items,
                    len(list_before) - (i_item + 1) + len(list_after),
                )
            continue

    for i_item, item_after in enumerate(list_after):
        if on_comparing_item:
            on_comparing_item(
                item_after,
                False,
                True,
                ItemComparisonResult.UNCHANGED,
                None,
                None,
                total_processed_items,
                len(list_after) - i_item,
            )

        try:
            convo_iter = convo.clone()
            convo_iter.add_user_message(
                f"""
At the moment, let's focus on this item from the "after" list:

{_item_to_prompt_string(item_after)}

We think that this item was newly added, because we can't find any matching item
from the "before" list. However, it's possible that we have instructions or context
that indicate otherwise.

At this point, we don't have the option of matching this item to any item from the "before"
list, since we've already processed all those items. However, we still have the option
of rejecting this item from addition -- in which case, it will be considered as not having
been added at all (or, in other words, it will be ignored in downstream processing).

What do you think? Should we consider this item as truly added, or should we reject / ignore
this item?
"""
            )
            convo_iter.submit()

            convo_iter.submit(
                json_response=JSONSchemaFormat(
                    {
                        "is_added": (
                            bool,
                            'Whether this item from the "after" list should be considered as truly added. '
                            + "If false, the item will be ignored in downstream processing.",
                        )
                    },
                    name="list_comparison_item_addition_decision",
                )
            )

            is_item_added = convo_iter.get_last_reply_dict_field("is_added")
            if is_item_added:
                retval["added"].append(_get_item_name(item_after))
                total_processed_items += 1
                if on_comparing_item:
                    on_comparing_item(
                        item_after,
                        False,
                        False,
                        ItemComparisonResult.ADDED,
                        None,
                        None,
                        total_processed_items,
                        len(list_after) - (i_item + 1),
                    )
                continue

            total_processed_items += 1
            if on_comparing_item:
                on_comparing_item(
                    item_after,
                    False,
                    False,
                    ItemComparisonResult.UNCHANGED,
                    None,
                    None,
                    total_processed_items,
                    len(list_after) - (i_item + 1),
                )
        except Exception:
            warning_message = (
                f'LLM processing failed for "after" item {json.dumps(_get_item_name(item_after))}; '
                + "skipping add classification for this item."
            )
            total_processed_items += 1
            if on_comparing_item:
                on_comparing_item(
                    item_after,
                    False,
                    False,
                    ItemComparisonResult.UNCHANGED,
                    None,
                    warning_message,
                    total_processed_items,
                    len(list_after) - (i_item + 1),
                )
            continue

    return {
        "removed": sorted(set(retval["removed"])),
        "added": sorted(set(retval["added"])),
        "renamed": retval["renamed"],
        "unchanged": sorted(set(retval["unchanged"])),
    }
