# mdi-llmkit (TypeScript)

Utilities for managing LLM chat conversations and structured JSON responses with OpenAI's Responses API.

## Installation

```bash
npm install mdi-llmkit openai
```

## Quick Start

### `gptSubmit`

```ts
import OpenAI from 'openai';
import { gptSubmit } from 'mdi-llmkit';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const reply = await gptSubmit(
  [{ role: 'user', content: 'Say hello.' }],
  client
);

console.log(reply);
```

### `GptConversation`

```ts
import OpenAI from 'openai';
import { GptConversation } from 'mdi-llmkit';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const conversation = new GptConversation([], { openaiClient: client });

const reply = await conversation.submitUserMessage(
  'Give me three project name ideas.'
);
console.log(reply);
```

### `JSONSchemaFormat`

```ts
import { JSONSchemaFormat, JSON_INTEGER, gptSubmit } from 'mdi-llmkit';

const responseFormat = JSONSchemaFormat(
  'answer_payload',
  {
    answer: 'The final answer',
    confidence: ['Confidence score', [0, 100], []],
    rank: JSON_INTEGER,
  },
  'Structured answer payload'
);

const result = await gptSubmit(
  [{ role: 'user', content: 'Return answer as structured JSON.' }],
  client,
  { jsonResponse: responseFormat }
);
```

## `jsonSurgery`

`jsonSurgery` applies iterative, model-guided edits to a JSON-compatible object using
structured JSON-path operations (`assign`, `append`, `insert`, `delete`, `rename`).

```ts
import { jsonSurgery } from 'mdi-llmkit/jsonSurgery';
```

- It deep-copies the input object and returns the modified copy.
- It supports optional schema guidance and key-skipping for model-visible context.
- It supports validation/progress callbacks and soft iteration/time limits.

## `compareItemLists` (comparison)

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
} from 'mdi-llmkit/comparison';

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

## Notes

- Current TypeScript parity slices include `gptSubmit`, `GptConversation`, and `JSONSchemaFormat`.
- You can import GPT API symbols via subpath imports, e.g. `import { GptConversation } from "mdi-llmkit/gptApi"`.
- Comparison symbols are available via `mdi-llmkit/comparison`.
- Integer schemas can be expressed with `JSON_INTEGER`; numeric (float-capable) schemas can use `JSON_NUMBER`.

## Migration from Python

- Function naming: Python `gpt_submit(...)` maps to TypeScript `gptSubmit(...)`.
- Argument style: Python keyword args map to a TypeScript options object.
- Conversation submit methods: Python `submit_user_message(...)` maps to `submitUserMessage(...)`.
- JSON schema DSL: Python tuple metadata uses TypeScript array metadata.
  - Python: `("Age", (0, 120), int)`
  - TypeScript: `["Age", [0, 120], JSON_INTEGER]`
- JSON schema type markers in TypeScript:
  - `JSON_INTEGER` for integer-only values.
  - `JSON_NUMBER` for float-capable numeric values.

## CI and Release

- CI workflow: `.github/workflows/typescript-ci.yml`
  - Runs on push to `main` and on pull requests when TypeScript package files change.
  - Executes `npm ci`, `npm test`, and `npm run build` in `packages/typescript-mdi-llmkit`.
- Release workflow: `.github/workflows/typescript-release.yml`
  - Runs on tags matching `typescript-v*` (for example: `typescript-v1.0.1`).
  - Requires repository secret `NPM_TOKEN` with publish permission to npm.
  - Executes tests/build before `npm publish --access public --provenance`.
