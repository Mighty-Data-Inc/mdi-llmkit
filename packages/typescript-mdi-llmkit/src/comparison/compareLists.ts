import { OpenAI } from 'openai';
import { GptConversation } from '../gptApi/gptConversation.js';
import { JSONSchemaFormat } from '../gptApi/jsonSchemaFormat.js';

type ListItem = string | { name: string; description?: string };

/**
 * Returns the comparable name for a list item.
 */
const getItemName = (item: ListItem): string => {
  return typeof item === 'string' ? item : item.name;
};

/**
 * Ensures a list has no duplicate item names after case-insensitive normalization.
 * Throws an error listing duplicates when the uniqueness precondition is violated.
 */
const assertUniqueNamesInList = (
  listToCheck: ListItem[],
  listName: 'before' | 'after'
): void => {
  const seenNames = new Set<string>();
  const duplicateNames = new Set<string>();

  for (const item of listToCheck) {
    const name = getItemName(item).trim().toLowerCase();
    if (seenNames.has(name)) {
      duplicateNames.add(name);
    } else {
      seenNames.add(name);
    }
  }

  if (duplicateNames.size > 0) {
    throw new Error(
      `compareItemLists: Duplicate item names found in ${listName} list (case-insensitive): ` +
        `${Array.from(duplicateNames)
          .sort()
          .map((name) => JSON.stringify(name))
          .join(', ')}`
    );
  }
};

/**
 * Formats a list item for prompt inclusion, including optional description context.
 */
const itemToPromptString = (item: ListItem): string => {
  if (typeof item === 'string') {
    return `- ${JSON.stringify(item)}`;
  } else {
    let s = `- ${JSON.stringify(item.name)}`;
    if (
      item.description &&
      item.description.trim().toLowerCase() !== item.name.trim().toLowerCase()
    ) {
      s += ` (details: ${JSON.stringify(item.description)})`;
    }
    return s;
  }
};

/**
 * Sort comparator for list items by case-insensitive name.
 */
const compareItemsByName = (a: ListItem, b: ListItem) => {
  const nameA = getItemName(a).toLowerCase();
  const nameB = getItemName(b).toLowerCase();
  return nameA.localeCompare(nameB);
};

/**
 * Compares two names case-insensitively while tolerating JSON-escaped variants.
 */
const areNamesEquivalent = (a: string, b: string): boolean => {
  a = a.trim().toLowerCase();
  b = b.trim().toLowerCase();
  if (a === b || a === JSON.stringify(b) || JSON.stringify(a) === b) {
    return true;
  }
  return false;
};

/**
 * Removes every item whose name matches the target (case-insensitive, JSON-tolerant).
 */
const removeItemsByName = (
  listToModify: ListItem[],
  itemNameToRemove: string
): ListItem[] => {
  itemNameToRemove = itemNameToRemove.trim().toLowerCase();
  return listToModify.filter((item) => {
    const name = getItemName(item).trim().toLowerCase();
    if (areNamesEquivalent(name, itemNameToRemove)) {
      return false; // Remove this item
    }
    return true; // Keep this item
  });
};

/**
 * Result of comparing two lists of strings.
 */
export interface StringListComparison {
  removed: string[];
  added: string[];
  renamed: Record<string, string>;
  unchanged: string[];
}

/**
 * Compares two lists of strings and identifies differences, including potential renames.
 * The lists presumably use strings. However, in situations where the AI might benefit from
 * additional context, the lists may contain objects with `name` and optional `description`
 * properties; in these situations, it's the `name` property that is compared.
 * The comparison is case insensitive.
 *
 * IMPORTANT: Item names are expected to be unique within each input list (case-insensitive).
 * Duplicate names in either list are not supported and may produce incorrect results.
 * @param before - The list of strings/items before the changes.
 * @param after - The list of strings/items after the changes.
 * @param explanation Optional explanation that provides context for the comparison, e.g.
 * a description of the items or the nature of the changes.
 * @returns An object containing removed, added, renamed, and unchanged strings
 */
