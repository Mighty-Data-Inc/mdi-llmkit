import { describe, expect, it } from 'vitest';
import {
  areItemsEqual,
  compareItems,
  getItemDescription,
  getItemName,
  itemToPromptString,
  removeItemFromList,
  type SemanticItem,
} from '../../src/semanticMatch/semanticItem.js';

describe('semanticItem helpers', () => {
  describe('getItemName', () => {
    it('returns the raw value for string items', () => {
      expect(getItemName('Widget')).toBe('Widget');
    });

    it('returns the name field for object items', () => {
      expect(getItemName({ name: 'Widget', description: 'A part' })).toBe(
        'Widget'
      );
    });
  });

  describe('getItemDescription', () => {
    it('returns undefined for string items', () => {
      expect(getItemDescription('Widget')).toBeUndefined();
    });

    it('returns undefined when object description is missing', () => {
      expect(getItemDescription({ name: 'Widget' })).toBeUndefined();
    });

    it('returns undefined when description equals name ignoring case and whitespace', () => {
      expect(
        getItemDescription({
          name: 'Product Alpha',
          description: '  product alpha  ',
        })
      ).toBeUndefined();
    });

    it('returns description when it provides additional context', () => {
      expect(
        getItemDescription({
          name: 'Product Alpha',
          description: 'Legacy tier retained for existing contracts',
        })
      ).toBe('Legacy tier retained for existing contracts');
    });

    it('preserves original description text when returning value', () => {
      expect(
        getItemDescription({
          name: 'Product Alpha',
          description: '  Legacy tier retained for existing contracts  ',
        })
      ).toBe('  Legacy tier retained for existing contracts  ');
    });
  });

  describe('itemToPromptString', () => {
    it('formats string items as a bullet with JSON-escaped content', () => {
      expect(itemToPromptString('Line "A"\nLine B')).toBe(
        '- "Line \\"A\\"\\nLine B"'
      );
    });

    it('formats object items with only the name when description is absent', () => {
      expect(itemToPromptString({ name: 'Product Alpha' })).toBe(
        '- "Product Alpha"'
      );
    });

    it('omits details when description equals name ignoring case and whitespace', () => {
      expect(
        itemToPromptString({
          name: 'Product Alpha',
          description: '  product alpha  ',
        })
      ).toBe('- "Product Alpha"');
    });

    it('includes details when description is meaningfully different', () => {
      expect(
        itemToPromptString({
          name: 'Product Alpha',
          description: 'Replaces legacy alpha tier',
        })
      ).toBe(
        '- "Product Alpha" (details: "Replaces legacy alpha tier")'
      );
    });
  });

  describe('compareItems', () => {
    it('returns 0 for names equal ignoring case', () => {
      expect(compareItems('Widget', 'widget')).toBe(0);
    });

    it('sorts by case-insensitive names', () => {
      const items: SemanticItem[] = [
        'zeta',
        { name: 'Bravo' },
        'alpha',
        { name: 'charlie' },
      ];

      const sortedNames = [...items].sort(compareItems).map(getItemName);
      expect(sortedNames).toEqual(['alpha', 'Bravo', 'charlie', 'zeta']);
    });

    it('trims names before comparing', () => {
      expect(compareItems('name', ' name')).toBe(0);
    });

    it('uses descriptions as case-insensitive tie-breaker when names are equal', () => {
      expect(
        compareItems(
          { name: 'Georgia', description: 'zebra context' },
          { name: 'Georgia', description: 'alpha context' }
        )
      ).toBeGreaterThan(0);
    });

    it('treats description case differences as equal in tie-break comparison', () => {
      expect(
        compareItems(
          { name: 'Georgia', description: 'Country in caucasus' },
          { name: 'Georgia', description: 'country in caucasus' }
        )
      ).toBe(0);
    });
  });

  describe('areItemsEqual', () => {
    it('is true for items with equal names ignoring case and whitespace', () => {
      expect(areItemsEqual(' Catalog Item ', { name: 'catalog item' })).toBe(
        true
      );
    });

    it('is false for different names', () => {
      expect(areItemsEqual('Catalog Item A', { name: 'Catalog Item B' })).toBe(
        false
      );
    });

    it('is false when names match but meaningful descriptions differ', () => {
      expect(
        areItemsEqual(
          { name: 'Catalog Item', description: 'old' },
          { name: 'catalog item', description: 'new' }
        )
      ).toBe(false);
    });
  });

  describe('removeItemFromList', () => {
    it('removes matching string items case-insensitively', () => {
      const original: SemanticItem[] = ['Alpha', 'Bravo', 'alpha'];

      const result = removeItemFromList(original, 'ALPHA');

      expect(result).toEqual(['Bravo']);
    });

    it('removes object items when both name and description are equivalent', () => {
      const original: SemanticItem[] = [
        { name: 'Catalog Item', description: 'legacy details' },
        { name: 'Catalog Item', description: 'LEGACY DETAILS' },
        { name: 'Other Item' },
      ];

      const result = removeItemFromList(original, {
        name: 'catalog item',
        description: '  legacy details  ',
      });

      expect(result).toEqual([{ name: 'Other Item' }]);
    });

    it('does not remove items that only match by name when descriptions differ', () => {
      const original: SemanticItem[] = [
        { name: 'Catalog Item', description: 'first copy' },
        'catalog item',
        { name: 'Other Item' },
      ];

      const result = removeItemFromList(original, {
        name: 'CATALOG ITEM',
        description: 'query description does not matter',
      });

      expect(result).toEqual(original);
      expect(result).not.toBe(original);
    });

    it('returns a new list and does not mutate the input array', () => {
      const original: SemanticItem[] = ['Alpha', 'Bravo'];

      const result = removeItemFromList(original, 'alpha');

      expect(result).toEqual(['Bravo']);
      expect(original).toEqual(['Alpha', 'Bravo']);
      expect(result).not.toBe(original);
    });

    it('returns unchanged items when there is no equivalent item', () => {
      const original: SemanticItem[] = ['Alpha', { name: 'Bravo' }];

      const result = removeItemFromList(original, 'Charlie');

      expect(result).toEqual(['Alpha', { name: 'Bravo' }]);
    });
  });
});
