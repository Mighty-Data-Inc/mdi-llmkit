/**
 * Semantic comparison for before/after item lists.
 *
 * This module compares two lists that represent the same domain at different points
 * in time (for example, before and after a migration) and classifies items as:
 * - unchanged,
 * - renamed,
 * - removed, or
 * - added.
 *
 * It is designed for cases where exact string comparison is not sufficient because
 * names may change while meaning stays the same.
 */

import { OpenAI } from 'openai';
import { areItemsEqual, getItemName, SemanticItem } from './semanticItem.js';
import { findSemanticMatch } from './find.js';

/**
 * Final classification of an item during comparison.
 */
export enum ItemComparisonClassification {
  /** Item existed in "before" and is considered deleted in "after". */
  Removed = 'removed',
  /** Item exists in "after" and is considered newly introduced. */
  Added = 'added',
  /** Item from "before" was matched to a different name in "after". */
  Renamed = 'renamed',
  /** Item is treated as unchanged or unresolved for downstream purposes. */
  Unchanged = 'unchanged',
}

export const ItemComparisonResult = ItemComparisonClassification;

export type ItemComparisonResult = {
  item: SemanticItem;
  classification: ItemComparisonClassification;
  newName: string | undefined;
};

/**
 * Compares two lists of items and classifies each item from the "before" list as removed,
 * renamed, or unchanged based on whether it has a semantic match in the "after" list.
 * Any items in the "after" list that don't match to an item in the "before" list are
 * classified as added.
 * @param before - The list of items before the changes.
 * @param after - The list of items after the changes.
 * @param explanation Optional explanation that provides context for the comparison, e.g.
 * a description of the items or the nature of the changes.
 * @returns An array of item comparison results. This includes all items from the "before"
 * list with their classification (removed/renamed/unchanged), and any unmatched items from
 * the "after" list classified as added.
 */
export const compareItemLists = async (
  openaiClient: OpenAI,
  listBefore: SemanticItem[],
  listAfter: SemanticItem[],
  explanation?: string
): Promise<ItemComparisonResult[]> => {
  // We're going to be removing items from the "after" list as we match them,
  // so we make a copy of it to avoid mutating the original array.
  listAfter = [...listAfter];

  const retval: ItemComparisonResult[] = [];

  for (const itemBefore of listBefore) {
    const indexMatchedInAfter = await findSemanticMatch(
      openaiClient,
      listAfter,
      itemBefore,
      explanation
    );
    if (indexMatchedInAfter === -1) {
      // No good match found in "after" list, so this item is probably removed.
      retval.push({
        item: itemBefore,
        classification: ItemComparisonClassification.Removed,
        newName: undefined,
      });
      continue;
    }
    const itemAfter = listAfter[indexMatchedInAfter];
    if (areItemsEqual(itemBefore, itemAfter)) {
      retval.push({
        item: itemBefore,
        classification: ItemComparisonClassification.Unchanged,
        newName: undefined,
      });
    } else {
      retval.push({
        item: itemBefore,
        classification: ItemComparisonClassification.Renamed,
        newName: getItemName(itemAfter),
      });
    }

    // Remove the matched item from the "after" list so it can't be matched again.
    listAfter.splice(indexMatchedInAfter, 1);
  }

  // All of the remaining items in the "after" list are considered added.
  for (const itemAfter of listAfter) {
    retval.push({
      item: itemAfter,
      classification: ItemComparisonClassification.Added,
      newName: undefined,
    });
  }

  return retval;
};
