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
  it('can detect two tables on a page when that is all that is on the page', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageThreePngPath = path.join(fixturesDir, 'school-supplies-BOS-11pt-page-3.png');
    const pageThreeBuffer = await readFile(pageThreePngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageThreeBuffer,
      undefined
    );

    expect(tables).toHaveLength(2);
    expect(tables[0]?.name).toBe('Classroom Purchases - Ms. Tessa Monroe (Room 2D)');
    expect(tables[1]?.name).toBe('Classroom Purchases - Mr. Omar Whitfield (Room 1A)');
  }, 180000);


  it('can detect two table names even when there is other text on the page', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageOnePngPath = path.join(fixturesDir, 'school-supplies-BOS-11pt-page-1.png');
    const pageOneBuffer = await readFile(pageOnePngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageOneBuffer,
      undefined
    );

    expect(tables).toHaveLength(2);
    expect(tables[0]?.name).toBe('Classroom Purchases - Ms. Elena Alvarez (Room 3A)');
    expect(tables[1]?.name).toBe('Classroom Purchases - Mr. Jonah Reed (Room 4B)');
  }, 180000);

  it('can read an orphaned table name', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageThreePngPath = path.join(fixturesDir, 'school-supplies-BOS-14pt-page-3.png');
    const pageFourPngPath = path.join(fixturesDir, 'school-supplies-BOS-14pt-page-4.png');
    const pageThreeBuffer = await readFile(pageThreePngPath);
    const pageFourBuffer = await readFile(pageFourPngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageThreeBuffer,
      undefined,
      undefined,
      undefined,
      undefined,
      pageFourBuffer
    );

    expect(tables).toHaveLength(2);
    expect(tables[0]?.name).toBe('Classroom Purchases - Ms. Priya Nandakumar (Room 5C)');
    expect(tables[1]?.name).toBe('Classroom Purchases - Ms. Tessa Monroe (Room 2D)');
  }, 180000);

  it('does not get distracted by next-page context on 14pt page 1', async () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures');
    const pageOnePngPath = path.join(fixturesDir, 'school-supplies-BOS-14pt-page-1.png');
    const pageTwoPngPath = path.join(fixturesDir, 'school-supplies-BOS-14pt-page-2.png');
    const pageOneBuffer = await readFile(pageOnePngPath);
    const pageTwoBuffer = await readFile(pageTwoPngPath);

    const tables = await ocrIdentifyTablesOnPage(
      createClient(),
      pageOneBuffer,
      undefined,
      undefined,
      undefined,
      undefined,
      pageTwoBuffer
    );

    expect(tables).toHaveLength(1);
    expect(tables[0]?.name).toBe('Classroom Purchases - Ms. Elena Alvarez (Room 3A)');
  }, 180000);
});
