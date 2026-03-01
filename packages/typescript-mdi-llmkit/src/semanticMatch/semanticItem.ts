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
 */
export const getItemName = (item: SemanticItem): string => {
  return typeof item === 'string' ? item : item.name;
};


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