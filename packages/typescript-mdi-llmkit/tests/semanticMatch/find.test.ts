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
  expectedMatch: string,
  explanation?: string
) => {
  const result = await findSemanticMatch(
    createClient(),
    list,
    testItem,
    explanation
  );
  expect(result).toBe(expectedMatch);
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
  expect(result).toBeNull();
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

      expect(result).toBe('Measles');
    }, 180000);
  });

  describe('medicine colloquial vs clinical names', () => {
    it('maps Varicella to Chickenpox', async () => {
      await expectMatch(
        ['Chickenpox', 'Measles', 'Cold sore'],
        'Varicella',
        'Chickenpox'
      );
    }, 180000);

    it('maps Pertussis to Whooping cough', async () => {
      await expectMatch(
        ['Whooping cough', 'Mumps', 'Tetanus'],
        'Pertussis',
        'Whooping cough'
      );
    }, 180000);

    it('maps Rubella to German measles', async () => {
      await expectMatch(
        ['German measles', 'Scarlet fever', 'Shingles'],
        'Rubella',
        'German measles'
      );
    }, 180000);

    it('maps Conjunctivitis to Pink eye', async () => {
      await expectMatch(
        ['Pink eye', 'Flu', 'Strep throat'],
        'Conjunctivitis',
        'Pink eye'
      );
    }, 180000);

    it('maps Infectious mononucleosis to Mono', async () => {
      await expectMatch(
        ['Mono', 'Chickenpox', 'Bronchitis'],
        'Infectious mononucleosis',
        'Mono'
      );
    }, 180000);

    it('returns null for unrelated clinical condition', async () => {
      await expectNoMatch(
        ['Migraine', 'Asthma', 'Eczema'],
        'Appendicitis'
      );
    }, 180000);
  });

  describe('geography modern vs historical names', () => {
    it('maps Nippon to Japan', async () => {
      await expectMatch(['China', 'Japan', 'Singapore'], 'Nippon', 'Japan');
    }, 180000);

    it('maps Persia to Iran', async () => {
      await expectMatch(['Iran', 'Iraq', 'Turkey'], 'Persia', 'Iran');
    }, 180000);

    it('maps Siam to Thailand', async () => {
      await expectMatch(['Thailand', 'Vietnam', 'Laos'], 'Siam', 'Thailand');
    }, 180000);

    it('maps Ceylon to Sri Lanka', async () => {
      await expectMatch(['Sri Lanka', 'India', 'Nepal'], 'Ceylon', 'Sri Lanka');
    }, 180000);

    it('maps Burma to Myanmar', async () => {
      await expectMatch(['Myanmar', 'Bangladesh', 'Bhutan'], 'Burma', 'Myanmar');
    }, 180000);

    it('returns null when no country in list is semantically related', async () => {
      await expectNoMatch(['Canada', 'Mexico', 'Brazil'], 'Prussia');
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
        'Republic of the Congo',
        'Interpret Congo-Brazzaville as the country whose capital is Brazzaville. ' +
          'Do not map it to the Democratic Republic of the Congo.'
      );
    }, 180000);
  });
});
