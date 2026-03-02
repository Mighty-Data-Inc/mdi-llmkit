/**
 * Shared item primitives and helpers used by semantic list comparison.
 *
 * This module intentionally focuses on item-level behavior:
 * - `SemanticItem` defines the accepted item shape (`string` or `{ name, description? }`).
 * - `getItemName` normalizes an item to its comparable name.
 * - `itemToPromptString` formats an item for prompt text, including optional details.
 * - `compareItems` provides case-insensitive ordering by item name.
 * - `areItemsEquivalent` provides case-insensitive name equivalence.
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
 * Sort comparator for list items by case-insensitive name.
 */
export const compareItems = (
  a: SemanticItem,
  b: SemanticItem
) => {
  const nameA = getItemName(a).toLowerCase();
  const nameB = getItemName(b).toLowerCase();
  return nameA.localeCompare(nameB);
};

/**
 * Case-insensitive name equivalence check for two items.
 * @param a The first item to compare.
 * @param b The second item to compare.
 * @returns `true` if the items are considered equal based on their names 
 * (case-insensitive), `false` otherwise.
 */
export const areItemNamesEqual = (a: SemanticItem, b: SemanticItem): boolean => {
  return compareItems(a, b) === 0;
}

/**
 * Removes an item from a list based on name equivalence.
 * @param itemList The list of items to remove from.
 * @param itemToRemove The item to remove from the list. Any item with a name that is 
 * case-insensitively equal to this item's name will be removed.
 * @returns A new list with the specified item removed.
 */
export const removeItemFromList = (itemList: SemanticItem[], itemToRemove: SemanticItem): SemanticItem[] => {
  return itemList.filter(item => !areItemNamesEqual(item, itemToRemove));
}