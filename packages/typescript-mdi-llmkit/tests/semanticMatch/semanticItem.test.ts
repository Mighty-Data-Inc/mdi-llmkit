import { describe, expect, it } from 'vitest';
import {
  areItemNamesEqual,
  compareItems,
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

    it('does not trim names when comparing', () => {
      expect(compareItems('name', ' name')).toBeGreaterThan(0);
    });
  });

  describe('areItemsEquivalent', () => {
    it('is true for string/object items with same name ignoring case', () => {
      expect(areItemNamesEqual('Catalog Item', { name: 'catalog item' })).toBe(
        true
      );
    });

    it('is false for different names', () => {
      expect(areItemNamesEqual('Catalog Item A', { name: 'Catalog Item B' })).toBe(
        false
      );
    });

    it('is based on name only, not description', () => {
      expect(
        areItemNamesEqual(
          { name: 'Catalog Item', description: 'old' },
          { name: 'catalog item', description: 'new' }
        )
      ).toBe(true);
    });
  });

  describe('removeItemFromList', () => {
    it('removes matching items case-insensitively', () => {
      const original: SemanticItem[] = ['Alpha', 'Bravo', 'alpha'];

      const result = removeItemFromList(original, 'ALPHA');

      expect(result).toEqual(['Bravo']);
    });

    it('matches across string and object forms by name', () => {
      const original: SemanticItem[] = [
        { name: 'Catalog Item', description: 'first copy' },
        'catalog item',
        { name: 'Other Item' },
      ];

      const result = removeItemFromList(original, {
        name: 'CATALOG ITEM',
        description: 'query description does not matter',
      });

      expect(result).toEqual([{ name: 'Other Item' }]);
    });

    it('returns a new list and does not mutate the input array', () => {
      const original: SemanticItem[] = ['Alpha', 'Bravo'];

      const result = removeItemFromList(original, 'alpha');

      expect(result).toEqual(['Bravo']);
      expect(original).toEqual(['Alpha', 'Bravo']);
      expect(result).not.toBe(original);
    });

    it('returns unchanged items when there is no name match', () => {
      const original: SemanticItem[] = ['Alpha', { name: 'Bravo' }];

      const result = removeItemFromList(original, 'Charlie');

      expect(result).toEqual(['Alpha', { name: 'Bravo' }]);
    });
  });
});
