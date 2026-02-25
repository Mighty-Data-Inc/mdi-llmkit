import sys
import unittest
from pathlib import Path
from typing import Any, List, Optional
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from mdi_llmkit.gpt_api.functions import GPT_MODEL_SMART
from mdi_llmkit.gpt_api.gpt_conversation import GptConversation


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


class GptConversationFrameworkBase(unittest.TestCase):
    """Shared scaffolding helpers for GptConversation unit tests."""

    def setUp(self):
        self.initial_messages = [{"role": "user", "content": "Hello"}]

    def make_client(self, *effects: Any) -> FakeOpenAIClient:
        return FakeOpenAIClient(side_effects=list(effects))

    def make_conversation(
        self,
        messages: Optional[List[dict]] = None,
        *,
        client: Optional[FakeOpenAIClient] = None,
        model: Optional[str] = None,
    ) -> GptConversation:
        return GptConversation(
            messages=messages if messages is not None else list(self.initial_messages),
            openai_client=client,
            model=model,
        )


class TestConstructionAndState(GptConversationFrameworkBase):
    """Constructor defaults and stored state behavior."""

    def test_constructor_defaults_to_empty_messages_no_client_and_no_model(self):
        conversation = GptConversation()

        self.assertEqual(conversation, [])
        self.assertIsNone(conversation.openai_client)
        self.assertIsNone(conversation.model)
        self.assertIsNone(conversation.last_reply)

    def test_constructor_preserves_initial_messages_client_and_model(self):
        messages = [{"role": "user", "content": "hello"}]
        client = self.make_client()

        conversation = GptConversation(
            messages=messages,
            openai_client=client,
            model="gpt-custom",
        )

        self.assertEqual(conversation, messages)
        self.assertIs(conversation.openai_client, client)
        self.assertEqual(conversation.model, "gpt-custom")

    def test_assign_messages_replaces_existing_messages_and_returns_self(self):
        conversation = self.make_conversation(
            messages=[{"role": "user", "content": "old"}]
        )
        new_messages = [
            {"role": "system", "content": "new"},
            {"role": "user", "content": "hello"},
        ]

        returned = conversation.assign_messages(new_messages)

        self.assertIs(returned, conversation)
        self.assertEqual(conversation, new_messages)

    def test_assign_messages_none_clears_conversation(self):
        conversation = self.make_conversation()

        conversation.assign_messages(None)

        self.assertEqual(conversation, [])

    def test_clone_returns_deep_copy_with_same_client_and_model(self):
        client = self.make_client()
        conversation = self.make_conversation(
            messages=[{"role": "user", "content": "hi", "meta": {"x": 1}}],
            client=client,
            model="gpt-custom",
        )

        cloned = conversation.clone()

        self.assertIsNot(cloned, conversation)
        self.assertEqual(cloned, conversation)
        self.assertIs(cloned.openai_client, client)
        self.assertEqual(cloned.model, "gpt-custom")

        cloned[0]["meta"]["x"] = 2
        self.assertEqual(conversation[0]["meta"]["x"], 1)


class TestMessageManagement(GptConversationFrameworkBase):
    """Message append helpers and message-query behavior."""

    def test_add_message_keeps_string_content(self):
        conversation = self.make_conversation(messages=[])

        returned = conversation.add_message("user", "plain text")

        self.assertIs(returned, conversation)
        self.assertEqual(conversation[-1], {"role": "user", "content": "plain text"})

    def test_add_message_serializes_dict_content_as_pretty_json(self):
        conversation = self.make_conversation(messages=[])

        conversation.add_message("user", {"a": 1})

        self.assertEqual(conversation[-1]["role"], "user")
        self.assertEqual(conversation[-1]["content"], '{\n  "a": 1\n}')

    def test_add_message_converts_non_str_non_dict_with_str(self):
        conversation = self.make_conversation(messages=[])

        conversation.add_message("user", 123)

        self.assertEqual(conversation[-1], {"role": "user", "content": "123"})

    def test_role_specific_add_helpers_use_expected_roles(self):
        conversation = self.make_conversation(messages=[])

        conversation.add_user_message("u")
        conversation.add_assistant_message("a")
        conversation.add_system_message("s")
        conversation.add_developer_message("d")

        self.assertEqual(
            [m["role"] for m in conversation],
            ["user", "assistant", "system", "developer"],
        )

    def test_get_last_message_returns_none_when_empty(self):
        conversation = self.make_conversation(messages=[])

        self.assertIsNone(conversation.get_last_message())

    def test_get_last_message_returns_tail_message(self):
        conversation = self.make_conversation(
            messages=[
                {"role": "user", "content": "first"},
                {"role": "assistant", "content": "second"},
            ]
        )

        self.assertEqual(
            conversation.get_last_message(),
            {"role": "assistant", "content": "second"},
        )

    def test_get_messages_by_role_filters_correctly(self):
        conversation = self.make_conversation(
            messages=[
                {"role": "user", "content": "u1"},
                {"role": "assistant", "content": "a1"},
                {"role": "user", "content": "u2"},
            ]
        )

        result = conversation.get_messages_by_role("user")

        self.assertEqual(
            result,
            [
                {"role": "user", "content": "u1"},
                {"role": "user", "content": "u2"},
            ],
        )

    def test_to_dict_list_returns_list_view_of_messages(self):
        conversation = self.make_conversation()

        result = conversation.to_dict_list()

        self.assertIsInstance(result, list)
        self.assertEqual(result, list(conversation))


