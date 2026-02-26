# mdi-llmkit
Utilities for managing multi-shot conversations and structured data handling in LLM applications

This repo contains shared, production-focused helpers we use at **Mighty Data Inc.** for building reliable LLM applications without rewriting the same plumbing in every project.

## Design goals

* Minimal abstractions
* Predictable behavior
* Cross-language parity (Python + TypeScript)
* Easy to drop into real projects

This is not a framework — just a clean, reusable toolkit for the parts of LLM integration that tend to get copy-pasted everywhere.

## Local Python dev (Windows)

From `packages/python-mdi-llmkit`, activate the package venv and run the jsonSurgery tests:

```powershell
.\venv\Scripts\Activate.ps1
python -c "import sys; print(sys.executable)"
python -m unittest tests/test_placemarked_json.py tests/test_json_surgery.py
```

For fuller Python package usage and examples, see [packages/python-mdi-llmkit/README.md](packages/python-mdi-llmkit/README.md).
