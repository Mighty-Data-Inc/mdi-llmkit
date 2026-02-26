import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from mdi_llmkit.json_surgery import (
    JSONSurgeryError,
    parse_json_from_ai_response,
)


class ParseJSONFromAIResponseTests(unittest.TestCase):
    def test_extracts_first_balanced_json_object_with_trailing_text(self):
        text = '{"foo":"bar"}{"baz":"quux"}'

        result = parse_json_from_ai_response(text)

        self.assertEqual(result, {"foo": "bar"})

    def test_returns_none_when_no_balanced_object_exists(self):
        text = '{"foo":"bar"'

        result = parse_json_from_ai_response(text)

        self.assertIsNone(result)


class JSONSurgeryErrorTests(unittest.TestCase):
    def test_json_surgery_error_copies_object_state(self):
        obj = {"a": {"b": 1}}

        err = JSONSurgeryError("boom", obj)
        obj["a"]["b"] = 2

        self.assertEqual(str(err), "boom")
        self.assertEqual(err.obj, {"a": {"b": 1}})


if __name__ == "__main__":
    unittest.main()
