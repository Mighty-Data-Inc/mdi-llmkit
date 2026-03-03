import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OpenAI } from 'openai';
import { describe, expect, it } from 'vitest';

import { ocrIdentifyTablesOnPage } from '../../src/ocrTable/ocrImagesExtractTableData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
if (!OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required for ocrIdentifyTablesOnPage live API tests. Configure your test environment to provide it.'
  );
}

const createClient = (): OpenAI =>
  new OpenAI({
    apiKey: OPENAI_API_KEY,
  });

describe('ocrIdentifyTablesOnPage (live API)', () => {
  it('loads fixture page 2 and returns the expected table name', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageTwoPngPath = path.join(fixturesDir, 'school-supplies-bill-of-sale.page-2.png');
    const pageTwoBuffer = await readFile(pageTwoPngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageTwoBuffer,
      'middle'
    );

    expect(tables).toHaveLength(1);
    expect(tables[0]?.name).toBe('Classroom Purchases - Mr. Jonah Reed (Room 4B)');
  }, 180000);
});
