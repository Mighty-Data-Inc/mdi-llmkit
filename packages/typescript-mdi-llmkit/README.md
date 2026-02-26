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
- Integer schemas can be expressed with `JSON_INTEGER`; numeric (float-capable) schemas can use `JSON_NUMBER`.
