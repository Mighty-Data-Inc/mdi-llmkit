import { OpenAI } from 'openai';
import { describe, expect, it } from 'vitest';

import { findSemanticMatch } from '../../src/semanticMatch/find.js';
import type { SemanticItem } from '../../src/semanticMatch/semanticItem.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
if (!OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required for findSemanticMatch live API tests. Configure your test environment to provide it.'
  );
}

const createClient = (): OpenAI =>
  new OpenAI({
    apiKey: OPENAI_API_KEY,
  });

const expectMatch = async (
  list: SemanticItem[],
  testItem: SemanticItem,
  expectedIndex: number,
  explanation?: string
) => {
  const result = await findSemanticMatch(
    createClient(),
    list,
    testItem,
    explanation
  );
  expect(result).toBe(expectedIndex);
};

const expectNoMatch = async (
  list: SemanticItem[],
  testItem: SemanticItem,
  explanation?: string
) => {
  const result = await findSemanticMatch(
    createClient(),
    list,
    testItem,
    explanation
  );
  expect(result).toBe(-1);
};

const expectOneOfMatches = async (
  list: SemanticItem[],
  testItem: SemanticItem,
  expectedIndexes: number[],
  explanation?: string
) => {
  const result = await findSemanticMatch(
    createClient(),
    list,
    testItem,
    explanation
  );
  expect(expectedIndexes).toContain(result);
};

