import { OpenAI } from 'openai';
import { describe, expect, it } from 'vitest';
import {
  compareItemLists,
  ItemComparisonResult,
  type OnComparingItemCallback,
  type SemanticallyComparableListItem,
} from '../../src/semanticMatch/compareLists.js';

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

type ComparisonEvent = {
  item: SemanticallyComparableListItem;
  isFromBeforeList: boolean;
  isStarting: boolean;
  result: ItemComparisonResult;
  newName: string | undefined;
  error: string | undefined;
  totalProcessedSoFar: number;
  totalLeftToProcess: number;
};

const collectEvents = () => {
  const events: ComparisonEvent[] = [];
  const callback: OnComparingItemCallback = (
    item,
    isFromBeforeList,
    isStarting,
    result,
    newName,
    error,
    totalProcessedSoFar,
    totalLeftToProcess
  ) => {
    events.push({
      item,
      isFromBeforeList,
      isStarting,
      result,
      newName,
      error,
      totalProcessedSoFar,
      totalLeftToProcess,
    });
  };
  return { events, callback };
};

const assertProcessedCountersAreSequential = (events: ComparisonEvent[]) => {
  const finishes = events.filter((event) => !event.isStarting);
  let expectedProcessed = 1;
  for (const event of finishes) {
    expect(event.totalProcessedSoFar).toBe(expectedProcessed);
    expectedProcessed += 1;
  }
  if (finishes.length > 0) {
    expect(finishes[finishes.length - 1].totalLeftToProcess).toBe(0);
  }
};

