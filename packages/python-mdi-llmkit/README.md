# mdi-llmkit

Utilities for managing LLM chat conversations and structured JSON responses with OpenAI's Responses API.

## Installation

```bash
pip install mdi-llmkit
```

## Quick Start

### `gpt_submit`

```python
from openai import OpenAI
from mdi_llmkit.gpt_api.functions import gpt_submit

client = OpenAI()

reply = gpt_submit(
    messages=[{"role": "user", "content": "Say hello."}],
    openai_client=client,
)
print(reply)
```

### `GptConversation`

```python
from openai import OpenAI
from mdi_llmkit.gpt_api.gpt_conversation import GptConversation

client = OpenAI()
conversation = GptConversation(openai_client=client)

reply = conversation.submit_user_message("Give me three project name ideas.")
print(reply)
```

## JSON Response Mode

```python
from openai import OpenAI
from mdi_llmkit.gpt_api.functions import gpt_submit

client = OpenAI()

result = gpt_submit(
    messages=[{"role": "user", "content": "Return JSON with keys a and b."}],
    openai_client=client,
    json_response=True,
)

print(type(result))  # dict or list
print(result)
```

## JSON Surgery

```python
from openai import OpenAI
from mdi_llmkit.json_surgery.json_surgery import json_surgery

client = OpenAI()

obj = {"status": "pending", "tags": ["alpha"]}
result = json_surgery(
    client,
    obj,
    'Set status to "approved" and append "done" to tags.',
)

print(result)
```

Placemark helpers are available in `mdi_llmkit.json_surgery.placemarked_json`:
- `placemarked_json_stringify(obj, indent=2, skipped_keys=None)`
- `navigate_to_json_path(obj, json_path)`

## Local Dev (Windows venv)

From `packages/python-mdi-llmkit`, activate the project venv and run tests:

```powershell
.\venv\Scripts\Activate.ps1
python -c "import sys; print(sys.executable)"
python -m unittest tests/test_placemarked_json.py tests/test_json_surgery.py
```

## Notes

- Package name for `pip install` is `mdi-llmkit`.
- Python import package is `mdi_llmkit`.
- `gpt_submit` supports optional warning reporting via `warning_callback`.