describe('findSemanticMatch (live API)', () => {
  // IMPORTANT: These tests intentionally use live OpenAI calls and DO NOT mock GptConversation.
  // We are validating real prompt+schema behavior end-to-end.

  describe('exact-match short-circuit behavior', () => {
    it('returns case-insensitive exact match without needing LLM resolution', async () => {
      const invalidClient = new OpenAI({
        apiKey: `${OPENAI_API_KEY}-INTENTIONALLY-INVALID-FOR-EXACT-MATCH-TEST`,
      });

      const result = await findSemanticMatch(
        invalidClient,
        ['Chickenpox', 'Measles', 'Cold sore'],
        'measles'
      );

      expect(result).toBe(1);
    }, 180000);

    it('returns the first index when multiple string items match case-insensitively', async () => {
      const invalidClient = new OpenAI({
        apiKey: `${OPENAI_API_KEY}-INTENTIONALLY-INVALID-FOR-DUPLICATE-INDEX-TEST`,
      });

      const result = await findSemanticMatch(
        invalidClient,
        ['Georgia', 'France', 'GEORGIA'],
        'georgia'
      );

      expect(result).toBe(0);
    }, 180000);

    it('short-circuits when list item has description but test item is string', async () => {
      const invalidClient = new OpenAI({
        apiKey: `${OPENAI_API_KEY}-INTENTIONALLY-INVALID-FOR-STRING-OBJECT-SHORTCUT-TEST`,
      });

      const result = await findSemanticMatch(
        invalidClient,
        [
          {
            name: 'Georgia',
            description:
              'A sovereign country in the South Caucasus. Capital: Tbilisi.',
          },
          {
            name: 'France',
            description: 'A country in Western Europe. Capital: Paris.',
          },
        ],
        'Georgia'
      );

      expect(result).toBe(0);
    }, 180000);

    it('short-circuits when both name/desc items have equal descriptions after trimming', async () => {
      const invalidClient = new OpenAI({
        apiKey: `${OPENAI_API_KEY}-INTENTIONALLY-INVALID-FOR-EQUAL-DESCRIPTION-SHORTCUT-TEST`,
      });

      const result = await findSemanticMatch(
        invalidClient,
        [
          {
            name: 'Georgia',
            description: 'A U.S. state in the southeastern U.S. Capital: Atlanta.',
          },
          {
            name: 'France',
            description: 'A country in Western Europe. Capital: Paris.',
          },
        ],
        {
          name: 'Georgia',
          description:
            '  A U.S. state in the southeastern U.S. Capital: Atlanta.  ',
        }
      );

      expect(result).toBe(0);
    }, 180000);

    it('does not short-circuit when names match but descriptions conflict', async () => {
      const invalidClient = new OpenAI({
        apiKey: `${OPENAI_API_KEY}-INTENTIONALLY-INVALID-FOR-CONFLICTING-DESCRIPTION-TEST`,
      });

      await expect(
        findSemanticMatch(
          invalidClient,
          [
            {
              name: 'Georgia',
              description:
                'A U.S. state in the southeastern United States. Capital: Atlanta.',
            },
            {
              name: 'France',
              description: 'A country in Western Europe. Capital: Paris.',
            },
          ],
          {
            name: 'Georgia',
            description:
              'A sovereign country in the South Caucasus. Capital: Tbilisi.',
          }
        )
      ).rejects.toThrow();
    }, 180000);
  });

  describe('medicine colloquial vs clinical names', () => {
    it('maps Varicella to Chickenpox', async () => {
      await expectMatch(
        ['Chickenpox', 'Measles', 'Cold sore'],
        'Varicella',
        0
      );
    }, 180000);

    it('maps Pertussis to Whooping cough', async () => {
      await expectMatch(
        ['Whooping cough', 'Mumps', 'Tetanus'],
        'Pertussis',
        0
      );
    }, 180000);

    it('maps Rubella to German measles', async () => {
      await expectMatch(
        ['German measles', 'Scarlet fever', 'Shingles'],
        'Rubella',
        0
      );
    }, 180000);

    it('maps Conjunctivitis to Pink eye', async () => {
      await expectMatch(
        ['Pink eye', 'Flu', 'Strep throat'],
        'Conjunctivitis',
        0
      );
    }, 180000);

    it('maps Infectious mononucleosis to Mono', async () => {
      await expectMatch(
        ['Mono', 'Chickenpox', 'Bronchitis'],
        'Infectious mononucleosis',
        0
      );
    }, 180000);

    it('returns -1 for unrelated clinical condition', async () => {
      await expectNoMatch(
        ['Migraine', 'Asthma', 'Eczema'],
        'Appendicitis'
      );
    }, 180000);
  });

  describe('geography modern vs historical names', () => {
    it('maps Nippon to Japan', async () => {
      await expectMatch(['China', 'Japan', 'Singapore'], 'Nippon', 1);
    }, 180000);

    it('maps Persia to Iran', async () => {
      await expectMatch(['Iran', 'Iraq', 'Turkey'], 'Persia', 0);
    }, 180000);

    it('maps Siam to Thailand', async () => {
      await expectMatch(['Thailand', 'Vietnam', 'Laos'], 'Siam', 0);
    }, 180000);

    it('maps Ceylon to Sri Lanka', async () => {
      await expectMatch(['Sri Lanka', 'India', 'Nepal'], 'Ceylon', 0);
    }, 180000);

    it('maps Burma to Myanmar', async () => {
      await expectMatch(['Myanmar', 'Bangladesh', 'Bhutan'], 'Burma', 0);
    }, 180000);

    it('returns -1 when no country in list is semantically related', async () => {
      await expectNoMatch(['Canada', 'Mexico', 'Brazil'], 'Prussia');
    }, 180000);
  });

  describe('geography same-name disambiguation (Georgia)', () => {
    it('chooses Georgia the country when both state and country are present as name/desc items', async () => {
      await expectMatch(
        [
          {
            name: 'Georgia',
            description:
              'A U.S. state in the southeastern United States. Capital: Atlanta.',
          },
          {
            name: 'Georgia',
            description:
              'A sovereign country in the South Caucasus. Capital: Tbilisi.',
          },
          {
            name: 'France',
            description: 'A country in Western Europe. Capital: Paris.',
          },
        ],
        {
          name: 'Georgia',
          description:
            'A country in the South Caucasus bordered by Turkey, Armenia, and Azerbaijan. Capital: Tbilisi.',
        },
        1
      );
    }, 180000);

    it('chooses Georgia the U.S. state when both state and country are present as name/desc items', async () => {
      await expectMatch(
        [
          {
            name: 'Georgia',
            description:
              'A U.S. state in the southeastern United States. Capital: Atlanta.',
          },
          {
            name: 'Georgia',
            description:
              'A sovereign country in the South Caucasus. Capital: Tbilisi.',
          },
          {
            name: 'France',
            description: 'A country in Western Europe. Capital: Paris.',
          },
        ],
        {
          name: 'Georgia',
          description:
            'A U.S. state in the southeastern U.S. with Atlanta as its capital.',
        },
        0
      );
    }, 180000);

    it('accepts either Georgia index for string-only test item with several red herrings', async () => {
      await expectOneOfMatches(
        [
          {
            name: 'Georgia',
            description:
              'A U.S. state in the southeastern United States. Capital: Atlanta.',
          },
          {
            name: 'Georgia',
            description:
              'A sovereign country in the South Caucasus. Capital: Tbilisi.',
          },
          {
            name: 'France',
            description: 'A country in Western Europe. Capital: Paris.',
          },
          {
            name: 'Florida',
            description:
              'A U.S. state in the southeastern U.S. Capital: Tallahassee.',
          },
          {
            name: 'Armenia',
            description: 'A country in the South Caucasus. Capital: Yerevan.',
          },
        ],
        'Georgia',
        [0, 1]
      );
    }, 180000);

    it('matches the single Georgia string item when test item provides state description', async () => {
      await expectMatch(
        ['Georgia', 'France', 'Japan'],
        {
          name: 'Georgia',
          description:
            'A U.S. state in the southeastern United States. Capital: Atlanta.',
        },
        0
      );
    }, 180000);
  });

  describe('context-guided disambiguation', () => {
    it('uses explanation to choose the correct Congo variant', async () => {
      await expectMatch(
        [
          'Republic of the Congo',
          'Democratic Republic of the Congo',
          'Gabon',
        ],
        'Congo-Brazzaville',
        0,
        'Interpret Congo-Brazzaville as the country whose capital is Brazzaville. ' +
          'Do not map it to the Democratic Republic of the Congo.'
      );
    }, 180000);
  });
});