describe('compareItemLists (live API)', () => {
  // IMPORTANT: These tests intentionally use live OpenAI calls and DO NOT mock GptConversation.
  // We are validating the real prompt+schema behavior end-to-end (including model decisions),
  // not just local control-flow in isolation.

  describe('input validation', () => {
    it('throws for duplicate item names (case-insensitive) within a list', async () => {
      await expect(
        compareItemLists(createClient(), ['Widget', 'widget'], ['Other'])
      ).rejects.toThrow('Duplicate item names found in before list');
    });
  });

  describe('string behavior', () => {
    it('classifies case-insensitive exact string matches as unchanged', async () => {
      const { events, callback } = collectEvents();

      const result = await compareItemLists(
        createClient(),
        ['String Item A', 'String Item B'],
        ['string item a', 'STRING ITEM B'],
        'Case-only differences are unchanged.',
        callback
      );

      expect(result.removed).toEqual([]);
      expect(result.added).toEqual([]);
      expect(result.renamed).toEqual({});
      expect(result.unchanged).toEqual(['String Item A', 'String Item B']);

      // Deterministic pruning handles all items before any LLM loop.
      expect(events).toHaveLength(0);
    }, 180000);
  });

  describe('name/description behavior', () => {
    it('treats same names as unchanged even when descriptions differ', async () => {
      const result = await compareItemLists(
        createClient(),
        [
          {
            name: 'Catalog Item 100',
            description: 'old description content',
          },
        ],
        [
          {
            name: 'catalog item 100',
            description: 'new description content',
          },
        ],
        'Identity is the item name; description differences alone do not imply rename.'
      );

      expect(result.removed).toEqual([]);
      expect(result.added).toEqual([]);
      expect(result.renamed).toEqual({});
      expect(result.unchanged).toEqual(['Catalog Item 100']);
    }, 180000);

    it('uses description context to support a guided rename decision', async () => {
      const result = await compareItemLists(
        createClient(),
        [
          {
            name: 'Plan Bronze Legacy',
            description: 'old tier label for the bronze offering',
          },
        ],
        [
          {
            name: 'Plan Bronze Modern',
            description: 'new tier label for the same bronze offering',
          },
        ],
        'Exactly one rename occurred. ' +
          'Plan Bronze Legacy was renamed to Plan Bronze Modern. ' +
          'Treat as rename; do not treat as remove/add.'
      );

      expect(result.removed).toEqual([]);
      expect(result.added).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.renamed['Plan Bronze Legacy']).toBe('Plan Bronze Modern');
    }, 180000);
  });

  describe('rename behavior', () => {
    it('detects a single guided rename', async () => {
      const result = await compareItemLists(
        createClient(),
        ['ACME Legacy Plan'],
        ['ACME Modern Plan'],
        'There is exactly one rename in this migration. ' +
          'ACME Legacy Plan was renamed to ACME Modern Plan. ' +
          'Treat this as rename, not add/remove.'
      );

      expect(result.removed).toEqual([]);
      expect(result.added).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.renamed['ACME Legacy Plan']).toBe('ACME Modern Plan');
    }, 180000);

    it('supports two independent guided renames in one run', async () => {
      const result = await compareItemLists(
        createClient(),
        ['Legacy Product Alpha', 'Legacy Product Beta'],
        ['Modern Product Alpha', 'Modern Product Beta'],
        'Two renames occurred with one-to-one mapping. ' +
          'Legacy Product Alpha -> Modern Product Alpha. ' +
          'Legacy Product Beta -> Modern Product Beta. ' +
          'No deletions or net additions in this migration.'
      );

      expect(Object.keys(result.renamed).sort()).toEqual([
        'Legacy Product Alpha',
        'Legacy Product Beta',
      ]);
      expect(result.renamed['Legacy Product Alpha']).toBe(
        'Modern Product Alpha'
      );
      expect(result.renamed['Legacy Product Beta']).toBe('Modern Product Beta');
      expect(result.removed).toEqual([]);
      expect(result.added).toEqual([]);
      expect(result.unchanged).toEqual([]);
    }, 180000);
  });

  describe('added/deleted behavior', () => {
    it('classifies explicit deletion', async () => {
      const result = await compareItemLists(
        createClient(),
        ['Delete Me Item'],
        [],
        'Delete Me Item was intentionally removed and has no replacement.'
      );

      expect(result.removed).toEqual(['Delete Me Item']);
      expect(result.added).toEqual([]);
      expect(result.renamed).toEqual({});
      expect(result.unchanged).toEqual([]);
    }, 180000);

    it('classifies explicit addition', async () => {
      const result = await compareItemLists(
        createClient(),
        [],
        ['Brand New Additive Item'],
        'Brand New Additive Item is newly introduced and should be treated as added.'
      );

      expect(result.removed).toEqual([]);
      expect(result.added).toEqual(['Brand New Additive Item']);
      expect(result.renamed).toEqual({});
      expect(result.unchanged).toEqual([]);
    }, 180000);
  });

  describe('mixed outcomes', () => {
    it('handles unchanged + renamed + removed + added together', async () => {
      const result = await compareItemLists(
        createClient(),
        ['Shared Constant Item', 'Legacy Rename Target', 'Delete Candidate'],
        ['shared constant item', 'Modern Rename Target', 'Add Candidate'],
        'Legacy Rename Target was renamed to Modern Rename Target. ' +
          'Delete Candidate was removed. ' +
          'Add Candidate was newly added. ' +
          'Shared Constant Item is unchanged.'
      );

      expect(result.unchanged).toEqual(['Shared Constant Item']);
      expect(result.renamed['Legacy Rename Target']).toBe(
        'Modern Rename Target'
      );
      expect(result.removed).toEqual(['Delete Candidate']);
      expect(result.added).toEqual(['Add Candidate']);
    }, 180000);
  });

  describe('callback reporting behavior', () => {
    it('emits balanced start/finish events with correct source-list flags', async () => {
      const { events, callback } = collectEvents();

      await compareItemLists(
        createClient(),
        ['Before Removed A', 'Before Removed B'],
        ['After Added A'],
        'Before Removed A and Before Removed B were removed. ' +
          'After Added A was newly added. ' +
          'No renames exist in this case.',
        callback
      );

      const starts = events.filter((event) => event.isStarting);
      const finishes = events.filter((event) => !event.isStarting);

      expect(starts.length).toBe(finishes.length);
      expect(starts.length).toBe(3);

      expect(starts.filter((event) => event.isFromBeforeList)).toHaveLength(2);
      expect(starts.filter((event) => !event.isFromBeforeList)).toHaveLength(1);
    }, 180000);

    it('increments processed counters sequentially and reaches zero remaining at end', async () => {
      const { events, callback } = collectEvents();

      await compareItemLists(
        createClient(),
        ['Legacy Counter Item'],
        ['Modern Counter Item', 'New Counter Add'],
        'Legacy Counter Item was renamed to Modern Counter Item. ' +
          'New Counter Add is newly added.',
        callback
      );

      assertProcessedCountersAreSequential(events);
    }, 180000);

    it('populates newName only for rename finish events', async () => {
      const { events, callback } = collectEvents();

      await compareItemLists(
        createClient(),
        ['Legacy Named Item'],
        ['Modern Named Item'],
        'Legacy Named Item was renamed to Modern Named Item.',
        callback
      );

      const renameFinishes = events.filter(
        (event) =>
          !event.isStarting && event.result === ItemComparisonResult.Renamed
      );
      expect(renameFinishes.length).toBeGreaterThan(0);
      for (const event of renameFinishes) {
        expect(event.newName).toBe('Modern Named Item');
      }

      for (const event of events.filter(
        (entry) =>
          !(!entry.isStarting && entry.result === ItemComparisonResult.Renamed)
      )) {
        expect(event.newName).toBeUndefined();
      }
    }, 180000);

    it('reports live API failures through callback error field (no mocks)', async () => {
      const { events, callback } = collectEvents();

      const invalidClient = new OpenAI({
        apiKey: `${OPENAI_API_KEY}-INTENTIONALLY-INVALID-FOR-TEST`,
      });

      const result = await compareItemLists(
        invalidClient,
        ['Live API Error Candidate'],
        ['After Error Path Item'],
        'If API fails, fallback should still complete with warning messages in callback.',
        callback
      );

      // Fallback behavior on failed before-item processing is to mark as unchanged.
      expect(result.unchanged).toContain('Live API Error Candidate');

      const finishEventsWithErrors = events.filter(
        (event) => !event.isStarting && typeof event.error === 'string'
      );
      expect(finishEventsWithErrors.length).toBeGreaterThan(0);
      expect(
        finishEventsWithErrors.some((event) =>
          (event.error || '').includes('LLM processing failed')
        )
      ).toBe(true);
    }, 180000);
  });

  describe('bulk list scenarios', () => {
    it('handles a larger mixed migration with multiple renames/additions/deletions', async () => {
      const beforeItems: SemanticallyComparableListItem[] = [
        'Shared Stable A',
        'Shared Stable B',
        'Legacy Rename One',
        'Legacy Rename Two',
        'Removed Batch One',
        'Removed Batch Two',
        'Shared Stable C',
      ];

      const afterItems: SemanticallyComparableListItem[] = [
        'shared stable a',
        'SHARED STABLE B',
        'Modern Rename One',
        'Modern Rename Two',
        'Added Batch One',
        'Added Batch Two',
        'shared stable c',
      ];

      const result = await compareItemLists(
        createClient(),
        beforeItems,
        afterItems,
        'Migration map: Legacy Rename One -> Modern Rename One. ' +
          'Legacy Rename Two -> Modern Rename Two. ' +
          'Removed Batch One and Removed Batch Two were removed. ' +
          'Added Batch One and Added Batch Two were newly added. ' +
          'Shared Stable A/B/C are unchanged.'
      );

      expect(result.unchanged).toEqual([
        'Shared Stable A',
        'Shared Stable B',
        'Shared Stable C',
      ]);
      expect(result.renamed).toEqual({
        'Legacy Rename One': 'Modern Rename One',
        'Legacy Rename Two': 'Modern Rename Two',
      });
      expect(result.removed).toEqual([
        'Removed Batch One',
        'Removed Batch Two',
      ]);
      expect(result.added).toEqual(['Added Batch One', 'Added Batch Two']);
    }, 240000);

    it('maintains coherent callback counters on larger ambiguous sets', async () => {
      const { events, callback } = collectEvents();

      const result = await compareItemLists(
        createClient(),
        [
          'Bulk Legacy 1',
          'Bulk Legacy 2',
          'Bulk Removed 1',
          'Bulk Removed 2',
          'Bulk Shared 1',
          'Bulk Shared 2',
        ],
        [
          'Bulk Modern 1',
          'Bulk Modern 2',
          'Bulk Added 1',
          'Bulk Added 2',
          'bulk shared 1',
          'BULK SHARED 2',
        ],
        'Bulk Legacy 1 -> Bulk Modern 1. ' +
          'Bulk Legacy 2 -> Bulk Modern 2. ' +
          'Bulk Removed 1 and Bulk Removed 2 were removed. ' +
          'Bulk Added 1 and Bulk Added 2 were newly added. ' +
          'Bulk Shared 1 and Bulk Shared 2 are unchanged.',
        callback
      );

      expect(result.renamed).toEqual({
        'Bulk Legacy 1': 'Bulk Modern 1',
        'Bulk Legacy 2': 'Bulk Modern 2',
      });
      expect(result.removed).toEqual(['Bulk Removed 1', 'Bulk Removed 2']);
      expect(result.added).toEqual(['Bulk Added 1', 'Bulk Added 2']);
      expect(result.unchanged).toEqual(['Bulk Shared 1', 'Bulk Shared 2']);

      // There are 4 ambiguous "before" items and, after rename removals, 2 remaining
      // "after" items for add-classification, so callback lifecycle should cover 6 items.
      const starts = events.filter((event) => event.isStarting);
      const finishes = events.filter((event) => !event.isStarting);
      expect(starts.length).toBe(6);
      expect(finishes.length).toBe(6);

      assertProcessedCountersAreSequential(events);
    }, 240000);
  });

  describe('inference without explicit mapping instructions', () => {
    it('infers removed string items when after list omits them', async () => {
      const result = await compareItemLists(
        createClient(),
        [
          'Invoice Number',
          'Purchase Date',
          'Supplier Name',
          'Legacy Tax Code',
          'Deprecated Internal Note',
          'Total Amount',
        ],
        ['Invoice Number', 'Purchase Date', 'Supplier Name', 'Total Amount']
      );

      expect(result.removed).toEqual([
        'Deprecated Internal Note',
        'Legacy Tax Code',
      ]);
      expect(result.added).toEqual([]);
      expect(result.renamed).toEqual({});
      expect(result.unchanged).toEqual([
        'Invoice Number',
        'Purchase Date',
        'Supplier Name',
        'Total Amount',
      ]);
    }, 180000);

    it('infers added string items when after list introduces them', async () => {
      const result = await compareItemLists(
        createClient(),
        ['Order ID', 'Customer Name', 'Subtotal', 'Order Date'],
        [
          'Order ID',
          'Customer Name',
          'Subtotal',
          'Order Date',
          'Shipping Method',
          'Delivery Address',
        ]
      );

      expect(result.removed).toEqual([]);
      expect(result.added?.sort()).toEqual(['Delivery Address', 'Shipping Method']);
      expect(result.renamed).toEqual({});
      expect(result.unchanged).toEqual([
        'Customer Name',
        'Order Date',
        'Order ID',
        'Subtotal',
      ]);
    }, 180000);

    it('infers removed name/description items without explicit guidance', async () => {
      const result = await compareItemLists(
        createClient(),
        [
          { name: 'acct_id', description: 'Unique account identifier' },
          { name: 'acct_name', description: 'Human-readable account name' },
          { name: 'acct_region', description: 'Assigned sales region' },
          {
            name: 'legacy_segment_code',
            description: 'Old segmentation code from prior CRM',
          },
          {
            name: 'legacy_priority_bucket',
            description: 'Obsolete account prioritization bucket',
          },
        ],
        [
          { name: 'acct_id', description: 'Unique account identifier' },
          { name: 'acct_name', description: 'Human-readable account name' },
          { name: 'acct_region', description: 'Assigned sales region' },
        ]
      );

      expect(result.removed).toEqual([
        'legacy_priority_bucket',
        'legacy_segment_code',
      ]);
      expect(result.added).toEqual([]);
      expect(result.renamed).toEqual({});
      expect(result.unchanged).toEqual(['acct_id', 'acct_name', 'acct_region']);
    }, 180000);

    it('infers added name/description items without explicit guidance', async () => {
      const result = await compareItemLists(
        createClient(),
        [
          { name: 'sku', description: 'Stock keeping unit identifier' },
          { name: 'title', description: 'Product display title' },
          { name: 'price', description: 'Current listed price' },
        ],
        [
          { name: 'sku', description: 'Stock keeping unit identifier' },
          { name: 'title', description: 'Product display title' },
          { name: 'price', description: 'Current listed price' },
          {
            name: 'inventory_count',
            description: 'Current on-hand inventory quantity',
          },
          {
            name: 'warehouse_location',
            description: 'Primary warehouse storage location code',
          },
        ]
      );

      expect(result.removed).toEqual([]);
      expect(result.added).toEqual(['inventory_count', 'warehouse_location']);
      expect(result.renamed).toEqual({});
      expect(result.unchanged).toEqual(['price', 'sku', 'title']);
    }, 180000);

    it('infers rename from semantic name similarity plus identical description', async () => {
      const result = await compareItemLists(
        createClient(),
        [
          {
            name: 'billing_address_line_1',
            description: 'Primary street line for billing address',
          },
          {
            name: 'billing_city',
            description: 'City associated with the billing address',
          },
          {
            name: 'billing_zip_code',
            description:
              'The five-digit postal code associated with the billing address',
          },
          {
            name: 'billing_country_code',
            description: 'ISO country code for the billing address',
          },
        ],
        [
          {
            name: 'billing_address_line_1',
            description: 'Primary street line for billing address',
          },
          {
            name: 'billing_city',
            description: 'City associated with the billing address',
          },
          {
            name: 'billing_postal_code',
            description:
              'The five-digit postal code associated with the billing address',
          },
          {
            name: 'billing_country_code',
            description: 'ISO country code for the billing address',
          },
        ]
      );

      expect(result.removed).toEqual([]);
      expect(result.added).toEqual([]);
      expect(result.unchanged).toEqual([
        'billing_address_line_1',
        'billing_city',
        'billing_country_code',
      ]);
      expect(result.renamed).toEqual({
        billing_zip_code: 'billing_postal_code',
      });
    }, 180000);

    it('infers rename from semantic similarity for plain string items', async () => {
      const result = await compareItemLists(
        createClient(),
        [
          'billing_address_line_1',
          'billing_city',
          'billing_zip_code',
          'billing_country_code',
        ],
        [
          'billing_address_line_1',
          'billing_city',
          'billing_postal_code',
          'billing_country_code',
        ]
      );

      expect(result.removed).toEqual([]);
      expect(result.added).toEqual([]);
      expect(result.unchanged).toEqual([
        'billing_address_line_1',
        'billing_city',
        'billing_country_code',
      ]);
      expect(result.renamed).toEqual({
        billing_zip_code: 'billing_postal_code',
      });
    }, 180000);
  });
});
