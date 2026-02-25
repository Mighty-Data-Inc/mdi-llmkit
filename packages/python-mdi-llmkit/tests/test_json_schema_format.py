import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from mdi_llmkit.gpt_api.json_schema_format import JSONSchemaFormat


class JSONSchemaFormatTests(unittest.TestCase):
    def test_object_schema_happy_path(self):
        schema = {
            "title": "Human-readable title",
            "age": int,
            "score": float,
            "enabled": bool,
        }

        result = JSONSchemaFormat(
            schema,
            name="response",
            description="Structured response payload",
        )

        self.assertEqual(result["format"]["type"], "json_schema")
        self.assertTrue(result["format"]["strict"])
        self.assertEqual(result["format"]["name"], "response")
        self.assertEqual(result["format"]["description"], "Structured response payload")

        converted = result["format"]["schema"]
        self.assertEqual(converted["type"], "object")
        self.assertFalse(converted["additionalProperties"])
        self.assertEqual(converted["required"], ["title", "age", "score", "enabled"])
        self.assertEqual(
            converted["properties"]["title"],
            {"type": "string", "description": "Human-readable title"},
        )
        self.assertEqual(converted["properties"]["age"]["type"], "integer")
        self.assertEqual(converted["properties"]["score"]["type"], "number")
        self.assertEqual(converted["properties"]["enabled"]["type"], "boolean")

    def test_non_object_schema_is_wrapped(self):
        result = JSONSchemaFormat(str, name="answer", description="")

        converted = result["format"]["schema"]
        self.assertEqual(converted["type"], "object")
        self.assertEqual(converted["required"], ["answer"])
        self.assertFalse(converted["additionalProperties"])
        self.assertEqual(converted["properties"]["answer"]["type"], "string")

    def test_string_enum_from_list(self):
        schema = {"mode": ["fast", "safe", "balanced"]}
        result = JSONSchemaFormat(schema, name="", description="")

        mode_schema = result["format"]["schema"]["properties"]["mode"]
        self.assertEqual(mode_schema["type"], "string")
        self.assertEqual(mode_schema["enum"], ["fast", "safe", "balanced"])

    def test_array_schema_with_bounds_and_item_description(self):
        schema = {
            "tags": (
                "Tag collection",
                (1, 5),
                ["Single tag"],
            )
        }
        result = JSONSchemaFormat(schema, name="", description="")

        tags_schema = result["format"]["schema"]["properties"]["tags"]
        self.assertEqual(tags_schema["type"], "array")
        self.assertEqual(tags_schema["description"], "Tag collection")
        self.assertEqual(tags_schema["minItems"], 1)
        self.assertEqual(tags_schema["maxItems"], 5)
        self.assertEqual(
            tags_schema["items"], {"type": "string", "description": "Single tag"}
        )

    def test_tuple_metadata_infers_type_for_number_range_and_enum(self):
        schema = {
            "age": ("Age in years", (0, 120), ()),
            "color": ("Preferred color", ["red", "green", "blue"], ()),
        }
        result = JSONSchemaFormat(schema, name="", description="")

        age_schema = result["format"]["schema"]["properties"]["age"]
        self.assertEqual(age_schema["type"], "integer")
        self.assertEqual(age_schema["description"], "Age in years")
        self.assertNotIn("minValue", age_schema)
        self.assertNotIn("maxValue", age_schema)

        color_schema = result["format"]["schema"]["properties"]["color"]
        self.assertEqual(color_schema["type"], "string")
        self.assertEqual(color_schema["description"], "Preferred color")
        self.assertEqual(color_schema["enum"], ["red", "green", "blue"])

    def test_unsupported_type_raises_value_error(self):
        with self.assertRaises(ValueError):
            JSONSchemaFormat({"bad": object()}, name="", description="")


if __name__ == "__main__":
    unittest.main()
