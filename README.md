# mdi-llmkit
Utilities for managing multi-shot conversations and structured data handling in LLM applications

This repo contains shared, production-focused helpers we use at **Mighty Data Inc.** for building reliable LLM applications without rewriting the same plumbing in every project.

## Design goals

* Minimal abstractions
* Predictable behavior
* Cross-language parity (Python + TypeScript)
* Easy to drop into real projects

This is not a framework — just a clean, reusable toolkit for the parts of LLM integration that tend to get copy-pasted everywhere.

## Preferred Python imports

```python
from mdi_llmkit.gpt_api import GptConversation
from mdi_llmkit.json_surgery import json_surgery
```

## Local Python dev (Windows)

From `packages/python-mdi-llmkit`, activate the package venv and run the jsonSurgery tests:

```powershell
.\venv\Scripts\Activate.ps1
python -c "import sys; print(sys.executable)"
python -m unittest tests/test_placemarked_json.py tests/test_json_surgery_unit.py
```

Live `json_surgery` integration tests (real API) require `OPENAI_API_KEY`:

```powershell
python -m unittest tests/test_json_surgery.py
```

For fuller Python package usage and examples, see [packages/python-mdi-llmkit/README.md](packages/python-mdi-llmkit/README.md).

## Release process

This repo ships two public packages with aligned versions:

- npm: `mdi-llmkit` from `packages/typescript-mdi-llmkit`
- PyPI: `mdi-llmkit` from `packages/python-mdi-llmkit`

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