class TestSubmissionWorkflow(GptConversationFrameworkBase):
    """Submit flow, model selection, and submit_* wrappers."""

    def test_submit_without_message_uses_instance_model(self):
        client = self.make_client()
        conversation = self.make_conversation(client=client, model="gpt-instance")

        with patch("mdi_llmkit.gpt_api.gpt_conversation.gpt_submit") as mock_submit:
            mock_submit.return_value = "reply"

            result = conversation.submit()

        self.assertEqual(result, "reply")
        self.assertEqual(conversation.last_reply, "reply")
        self.assertEqual(conversation[-1], {"role": "assistant", "content": "reply"})
        mock_submit.assert_called_once_with(
            messages=self.initial_messages,
            openai_client=client,
            json_response=None,
            model="gpt-instance",
        )

    def test_submit_prefers_explicit_model_over_instance_model(self):
        client = self.make_client()
        conversation = self.make_conversation(client=client, model="gpt-instance")

        with patch("mdi_llmkit.gpt_api.gpt_conversation.gpt_submit") as mock_submit:
            mock_submit.return_value = "reply"
            conversation.submit(model="gpt-explicit")

        self.assertEqual(mock_submit.call_args.kwargs["model"], "gpt-explicit")

    def test_submit_uses_default_model_when_no_model_set(self):
        client = self.make_client()
        conversation = self.make_conversation(client=client, model=None)

        with patch("mdi_llmkit.gpt_api.gpt_conversation.gpt_submit") as mock_submit:
            mock_submit.return_value = "reply"
            conversation.submit()

        self.assertEqual(mock_submit.call_args.kwargs["model"], GPT_MODEL_SMART)

    def test_submit_with_string_message_appends_user_then_assistant(self):
        client = self.make_client()
        conversation = self.make_conversation(messages=[], client=client)

        with patch("mdi_llmkit.gpt_api.gpt_conversation.gpt_submit") as mock_submit:
            mock_submit.return_value = "assistant reply"
            result = conversation.submit(message="hello")

        self.assertEqual(result, "assistant reply")
        self.assertEqual(
            conversation,
            [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "assistant reply"},
            ],
        )

    def test_submit_with_dict_message_infers_json_response_and_role_when_missing(self):
        client = self.make_client()
        conversation = self.make_conversation(messages=[], client=client)
        message = {
            "format": {"type": "json_object"},
            "role": "developer",
            "content": "Return JSON only.",
        }

        with patch("mdi_llmkit.gpt_api.gpt_conversation.gpt_submit") as mock_submit:
            mock_submit.return_value = {"ok": True}
            result = conversation.submit(message=message, role=None)

        self.assertEqual(result, {"ok": True})
        self.assertEqual(
            conversation[0], {"role": "developer", "content": "Return JSON only."}
        )
        self.assertEqual(
            mock_submit.call_args.kwargs["json_response"],
            message,
        )
        self.assertEqual(
            conversation[-1],
            {"role": "assistant", "content": '{\n  "ok": true\n}'},
        )

    def test_submit_with_dict_message_respects_explicit_json_response(self):
        client = self.make_client()
        conversation = self.make_conversation(messages=[], client=client)
        message = {
            "format": {"type": "json_object"},
            "role": "user",
            "content": "ignored role because role arg set",
        }
        explicit_json_response = {"format": {"type": "json_schema"}}

        with patch("mdi_llmkit.gpt_api.gpt_conversation.gpt_submit") as mock_submit:
            mock_submit.return_value = "ok"
            conversation.submit(
                message=message,
                role="system",
                json_response=explicit_json_response,
            )

        self.assertEqual(conversation[0]["role"], "system")
        self.assertEqual(
            mock_submit.call_args.kwargs["json_response"],
            explicit_json_response,
        )

    def test_submit_message_wrappers_add_role_and_return_reply(self):
        client = self.make_client()
        conversation = self.make_conversation(messages=[], client=client)

        with patch("mdi_llmkit.gpt_api.gpt_conversation.gpt_submit") as mock_submit:
            mock_submit.side_effect = ["r1", "r2", "r3", "r4", "r5"]

            self.assertEqual(conversation.submit_message("system", "m1"), "r1")
            self.assertEqual(conversation.submit_user_message("m2"), "r2")
            self.assertEqual(conversation.submit_assistant_message("m3"), "r3")
            self.assertEqual(conversation.submit_system_message("m4"), "r4")
            self.assertEqual(conversation.submit_developer_message("m5"), "r5")

        self.assertEqual(
            [m["role"] for m in conversation[::2]],
            ["system", "user", "assistant", "system", "developer"],
        )


