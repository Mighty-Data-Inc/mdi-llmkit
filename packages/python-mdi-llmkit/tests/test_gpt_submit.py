import sys
import unittest
import json
from pathlib import Path
from typing import Any, List, Optional
from unittest.mock import patch

import openai
from openai._types import omit


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from mdi_llmkit.gpt_api.functions import GPT_MODEL_SMART, gpt_submit


class FakeResponse:
    def __init__(
        self,
        output_text: str = "",
        error: Optional[Any] = None,
        incomplete_details: Optional[Any] = None,
    ):
        self.output_text = output_text
        self.error = error
        self.incomplete_details = incomplete_details


class FakeResponsesAPI:
    def __init__(self, side_effects: Optional[List[Any]] = None):
        self.side_effects = side_effects or []
        self.create_calls: List[dict] = []

    def create(self, **kwargs):
        self.create_calls.append(kwargs)

        if not self.side_effects:
            return FakeResponse()

        next_effect = self.side_effects.pop(0)
        if isinstance(next_effect, BaseException):
            raise next_effect
        return next_effect


class FakeOpenAIClient:
    def __init__(self, side_effects: Optional[List[Any]] = None):
        self.responses = FakeResponsesAPI(side_effects=side_effects)


class FakeResponseNoneOutputText:
    def __init__(self):
        self.output_text = None
        self.error = None
        self.incomplete_details = None


class GPTSubmitFrameworkBase(unittest.TestCase):
    """Shared scaffolding helpers for gpt_submit unit tests."""

    def setUp(self):
        self.messages = [{"role": "user", "content": "Hello"}]

    def make_client(self, *effects: Any) -> FakeOpenAIClient:
        return FakeOpenAIClient(side_effects=list(effects))

    def make_response(
        self,
        output_text: str = "",
        error: Optional[Any] = None,
        incomplete_details: Optional[Any] = None,
    ) -> FakeResponse:
        return FakeResponse(
            output_text=output_text,
            error=error,
            incomplete_details=incomplete_details,
        )

    def call_submit(self, client: FakeOpenAIClient, **kwargs):
        return gpt_submit(self.messages, client, **kwargs)


class TestDefaultsAndInputShaping(GPTSubmitFrameworkBase):
    """Placeholder group for default model and request-shaping coverage."""

    def test_uses_default_model_and_omits_text_config_when_json_not_requested(self):
        client = self.make_client(self.make_response(output_text="ok"))

        result = self.call_submit(client)

        self.assertEqual(result, "ok")
        self.assertEqual(len(client.responses.create_calls), 1)
        request_payload = client.responses.create_calls[0]
        self.assertEqual(request_payload["model"], GPT_MODEL_SMART)
        self.assertIs(request_payload["text"], omit)

    def test_prepends_fresh_datetime_system_message_to_input(self):
        client = self.make_client(self.make_response(output_text="ok"))

        self.call_submit(client)

        request_payload = client.responses.create_calls[0]
        submitted_messages = request_payload["input"]
        self.assertGreaterEqual(len(submitted_messages), 2)
        first_message = submitted_messages[0]
        self.assertEqual(first_message["role"], "system")
        self.assertTrue(first_message["content"].startswith("!DATETIME:"))
        self.assertEqual(submitted_messages[1:], self.messages)


