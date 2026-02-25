import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from mdi_llmkit.gpt_api.json_schema_format import JSONSchemaFormat

import json


class JSONSchemaFormatTests(unittest.TestCase):
    def test_object_schema_happy_path(self):
        """Shows the direct DSL-to-schema expansion for primitive object fields."""
        result = JSONSchemaFormat(
            name="response",
            description="Structured response payload",
            schema={
                "title": "Human-readable title",
                "age": int,
                "score": float,
                "enabled": bool,
            },
        )

        expected = {
            "format": {
                "type": "json_schema",
                "strict": True,
                "name": "response",
                "description": "Structured response payload",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["title", "age", "score", "enabled"],
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Human-readable title",
                        },
                        "age": {"type": "integer"},
                        "score": {"type": "number"},
                        "enabled": {"type": "boolean"},
                    },
                },
            }
        }
        self.assertEqual(result, expected)

    def test_non_object_schema_is_wrapped(self):
        """Verifies non-object top-level schemas are wrapped in a named root object."""
        result = JSONSchemaFormat(str, name="answer")

        expected = {
            "format": {
                "type": "json_schema",
                "strict": True,
                "name": "answer",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["answer"],
                    "properties": {
                        "answer": {"type": "string"},
                    },
                },
            }
        }
        self.assertEqual(result, expected)

    def test_string_enum_from_list(self):
        """Verifies a multi-string list shorthand expands into a string enum."""
        result = JSONSchemaFormat(
            name="answer_enum",
            schema={"mode": ["fast", "safe", "balanced"]},
        )
        expected = {
            "format": {
                "type": "json_schema",
                "strict": True,
                "name": "answer_enum",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["mode"],
                    "properties": {
                        "mode": {
                            "type": "string",
                            "enum": ["fast", "safe", "balanced"],
                        }
                    },
                },
            }
        }
        self.assertEqual(result, expected)

    def test_array_schema_with_bounds_and_item_description(self):
        """Verifies tuple metadata expands into array description/minItems/maxItems/items."""
        result = JSONSchemaFormat(
            name="test_schema",
            schema={
                "tags": (
                    "Tag collection",
                    (1, 5),
                    ["Single tag"],
                )
            },
        )
        expected = {
            "format": {
                "type": "json_schema",
                "strict": True,
                "name": "test_schema",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["tags"],
                    "properties": {
                        "tags": {
                            "type": "array",
                            "description": "Tag collection",
                            "minItems": 1,
                            "maxItems": 5,
                            "items": {"type": "string", "description": "Single tag"},
                        }
                    },
                },
            }
        }
        self.assertEqual(result, expected)

    def test_tuple_metadata_infers_type_for_number_range_and_enum(self):
        """Verifies tuple metadata inference for numeric ranges and string enums."""
        result = JSONSchemaFormat(
            name="test_schema",
            schema={
                "age": ("Age in years", (0, 120), ()),
                "color": ("Preferred color", ["red", "green", "blue"], ()),
            },
        )
        expected = {
            "format": {
                "type": "json_schema",
                "strict": True,
                "name": "test_schema",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["age", "color"],
                    "properties": {
                        "age": {
                            "type": "integer",
                            "description": "Age in years",
                            "minimum": 0,
                            "maximum": 120,
                        },
                        "color": {
                            "type": "string",
                            "description": "Preferred color",
                            "enum": ["red", "green", "blue"],
                        },
                    },
                },
            }
        }
        self.assertEqual(result, expected)

    def test_tuple_metadata_infers_float_range_constraints(self):
        """Verifies float tuple ranges infer number type and inclusive bounds."""
        result = JSONSchemaFormat(
            name="test_schema",
            schema={
                "confidence": ("Confidence score", (0.0, 1.0), ()),
            },
        )

        expected = {
            "format": {
                "type": "json_schema",
                "strict": True,
                "name": "test_schema",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["confidence"],
                    "properties": {
                        "confidence": {
                            "type": "number",
                            "description": "Confidence score",
                            "minimum": 0.0,
                            "maximum": 1.0,
                        }
                    },
                },
            }
        }
        self.assertEqual(result, expected)

    def test_tuple_metadata_supports_one_sided_numeric_bounds(self):
        """Verifies tuple ranges with None produce one-sided minimum/maximum constraints."""
        result = JSONSchemaFormat(
            name="test_schema",
            schema={
                "min_only": ("Minimum only", (0, None), ()),
                "max_only": ("Maximum only", (None, 10), ()),
            },
        )

        expected = {
            "format": {
                "type": "json_schema",
                "strict": True,
                "name": "test_schema",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["min_only", "max_only"],
                    "properties": {
                        "min_only": {
                            "type": "integer",
                            "description": "Minimum only",
                            "minimum": 0,
                        },
                        "max_only": {
                            "type": "integer",
                            "description": "Maximum only",
                            "maximum": 10,
                        },
                    },
                },
            }
        }
        self.assertEqual(result, expected)

    def test_nested_recursive_list_and_object_formatting(self):
        """Shows recursive expansion across nested arrays, objects, and enum/list shorthands."""
        result = JSONSchemaFormat(
            name="nested_schema",
            schema={
                "groups": [
                    {
                        "name": "Group name",
                        "members": [
                            {
                                "id": int,
                                "roles": ["admin", "viewer"],
                                "tags": ["Tag label"],
                                "profile": {
                                    "active": bool,
                                    "scores": [float],
                                },
                            }
                        ],
                    }
                ]
            },
        )

        expected = {
            "format": {
                "type": "json_schema",
                "strict": True,
                "name": "nested_schema",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["groups"],
                    "properties": {
                        "groups": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "members"],
                                "properties": {
                                    "name": {
                                        "type": "string",
                                        "description": "Group name",
                                    },
                                    "members": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "additionalProperties": False,
                                            "required": [
                                                "id",
                                                "roles",
                                                "tags",
                                                "profile",
                                            ],
                                            "properties": {
                                                "id": {"type": "integer"},
                                                "roles": {
                                                    "type": "string",
                                                    "enum": ["admin", "viewer"],
                                                },
                                                "tags": {
                                                    "type": "array",
                                                    "items": {
                                                        "type": "string",
                                                        "description": "Tag label",
                                                    },
                                                },
                                                "profile": {
                                                    "type": "object",
                                                    "additionalProperties": False,
                                                    "required": ["active", "scores"],
                                                    "properties": {
                                                        "active": {"type": "boolean"},
                                                        "scores": {
                                                            "type": "array",
                                                            "items": {"type": "number"},
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        }
                    },
                },
            }
        }
        self.assertEqual(result, expected)

    def test_nested_recursive_formatting_with_inner_tuple_metadata(self):
        """Shows recursive expansion when inner nodes also carry tuple metadata constraints."""
        result = JSONSchemaFormat(
            name="nested_schema_with_metadata",
            schema={
                "groups": [
                    {
                        "name": "Group name",
                        "members": (
                            "Members list",
                            (1, None),
                            [
                                {
                                    "id": int,
                                    "score": ("Member score", (0.0, 1.0), float),
                                    "aliases": ("Alias list", (0, 3), ["Alias text"]),
                                    "history": [
                                        {
                                            "year": ("Year", (1900, 2100), int),
                                            "tags": (
                                                "History tags",
                                                (0, 5),
                                                ["Tag text"],
                                            ),
                                        }
                                    ],
                                }
                            ],
                        ),
                    }
                ]
            },
        )

        expected = {
            "format": {
                "type": "json_schema",
                "strict": True,
                "name": "nested_schema_with_metadata",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["groups"],
                    "properties": {
                        "groups": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "members"],
                                "properties": {
                                    "name": {
                                        "type": "string",
                                        "description": "Group name",
                                    },
                                    "members": {
                                        "type": "array",
                                        "description": "Members list",
                                        "minItems": 1,
                                        "items": {
                                            "type": "object",
                                            "additionalProperties": False,
                                            "required": [
                                                "id",
                                                "score",
                                                "aliases",
                                                "history",
                                            ],
                                            "properties": {
                                                "id": {"type": "integer"},
                                                "score": {
                                                    "type": "number",
                                                    "description": "Member score",
                                                    "minimum": 0.0,
                                                    "maximum": 1.0,
                                                },
                                                "aliases": {
                                                    "type": "array",
                                                    "description": "Alias list",
                                                    "minItems": 0,
                                                    "maxItems": 3,
                                                    "items": {
                                                        "type": "string",
                                                        "description": "Alias text",
                                                    },
                                                },
                                                "history": {
                                                    "type": "array",
                                                    "items": {
                                                        "type": "object",
                                                        "additionalProperties": False,
                                                        "required": ["year", "tags"],
                                                        "properties": {
                                                            "year": {
                                                                "type": "integer",
                                                                "description": "Year",
                                                                "minimum": 1900,
                                                                "maximum": 2100,
                                                            },
                                                            "tags": {
                                                                "type": "array",
                                                                "description": "History tags",
                                                                "minItems": 0,
                                                                "maxItems": 5,
                                                                "items": {
                                                                    "type": "string",
                                                                    "description": "Tag text",
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        }
                    },
                },
            }
        }
        self.assertEqual(result, expected)

    def test_unsupported_type_raises_value_error(self):
        """Verifies unsupported literal values fail fast with a clear ValueError."""
        with self.assertRaises(ValueError):
            JSONSchemaFormat({"bad": object()}, name="", description="")


if __name__ == "__main__":
    unittest.main()
