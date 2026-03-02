import copy
import os
import sys
import unittest
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


from mdi_llmkit.semantic_match import (
    ItemComparisonClassification,
    ItemComparisonResult,
    SemanticItem,
    compare_item_lists,
    get_item_name,
)


print(f"Loading .env from CWD={os.getcwd()}")
load_dotenv()


OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
if not OPENAI_API_KEY:
    raise RuntimeError(
        "OPENAI_API_KEY is required for compare_item_lists live API tests. "
        "Configure your test environment to provide it."
    )


def create_client() -> OpenAI:
    return OpenAI(api_key=OPENAI_API_KEY, timeout=30.0)


def get_by_classification(
    results: list[ItemComparisonResult],
    classification: ItemComparisonClassification,
) -> list[ItemComparisonResult]:
    return [entry for entry in results if entry["classification"] == classification]


def get_names_by_classification(
    results: list[ItemComparisonResult],
    classification: ItemComparisonClassification,
) -> list[str]:
    return [
        get_item_name(entry["item"])
        for entry in get_by_classification(results, classification)
    ]


def get_renamed_map(results: list[ItemComparisonResult]) -> dict[str, str]:
    renamed: dict[str, str] = {}
    for entry in get_by_classification(results, ItemComparisonClassification.RENAMED):
        renamed[get_item_name(entry["item"])] = entry.get("new_name") or ""
    return renamed


