# mightydatainc-mdi-llmkit

Python meta-package for the Mighty Data LLM toolkit.

This package is a convenience installer. It does not provide its own runtime API surface. Instead, it installs the core component packages used in Python projects.

## Installation

```bash
pip install mightydatainc-mdi-llmkit
```

## Installed Component Packages

Installing this meta-package pulls in:

- `mightydatainc-llm-conversation`
- `mightydatainc-json-surgery`
- `mightydatainc-semantic-match`

## Usage

Import functionality from the component packages directly:

```python
from mightydatainc_llm_conversation import LLMConversation
from mightydatainc_json_surgery import json_surgery
from mightydatainc_semantic_match import find_semantic_match
```

Refer to each component repository/package documentation for API details and examples.

## Notes

- PyPI distribution name: `mightydatainc-mdi-llmkit`
- Local Python package namespace in this repository: `mdi_llmkit` (intentionally minimal for meta-package behavior)
