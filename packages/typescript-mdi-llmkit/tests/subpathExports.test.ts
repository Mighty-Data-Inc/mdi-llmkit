import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

const DIST_GPTAPI_INDEX = path.resolve('dist/src/gptApi/index.js');
const DIST_JSON_SURGERY = path.resolve('dist/src/jsonSurgery/index.js');
const DIST_SEMANTIC_MATCH_INDEX = path.resolve('dist/src/semanticMatch/index.js');

beforeAll(() => {
  if (
    !existsSync(DIST_GPTAPI_INDEX) ||
    !existsSync(DIST_JSON_SURGERY) ||
    !existsSync(DIST_SEMANTIC_MATCH_INDEX)
  ) {
    execSync('npm run build', { stdio: 'inherit' });
  }
});

describe('package subpath exports', () => {
  it('declares gptApi, jsonSurgery, and semanticMatch in package exports', async () => {
    const packageJsonPath = path.resolve('package.json');
    const packageJsonRaw = await readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonRaw) as {
      exports?: Record<string, { types?: string; import?: string }>;
    };

    expect(packageJson.exports?.['./gptApi']).toBeDefined();
    expect(packageJson.exports?.['./gptApi']?.types).toBe(
      './dist/src/gptApi/index.d.ts'
    );
    expect(packageJson.exports?.['./gptApi']?.import).toBe(
      './dist/src/gptApi/index.js'
    );

    expect(packageJson.exports?.['./jsonSurgery']).toBeDefined();
    expect(packageJson.exports?.['./jsonSurgery']?.types).toBe(
      './dist/src/jsonSurgery/index.d.ts'
    );
    expect(packageJson.exports?.['./jsonSurgery']?.import).toBe(
      './dist/src/jsonSurgery/index.js'
    );

    expect(packageJson.exports?.['./semanticMatch']).toBeDefined();
    expect(packageJson.exports?.['./semanticMatch']?.types).toBe(
      './dist/src/semanticMatch/index.d.ts'
    );
    expect(packageJson.exports?.['./semanticMatch']?.import).toBe(
      './dist/src/semanticMatch/index.js'
    );
  });

  it('imports GPT API symbols from "mdi-llmkit/gptApi"', async () => {
    const mod = await import('mdi-llmkit/gptApi');

    expect(typeof mod.gptSubmit).toBe('function');
    expect(typeof mod.GptConversation).toBe('function');
    expect(typeof mod.JSONSchemaFormat).toBe('function');
  });

  it('imports jsonSurgery symbols from "mdi-llmkit/jsonSurgery"', async () => {
    const mod = await import('mdi-llmkit/jsonSurgery');

    expect(typeof mod.jsonSurgery).toBe('function');
    expect(typeof mod.JSONSurgeryError).toBe('function');
  });

  it('imports semanticMatch symbols from "mdi-llmkit/semanticMatch"', async () => {
    const mod = await import('mdi-llmkit/semanticMatch');

    expect(typeof mod.compareItemLists).toBe('function');
    expect(typeof mod.ItemComparisonResult).toBe('object');
    expect(typeof mod.getItemName).toBe('function');
    expect(typeof mod.itemToPromptString).toBe('function');
    expect(typeof mod.compareItems).toBe('function');
    expect(typeof mod.areItemNamesEqual).toBe('function');
  });
});
