# mdi-llmkit (TypeScript)

Utilities for managing LLM chat conversations and structured JSON responses with OpenAI's Responses API.

## Installation

```bash
npm install mdi-llmkit openai
```


## `compareItemLists` (semanticMatch)

`compareItemLists` performs a semantic diff between a "before" list and an "after" list,
including LLM-assisted rename/add/remove decisions.

Types:

- `SemanticallyComparableListItem`
  - `string`
  - `{ name: string; description?: string }`
- `ItemComparisonResult`
  - `Removed | Added | Renamed | Unchanged`
- `OnComparingItemCallback`
  - `(item, isFromBeforeList, isStarting, result, newName, error, totalProcessedSoFar, totalLeftToProcess) => void`

Behavior notes:

- Item matching is name-based and case-insensitive.
- `description` provides extra model context but is not identity.
- Names are expected to be unique within each list (case-insensitive).
- Progress callback is fired at item start (`isStarting=true`) and finish (`isStarting=false`).

Example:

```ts
import OpenAI from 'openai';
import {
  compareItemLists,
  ItemComparisonResult,
  type OnComparingItemCallback,
} from 'mdi-llmkit/semanticMatch';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const onComparingItem: OnComparingItemCallback = (
  item,
  isFromBeforeList,
  isStarting,
  result,
  newName,
  error,
  processed,
  left
) => {
  if (error) {
    console.warn('Comparison warning:', error);
  }
  if (!isStarting && result === ItemComparisonResult.Renamed) {
    console.log('Renamed:', item, '->', newName);
  }
  console.log({ isFromBeforeList, isStarting, result, processed, left });
};

const comparison = await compareItemLists(
  client,
  [{ name: 'Widget A', description: 'Legacy widget' }, 'Widget B'],
  [
    { name: 'Widget Alpha', description: 'Migrated name for Widget A' },
    'Widget B',
  ],
  'Widgets migrated from legacy catalog to new naming standards.',
  onComparingItem
);

console.log(comparison);
```

## JSON Response Mode

```ts
import OpenAI from 'openai';
import { gptSubmit } from 'mdi-llmkit';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const result = await gptSubmit(
  [{ role: 'user', content: 'Return JSON with keys a and b.' }],
  client,
  { jsonResponse: true }
);

console.log(result);
```


## CI and Release

- Unified CI + release workflow: `.github/workflows/typescript-release.yml`
  - Runs CI on pull requests and on pushes to `main` when TypeScript package files change.
  - Executes `npm ci`, `npm test`, and `npm run build` in `packages/typescript-mdi-llmkit`.
  - On push to `main`, publishes to npm only if `package.json` version changed and that version is not already published.
  - Uses repository secret `NPM_TOKEN` for npm authentication.
