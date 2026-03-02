import { OpenAI } from 'openai';
import { describe, expect, it } from 'vitest';

import {
  compareItemLists,
  ItemComparisonClassification,
  type ItemComparisonResult,
} from '../../src/semanticMatch/compareLists.js';
import { getItemName, type SemanticItem } from '../../src/semanticMatch/semanticItem.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
if (!OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required for compareItemLists live API tests. Configure your test environment to provide it.'
  );
}

const createClient = (): OpenAI =>
  new OpenAI({
    apiKey: OPENAI_API_KEY,
  });

const getByClassification = (
  results: ItemComparisonResult[],
  classification: ItemComparisonClassification
): ItemComparisonResult[] =>
  results.filter((entry) => entry.classification === classification);

const getNamesByClassification = (
  results: ItemComparisonResult[],
  classification: ItemComparisonClassification
): string[] => getByClassification(results, classification).map((entry) => getItemName(entry.item));

const getRenamedMap = (results: ItemComparisonResult[]): Record<string, string> => {
  const renamed: Record<string, string> = {};
  for (const entry of getByClassification(
    results,
    ItemComparisonClassification.Renamed
  )) {
    renamed[getItemName(entry.item)] = entry.newName || '';
  }
  return renamed;
};

describe('compareItemLists (live API)', () => {
  // IMPORTANT: These tests intentionally use live OpenAI calls and DO NOT mock findSemanticMatch.
  // We are validating end-to-end behavior for the current record-based result contract.

  describe('current return contract', () => {
    it('returns per-item records with classification and optional newName', async () => {
      const results = await compareItemLists(
        createClient(),
        ['Legacy Plan Alpha'],
        ['Modern Plan Alpha'],
        'Legacy Plan Alpha was renamed to Modern Plan Alpha.'
      );

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].item).toBe('Legacy Plan Alpha');
      expect(results[0].classification).toBe(ItemComparisonClassification.Renamed);
      expect(results[0].newName).toBe('Modern Plan Alpha');
    }, 180000);
  });

  describe('deterministic exact-match behavior', () => {
    it('classifies exact string matches as unchanged and does not mutate inputs', async () => {
      const before: SemanticItem[] = ['String Item A', 'String Item B'];
      const after: SemanticItem[] = ['string item a', 'STRING ITEM B'];

      const beforeSnapshot = JSON.parse(JSON.stringify(before));
      const afterSnapshot = JSON.parse(JSON.stringify(after));

      const results = await compareItemLists(createClient(), before, after);

      expect(getNamesByClassification(results, ItemComparisonClassification.Unchanged)).toEqual([
        'String Item A',
        'String Item B',
      ]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Removed)).toEqual([]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Added)).toEqual([]);
      expect(getRenamedMap(results)).toEqual({});

      expect(before).toEqual(beforeSnapshot);
      expect(after).toEqual(afterSnapshot);
    }, 180000);

    it('classifies object-vs-string same-name pair as unchanged', async () => {
      const results = await compareItemLists(
        createClient(),
        [
          {
            name: 'Georgia',
            description:
              'A sovereign country in the South Caucasus. Capital: Tbilisi.',
          },
        ],
        ['georgia']
      );

      expect(results).toHaveLength(1);
      expect(results[0].classification).toBe(ItemComparisonClassification.Unchanged);
      expect(results[0].newName).toBeUndefined();
    }, 180000);
  });

  describe('added and removed behavior', () => {
    it('classifies before-only item as removed', async () => {
      const results = await compareItemLists(
        createClient(),
        ['Delete Me Item'],
        [],
        'Delete Me Item was intentionally removed and has no replacement.'
      );

      expect(getNamesByClassification(results, ItemComparisonClassification.Removed)).toEqual([
        'Delete Me Item',
      ]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Added)).toEqual([]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Unchanged)).toEqual([]);
      expect(getRenamedMap(results)).toEqual({});
    }, 180000);

    it('classifies after-only items as added', async () => {
      const results = await compareItemLists(
        createClient(),
        [],
        ['Brand New Additive Item', 'Second New Item']
      );

      expect(getNamesByClassification(results, ItemComparisonClassification.Added)).toEqual([
        'Brand New Additive Item',
        'Second New Item',
      ]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Removed)).toEqual([]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Unchanged)).toEqual([]);
      expect(getRenamedMap(results)).toEqual({});
    }, 180000);
  });

  describe('rename behavior', () => {
    it('detects a single guided rename', async () => {
      const results = await compareItemLists(
        createClient(),
        ['ACME Legacy Plan'],
        ['ACME Modern Plan'],
        'There is exactly one rename in this migration. ' +
          'ACME Legacy Plan was renamed to ACME Modern Plan. ' +
          'Treat this as rename, not add/remove.'
      );

      expect(getRenamedMap(results)).toEqual({
        'ACME Legacy Plan': 'ACME Modern Plan',
      });
      expect(getNamesByClassification(results, ItemComparisonClassification.Removed)).toEqual([]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Added)).toEqual([]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Unchanged)).toEqual([]);
    }, 180000);

    it('handles two guided renames in one run', async () => {
      const results = await compareItemLists(
        createClient(),
        ['Legacy Product Alpha', 'Legacy Product Beta'],
        ['Modern Product Alpha', 'Modern Product Beta'],
        'Two renames occurred with one-to-one mapping. ' +
          'Legacy Product Alpha -> Modern Product Alpha. ' +
          'Legacy Product Beta -> Modern Product Beta. ' +
          'No deletions or net additions in this migration.'
      );

      expect(getRenamedMap(results)).toEqual({
        'Legacy Product Alpha': 'Modern Product Alpha',
        'Legacy Product Beta': 'Modern Product Beta',
      });
      expect(getNamesByClassification(results, ItemComparisonClassification.Removed)).toEqual([]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Added)).toEqual([]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Unchanged)).toEqual([]);
    }, 180000);
  });

  describe('mixed outcomes', () => {
    it('returns records for unchanged + renamed + removed + added in one run', async () => {
      const results = await compareItemLists(
        createClient(),
        ['Shared Constant Item', 'Legacy Rename Target', 'Delete Candidate'],
        ['shared constant item', 'Modern Rename Target', 'Add Candidate'],
        'Legacy Rename Target was renamed to Modern Rename Target. ' +
          'Delete Candidate was removed. ' +
          'Add Candidate was newly added. ' +
          'Shared Constant Item is unchanged.'
      );

      expect(getNamesByClassification(results, ItemComparisonClassification.Unchanged)).toEqual([
        'Shared Constant Item',
      ]);
      expect(getRenamedMap(results)).toEqual({
        'Legacy Rename Target': 'Modern Rename Target',
      });
      expect(getNamesByClassification(results, ItemComparisonClassification.Removed)).toEqual([
        'Delete Candidate',
      ]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Added)).toEqual([
        'Add Candidate',
      ]);
    }, 180000);

    it('returns one result record per before-item plus unmatched after-items', async () => {
      const before: SemanticItem[] = ['A', 'B', 'C'];
      const after: SemanticItem[] = ['a', 'B-NEW', 'D'];

      const results = await compareItemLists(
        createClient(),
        before,
        after,
        'A is unchanged (case only). B was renamed to B-NEW. C was removed. D was added.'
      );

      expect(results.length).toBe(4);
    }, 180000);
  });

  describe('additional behavior coverage', () => {
    it('treats same-name items with conflicting meaningful descriptions as renamed', async () => {
      const results = await compareItemLists(
        createClient(),
        [
          {
            name: 'Georgia',
            description:
              'A U.S. state in the southeastern United States. Capital: Atlanta.',
          },
        ],
        [
          {
            name: 'Georgia',
            description:
              'A sovereign country in the South Caucasus. Capital: Tbilisi.',
          },
        ],
        'These two items share a label but represent different entities. Treat this as a rename rather than unchanged.'
      );

      expect(results).toHaveLength(1);
      expect(results[0].classification).toBe(ItemComparisonClassification.Renamed);
      expect(results[0].newName).toBe('Georgia');
    }, 180000);

    it('consumes a matched after-item once, leaving subsequent similar item as removed', async () => {
      const results = await compareItemLists(
        createClient(),
        ['Legacy Item Alpha', 'Legacy Item Alpha Copy'],
        ['Modern Item Alpha'],
        'Only Legacy Item Alpha was renamed to Modern Item Alpha. Legacy Item Alpha Copy was removed.'
      );

      expect(getRenamedMap(results)).toEqual({
        'Legacy Item Alpha': 'Modern Item Alpha',
      });
      expect(getNamesByClassification(results, ItemComparisonClassification.Removed)).toEqual([
        'Legacy Item Alpha Copy',
      ]);
      expect(getNamesByClassification(results, ItemComparisonClassification.Added)).toEqual([]);
    }, 180000);

    it('preserves order of added records from remaining after-list items', async () => {
      const results = await compareItemLists(
        createClient(),
        [],
        [
          { name: 'Added First', description: 'first' },
          { name: 'Added Second', description: 'second' },
          'Added Third',
        ]
      );

      expect(getNamesByClassification(results, ItemComparisonClassification.Added)).toEqual([
        'Added First',
        'Added Second',
        'Added Third',
      ]);
    }, 180000);

    it('does not mutate before or after lists in mixed classification scenarios', async () => {
      const before: SemanticItem[] = [
        'Stable Name',
        'Legacy Rename Candidate',
        'Legacy Removed Candidate',
      ];
      const after: SemanticItem[] = [
        'stable name',
        'Modern Rename Candidate',
        'Newly Added Candidate',
      ];

      const beforeSnapshot = JSON.parse(JSON.stringify(before));
      const afterSnapshot = JSON.parse(JSON.stringify(after));

      await compareItemLists(
        createClient(),
        before,
        after,
        'Legacy Rename Candidate was renamed to Modern Rename Candidate. Legacy Removed Candidate was removed. Newly Added Candidate was added.'
      );

      expect(before).toEqual(beforeSnapshot);
      expect(after).toEqual(afterSnapshot);
    }, 180000);
  });
});