class TestSystemMessageBehavior(GPTSubmitFrameworkBase):
    """Placeholder group for datetime and announcement system-message behavior."""

    def test_replaces_existing_datetime_system_message(self):
        self.messages = [
            {"role": "system", "content": "!DATETIME: stale timestamp"},
            {"role": "system", "content": "keep me"},
            {"role": "user", "content": "Hello"},
        ]
        client = self.make_client(self.make_response(output_text="ok"))

        self.call_submit(client)

        submitted_messages = client.responses.create_calls[0]["input"]
        datetime_messages = [
            m
            for m in submitted_messages
            if m.get("role") == "system"
            and isinstance(m.get("content"), str)
            and m["content"].startswith("!DATETIME:")
        ]
        self.assertEqual(len(datetime_messages), 1)
        self.assertEqual(submitted_messages[1:], self.messages[1:])

    def test_prepends_announcement_before_datetime_and_trims_whitespace(self):
        client = self.make_client(self.make_response(output_text="ok"))

        self.call_submit(
            client, system_announcement_message="  Please follow policy.  "
        )

        submitted_messages = client.responses.create_calls[0]["input"]
        self.assertEqual(submitted_messages[0]["role"], "system")
        self.assertEqual(submitted_messages[0]["content"], "Please follow policy.")
        self.assertTrue(submitted_messages[1]["content"].startswith("!DATETIME:"))

    def test_ignores_blank_announcement_message(self):
        client = self.make_client(self.make_response(output_text="ok"))

        self.call_submit(client, system_announcement_message="   ")

        submitted_messages = client.responses.create_calls[0]["input"]
        self.assertTrue(submitted_messages[0]["content"].startswith("!DATETIME:"))


class TestResponseHandling(GPTSubmitFrameworkBase):
    """Placeholder group for plain-text and JSON response parsing behavior."""

    def test_returns_stripped_text_for_non_json_mode(self):
        client = self.make_client(self.make_response(output_text="   hello world\n\n"))

        result = self.call_submit(client)

        self.assertEqual(result, "hello world")

    def test_respects_explicit_model_override_in_non_json_mode(self):
        explicit_model = "gpt-4.1-nano"
        client = self.make_client(self.make_response(output_text="ok"))

        result = self.call_submit(client, model=explicit_model)

        self.assertEqual(result, "ok")
        request_payload = client.responses.create_calls[0]
        self.assertEqual(request_payload["model"], explicit_model)

    def test_malformed_response_object_raises_attribute_error_without_retry(self):
        client = self.make_client(object())

        with self.assertRaises(AttributeError):
            self.call_submit(client, retry_limit=5)

        self.assertEqual(len(client.responses.create_calls), 1)

    def test_response_with_none_output_text_raises_attribute_error(self):
        client = self.make_client(FakeResponseNoneOutputText())

        with self.assertRaises(AttributeError):
            self.call_submit(client, retry_limit=3)

        self.assertEqual(len(client.responses.create_calls), 1)


class TestRetryBehavior(GPTSubmitFrameworkBase):
    """Placeholder group for retry logic and terminal error propagation."""

    def test_retries_after_openai_error_and_then_succeeds(self):
        client = self.make_client(
            openai.OpenAIError("temporary failure"),
            self.make_response(output_text="recovered"),
        )
        warnings: List[str] = []

        with patch("mdi_llmkit.gpt_api.functions.time.sleep") as mock_sleep:
            result = self.call_submit(
                client,
                retry_limit=2,
                retry_backoff_time_seconds=7,
                warning_callback=warnings.append,
            )

        self.assertEqual(result, "recovered")
        self.assertEqual(len(client.responses.create_calls), 2)
        mock_sleep.assert_called_once_with(7)
        self.assertEqual(len(warnings), 1)
        self.assertIn("OpenAI API error", warnings[0])
        self.assertIn("Retrying (attempt 1 of 2)", warnings[0])

    def test_raises_last_openai_error_after_retries_exhausted(self):
        client = self.make_client(
            openai.OpenAIError("still failing"),
            openai.OpenAIError("still failing"),
        )

        with patch("mdi_llmkit.gpt_api.functions.time.sleep"):
            with self.assertRaises(openai.OpenAIError):
                self.call_submit(client, retry_limit=2, retry_backoff_time_seconds=0)

    def test_retries_after_json_decode_error_and_then_succeeds(self):
        client = self.make_client(
            self.make_response(output_text="not json"),
            self.make_response(output_text='{"ok": true}'),
        )
        warnings: List[str] = []

        result = self.call_submit(
            client,
            json_response=True,
            retry_limit=2,
            warning_callback=warnings.append,
        )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(client.responses.create_calls), 2)
        self.assertEqual(len(warnings), 1)
        self.assertIn("JSON decode error", warnings[0])
        self.assertIn("Retrying (attempt 1 of 2)", warnings[0])

    def test_raises_json_decode_error_when_json_retries_exhausted(self):
        client = self.make_client(self.make_response(output_text="not json"))

        with self.assertRaises(json.JSONDecodeError):
            self.call_submit(client, json_response=True, retry_limit=1)

    def test_raises_value_error_when_retry_limit_is_zero(self):
        client = self.make_client(self.make_response(output_text="unused"))

        with self.assertRaises(ValueError):
            self.call_submit(client, retry_limit=0)


