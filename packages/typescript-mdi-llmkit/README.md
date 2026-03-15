# @mightydatainc/mdi-llmkit

TypeScript/Node meta-package for the Mighty Data LLM toolkit.

## Full Project Documentation

For the complete project overview and rationale, see the repository README:

- https://github.com/Mighty-Data-Inc/mdi-llmkit#readme

This package is a convenience installer. It does not define a runtime API surface of its own. Instead, it installs the core component packages used in TypeScript and JavaScript projects.

## Installation

```bash
npm install @mightydatainc/mdi-llmkit
```

## Installed Component Packages

Installing this meta-package pulls in:

- `@mightydatainc/llm-conversation`
- `@mightydatainc/json-surgery`
- `@mightydatainc/semantic-match`

## Usage

Import functionality from the component packages directly:

```ts
import * as llmConversation from '@mightydatainc/llm-conversation';
import * as jsonSurgery from '@mightydatainc/json-surgery';
import * as semanticMatch from '@mightydatainc/semantic-match';
```

Refer to each component package documentation for API details and examples.

## Notes

- npm package name: `@mightydatainc/mdi-llmkit`
- This package is dependency-only by design.
