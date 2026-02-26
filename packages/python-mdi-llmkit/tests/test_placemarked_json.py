import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from mdi_llmkit.json_surgery import (
    navigate_to_json_path,
    placemarked_json_stringify,
)


class PlacemarkedJSONStringifyTests(unittest.TestCase):
    def test_adds_root_and_nested_placemark_comments(self):
        value = {
            "items": [{"title": "Inception"}],
            "metadata": {"createdBy": "Admin"},
        }

        output = placemarked_json_stringify(value)

        self.assertIn("// root", output)
        self.assertIn('// root["items"]', output)
        self.assertIn('// root["items"][0]', output)
        self.assertIn('// root["metadata"]', output)

    def test_serializes_primitive_values_and_null(self):
        value = {
            "text": "hello",
            "count": 42,
            "isActive": True,
            "empty": None,
        }

        output = placemarked_json_stringify(value)

        self.assertIn('"text": "hello"', output)
        self.assertIn('"count": 42', output)
        self.assertIn('"isActive": true', output)
        self.assertIn('"empty": null', output)

    def test_formats_arrays_with_per_index_comments(self):
        output = placemarked_json_stringify(["alpha", "beta"])

        self.assertIn("[\n", output)
        self.assertIn("// root[0]", output)
        self.assertIn("// root[1]", output)
        self.assertIn('"alpha",', output)
        self.assertIn('"beta"', output)

    def test_omits_skipped_keys_across_nested_levels(self):
        value = {
            "skip": "root-value",
            "nested": {
                "keep": True,
                "skip": "nested-value",
            },
            "rows": [
                {"id": 1, "skip": "row-a"},
                {"id": 2, "skip": "row-b"},
            ],
        }

        output = placemarked_json_stringify(value, 2, ["skip"])

        self.assertIn('"nested":', output)
        self.assertIn('"rows":', output)
        self.assertIn('"id": 1', output)
        self.assertIn('"id": 2', output)
        self.assertNotIn('"skip":', output)
        self.assertNotIn("root-value", output)
        self.assertNotIn("nested-value", output)
        self.assertNotIn("row-a", output)
        self.assertNotIn("row-b", output)

    def test_custom_indent_and_trimmed_output(self):
        output = placemarked_json_stringify({"nested": {"value": 1}}, 4)

        self.assertIn('\n    "nested":', output)
        self.assertIn('\n        "value": 1', output)
        self.assertFalse(output.endswith("\n"))
        self.assertEqual(output, output.strip())

    def test_falls_back_to_two_spaces_when_indent_is_zero_or_none(self):
        zero_indent_output = placemarked_json_stringify({"nested": {"value": 1}}, 0)
        undefined_indent_output = placemarked_json_stringify({"nested": {"value": 1}})

        self.assertIn('\n  "nested":', zero_indent_output)
        self.assertIn('\n    "value": 1', zero_indent_output)
        self.assertIn('\n  "nested":', undefined_indent_output)
        self.assertIn('\n    "value": 1', undefined_indent_output)

    def test_produces_stable_multiline_structure_for_mixed_nested_values(self):
        output = placemarked_json_stringify(
            {
                "name": "Example",
                "config": {
                    "enabled": True,
                    "levels": [1, 2],
                },
            }
        )

        self.assertEqual(
            output,
            """// root
{
  "name": "Example",

  // root["config"]
  "config":
  {
    "enabled": true,

    // root["config"]["levels"]
    "levels":
    [
      // root["config"]["levels"][0]
      1,

      // root["config"]["levels"][1]
      2
    ]
  }
}""",
        )


class NavigateToJSONPathTests(unittest.TestCase):
    def test_resolves_mixed_object_key_and_array_index_paths(self):
        obj = {
            "sections": [{"title": "Intro"}, {"title": "Details"}],
        }

        result = navigate_to_json_path(obj, ["sections", 1, "title"])

        self.assertEqual(result["path_target"], "Details")
        self.assertEqual(result["path_key_or_index"], "title")

    def test_returns_parent_key_and_target_for_non_empty_path(self):
        obj = {
            "sections": [{"title": "Intro"}, {"title": "Details"}],
        }

        result = navigate_to_json_path(obj, ["sections", 1])

        self.assertIs(result["path_parent"], obj["sections"])
        self.assertEqual(result["path_key_or_index"], 1)
        self.assertIs(result["path_target"], obj["sections"][1])

    def test_returns_root_tuple_for_empty_path(self):
        obj = {"a": 1}

        result = navigate_to_json_path(obj, [])

        self.assertIsNone(result["path_parent"])
        self.assertIsNone(result["path_key_or_index"])
        self.assertIs(result["path_target"], obj)

    def test_returns_null_leaf_target_when_parent_exists(self):
        obj = {"metadata": {"optional": None}}

        result = navigate_to_json_path(obj, ["metadata", "optional"])

        self.assertIs(result["path_parent"], obj["metadata"])
        self.assertEqual(result["path_key_or_index"], "optional")
        self.assertIsNone(result["path_target"])

    def test_throws_when_traversal_goes_past_undefined(self):
        obj = {"metadata": {}}

        with self.assertRaisesRegex(ValueError, "Could not navigate to path"):
            navigate_to_json_path(obj, ["metadata", "missing", "leaf"])


if __name__ == "__main__":
    unittest.main()
