import os
import sys
import unittest
import importlib
import time
from pathlib import Path
from typing import cast


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from mdi_llmkit.json_surgery import (
    JSONSurgeryError,
    JSONSurgeryOptions,
    json_surgery,
)


dotenv_module = importlib.import_module("dotenv")
dotenv_module.load_dotenv(ROOT / ".env", override=False)
dotenv_module.load_dotenv(ROOT.parent.parent / ".env", override=False)


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError(
        "OPENAI_API_KEY is required for json_surgery live API tests. "
        "Configure your test environment to provide it."
    )


def create_client():
    openai_module = importlib.import_module("openai")
    return openai_module.OpenAI(api_key=OPENAI_API_KEY, timeout=30.0)


class JSONSurgeryLiveAPITests(unittest.TestCase):
    def test_applies_simple_scalar_update_without_mutating_original(self):
        original = {
            "id": "task-1",
            "status": "pending",
            "notes": ["created"],
        }

        result = json_surgery(
            create_client(),
            original,
            'Set the status field to "approved". Do not change any other fields.',
            options={
                "schema_description": """
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "status": { "type": "string" },
    "notes": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["id", "status", "notes"],
  "additionalProperties": false
}
""",
            },
        )

        self.assertEqual(result["status"], "approved")
        self.assertEqual(result["id"], original["id"])
        self.assertEqual(result["notes"], original["notes"])

        self.assertIsNot(result, original)
        self.assertEqual(original["status"], "pending")

    def test_renames_nested_property_while_preserving_value(self):
        original = {
            "address": {
                "zip": "98101",
                "city": "Seattle",
            }
        }

        result = json_surgery(
            create_client(),
            original,
            (
                'Inside address, rename the key "zip" to "postalCode" '
                "and keep the same value. Do not change anything else."
            ),
        )

        self.assertEqual(result["address"]["postalCode"], "98101")
        self.assertEqual(result["address"]["city"], "Seattle")
        self.assertNotIn("zip", result["address"])

        self.assertIsNot(result, original)
        self.assertEqual(original["address"]["zip"], "98101")

    def test_handles_array_insert_and_append_updates(self):
        original = {"tags": ["alpha", "beta"]}

        result = json_surgery(
            create_client(),
            original,
            (
                'In the tags array, insert "urgent" at the beginning and '
                'append "done" at the end. Keep existing tags.'
            ),
        )

        self.assertIsInstance(result["tags"], list)
        self.assertEqual(result["tags"][0], "urgent")
        self.assertEqual(result["tags"][-1], "done")
        self.assertIn("alpha", result["tags"])
        self.assertIn("beta", result["tags"])

        self.assertIsNot(result, original)
        self.assertEqual(original["tags"], ["alpha", "beta"])

    def test_honors_skipped_keys_while_modifying_visible_fields(self):
        original = {
            "name": "Widget",
            "secretToken": "SECRET-123",
            "audit": {
                "createdBy": "u1",
            },
        }

        result = json_surgery(
            create_client(),
            original,
            'Change name to "Widget Pro" and set audit.createdBy to "u2".',
            options={"skipped_keys": ["secretToken"]},
        )

        self.assertEqual(result["name"], "Widget Pro")
        self.assertEqual(result["audit"]["createdBy"], "u2")
        self.assertEqual(result["secretToken"], "SECRET-123")

        self.assertIsNot(result, original)
        self.assertEqual(original["name"], "Widget")
        self.assertEqual(original["audit"]["createdBy"], "u1")
        self.assertEqual(original["secretToken"], "SECRET-123")

    def test_follows_schema_constrained_type_updates_for_primitives(self):
        original = {
            "age": 40,
            "active": True,
        }

        result = json_surgery(
            create_client(),
            original,
            "Set age to 41 and active to false.",
            options={
                "schema_description": """
{
  "type": "object",
  "properties": {
    "age": { "type": "number" },
    "active": { "type": "boolean" }
  },
  "required": ["age", "active"],
  "additionalProperties": false
}
""",
            },
        )

        self.assertEqual(result["age"], 41)
        self.assertIsInstance(result["age"], (int, float))
        self.assertEqual(result["active"], False)
        self.assertIsInstance(result["active"], bool)

        self.assertIsNot(result, original)
        self.assertEqual(original["age"], 40)
        self.assertEqual(original["active"], True)

    def test_removes_requested_properties_without_disturbing_unrelated_fields(self):
        original = {
            "id": "rec-1",
            "name": "Sample",
            "obsoleteField": "remove-me",
            "metadata": {
                "owner": "team-a",
            },
        }

        result = json_surgery(
            create_client(),
            original,
            "Delete obsoleteField. Keep id, name, and metadata unchanged.",
        )

        self.assertNotIn("obsoleteField", result)
        self.assertEqual(result["id"], original["id"])
        self.assertEqual(result["name"], original["name"])
        self.assertEqual(result["metadata"], original["metadata"])

        self.assertIsNot(result, original)
        self.assertEqual(original["obsoleteField"], "remove-me")

    def test_keeps_object_unchanged_for_explicit_noop_instructions(self):
        original = {
            "status": "complete",
            "tags": ["alpha", "beta"],
            "details": {
                "priority": 2,
                "archived": False,
            },
        }

        result = json_surgery(
            create_client(),
            original,
            "Do not make any modifications. Confirm the object already satisfies the request as-is.",
        )

        self.assertEqual(result, original)
        self.assertIsNot(result, original)

    def test_handles_combined_rename_and_value_update_in_one_request(self):
        original = {
            "profile": {
                "first_name": "Sam",
                "last_name": "Lee",
            },
        }

        result = json_surgery(
            create_client(),
            original,
            'In profile, rename first_name to firstName and update last_name to "Li".',
        )

        self.assertEqual(result["profile"]["firstName"], "Sam")
        self.assertEqual(result["profile"]["last_name"], "Li")
        self.assertNotIn("first_name", result["profile"])

        self.assertIsNot(result, original)
        self.assertEqual(
            original["profile"],
            {
                "first_name": "Sam",
                "last_name": "Lee",
            },
        )

    def test_supports_order_sensitive_array_edits(self):
        original = {
            "steps": ["draft", "review", "publish"],
        }

        result = json_surgery(
            create_client(),
            original,
            'In steps, insert "plan" at the beginning and remove "review". Keep the remaining order intact.',
        )

        self.assertIsInstance(result["steps"], list)
        self.assertEqual(result["steps"][0], "plan")
        self.assertNotIn("review", result["steps"])
        self.assertIn("draft", result["steps"])
        self.assertIn("publish", result["steps"])
        self.assertLess(
            result["steps"].index("draft"), result["steps"].index("publish")
        )

        self.assertIsNot(result, original)
        self.assertEqual(original["steps"], ["draft", "review", "publish"])

    def test_builds_nested_object_structure_from_plain_english_instructions(self):
        original = {
            "profile": {},
        }

        result = json_surgery(
            create_client(),
            original,
            'Create profile.contact with email "person@example.com" and phone "555-0100".',
        )

        self.assertTrue(result.get("profile"))
        self.assertTrue(result["profile"].get("contact"))
        self.assertEqual(result["profile"]["contact"]["email"], "person@example.com")
        self.assertEqual(result["profile"]["contact"]["phone"], "555-0100")

        self.assertIsNot(result, original)
        self.assertEqual(original["profile"], {})

    def test_on_validate_before_return_when_errors_missing(self):
        original = {
            "name": "Test Product",
            "price": 100,
        }

        def on_validate_before_return(obj):
            return {}

        result = json_surgery(
            create_client(),
            original,
            "Increase the price by 10%",
            options=cast(
                JSONSurgeryOptions,
                {"on_validate_before_return": on_validate_before_return},
            ),
        )

        self.assertEqual(result["price"], 110)
        self.assertIsNot(result, original)
        self.assertEqual(original["price"], 100)

    def test_on_validate_before_return_when_errors_empty(self):
        original = {
            "name": "Test Product",
            "price": 100,
        }

        def on_validate_before_return(obj):
            return {"errors": []}

        result = json_surgery(
            create_client(),
            original,
            "Increase the price by 10%",
            options=cast(
                JSONSurgeryOptions,
                {"on_validate_before_return": on_validate_before_return},
            ),
        )

        self.assertEqual(result["price"], 110)
        self.assertIsNot(result, original)
        self.assertEqual(original["price"], 100)

    def test_on_validate_before_return_applies_changes_from_errors(self):
        original = {
            "name": "Test Product",
            "price": 100,
        }

        def on_validate_before_return(obj):
            errors = []
            if not obj.get("id"):
                errors.append("Object needs an `id` field. Set its value to `001`.")
            if not obj.get("date"):
                errors.append(
                    "Object needs a `date` field. Set its value to `2024-01-01`."
                )
            return {"errors": errors}

        result = json_surgery(
            create_client(),
            original,
            "Increase the price by 10%",
            options=cast(
                JSONSurgeryOptions,
                {"on_validate_before_return": on_validate_before_return},
            ),
        )

        self.assertEqual(result["price"], 110)
        self.assertEqual(result["id"], "001")
        self.assertEqual(result["date"], "2024-01-01")

        self.assertIsNot(result, original)
        self.assertEqual(original["price"], 100)

    def test_on_validate_before_return_uses_corrected_object(self):
        original = {
            "name": "Test Product",
            "price": 100,
        }

        def on_validate_before_return(obj):
            obj["id"] = "001"
            obj["date"] = "2024-01-01"
            return {"obj_corrected": obj}

        result = json_surgery(
            create_client(),
            original,
            "Increase the price by 10%",
            options=cast(
                JSONSurgeryOptions,
                {"on_validate_before_return": on_validate_before_return},
            ),
        )

        self.assertEqual(result["price"], 110)
        self.assertEqual(result["id"], "001")
        self.assertEqual(result["date"], "2024-01-01")

        self.assertIsNot(result, original)
        self.assertEqual(original["price"], 100)

    def test_on_validate_before_return_uses_corrected_object_and_errors(self):
        original = {
            "name": "Test Product",
            "price": 100,
        }

        def on_validate_before_return(obj):
            errors = []
            obj["id"] = "001"
            if not obj.get("date"):
                errors.append(
                    "Object needs a `date` field. Set its value to `2024-01-01`."
                )
            return {"obj_corrected": obj, "errors": errors}

        result = json_surgery(
            create_client(),
            original,
            "Increase the price by 10%",
            options=cast(
                JSONSurgeryOptions,
                {"on_validate_before_return": on_validate_before_return},
            ),
        )

        self.assertEqual(result["price"], 110)
        self.assertEqual(result["id"], "001")
        self.assertEqual(result["date"], "2024-01-01")

        self.assertIsNot(result, original)
        self.assertEqual(original["price"], 100)

    def test_on_validate_before_return_allows_undefined(self):
        original = {
            "name": "Test Product",
            "price": 100,
        }

        def on_validate_before_return(obj):
            return None

        result = json_surgery(
            create_client(),
            original,
            "Increase the price by 10%",
            options={"on_validate_before_return": on_validate_before_return},
        )

        self.assertEqual(result["price"], 110)
        self.assertIsNot(result, original)
        self.assertEqual(original["price"], 100)

    def test_on_work_in_progress_called_after_each_iteration(self):
        original = {
            "name": "Test Product",
            "price": 100,
        }

        work_in_progress_call_count = 0

        def on_work_in_progress(obj):
            nonlocal work_in_progress_call_count
            work_in_progress_call_count += 1

        result = json_surgery(
            create_client(),
            original,
            "Increase the price by 10%",
            options={"on_work_in_progress": on_work_in_progress},
        )

        self.assertEqual(result["price"], 110)
        self.assertEqual(work_in_progress_call_count, 1)

    def test_on_work_in_progress_replaces_object_when_returned(self):
        original = {
            "name": "Test Product",
            "price": 100,
        }

        work_in_progress_call_count = 0

        def on_work_in_progress(obj):
            nonlocal work_in_progress_call_count
            work_in_progress_call_count += 1
            return {
                **obj,
                "id": "001",
                "date": "2024-01-01",
            }

        result = json_surgery(
            create_client(),
            original,
            "Increase the price by 10%",
            options={"on_work_in_progress": on_work_in_progress},
        )

        self.assertEqual(result["price"], 110)
        self.assertEqual(result["id"], "001")
        self.assertEqual(result["date"], "2024-01-01")
        self.assertEqual(work_in_progress_call_count, 1)

    def test_on_work_in_progress_propagates_errors(self):
        original = {
            "name": "Test Product",
            "price": 100,
        }

        unique_error_string = (
            "Super unique error string very recognize much distinct wow"
        )

        def on_work_in_progress(obj):
            raise ValueError(unique_error_string)

        with self.assertRaisesRegex(ValueError, unique_error_string):
            json_surgery(
                create_client(),
                original,
                "Increase the price by 10%",
                options={"on_work_in_progress": on_work_in_progress},
            )

    def test_bulk_copy_nested_object_in_dict_single_iteration(self):
        original = {
            "ernie": {
                "species": "muppet",
                "gender": "male",
                "address": {
                    "street_name": "Sesame St",
                    "house_number": "123",
                    "unit": {"floor": 1, "number": "1D"},
                    "city": "Sesame City",
                },
            },
        }

        num_times_work_in_progress_called = 0

        def on_work_in_progress(obj):
            nonlocal num_times_work_in_progress_called
            num_times_work_in_progress_called += 1

        result = json_surgery(
            create_client(),
            original,
            "Create a new character, `bert`, by copying the entire `ernie` object "
            'using the bulk "copy" action. Keep all data the same.',
            options={"on_work_in_progress": on_work_in_progress},
        )

        self.assertEqual(len(original.keys()), 1)
        self.assertEqual(len(result.keys()), 2)
        self.assertEqual(result["ernie"], original["ernie"])
        self.assertEqual(result["bert"], original["ernie"])
        self.assertEqual(num_times_work_in_progress_called, 1)

    def test_bulk_append_copy_nested_object_in_list_two_or_fewer_iterations(self):
        original = {
            "sesame_street_characters": [
                {
                    "name": "Ernie",
                    "species": "muppet",
                    "gender": "male",
                    "address": {
                        "street_name": "Sesame St",
                        "house_number": "123",
                        "unit": {"floor": 1, "number": "1D"},
                        "city": "Sesame City",
                    },
                },
                {
                    "name": "Oscar",
                    "species": "muppet",
                    "gender": "male",
                    "address": {
                        "street_name": "Sesame St",
                        "house_number": "none",
                        "unit": {"floor": 0, "number": "none"},
                        "city": "Sesame City",
                    },
                },
            ],
        }

        num_times_work_in_progress_called = 0

        def on_work_in_progress(obj):
            nonlocal num_times_work_in_progress_called
            num_times_work_in_progress_called += 1

        result = json_surgery(
            create_client(),
            original,
            'Create a new character, "Bert", by copying the entire "Ernie" object '
            'using the bulk "copy" action. Keep all data the same (except the name, of course). '
            "Append Bert to the end of the sesame_street_characters array.",
            options={"on_work_in_progress": on_work_in_progress},
        )

        self.assertEqual(len(original["sesame_street_characters"]), 2)
        self.assertEqual(len(result["sesame_street_characters"]), 3)
        self.assertEqual(
            result["sesame_street_characters"][0],
            original["sesame_street_characters"][0],
        )

        expect_bert = {
            **original["sesame_street_characters"][0],
            "address": {
                **original["sesame_street_characters"][0]["address"],
                "unit": {**original["sesame_street_characters"][0]["address"]["unit"]},
            },
        }
        expect_bert["name"] = "Bert"
        self.assertEqual(result["sesame_street_characters"][2], expect_bert)
        self.assertLessEqual(num_times_work_in_progress_called, 2)

    def test_bulk_insert_copy_nested_object_in_list_two_or_fewer_iterations(self):
        original = {
            "sesame_street_characters": [
                {
                    "name": "Ernie",
                    "species": "muppet",
                    "gender": "male",
                    "address": {
                        "street_name": "Sesame St",
                        "house_number": "123",
                        "unit": {"floor": 1, "number": "1D"},
                        "city": "Sesame City",
                    },
                },
                {
                    "name": "Oscar",
                    "species": "muppet",
                    "gender": "male",
                    "address": {
                        "street_name": "Sesame St",
                        "house_number": "none",
                        "unit": {"floor": 0, "number": "none"},
                        "city": "Sesame City",
                    },
                },
            ],
        }

        num_times_work_in_progress_called = 0

        def on_work_in_progress(obj):
            nonlocal num_times_work_in_progress_called
            num_times_work_in_progress_called += 1

        result = json_surgery(
            create_client(),
            original,
            'Create a new character, "Bert", by copying the entire "Ernie" object '
            'using the bulk "copy" action. Keep all data the same (except the name, of course). '
            "Insert Bert after Ernie in the sesame_street_characters array.",
            options={"on_work_in_progress": on_work_in_progress},
        )

        self.assertEqual(len(original["sesame_street_characters"]), 2)
        self.assertEqual(len(result["sesame_street_characters"]), 3)
        self.assertEqual(
            result["sesame_street_characters"][0],
            original["sesame_street_characters"][0],
        )

        expect_bert = {
            **original["sesame_street_characters"][0],
            "address": {
                **original["sesame_street_characters"][0]["address"],
                "unit": {**original["sesame_street_characters"][0]["address"]["unit"]},
            },
        }
        expect_bert["name"] = "Bert"
        self.assertEqual(result["sesame_street_characters"][1], expect_bert)
        self.assertLessEqual(num_times_work_in_progress_called, 2)

    def test_bulk_move_nested_object_in_dict_two_or_fewer_iterations(self):
        original = {
            "sesame_street_characters": {
                "ernie": {
                    "species": "muppet",
                    "gender": "male",
                    "address": {
                        "street_name": "Sesame St",
                        "house_number": "123",
                        "unit": {"floor": 1, "number": "1D"},
                        "city": "Sesame City",
                    },
                },
            },
            "adventure_time_characters": {
                "finn": {
                    "species": "human",
                    "gender": "male",
                    "address": {
                        "street_name": "Tree Fort Ln",
                        "house_number": "1",
                        "unit": {"floor": 1, "number": "1A"},
                        "city": "Ooo",
                    },
                },
                "bert": {
                    "species": "muppet",
                    "gender": "male",
                    "address": {
                        "street_name": "Sesame St",
                        "house_number": "123",
                        "unit": {"floor": 1, "number": "1D"},
                        "city": "Sesame City",
                    },
                },
            },
        }

        num_times_work_in_progress_called = 0

        def on_work_in_progress(obj):
            nonlocal num_times_work_in_progress_called
            num_times_work_in_progress_called += 1

        result = json_surgery(
            create_client(),
            original,
            'The character "bert" is misfiled under adventure_time_characters. '
            "He should be under sesame_street_characters. Move him there, preferably "
            "using a bulk copy/move operation if possible.",
            options={"on_work_in_progress": on_work_in_progress},
        )

        self.assertEqual(len(original["sesame_street_characters"].keys()), 1)
        self.assertEqual(len(original["adventure_time_characters"].keys()), 2)
        self.assertEqual(len(result["sesame_street_characters"].keys()), 2)
        self.assertEqual(len(result["adventure_time_characters"].keys()), 1)
        self.assertEqual(
            result["sesame_street_characters"]["bert"],
            original["adventure_time_characters"]["bert"],
        )
        self.assertLessEqual(num_times_work_in_progress_called, 2)

    def test_bulk_move_nested_object_from_list_to_list_few_iterations(self):
        original = {
            "sesame_street_characters": [
                {
                    "name": "Ernie",
                    "species": "muppet",
                    "gender": "male",
                    "address": {
                        "street_name": "Sesame St",
                        "house_number": "123",
                        "unit": {"floor": 1, "number": "1D"},
                        "city": "Sesame City",
                    },
                },
                {
                    "name": "Oscar",
                    "species": "muppet",
                    "gender": "male",
                    "address": {
                        "street_name": "Sesame St",
                        "house_number": "none",
                        "unit": {"floor": 0, "number": "none"},
                        "city": "Sesame City",
                    },
                },
            ],
            "adventure_time_characters": [
                {
                    "name": "Finn",
                    "species": "human",
                    "gender": "male",
                    "address": {
                        "street_name": "Tree Fort Ln",
                        "house_number": "1",
                        "unit": {"floor": 1, "number": "1A"},
                        "city": "Ooo",
                    },
                },
                {
                    "name": "Bert",
                    "species": "muppet",
                    "gender": "male",
                    "address": {
                        "street_name": "Sesame St",
                        "house_number": "123",
                        "unit": {"floor": 1, "number": "1D"},
                        "city": "Sesame City",
                    },
                },
            ],
        }

        num_times_work_in_progress_called = 0

        def on_work_in_progress(obj):
            nonlocal num_times_work_in_progress_called
            num_times_work_in_progress_called += 1

        result = json_surgery(
            create_client(),
            original,
            'The character "Bert" is misfiled under adventure_time_characters. '
            "He should be under sesame_street_characters. Move him there, right "
            "after Ernie, preferably using a bulk copy/move operation if possible.",
            options={"on_work_in_progress": on_work_in_progress},
        )

        self.assertEqual(len(original["sesame_street_characters"]), 2)
        self.assertEqual(len(original["adventure_time_characters"]), 2)
        self.assertEqual(len(result["sesame_street_characters"]), 3)
        self.assertEqual(len(result["adventure_time_characters"]), 1)
        self.assertEqual(
            result["sesame_street_characters"][1],
            original["adventure_time_characters"][1],
        )
        self.assertLessEqual(num_times_work_in_progress_called, 2)

    def test_gives_up_after_iteration_limit(self):
        def on_validate_before_return(obj):
            undocumented_fields = [
                "id",
                "date",
                "description",
                "category",
                "status",
                "type",
            ]
            for field in undocumented_fields:
                if not obj.get(field):
                    return {"errors": [f"Object needs a `{field}` field."]}
            return {"errors": []}

        original = {
            "name": "Test Product",
            "price": 100,
        }

        try:
            json_surgery(
                create_client(),
                original,
                "Increase the price by 10%",
                options=cast(
                    JSONSurgeryOptions,
                    {
                        "on_validate_before_return": on_validate_before_return,
                        "give_up_after_iterations": 2,
                    },
                ),
            )
        except JSONSurgeryError as error:
            self.assertIn("iteration", str(error).lower())
            result = error.obj
            self.assertEqual(result["price"], 110)
            self.assertNotEqual(original, result)
            self.assertEqual(original["price"], 100)
            return

        raise AssertionError(
            "Expected json_surgery to throw after reaching iteration limit."
        )

    def test_gives_up_after_time_limit(self):
        def on_validate_before_return(obj):
            time.sleep(3)
            undocumented_fields = ["id", "date", "description"]
            for field in undocumented_fields:
                if not obj.get(field):
                    return {"errors": [f"Object needs a `{field}` field."]}
            return {"errors": []}

        original = {
            "name": "Test Product",
            "price": 100,
        }

        try:
            json_surgery(
                create_client(),
                original,
                "Increase the price by 10%",
                options=cast(
                    JSONSurgeryOptions,
                    {
                        "on_validate_before_return": on_validate_before_return,
                        "give_up_after_seconds": 2,
                    },
                ),
            )
        except JSONSurgeryError as error:
            self.assertIn("seconds", str(error).lower())
            result = error.obj
            self.assertEqual(result["price"], 110)
            self.assertNotEqual(original, result)
            self.assertEqual(original["price"], 100)
            return

        raise AssertionError(
            "Expected json_surgery to throw after reaching time limit."
        )


if __name__ == "__main__":
    unittest.main()
