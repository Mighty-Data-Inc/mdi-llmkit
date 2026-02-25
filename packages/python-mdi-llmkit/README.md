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

## Notes

- Package name for `pip install` is `mdi-llmkit`.
- Python import package is `mdi_llmkit`.
- `gpt_submit` supports optional warning reporting via `warning_callback`.