class TestJsonModes(GPTSubmitFrameworkBase):
    """Placeholder group for json_response mode handling."""

    def test_warning_callback_receives_response_error_and_incomplete_detail_messages(
        self,
    ):
        client = self.make_client(
            self.make_response(
                output_text='{"ok": true}',
                error="non-fatal warning",
                incomplete_details={"reason": "truncated"},
            )
        )
        warnings: List[str] = []

        result = self.call_submit(
            client,
            json_response=True,
            warning_callback=warnings.append,
        )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(len(warnings), 2)
        self.assertIn("OpenAI API returned an error", warnings[0])
        self.assertIn("OpenAI API returned incomplete details", warnings[1])

    def test_json_response_true_uses_json_object_text_format(self):
        client = self.make_client(self.make_response(output_text='{"value": 1}'))

        result = self.call_submit(client, json_response=True)

        self.assertEqual(result, {"value": 1})
        request_payload = client.responses.create_calls[0]
        self.assertEqual(request_payload["text"], {"format": {"type": "json_object"}})

    def test_json_response_dict_is_deep_copied_and_augmented_without_mutating_input(
        self,
    ):
        schema = {
            "format": {
                "type": "json_schema",
                "name": "answer",
                "description": "Return the answer",
                "schema": {
                    "type": "object",
                    "properties": {"answer": {"type": "string"}},
                    "required": ["answer"],
                },
            }
        }
        client = self.make_client(self.make_response(output_text='{"answer": "ok"}'))

        result = self.call_submit(client, json_response=schema)

        self.assertEqual(result, {"answer": "ok"})
        self.assertEqual(schema["format"]["description"], "Return the answer")
        submitted_text = client.responses.create_calls[0]["text"]
        self.assertIn(
            "ABSOLUTELY NO UNICODE ALLOWED",
            submitted_text["format"]["description"],
        )

    def test_json_response_string_is_parsed_into_text_param(self):
        client = self.make_client(self.make_response(output_text='{"answer": 42}'))
        response_format_json = '{"format": {"type": "json_object"}}'

        result = self.call_submit(client, json_response=response_format_json)

        self.assertEqual(result, {"answer": 42})
        request_payload = client.responses.create_calls[0]
        self.assertEqual(request_payload["text"], {"format": {"type": "json_object"}})

    def test_json_mode_uses_raw_decode_and_accepts_trailing_text(self):
        client = self.make_client(
            self.make_response(output_text='{"first": 1}{"second": 2}')
        )

        result = self.call_submit(client, json_response=True)

        self.assertEqual(result, {"first": 1})

    def test_json_mode_returns_list_when_top_level_json_is_array(self):
        client = self.make_client(
            self.make_response(output_text='[{"id": 1}, {"id": 2}]')
        )

        result = self.call_submit(client, json_response=True)

        self.assertEqual(result, [{"id": 1}, {"id": 2}])

    def test_json_mode_parses_json_wrapped_in_whitespace(self):
        client = self.make_client(
            self.make_response(output_text='\n\t  {"ok": true}  \n')
        )

        result = self.call_submit(client, json_response=True)

        self.assertEqual(result, {"ok": True})

    def test_json_mode_passes_through_scalar_json_value(self):
        client = self.make_client(self.make_response(output_text="42"))

        result = self.call_submit(client, json_response=True)

        self.assertEqual(result, 42)

    def test_invalid_json_response_string_raises_before_api_call(self):
        client = self.make_client(self.make_response(output_text='{"unused": true}'))

        with self.assertRaises(json.JSONDecodeError):
            self.call_submit(client, json_response="{not valid json")

        self.assertEqual(client.responses.create_calls, [])


if __name__ == "__main__":
    unittest.main()