class TestLastReplyAccessors(GptConversationFrameworkBase):
    """last_reply accessor behavior for type-specific convenience methods."""

    def test_get_last_reply_str_returns_last_reply_when_string(self):
        conversation = self.make_conversation()
        conversation.last_reply = "hello"

        self.assertEqual(conversation.get_last_reply_str(), "hello")

    def test_get_last_reply_str_returns_empty_when_non_string(self):
        conversation = self.make_conversation()
        conversation.last_reply = {"a": 1}

        self.assertEqual(conversation.get_last_reply_str(), "")

    def test_get_last_reply_dict_returns_clone_when_dict(self):
        conversation = self.make_conversation()
        conversation.last_reply = {"a": {"b": 1}}

        result = conversation.get_last_reply_dict()

        self.assertEqual(result, {"a": {"b": 1}})
        result["a"]["b"] = 2
        self.assertEqual(conversation.last_reply["a"]["b"], 1)

    def test_get_last_reply_dict_returns_empty_when_non_dict(self):
        conversation = self.make_conversation()
        conversation.last_reply = "text"

        self.assertEqual(conversation.get_last_reply_dict(), {})

    def test_get_last_reply_dict_field_returns_value_or_default(self):
        conversation = self.make_conversation()
        conversation.last_reply = {"x": 10}

        self.assertEqual(conversation.get_last_reply_dict_field("x"), 10)
        self.assertEqual(conversation.get_last_reply_dict_field("missing", 99), 99)

    def test_get_last_reply_dict_field_returns_none_when_last_reply_not_dict(self):
        conversation = self.make_conversation()
        conversation.last_reply = "text"

        self.assertIsNone(conversation.get_last_reply_dict_field("x", default=99))


class TestErrorPaths(GptConversationFrameworkBase):
    """Missing-client checks and failure propagation behavior."""

    def test_submit_raises_when_client_not_set(self):
        conversation = self.make_conversation(client=None)

        with self.assertRaises(ValueError) as exc_info:
            conversation.submit()

        self.assertIn("OpenAI client is not set", str(exc_info.exception))

    def test_submit_propagates_exception_from_gpt_submit_without_mutating_state(self):
        client = self.make_client()
        initial_messages = [{"role": "user", "content": "hello"}]
        conversation = self.make_conversation(
            messages=list(initial_messages), client=client
        )

        with patch("mdi_llmkit.gpt_api.gpt_conversation.gpt_submit") as mock_submit:
            mock_submit.side_effect = RuntimeError("boom")
            with self.assertRaises(RuntimeError):
                conversation.submit()

        self.assertEqual(conversation, initial_messages)
        self.assertIsNone(conversation.last_reply)

    def test_submit_with_empty_string_message_does_not_append_user_message(self):
        client = self.make_client()
        conversation = self.make_conversation(messages=[], client=client)

        with patch("mdi_llmkit.gpt_api.gpt_conversation.gpt_submit") as mock_submit:
            mock_submit.return_value = "reply"
            conversation.submit(message="")

        self.assertEqual(conversation, [{"role": "assistant", "content": "reply"}])


if __name__ == "__main__":
    unittest.main()