export const compareItemLists = async (
  openaiClient: OpenAI,
  listBefore: ListItem[],
  listAfter: ListItem[],
  explanation?: string
): Promise<{
  removed: string[];
  added: string[];
  renamed: Record<string, string>;
  unchanged: string[];
}> => {
  // Make sure we don't modify the original lists.
  listBefore = JSON.parse(JSON.stringify(listBefore));
  listAfter = JSON.parse(JSON.stringify(listAfter));

  const retval = {
    removed: [] as string[],
    added: [] as string[],
    renamed: {} as Record<string, string>,
    unchanged: [] as string[],
  };

  assertUniqueNamesInList(listBefore, 'before');
  assertUniqueNamesInList(listAfter, 'after');
  listBefore.sort(compareItemsByName);
  listAfter.sort(compareItemsByName);

  const setStringsBefore = new Set<string>(
    listBefore.map((item) => getItemName(item))
  );
  const setStringsAfter = new Set<string>(
    listAfter.map((item) => getItemName(item))
  );

  // Determine which strings are common to both lists.
  // We can't just do a simple set intersection, because we want the comparison
  // to be case insensitive. So we have to do it manually.
  // We'll just perform an n^2 comparison since the lists are expected to be small.
  const setStringsCommon = new Set<string>();
  for (const strBefore of setStringsBefore) {
    for (const strAfter of setStringsAfter) {
      if (strBefore.toLowerCase() === strAfter.toLowerCase()) {
        setStringsCommon.add(strBefore);
        break;
      }
    }
  }
  // This already gives us the unchanged items.
  retval.unchanged = Array.from(setStringsCommon).sort();

  // Remove the unchanged items from both lists, leaving only items that might have been
  // removed, added, or renamed.
  // Remember that we can't just do set subtraction because of case insensitivity, and
  // because the original lists may contain objects rather than just strings.
  for (const strCommon of setStringsCommon) {
    listBefore = removeItemsByName(listBefore, strCommon);
    listAfter = removeItemsByName(listAfter, strCommon);
  }

  // Now the two lists contain only items with different names.
  // However, some of these items may be renames rather than pure additions/removals.
  // The only way to tell is with AI.

  const convo = new GptConversation([], { openaiClient });
  convo.addSystemMessage(`
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
`);

  if (explanation) {
    convo.addSystemMessage(`
Here is some additional context that may help you make better decisions about which items
have been renamed versus removed/added:

${explanation}
`);
  }

  convo.addUserMessage(`
"BEFORE" LIST:

${listBefore.map(itemToPromptString).join('\n')}
`);

  // First, go through each item in the "before" list, and submit it to the LLM
  // for presentation.
  for (let iItem = 0; iItem < listBefore.length; iItem++) {
    console.log(
      `  Processing item ${iItem + 1} of ${listBefore.length}: ` +
        `${getItemName(listBefore[iItem])}`
    );
    const itemBefore = listBefore[iItem];

    try {
      const convoIter = convo.clone();

      // We rebuild the "after" list each time, since items may get removed from it
      // as they get matched.
      convoIter.addUserMessage(`
"AFTER" LIST:

${listAfter.map(itemToPromptString).join('\n')}
`);

      convoIter.addUserMessage(`
For the moment, let's focus on this item from the "before" list:

${itemToPromptString(itemBefore)}

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
`);
      await convoIter.submit();

      await convoIter.submit(undefined, undefined, {
        jsonResponse: JSONSchemaFormat(
          'list_comparison_item_rename_exploration',
          {
            is_renamed: [
              Boolean,
              'Whether the item from the "before" list has been renamed in the "after" list.',
            ],
            new_name: [
              String,
              'The new name of the item in the "after" list, if it has been renamed. ' +
                'This needs to be an *exact character-for-character match* of the name of ' +
                'exactly *one* item in the "after" list, written *exactly* as it appears ' +
                'in the "after" list. If the item was not renamed, this should be an empty string.',
            ],
            is_deleted: [
              Boolean,
              'Whether the item from the "before" list has been deleted/removed in the ' +
                '"after" list. Presumably, if is_renamed is true, this should be false, ' +
                'and vice versa.',
            ],
          }
        ),
      });

      const isItemDeleted = convoIter.getLastReplyDictField('is_deleted');
      const isItemRenamed = convoIter.getLastReplyDictField('is_renamed');

      if (!isItemDeleted && !isItemRenamed) {
        // Item is unchanged - shouldn't happen since we already filtered those out,
        // but just in case, we handle it.
        console.warn(
          `LLM indicated item is neither renamed nor deleted, which should not happen. ` +
            `Marking as unchanged: ${getItemName(itemBefore)}`
        );
        retval.unchanged.push(getItemName(itemBefore));
        continue;
      }

      if (isItemDeleted) {
        // This is the easy case - item was deleted.
        retval.removed.push(getItemName(itemBefore));
        continue;
      }
      if (isItemRenamed) {
        const newNameAccordingToLLM =
          `${convoIter.getLastReplyDictField('new_name', '')}`.trim();

        if (!newNameAccordingToLLM) {
          // Invalid response - no new name provided.
          // Do not mark the item as removed. Mark it as unchanged.
          console.warn(
            `LLM indicated item was renamed but did not provide a new name. ` +
              `Skipping rename for item: ${getItemName(itemBefore)}`
          );
          retval.unchanged.push(getItemName(itemBefore));
          continue;
        }
        // Find the actual item in listAfter that matches this name.
        // We do this because the LLM might return a name that is slightly different
        // from the actual name in the list (e.g. different casing, or with/without
        // quotes, etc.)
        let nameOfMatchedItem: string | null = null;
        for (const itemAfter of listAfter) {
          const nameAfter = getItemName(itemAfter);
          if (areNamesEquivalent(nameAfter, newNameAccordingToLLM)) {
            nameOfMatchedItem = nameAfter;
            break;
          }
        }
        if (!nameOfMatchedItem) {
          // Couldn't find a matching item in listAfter.
          // Do not mark the item as removed. Mark it as unchanged.
          console.warn(
            `LLM indicated item was renamed to "${newNameAccordingToLLM}", ` +
              `but no matching item was found in the "after" list. ` +
              `Skipping rename for item: ${getItemName(itemBefore)}`
          );
          console.log();
          retval.unchanged.push(getItemName(itemBefore));
          continue;
        }
        // Valid rename.
        retval.renamed[getItemName(itemBefore)] = nameOfMatchedItem;

        // Remove the matched item from listAfter so it can't be matched again.
        listAfter = removeItemsByName(listAfter, nameOfMatchedItem);
      }
    } catch (error) {
      console.warn(
        `LLM processing failed for "before" item ${JSON.stringify(
          getItemName(itemBefore)
        )}; marking as unchanged.`,
        error
      );
      retval.unchanged.push(getItemName(itemBefore));
      continue;
    }
  }

  // At this point, any remaining items in listAfter are probably added.
  // However, there could be additional instructions that indicate otherwise.
  console.log(
    `compareItemLists: Processing ${listAfter.length} items from "after" list...`
  );
  // TODO: Instead of console.log, send this to a logging callback.
  for (let iItem = 0; iItem < listAfter.length; iItem++) {
    console.log(
      `  Processing item ${iItem + 1} of ${listAfter.length}: ` +
        `${getItemName(listAfter[iItem])}`
    );
    const itemAfter = listAfter[iItem];

    try {
      const convoIter = convo.clone();
      convoIter.addUserMessage(`
At the moment, let's focus on this item from the "after" list:

${itemToPromptString(itemAfter)}

We think that this item was newly added, because we can't find any matching item
from the "before" list. However, it's possible that we have instructions or context
that indicate otherwise.

At this point, we don't have the option of matching this item to any item from the "before"
list, since we've already processed all those items. However, we still have the option
of rejecting this item from addition -- in which case, it will be considered as not having
been added at all (or, in other words, it will be ignored in downstream processing).

What do you think? Should we consider this item as truly added, or should we reject / ignore
this item?
`);
      await convoIter.submit();

      await convoIter.submit(undefined, undefined, {
        jsonResponse: JSONSchemaFormat(
          'list_comparison_item_addition_decision',
          {
            is_added: [
              Boolean,
              `Whether this item from the "after" list should be considered as truly added. ` +
                `If false, the item will be ignored in downstream processing.`,
            ],
          }
        ),
      });

      const isItemAdded = convoIter.getLastReplyDictField('is_added');
      if (isItemAdded) {
        retval.added.push(getItemName(itemAfter));
      }
    } catch (error) {
      console.warn(
        `LLM processing failed for "after" item ${JSON.stringify(
          getItemName(itemAfter)
        )}; skipping add classification for this item.`,
        error
      );
      continue;
    }
  }

  return {
    removed: [...new Set(retval.removed)].sort(),
    added: [...new Set(retval.added)].sort(),
    renamed: retval.renamed,
    unchanged: [...new Set(retval.unchanged)].sort(),
  };
};
