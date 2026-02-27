# mdi-llmkit (TypeScript)

Utilities for managing LLM chat conversations and structured JSON responses with OpenAI's Responses API.

## Installation

```bash
npm install mdi-llmkit openai
```

## Quick Start

### `gptSubmit`

```ts
import OpenAI from "openai";
import { gptSubmit } from "mdi-llmkit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const reply = await gptSubmit(
	[{ role: "user", content: "Say hello." }],
	client,
);

console.log(reply);
```

### `GptConversation`

```ts
import OpenAI from "openai";
import { GptConversation } from "mdi-llmkit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const conversation = new GptConversation([], { openaiClient: client });

const reply = await conversation.submitUserMessage("Give me three project name ideas.");
console.log(reply);
```

### `JSONSchemaFormat`

```ts
import { JSONSchemaFormat, JSON_INTEGER, gptSubmit } from "mdi-llmkit";

const responseFormat = JSONSchemaFormat(
	{
		answer: "The final answer",
		confidence: ["Confidence score", [0, 100], []],
		rank: JSON_INTEGER,
	},
	{
		name: "answer_payload",
		description: "Structured answer payload",
	},
);

const result = await gptSubmit(
	[{ role: "user", content: "Return answer as structured JSON." }],
	client,
	{ jsonResponse: responseFormat },
);
```

## `jsonSurgery`

`jsonSurgery` applies iterative, model-guided edits to a JSON-compatible object using
structured JSON-path operations (`assign`, `append`, `insert`, `delete`, `rename`).

```ts
import { jsonSurgery } from "mdi-llmkit/jsonSurgery";
```

- It deep-copies the input object and returns the modified copy.
- It supports optional schema guidance and key-skipping for model-visible context.
- It supports validation/progress callbacks and soft iteration/time limits.

## JSON Response Mode

```ts
import OpenAI from "openai";
import { gptSubmit } from "mdi-llmkit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const result = await gptSubmit(
	[{ role: "user", content: "Return JSON with keys a and b." }],
	client,
	{ jsonResponse: true },
);

console.log(result);
```

## Notes

- Current TypeScript parity slices include `gptSubmit`, `GptConversation`, and `JSONSchemaFormat`.
- You can import GPT API symbols via subpath imports, e.g. `import { GptConversation } from "mdi-llmkit/gptApi"`.
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
	- Runs on tags matching `typescript-v*` (for example: `typescript-v0.1.0`).
	- Requires repository secret `NPM_TOKEN` with publish permission to npm.
	- Executes tests/build before `npm publish --access public --provenance`.