class CompareItemListsLiveAPITests(unittest.TestCase):
    # IMPORTANT: These tests intentionally use live OpenAI calls and DO NOT mock find_semantic_match.
    # We are validating end-to-end behavior for the current record-based result contract.

    # current return contract
    def test_returns_per_item_records_with_classification_and_optional_new_name(self):
        results = compare_item_lists(
            create_client(),
            ["Legacy Plan Alpha"],
            ["Modern Plan Alpha"],
            "Legacy Plan Alpha was renamed to Modern Plan Alpha.",
        )

        self.assertTrue(isinstance(results, list))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["item"], "Legacy Plan Alpha")
        self.assertEqual(
            results[0]["classification"], ItemComparisonClassification.RENAMED
        )
        self.assertEqual(results[0].get("new_name"), "Modern Plan Alpha")

    # deterministic exact-match behavior
    def test_classifies_exact_string_matches_as_unchanged_and_does_not_mutate_inputs(
        self,
    ):
        before: list[SemanticItem] = ["String Item A", "String Item B"]
        after: list[SemanticItem] = ["string item a", "STRING ITEM B"]

        before_snapshot = copy.deepcopy(before)
        after_snapshot = copy.deepcopy(after)

        results = compare_item_lists(create_client(), before, after)

        self.assertEqual(
            get_names_by_classification(
                results, ItemComparisonClassification.UNCHANGED
            ),
            ["String Item A", "String Item B"],
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.REMOVED),
            [],
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.ADDED),
            [],
        )
        self.assertEqual(get_renamed_map(results), {})

        self.assertEqual(before, before_snapshot)
        self.assertEqual(after, after_snapshot)

    def test_classifies_object_vs_string_same_name_pair_as_unchanged(self):
        results = compare_item_lists(
            create_client(),
            [
                {
                    "name": "Georgia",
                    "description": "A sovereign country in the South Caucasus. Capital: Tbilisi.",
                }
            ],
            ["georgia"],
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(
            results[0]["classification"], ItemComparisonClassification.UNCHANGED
        )
        self.assertIsNone(results[0].get("new_name"))

    # added and removed behavior
    def test_classifies_before_only_item_as_removed(self):
        results = compare_item_lists(
            create_client(),
            ["Delete Me Item"],
            [],
            "Delete Me Item was intentionally removed and has no replacement.",
        )

        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.REMOVED),
            ["Delete Me Item"],
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.ADDED),
            [],
        )
        self.assertEqual(
            get_names_by_classification(
                results, ItemComparisonClassification.UNCHANGED
            ),
            [],
        )
        self.assertEqual(get_renamed_map(results), {})

    def test_classifies_after_only_items_as_added(self):
        results = compare_item_lists(
            create_client(),
            [],
            ["Brand New Additive Item", "Second New Item"],
        )

        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.ADDED),
            ["Brand New Additive Item", "Second New Item"],
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.REMOVED),
            [],
        )
        self.assertEqual(
            get_names_by_classification(
                results, ItemComparisonClassification.UNCHANGED
            ),
            [],
        )
        self.assertEqual(get_renamed_map(results), {})

    # rename behavior
    def test_detects_a_single_guided_rename(self):
        results = compare_item_lists(
            create_client(),
            ["ACME Legacy Plan"],
            ["ACME Modern Plan"],
            "There is exactly one rename in this migration. "
            + "ACME Legacy Plan was renamed to ACME Modern Plan. "
            + "Treat this as rename, not add/remove.",
        )

        self.assertEqual(
            get_renamed_map(results),
            {"ACME Legacy Plan": "ACME Modern Plan"},
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.REMOVED),
            [],
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.ADDED),
            [],
        )
        self.assertEqual(
            get_names_by_classification(
                results, ItemComparisonClassification.UNCHANGED
            ),
            [],
        )

    def test_handles_two_guided_renames_in_one_run(self):
        results = compare_item_lists(
            create_client(),
            ["Legacy Product Alpha", "Legacy Product Beta"],
            ["Modern Product Alpha", "Modern Product Beta"],
            "Two renames occurred with one-to-one mapping. "
            + "Legacy Product Alpha -> Modern Product Alpha. "
            + "Legacy Product Beta -> Modern Product Beta. "
            + "No deletions or net additions in this migration.",
        )

        self.assertEqual(
            get_renamed_map(results),
            {
                "Legacy Product Alpha": "Modern Product Alpha",
                "Legacy Product Beta": "Modern Product Beta",
            },
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.REMOVED),
            [],
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.ADDED),
            [],
        )
        self.assertEqual(
            get_names_by_classification(
                results, ItemComparisonClassification.UNCHANGED
            ),
            [],
        )

    # mixed outcomes
    def test_returns_records_for_unchanged_renamed_removed_added_in_one_run(self):
        results = compare_item_lists(
            create_client(),
            ["Shared Constant Item", "Legacy Rename Target", "Delete Candidate"],
            ["shared constant item", "Modern Rename Target", "Add Candidate"],
            "Legacy Rename Target was renamed to Modern Rename Target. "
            + "Delete Candidate was removed. "
            + "Add Candidate was newly added. "
            + "Shared Constant Item is unchanged.",
        )

        self.assertEqual(
            get_names_by_classification(
                results, ItemComparisonClassification.UNCHANGED
            ),
            ["Shared Constant Item"],
        )
        self.assertEqual(
            get_renamed_map(results),
            {"Legacy Rename Target": "Modern Rename Target"},
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.REMOVED),
            ["Delete Candidate"],
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.ADDED),
            ["Add Candidate"],
        )

    def test_returns_one_result_record_per_before_item_plus_unmatched_after_items(self):
        before: list[SemanticItem] = ["A", "B", "C"]
        after: list[SemanticItem] = ["a", "B-NEW", "D"]

        results = compare_item_lists(
            create_client(),
            before,
            after,
            "A is unchanged (case only). B was renamed to B-NEW. C was removed. D was added.",
        )

        self.assertEqual(len(results), 4)

    # additional behavior coverage
    def test_treats_same_name_items_with_conflicting_descriptions_as_renamed(self):
        results = compare_item_lists(
            create_client(),
            [
                {
                    "name": "Georgia",
                    "description": "A U.S. state in the southeastern United States. Capital: Atlanta.",
                },
            ],
            [
                {
                    "name": "Georgia",
                    "description": "A sovereign country in the South Caucasus. Capital: Tbilisi.",
                },
            ],
            "These two items share a label but represent different entities. Treat this as a rename rather than unchanged.",
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(
            results[0]["classification"], ItemComparisonClassification.RENAMED
        )
        self.assertEqual(results[0].get("new_name"), "Georgia")

    def test_consumes_matched_after_item_once_leaving_similar_item_as_removed(self):
        results = compare_item_lists(
            create_client(),
            ["Legacy Item Alpha", "Legacy Item Alpha Copy"],
            ["Modern Item Alpha"],
            "Only Legacy Item Alpha was renamed to Modern Item Alpha. Legacy Item Alpha Copy was removed.",
        )

        self.assertEqual(
            get_renamed_map(results),
            {"Legacy Item Alpha": "Modern Item Alpha"},
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.REMOVED),
            ["Legacy Item Alpha Copy"],
        )
        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.ADDED),
            [],
        )

    def test_preserves_order_of_added_records_from_remaining_after_list_items(self):
        results = compare_item_lists(
            create_client(),
            [],
            [
                {"name": "Added First", "description": "first"},
                {"name": "Added Second", "description": "second"},
                "Added Third",
            ],
        )

        self.assertEqual(
            get_names_by_classification(results, ItemComparisonClassification.ADDED),
            ["Added First", "Added Second", "Added Third"],
        )

    def test_does_not_mutate_before_or_after_lists_in_mixed_classification_scenarios(
        self,
    ):
        before: list[SemanticItem] = [
            "Stable Name",
            "Legacy Rename Candidate",
            "Legacy Removed Candidate",
        ]
        after: list[SemanticItem] = [
            "stable name",
            "Modern Rename Candidate",
            "Newly Added Candidate",
        ]

        before_snapshot = copy.deepcopy(before)
        after_snapshot = copy.deepcopy(after)

        compare_item_lists(
            create_client(),
            before,
            after,
            "Legacy Rename Candidate was renamed to Modern Rename Candidate. "
            + "Legacy Removed Candidate was removed. Newly Added Candidate was added.",
        )

        self.assertEqual(before, before_snapshot)
        self.assertEqual(after, after_snapshot)


if __name__ == "__main__":
    unittest.main()
