import sys
import unittest
from functools import cmp_to_key
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from mdi_llmkit.semantic_match import (
    are_items_equal,
    compare_items,
    get_item_description,
    get_item_name,
    item_to_prompt_string,
    remove_item_from_list,
)


class SemanticItemHelpersTests(unittest.TestCase):
    # get_item_name
    def test_get_item_name_returns_raw_value_for_string_items(self):
        self.assertEqual(get_item_name("Widget"), "Widget")

    def test_get_item_name_returns_name_field_for_object_items(self):
        self.assertEqual(
            get_item_name({"name": "Widget", "description": "A part"}), "Widget"
        )

    # get_item_description
    def test_get_item_description_returns_none_for_string_items(self):
        self.assertIsNone(get_item_description("Widget"))

    def test_get_item_description_returns_none_when_description_is_missing(self):
        self.assertIsNone(get_item_description({"name": "Widget"}))

    def test_get_item_description_returns_none_when_equal_to_name_ignoring_case_and_whitespace(
        self,
    ):
        self.assertIsNone(
            get_item_description(
                {
                    "name": "Product Alpha",
                    "description": "  product alpha  ",
                }
            )
        )

    def test_get_item_description_returns_description_when_it_adds_context(self):
        self.assertEqual(
            get_item_description(
                {
                    "name": "Product Alpha",
                    "description": "Legacy tier retained for existing contracts",
                }
            ),
            "Legacy tier retained for existing contracts",
        )

    def test_get_item_description_preserves_original_text_when_returned(self):
        self.assertEqual(
            get_item_description(
                {
                    "name": "Product Alpha",
                    "description": "  Legacy tier retained for existing contracts  ",
                }
            ),
            "  Legacy tier retained for existing contracts  ",
        )

    # item_to_prompt_string
    def test_item_to_prompt_string_formats_string_items_with_json_escaping(self):
        self.assertEqual(
            item_to_prompt_string('Line "A"\nLine B'),
            '- "Line \\"A\\"\\nLine B"',
        )

    def test_item_to_prompt_string_formats_object_name_only_when_description_absent(
        self,
    ):
        self.assertEqual(
            item_to_prompt_string({"name": "Product Alpha"}),
            '- "Product Alpha"',
        )

    def test_item_to_prompt_string_omits_details_when_description_equals_name(self):
        self.assertEqual(
            item_to_prompt_string(
                {
                    "name": "Product Alpha",
                    "description": "  product alpha  ",
                }
            ),
            '- "Product Alpha"',
        )

    def test_item_to_prompt_string_includes_details_when_description_differs(self):
        self.assertEqual(
            item_to_prompt_string(
                {
                    "name": "Product Alpha",
                    "description": "Replaces legacy alpha tier",
                }
            ),
            '- "Product Alpha" (details: "Replaces legacy alpha tier")',
        )

    # compare_items
    def test_compare_items_returns_zero_for_names_equal_ignoring_case(self):
        self.assertEqual(compare_items("Widget", "widget"), 0)

    def test_compare_items_sorts_by_case_insensitive_names(self):
        items = [
            "zeta",
            {"name": "Bravo"},
            "alpha",
            {"name": "charlie"},
        ]

        sorted_names = [
            get_item_name(item) for item in sorted(items, key=cmp_to_key(compare_items))
        ]
        self.assertEqual(sorted_names, ["alpha", "Bravo", "charlie", "zeta"])

    def test_compare_items_trims_names_before_comparing(self):
        self.assertEqual(compare_items("name", " name"), 0)

    def test_compare_items_uses_descriptions_as_tie_breaker(self):
        self.assertGreater(
            compare_items(
                {"name": "Georgia", "description": "zebra context"},
                {"name": "Georgia", "description": "alpha context"},
            ),
            0,
        )

    def test_compare_items_treats_description_case_differences_as_equal(self):
        self.assertEqual(
            compare_items(
                {"name": "Georgia", "description": "Country in caucasus"},
                {"name": "Georgia", "description": "country in caucasus"},
            ),
            0,
        )

    # are_items_equal
    def test_are_items_equal_true_for_equal_names_ignoring_case_and_whitespace(self):
        self.assertTrue(are_items_equal(" Catalog Item ", {"name": "catalog item"}))

    def test_are_items_equal_false_for_different_names(self):
        self.assertFalse(are_items_equal("Catalog Item A", {"name": "Catalog Item B"}))

    def test_are_items_equal_false_when_names_match_but_descriptions_differ(self):
        self.assertFalse(
            are_items_equal(
                {"name": "Catalog Item", "description": "old"},
                {"name": "catalog item", "description": "new"},
            )
        )

    def test_are_items_equal_treats_name_plus_description_as_equal_to_string(self):
        self.assertTrue(
            are_items_equal(
                {
                    "name": "Georgia",
                    "description": "A sovereign country in the South Caucasus. Capital: Tbilisi.",
                },
                "georgia",
            )
        )

    # remove_item_from_list
    def test_remove_item_from_list_removes_matching_strings_case_insensitively(self):
        original = ["Alpha", "Bravo", "alpha"]

        result = remove_item_from_list(original, "ALPHA")

        self.assertEqual(result, ["Bravo"])

    def test_remove_item_from_list_removes_objects_when_name_and_description_equivalent(
        self,
    ):
        original = [
            {"name": "Catalog Item", "description": "legacy details"},
            {"name": "Catalog Item", "description": "LEGACY DETAILS"},
            {"name": "Other Item"},
        ]

        result = remove_item_from_list(
            original,
            {
                "name": "catalog item",
                "description": "  legacy details  ",
            },
        )

        self.assertEqual(result, [{"name": "Other Item"}])

    def test_remove_item_from_list_removes_item_without_description_when_name_ambiguous(
        self,
    ):
        original = [
            {"name": "Catalog Item", "description": "first copy"},
            "catalog item",
            {"name": "Other Item"},
        ]

        result = remove_item_from_list(
            original,
            {
                "name": "CATALOG ITEM",
                "description": "query description does not matter",
            },
        )

        self.assertEqual(
            result,
            [
                {"name": "Catalog Item", "description": "first copy"},
                {"name": "Other Item"},
            ],
        )
        self.assertIsNot(result, original)

    def test_remove_item_from_list_does_not_remove_name_only_matches_if_descriptions_differ(
        self,
    ):
        original = [
            {"name": "Catalog Item", "description": "first copy"},
            {"name": "catalog item", "description": "second copy"},
            {"name": "Other Item"},
        ]

        result = remove_item_from_list(
            original,
            {
                "name": "CATALOG ITEM",
                "description": "query description does not matter",
            },
        )

        self.assertEqual(result, original)
        self.assertIsNot(result, original)

    def test_remove_item_from_list_returns_new_list_and_does_not_mutate_input(self):
        original = ["Alpha", "Bravo"]

        result = remove_item_from_list(original, "alpha")

        self.assertEqual(result, ["Bravo"])
        self.assertEqual(original, ["Alpha", "Bravo"])
        self.assertIsNot(result, original)

    def test_remove_item_from_list_returns_unchanged_items_when_no_equivalent(self):
        original = ["Alpha", {"name": "Bravo"}]

        result = remove_item_from_list(original, "Charlie")

        self.assertEqual(result, ["Alpha", {"name": "Bravo"}])


if __name__ == "__main__":
    unittest.main()
