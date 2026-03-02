/**
 * Shared item primitives and helpers used by semantic list comparison.
 *
 * This module intentionally focuses on item-level behavior:
 * - `SemanticItem` defines the accepted item shape (`string` or `{ name, description? }`).
 * - `getItemName` normalizes an item to its comparable name.
 * - `itemToPromptString` formats an item for prompt text, including optional details.
 * - `compareItems` provides case-insensitive ordering by item name.
 * - `areItemsEqual` provides equality checks across comparable item content.
 *
 * Matching orchestration (removed/added/renamed classification) is implemented in
 * higher-level modules and consumes these utilities.
 */

/**
 * Item shape accepted by `compareItemLists` for semantic comparison.
 *
 * - A raw string is treated as the item's comparable name.
 * - An object uses `name` as the comparable value and may include optional
 *   `description` to provide additional LLM context.
 */
export type SemanticItem =
  | string
  | { name: string; description?: string };


/**
 * Returns the comparable name for a list item.
 * @param item The item to extract the name from.
 * @returns The name of the item, which is used for comparison and matching.
 */
export const getItemName = (item: SemanticItem): string => {
  return typeof item === 'string' ? item : item.name;
};

/**
 * Returns the description of a list item, if available and non-redundant with the name.
 * If the item is a string or if the description is missing or effectively the same as the name,
 * this function returns `undefined`.
 * @param item The item to extract the description from.
 * @returns The description of the item, or `undefined` if not available or redundant.
 */
export const getItemDescription = (item: SemanticItem): string | undefined => {
  if (typeof item === 'string') {
    return undefined;
  }
  if (!item.description) {
    return undefined;
  }
  // If the description is the same as the name (ignoring case and whitespace),
  // then it's not really providing any additional context, so we can ignore it.
  if (item.description.trim().toLowerCase() === item.name.trim().toLowerCase()) {
    return undefined;
  }
  return item.description;
}


/**
 * Formats a list item for prompt inclusion, including optional description context.
 * The output is a string that starts with "- " followed by the item name, and if a 
 * description is provided and is not redundant with the name, it includes the description 
 * in parentheses. The item name and description are JSON-stringified to prevent formatting
 * issues in the prompt (e.g. with newlines or special characters).
 * @param item The item to format for the prompt.
 * @returns A string representation of the item suitable for inclusion in the prompt.
 */
export const itemToPromptString = (item: SemanticItem): string => {
  let s = `- ${JSON.stringify(getItemName(item))}`;
  const description = getItemDescription(item);
  if (description) {
    s += ` (details: ${JSON.stringify(description)})`;
  }
  return s;
};

/**
 * Sort comparator for list items.
 *
 * Ordering behavior:
 * 1) Compare names case-insensitively after trimming leading/trailing whitespace.
 * 2) If names are equal, compare non-redundant descriptions case-insensitively
 *    as a tie-breaker. We only compare descriptions when both items have a
 *    non-redundant description.
 */
export const compareItems = (
  a: SemanticItem,
  b: SemanticItem
) => {
  const nameA = getItemName(a).trim().toLowerCase();
  const nameB = getItemName(b).trim().toLowerCase();
  const byName = nameA.localeCompare(nameB);
  if (byName !== 0) {
    return byName;
  }

  const descA = (getItemDescription(a) ?? '').trim().toLowerCase();
  const descB = (getItemDescription(b) ?? '').trim().toLowerCase();

  // In order to compare descriptions, both items should have a description.
  // If only one item has a description, we don't bother comparing the
  // description field.
  if (!descA || !descB) {
    return 0;
  }

  // If we have two descriptions, we can use them as a tie-breaker.
  return descA.localeCompare(descB);
};

/**
 * Equality check for two items.
 *
 * Equality uses the same semantics as `compareItems`:
 * - names are compared case-insensitively after trimming;
 * - when names tie, non-redundant descriptions are compared
 *   case-insensitively after trimming.
 * @param a The first item to compare.
 * @param b The second item to compare.
 * @returns `true` if the items are equal under comparator semantics, `false` otherwise.
 */
export const areItemsEqual = (a: SemanticItem, b: SemanticItem): boolean => {
  return compareItems(a, b) === 0;
}

/**
 * Removes an item from a list based on full item equivalence.
 * @param itemList The list of items to remove from.
 * @param itemToRemove The item to remove from the list. Any item equal to this item
 * under `areItemsEqual` semantics will be removed.
 * @returns A new list with the specified item removed.
 */
export const removeItemFromList = (itemList: SemanticItem[], itemToRemove: SemanticItem): SemanticItem[] => {
  return itemList.filter(item => !areItemsEqual(item, itemToRemove));
}