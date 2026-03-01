/**
 * Semantic match finder for migration-style item lists.
 *
 * This module provides a helper that determines whether a "test item" is already present
 * in an existing list, even when names are different. In this context, a semantic match
 * means two labels point to the same underlying concept (for example, renamed fields,
 * wording changes, or synonyms).
 *
 * Matching strategy:
 * 1) Check for exact name equality.
 * 2) If no exact match exists, use an LLM to infer conceptual equivalence.
 *
 * The exported function returns the index of the first matching list item when a match
 * is found, or `-1` when no sufficiently similar item exists.
 */

import { OpenAI } from 'openai';
import {
  areItemNamesEqual,
  itemToPromptString,
  SemanticItem,
} from './semanticItem.js';
import { GptConversation } from '../gptApi/gptConversation.js';
import { JSONSchemaFormat } from '../gptApi/jsonSchemaFormat.js';

/**
 * Finds the best semantic match for a test item within a list of items.
 *
 * A semantic match means two items represent the same underlying concept even if their
 * names differ (for example, due to renaming, wording changes, or synonyms).
 *
 * The function first checks for an exact name match and returns its index immediately
 * if found.
 * If no exact match exists, it asks the LLM to decide whether the test item is represented
 * in the list under a different name and returns the index of the first matching list item,
 * or `-1` when no good semantic match is found.
 *
 * @param openaiClient An instance of the OpenAI client to use for LLM interactions.
 * @param itemlist The list of strings/items to compare.
 * @param itemToFind The item for which we want to find a semantic match in the list.
 * @param explanation Optional explanation that provides context for the comparison, e.g.
 * a description of the items or the nature of the changes.
 * @returns The index of the first matching item from the list, or `-1` if no good match
 * is found.
 */
export const findSemanticMatch = async (
  openaiClient: OpenAI,
  itemlist: SemanticItem[],
  itemToFind: SemanticItem,
  explanation?: string
): Promise<number> => {
  // First check if there's an exact match for the item in the list.
  // If so, we can skip the LLM and just return that.
  for (let i = 0; i < itemlist.length; i++) {
    const item = itemlist[i];
    if (areItemNamesEqual(item, itemToFind)) {
      // We have an exact name match, but the items might contain descriptions.
      // If one or the other does *not* have a description, then call it a match.
      // If they both have descriptions, then we'll call it a match if the
      // descriptions are identical. If the descriptions are different, then we'll
      // have to let the LLM decide.
      if (
        typeof item === 'string' ||
        typeof itemToFind === 'string' ||
        !item.description ||
        !itemToFind.description ||
        item.description.trim() === itemToFind.description.trim()
      ) {
        return i;
      }
    }
  }

  const convo = new GptConversation([], { openaiClient });
  convo.addSystemMessage(`
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
`);

  if (explanation) {
    convo.addSystemMessage(`
Here is some additional context that may help you make better decisions about which items
have been renamed versus removed/added:

${explanation}
`);
  }

  let sList = '';
  for (let iItem = 0; iItem < itemlist.length; iItem++) {
    const item = itemlist[iItem];
    sList += `- ITEM #${iItem + 1}. ${itemToPromptString(item)}\n`;
  }

  convo.addUserMessage(`
Here is the list of items:

${sList}

And here is the test item to compare against that list:

- ${itemToPromptString(itemToFind)}
`);

  await convo.submit(undefined, undefined, {
    jsonResponse: JSONSchemaFormat(
      'list_comparison_find_potentially_renamed_item',
      {
        discussion: [
          String,
          'Your reasoning process as you compare the test item to the items in the list. ' +
            'This is for debugging purposes and will not be parsed by any downstream logic, ' +
            'but please provide as much detail as possible about your thinking here, ' +
            'as it will help us understand your decision-making process.',
        ],
        is_testitem_in_list: [
          Boolean,
          'Whether the test item is present in the list.',
        ],
        item_number_in_list: [
          Number,
          `The item number (as indicated by "ITEM #") of the item that you've identified as ` +
            `matching the test item. If you don't think any item in the list matches the ` +
            `test item, then set this to -1.`,
        ],
      }
    ),
  });

  const isTestItemInList = convo.getLastReplyDictField(
    'is_testitem_in_list'
  ) as boolean;
  const itemNumberInList = convo.getLastReplyDictField(
    'item_number_in_list'
  ) as number;

  if (!isTestItemInList) {
    return -1;
  }

  if (!Number.isInteger(itemNumberInList)) {
    return -1;
  }

  const index = itemNumberInList - 1;
  if (index < 0 || index >= itemlist.length) {
    return -1;
  }

  return index;
};
