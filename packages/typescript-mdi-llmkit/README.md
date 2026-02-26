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

- Current TypeScript parity slices include `gptSubmit` and `GptConversation`.
- The JSON schema helper parity (`JSONSchemaFormat`) is planned for a follow-up session.
