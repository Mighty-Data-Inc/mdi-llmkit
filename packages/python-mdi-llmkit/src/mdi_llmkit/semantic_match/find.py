"""Semantic match finder for migration-style item lists.

This module provides a helper that determines whether a test item is already
present in an existing list, even when names are different.
"""

from mdi_llmkit.gpt_api.functions import OpenAIClientLike
from mdi_llmkit.gpt_api.gpt_conversation import GptConversation
from mdi_llmkit.gpt_api.json_schema_format import JSONSchemaFormat

from .semantic_item import SemanticItem, are_items_equal, item_to_prompt_string


def find_semantic_match(
    openai_client: OpenAIClientLike,
    item_list: list[SemanticItem],
    item_to_find: SemanticItem,
    explanation: str | None = None,
) -> int:
    """Find the index of the best semantic match for ``item_to_find``.

    Returns the index of the first matching item from ``item_list`` or ``-1``
    when no good match is found.
    """
    for index, item in enumerate(item_list):
        if are_items_equal(item, item_to_find):
            return index

    convo = GptConversation([], openai_client=openai_client)
    convo.add_system_message(
        """
You are a data analyst who has been hired to try to preserve the integrity of a list of
data items. The user will show you a list of items from a data migration, followed by
a "test item". Your job is to determine whether the test item is already present in
the list (but maybe under a different name), or whether it is not present in the list
at all.

We've already determined that the test item does not have an exact name match in the list,
but it might have been renamed or expressed in a different way.

Let me give you a few examples of what I mean by this:

- Imagine that the list is ["Customer ID", "Order Date", "Total Amount"], and the test item
    is "Client Identifier". Then you'd return "Customer ID".

- Imagine that the list is ["Customer ID", "Order Date", "Total Amount"], and the test item
    is "Date of Order". Then you'd return "Order Date".

- Imagine that the list is ["Customer ID", "Order Date", "Total Amount"], and the test item
    is "Product Name". Then you'd return null, because none of the items in the list are
    semantically similar to "Product Name".

- Imagine that the list is ["Dragonfly", "Butterfly", "Firefly"], and the test item is
    "Lightning Bug". Then you'd return "Firefly".

- Imagine that the list is ["Dragonfly", "Butterfly", "Firefly"], and the test item is
    "Spider". Then you'd return null, because none of the items in the list are
    semantically similar to "Spider".
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

    serialized_list = ""
    for index, item in enumerate(item_list):
        serialized_list += f"- ITEM #{index + 1}. {item_to_prompt_string(item)}\n"

    convo.add_user_message(
        f"""
Here is the list of items:

{serialized_list}

And here is the test item to compare against that list:

- {item_to_prompt_string(item_to_find)}
"""
    )

    convo.submit(
        json_response=JSONSchemaFormat(
            {
                "discussion": (
                    str,
                    "Your reasoning process as you compare the test item to the items in the list. "
                    + "This is for debugging purposes and will not be parsed by any downstream logic, "
                    + "but please provide as much detail as possible about your thinking here, "
                    + "as it will help us understand your decision-making process.",
                ),
                "is_testitem_in_list": (
                    bool,
                    "Whether the test item is present in the list.",
                ),
                "item_number_in_list": (
                    int,
                    'The item number (as indicated by "ITEM #") of the item that you\'ve identified as '
                    + "matching the test item. If you don't think any item in the list matches the "
                    + "test item, then set this to -1.",
                ),
            },
            name="list_comparison_find_potentially_renamed_item",
        )
    )

    is_test_item_in_list = convo.get_last_reply_dict_field("is_testitem_in_list")
    item_number_in_list = convo.get_last_reply_dict_field("item_number_in_list")

    if not is_test_item_in_list:
        return -1

    if not isinstance(item_number_in_list, int):
        return -1

    index = item_number_in_list - 1
    if index < 0 or index >= len(item_list):
        return -1

    return index
