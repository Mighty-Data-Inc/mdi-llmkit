import json
import sys
import unittest
from pathlib import Path
from typing import Any, Optional


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from mdi_llmkit.json_surgery import (
    JSONSurgeryError,
    json_surgery,
    parse_json_from_ai_response,
)


class FakeResponse:
    def __init__(self, output_text: str = ""):
        self.output_text = output_text


class FakeResponsesAPI:
    def __init__(self, side_effects: Optional[list[Any]] = None):
        self.side_effects = side_effects or []
        self.create_calls: list[dict[str, Any]] = []

    def create(self, **kwargs):
        self.create_calls.append(kwargs)

        if not self.side_effects:
            return FakeResponse("")

        next_effect = self.side_effects.pop(0)
        if isinstance(next_effect, BaseException):
            raise next_effect
        return next_effect


class FakeOpenAIClient:
    def __init__(self, side_effects: Optional[list[Any]] = None):
        self.responses = FakeResponsesAPI(side_effects=side_effects)


class ParseJSONFromAIResponseTests(unittest.TestCase):
    def test_extracts_first_balanced_json_object_with_trailing_text(self):
        text = '{"foo":"bar"}{"baz":"quux"}'

        result = parse_json_from_ai_response(text)

        self.assertEqual(result, {"foo": "bar"})

    def test_returns_none_when_no_balanced_object_exists(self):
        text = '{"foo":"bar"'

        result = parse_json_from_ai_response(text)

        self.assertIsNone(result)


class JSONSurgeryWorkflowTests(unittest.TestCase):
    def test_applies_assign_operation_and_returns_modified_copy(self):
        original = {
            "id": "task-1",
            "status": "pending",
            "notes": ["created"],
        }

        modifications_json = {
            "modifications": [
                {
                    "json_path_of_parent": [],
                    "key_or_index": "status",
                    "action": "assign",
                    "new_key_name": "",
                    "data": {
                        "inline_value": {
                            "string_value": "approved",
                        }
                    },
                }
            ]
        }

        verification_json = {
            "description_of_changes_intended": "Set status to approved.",
            "description_of_changes_applied": "Set status to approved.",
            "should_we_keep_these_changes": True,
            "reason_to_revert": "",
            "next_step": "No more changes required.",
        }

        side_effects = [
            FakeResponse("Modification Plan: One assignment operation."),
            FakeResponse("I will set status to approved."),
            FakeResponse(json.dumps(modifications_json)),
            FakeResponse("The changes are correct for this step."),
            FakeResponse(json.dumps(verification_json)),
            FakeResponse("We are done."),
            FakeResponse('{"modifications": []}'),
        ]
        client = FakeOpenAIClient(side_effects=side_effects)

        result = json_surgery(
            client,
            original,
            'Set the status field to "approved". Do not change any other fields.',
        )

        self.assertEqual(result["status"], "approved")
        self.assertEqual(result["id"], "task-1")
        self.assertEqual(result["notes"], ["created"])

        self.assertIsNot(result, original)
        self.assertEqual(original["status"], "pending")

    def test_json_surgery_error_copies_object_state(self):
        obj = {"a": {"b": 1}}

        err = JSONSurgeryError("boom", obj)
        obj["a"]["b"] = 2

        self.assertEqual(str(err), "boom")
        self.assertEqual(err.obj, {"a": {"b": 1}})


if __name__ == "__main__":
    unittest.main()
