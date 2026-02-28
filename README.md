# mdi-llmkit
Utilities for managing multi-shot conversations and structured data handling in LLM applications

This repo contains shared, production-focused helpers we use at **Mighty Data Inc.** for building reliable LLM applications without rewriting the same plumbing in every project.

## Design goals

* Minimal abstractions
* Predictable behavior
* Cross-language parity (Python + TypeScript)
* Easy to drop into real projects

This is not a framework — just a clean, reusable toolkit for the parts of LLM integration that tend to get copy-pasted everywhere.

## Packages in this monorepo

- TypeScript package: `mdi-llmkit` (npm) in `packages/typescript-mdi-llmkit`
- Python package: `mdi-llmkit` (PyPI, import as `mdi_llmkit`) in `packages/python-mdi-llmkit`

Package-specific docs:

- TypeScript: [packages/typescript-mdi-llmkit/README.md](packages/typescript-mdi-llmkit/README.md)
- Python: [packages/python-mdi-llmkit/README.md](packages/python-mdi-llmkit/README.md)

## Feature overview

Shared core capabilities (Python + TypeScript):

- Conversation and multi-message submission helpers
- Structured JSON response support
- JSON schema helpers for structured output
- Model-guided JSON editing

TypeScript package also includes:

- Semantic list comparison utilities

## Quick start

### Python

```python
from mdi_llmkit.gpt_api import GptConversation
from mdi_llmkit.json_surgery import json_surgery
```

### TypeScript

```ts
import OpenAI from 'openai';
import { GptConversation } from 'mdi-llmkit';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const conversation = new GptConversation([], { openaiClient: client });
const reply = await conversation.submitUserMessage('Say hello.');
console.log(reply);
```

## Local dev (Windows)

### Python

From `packages/python-mdi-llmkit`, activate the package venv and run the jsonSurgery tests:

```powershell
.\venv\Scripts\Activate.ps1
python -c "import sys; print(sys.executable)"
python -m unittest tests/test_placemarked_json.py tests/test_json_surgery.py
```

Live `json_surgery` integration tests (real API) require `OPENAI_API_KEY`:

```powershell
python -m unittest tests/test_json_surgery.py
```

### TypeScript

From `packages/typescript-mdi-llmkit`, install dependencies and run tests/build:

```powershell
npm ci
npm test
npm run build
```

## Unit testing with live API calls

Some tests intentionally call the real OpenAI API instead of mocking model responses.

This is by design for AI-driven features (for example JSON editing and semantic comparison):

- We need to validate prompt behavior against the real model, not just our wrapper code.
- The core contract includes prompt wording + parsing logic + model output shape working together.
- Mock-only tests cannot verify whether production prompts still elicit the required behavior.

These tests do have tradeoffs:

- They require `OPENAI_API_KEY` in the test environment.
- They incur small API cost when run.
- They can be slower than pure unit tests, though concurrent execution reduces this significantly.

Deterministic assertions are still intentional here: tests are written with tightly scoped instructions and clearly defined JSON outcomes, so stable structured output is treated as a baseline requirement. If those tests fail, we treat it as a bug in prompt design, output handling, or integration behavior.

## Release process

This repo ships two public packages with aligned versions:

- npm: `mdi-llmkit` from `packages/typescript-mdi-llmkit`
- PyPI: `mdi-llmkit` from `packages/python-mdi-llmkit`

GitHub release automation publishes each package automatically on push to `main`
when its package version changes:

- TypeScript checks `packages/typescript-mdi-llmkit/package.json`
- Python checks `packages/python-mdi-llmkit/pyproject.toml`

Before publishing:

- Ensure both versions are updated (`package.json` and `pyproject.toml`).
- Authenticate once locally:
	- npm: `npm login`
	- PyPI: `python -m twine upload --repository pypi dist/*` (token prompt) or configure `~/.pypirc`

Optional manual preflight check (also run automatically by release scripts):

```powershell
.\scripts\release-preflight.ps1
```

From repo root, use the release scripts:

```powershell
.\scripts\release-typescript.ps1
```

```powershell
.\scripts\release-python.ps1
```

Or publish both, TypeScript first then Python:

```powershell
.\scripts\release-all.ps1
```

Each script has built-in PowerShell help:

```powershell
Get-Help .\scripts\release-all.ps1 -Full
```

After publish, tag and push a release tag (example):

```powershell
git tag v1.0.1
git push origin v1.0.1
```
