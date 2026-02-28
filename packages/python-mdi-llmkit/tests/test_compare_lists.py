import os
import sys
import unittest
from pathlib import Path
from typing import TypedDict

from dotenv import load_dotenv
from openai import OpenAI


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


from mdi_llmkit.comparison import (
    ItemComparisonResult,
    OnComparingItemCallback,
    SemanticallyComparableListItem,
    compare_item_lists,
)


print(f"Loading .env from CWD={os.getcwd()}")
load_dotenv()


OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
if not OPENAI_API_KEY:
    raise RuntimeError(
        "OPENAI_API_KEY is required for json_surgery live API tests. "
        "Configure your test environment to provide it."
    )


def create_client() -> OpenAI:
    openai_client = OpenAI(api_key=OPENAI_API_KEY, timeout=30.0)
    return openai_client


class ComparisonEvent(TypedDict):
    item: SemanticallyComparableListItem
    is_from_before_list: bool
    is_starting: bool
    result: ItemComparisonResult
    new_name: str | None
    error: str | None
    total_processed_so_far: int
    total_left_to_process: int


def collect_events() -> tuple[list[ComparisonEvent], OnComparingItemCallback]:
    events: list[ComparisonEvent] = []

    def callback(
        item: SemanticallyComparableListItem,
        is_from_before_list: bool,
        is_starting: bool,
        result: ItemComparisonResult,
        new_name: str | None,
        error: str | None,
        total_processed_so_far: int,
        total_left_to_process: int,
    ) -> None:
        events.append(
            {
                "item": item,
                "is_from_before_list": is_from_before_list,
                "is_starting": is_starting,
                "result": result,
                "new_name": new_name,
                "error": error,
                "total_processed_so_far": total_processed_so_far,
                "total_left_to_process": total_left_to_process,
            }
        )

    return events, callback


def assert_processed_counters_are_sequential(
    testcase: unittest.TestCase, events: list[ComparisonEvent]
) -> None:
    finishes = [event for event in events if not event["is_starting"]]
    expected_processed = 1
    for event in finishes:
        testcase.assertEqual(event["total_processed_so_far"], expected_processed)
        expected_processed += 1
    if len(finishes) > 0:
        testcase.assertEqual(finishes[-1]["total_left_to_process"], 0)


class CompareItemListsLiveAPITests(unittest.TestCase):
    # IMPORTANT: These tests intentionally use live OpenAI calls and DO NOT mock GptConversation.
    # We are validating the real prompt+schema behavior end-to-end (including model decisions),
    # not just local control-flow in isolation.

    # input validation
    def test_throws_for_duplicate_item_names_case_insensitive_within_a_list(self):
        with self.assertRaisesRegex(
            Exception, "Duplicate item names found in before list"
        ):
            compare_item_lists(create_client(), ["Widget", "widget"], ["Other"])

    # string behavior
    def test_classifies_case_insensitive_exact_string_matches_as_unchanged(self):
        events, callback = collect_events()

        result = compare_item_lists(
            create_client(),
            ["String Item A", "String Item B"],
            ["string item a", "STRING ITEM B"],
            "Case-only differences are unchanged.",
            callback,
        )

        self.assertEqual(result["removed"], [])
        self.assertEqual(result["added"], [])
        self.assertEqual(result["renamed"], {})
        self.assertEqual(result["unchanged"], ["String Item A", "String Item B"])

        # Deterministic pruning handles all items before any LLM loop.
        self.assertEqual(len(events), 0)

    # name/description behavior
    def test_treats_same_names_as_unchanged_even_when_descriptions_differ(self):
        result = compare_item_lists(
            create_client(),
            [
                {
                    "name": "Catalog Item 100",
                    "description": "old description content",
                }
            ],
            [
                {
                    "name": "catalog item 100",
                    "description": "new description content",
                }
            ],
            "Identity is the item name; description differences alone do not imply rename.",
        )

        self.assertEqual(result["removed"], [])
        self.assertEqual(result["added"], [])
        self.assertEqual(result["renamed"], {})
        self.assertEqual(result["unchanged"], ["Catalog Item 100"])

    def test_uses_description_context_to_support_a_guided_rename_decision(self):
        result = compare_item_lists(
            create_client(),
            [
                {
                    "name": "Plan Bronze Legacy",
                    "description": "old tier label for the bronze offering",
                }
            ],
            [
                {
                    "name": "Plan Bronze Modern",
                    "description": "new tier label for the same bronze offering",
                }
            ],
            "Exactly one rename occurred. "
            + "Plan Bronze Legacy was renamed to Plan Bronze Modern. "
            + "Treat as rename; do not treat as remove/add.",
        )

        self.assertEqual(result["removed"], [])
        self.assertEqual(result["added"], [])
        self.assertEqual(result["unchanged"], [])
        self.assertEqual(result["renamed"]["Plan Bronze Legacy"], "Plan Bronze Modern")

    # rename behavior
    def test_detects_a_single_guided_rename(self):
        result = compare_item_lists(
            create_client(),
            ["ACME Legacy Plan"],
            ["ACME Modern Plan"],
            "There is exactly one rename in this migration. "
            + "ACME Legacy Plan was renamed to ACME Modern Plan. "
            + "Treat this as rename, not add/remove.",
        )

        self.assertEqual(result["removed"], [])
        self.assertEqual(result["added"], [])
        self.assertEqual(result["unchanged"], [])
        self.assertEqual(result["renamed"]["ACME Legacy Plan"], "ACME Modern Plan")

    def test_supports_two_independent_guided_renames_in_one_run(self):
        result = compare_item_lists(
            create_client(),
            ["Legacy Product Alpha", "Legacy Product Beta"],
            ["Modern Product Alpha", "Modern Product Beta"],
            "Two renames occurred with one-to-one mapping. "
            + "Legacy Product Alpha -> Modern Product Alpha. "
            + "Legacy Product Beta -> Modern Product Beta. "
            + "No deletions or net additions in this migration.",
        )

        self.assertEqual(
            sorted(result["renamed"].keys()),
            ["Legacy Product Alpha", "Legacy Product Beta"],
        )
        self.assertEqual(
            result["renamed"]["Legacy Product Alpha"], "Modern Product Alpha"
        )
        self.assertEqual(
            result["renamed"]["Legacy Product Beta"], "Modern Product Beta"
        )
        self.assertEqual(result["removed"], [])
        self.assertEqual(result["added"], [])
        self.assertEqual(result["unchanged"], [])

    # added/deleted behavior
    def test_classifies_explicit_deletion(self):
        result = compare_item_lists(
            create_client(),
            ["Delete Me Item"],
            [],
            "Delete Me Item was intentionally removed and has no replacement.",
        )

        self.assertEqual(result["removed"], ["Delete Me Item"])
        self.assertEqual(result["added"], [])
        self.assertEqual(result["renamed"], {})
        self.assertEqual(result["unchanged"], [])

    def test_classifies_explicit_addition(self):
        result = compare_item_lists(
            create_client(),
            [],
            ["Brand New Additive Item"],
            "Brand New Additive Item is newly introduced and should be treated as added.",
        )

        self.assertEqual(result["removed"], [])
        self.assertEqual(result["added"], ["Brand New Additive Item"])
        self.assertEqual(result["renamed"], {})
        self.assertEqual(result["unchanged"], [])

    # mixed outcomes
    def test_handles_unchanged_renamed_removed_added_together(self):
        result = compare_item_lists(
            create_client(),
            ["Shared Constant Item", "Legacy Rename Target", "Delete Candidate"],
            ["shared constant item", "Modern Rename Target", "Add Candidate"],
            "Legacy Rename Target was renamed to Modern Rename Target. "
            + "Delete Candidate was removed. "
            + "Add Candidate was newly added. "
            + "Shared Constant Item is unchanged.",
        )

        self.assertEqual(result["unchanged"], ["Shared Constant Item"])
        self.assertEqual(
            result["renamed"]["Legacy Rename Target"], "Modern Rename Target"
        )
        self.assertEqual(result["removed"], ["Delete Candidate"])
        self.assertEqual(result["added"], ["Add Candidate"])

    # callback reporting behavior
    def test_emits_balanced_start_finish_events_with_correct_source_list_flags(self):
        events, callback = collect_events()

        compare_item_lists(
            create_client(),
            ["Before Removed A", "Before Removed B"],
            ["After Added A"],
            "Before Removed A and Before Removed B were removed. "
            + "After Added A was newly added. "
            + "No renames exist in this case.",
            callback,
        )

        starts = [event for event in events if event["is_starting"]]
        finishes = [event for event in events if not event["is_starting"]]

        self.assertEqual(len(starts), len(finishes))
        self.assertEqual(len(starts), 3)

        self.assertEqual(
            len([event for event in starts if event["is_from_before_list"]]), 2
        )
        self.assertEqual(
            len([event for event in starts if not event["is_from_before_list"]]), 1
        )

    def test_increments_processed_counters_sequentially_and_reaches_zero_remaining_at_end(
        self,
    ):
        events, callback = collect_events()

        compare_item_lists(
            create_client(),
            ["Legacy Counter Item"],
            ["Modern Counter Item", "New Counter Add"],
            "Legacy Counter Item was renamed to Modern Counter Item. "
            + "New Counter Add is newly added.",
            callback,
        )

        assert_processed_counters_are_sequential(self, events)

    def test_populates_new_name_only_for_rename_finish_events(self):
        events, callback = collect_events()

        compare_item_lists(
            create_client(),
            ["Legacy Named Item"],
            ["Modern Named Item"],
            "Legacy Named Item was renamed to Modern Named Item.",
            callback,
        )

        rename_finishes = [
            event
            for event in events
            if not event["is_starting"]
            and event["result"] == ItemComparisonResult.RENAMED
        ]
        self.assertGreater(len(rename_finishes), 0)
        for event in rename_finishes:
            self.assertEqual(event["new_name"], "Modern Named Item")

        for event in [
            entry
            for entry in events
            if not (
                not entry["is_starting"]
                and entry["result"] == ItemComparisonResult.RENAMED
            )
        ]:
            self.assertIsNone(event["new_name"])

    def test_reports_live_api_failures_through_callback_error_field_no_mocks(self):
        events, callback = collect_events()

        invalid_client = OpenAI(
            api_key=f"{OPENAI_API_KEY}-INTENTIONALLY-INVALID-FOR-TEST",
        )

        result = compare_item_lists(
            invalid_client,
            ["Live API Error Candidate"],
            ["After Error Path Item"],
            "If API fails, fallback should still complete with warning messages in callback.",
            callback,
        )

        # Fallback behavior on failed before-item processing is to mark as unchanged.
        self.assertIn("Live API Error Candidate", result["unchanged"])

        finish_events_with_errors = [
            event
            for event in events
            if not event["is_starting"] and isinstance(event["error"], str)
        ]
        self.assertGreater(len(finish_events_with_errors), 0)
        self.assertTrue(
            any(
                "LLM processing failed" in (event["error"] or "")
                for event in finish_events_with_errors
            )
        )

    # bulk list scenarios
    def test_handles_a_larger_mixed_migration_with_multiple_renames_additions_deletions(
        self,
    ):
        before_items: list[SemanticallyComparableListItem] = [
            "Shared Stable A",
            "Shared Stable B",
            "Legacy Rename One",
            "Legacy Rename Two",
            "Removed Batch One",
            "Removed Batch Two",
            "Shared Stable C",
        ]

        after_items: list[SemanticallyComparableListItem] = [
            "shared stable a",
            "SHARED STABLE B",
            "Modern Rename One",
            "Modern Rename Two",
            "Added Batch One",
            "Added Batch Two",
            "shared stable c",
        ]

        result = compare_item_lists(
            create_client(),
            before_items,
            after_items,
            "Migration map: Legacy Rename One -> Modern Rename One. "
            + "Legacy Rename Two -> Modern Rename Two. "
            + "Removed Batch One and Removed Batch Two were removed. "
            + "Added Batch One and Added Batch Two were newly added. "
            + "Shared Stable A/B/C are unchanged.",
        )

        self.assertEqual(
            result["unchanged"],
            ["Shared Stable A", "Shared Stable B", "Shared Stable C"],
        )
        self.assertEqual(
            result["renamed"],
            {
                "Legacy Rename One": "Modern Rename One",
                "Legacy Rename Two": "Modern Rename Two",
            },
        )
        self.assertEqual(result["removed"], ["Removed Batch One", "Removed Batch Two"])
        self.assertEqual(result["added"], ["Added Batch One", "Added Batch Two"])

    def test_maintains_coherent_callback_counters_on_larger_ambiguous_sets(self):
        events, callback = collect_events()

        result = compare_item_lists(
            create_client(),
            [
                "Bulk Legacy 1",
                "Bulk Legacy 2",
                "Bulk Removed 1",
                "Bulk Removed 2",
                "Bulk Shared 1",
                "Bulk Shared 2",
            ],
            [
                "Bulk Modern 1",
                "Bulk Modern 2",
                "Bulk Added 1",
                "Bulk Added 2",
                "bulk shared 1",
                "BULK SHARED 2",
            ],
            "Bulk Legacy 1 -> Bulk Modern 1. "
            + "Bulk Legacy 2 -> Bulk Modern 2. "
            + "Bulk Removed 1 and Bulk Removed 2 were removed. "
            + "Bulk Added 1 and Bulk Added 2 were newly added. "
            + "Bulk Shared 1 and Bulk Shared 2 are unchanged.",
            callback,
        )

        self.assertEqual(
            result["renamed"],
            {
                "Bulk Legacy 1": "Bulk Modern 1",
                "Bulk Legacy 2": "Bulk Modern 2",
            },
        )
        self.assertEqual(result["removed"], ["Bulk Removed 1", "Bulk Removed 2"])
        self.assertEqual(result["added"], ["Bulk Added 1", "Bulk Added 2"])
        self.assertEqual(result["unchanged"], ["Bulk Shared 1", "Bulk Shared 2"])

        # There are 4 ambiguous "before" items and, after rename removals, 2 remaining
        # "after" items for add-classification, so callback lifecycle should cover 6 items.
        starts = [event for event in events if event["is_starting"]]
        finishes = [event for event in events if not event["is_starting"]]
        self.assertEqual(len(starts), 6)
        self.assertEqual(len(finishes), 6)

        assert_processed_counters_are_sequential(self, events)

    # inference without explicit mapping instructions
    def test_infers_removed_string_items_when_after_list_omits_them(self):
        result = compare_item_lists(
            create_client(),
            [
                "Invoice Number",
                "Purchase Date",
                "Supplier Name",
                "Legacy Tax Code",
                "Deprecated Internal Note",
                "Total Amount",
            ],
            ["Invoice Number", "Purchase Date", "Supplier Name", "Total Amount"],
        )

        self.assertEqual(
            result["removed"], ["Deprecated Internal Note", "Legacy Tax Code"]
        )
        self.assertEqual(result["added"], [])
        self.assertEqual(result["renamed"], {})
        self.assertEqual(
            result["unchanged"],
            ["Invoice Number", "Purchase Date", "Supplier Name", "Total Amount"],
        )

    def test_infers_added_string_items_when_after_list_introduces_them(self):
        result = compare_item_lists(
            create_client(),
            ["Order ID", "Customer Name", "Subtotal", "Order Date"],
            [
                "Order ID",
                "Customer Name",
                "Subtotal",
                "Order Date",
                "Shipping Method",
                "Delivery Address",
            ],
        )

        self.assertEqual(result["removed"], [])
        self.assertEqual(result["added"], ["Shipping Method", "Delivery Address"])
        self.assertEqual(result["renamed"], {})
        self.assertEqual(
            result["unchanged"],
            ["Customer Name", "Order Date", "Order ID", "Subtotal"],
        )

    def test_infers_removed_name_description_items_without_explicit_guidance(self):
        result = compare_item_lists(
            create_client(),
            [
                {"name": "acct_id", "description": "Unique account identifier"},
                {
                    "name": "acct_name",
                    "description": "Human-readable account name",
                },
                {"name": "acct_region", "description": "Assigned sales region"},
                {
                    "name": "legacy_segment_code",
                    "description": "Old segmentation code from prior CRM",
                },
                {
                    "name": "legacy_priority_bucket",
                    "description": "Obsolete account prioritization bucket",
                },
            ],
            [
                {"name": "acct_id", "description": "Unique account identifier"},
                {
                    "name": "acct_name",
                    "description": "Human-readable account name",
                },
                {"name": "acct_region", "description": "Assigned sales region"},
            ],
        )

        self.assertEqual(
            result["removed"], ["legacy_priority_bucket", "legacy_segment_code"]
        )
        self.assertEqual(result["added"], [])
        self.assertEqual(result["renamed"], {})
        self.assertEqual(result["unchanged"], ["acct_id", "acct_name", "acct_region"])

    def test_infers_added_name_description_items_without_explicit_guidance(self):
        result = compare_item_lists(
            create_client(),
            [
                {"name": "sku", "description": "Stock keeping unit identifier"},
                {"name": "title", "description": "Product display title"},
                {"name": "price", "description": "Current listed price"},
            ],
            [
                {"name": "sku", "description": "Stock keeping unit identifier"},
                {"name": "title", "description": "Product display title"},
                {"name": "price", "description": "Current listed price"},
                {
                    "name": "inventory_count",
                    "description": "Current on-hand inventory quantity",
                },
                {
                    "name": "warehouse_location",
                    "description": "Primary warehouse storage location code",
                },
            ],
        )

        self.assertEqual(result["removed"], [])
        self.assertEqual(result["added"], ["inventory_count", "warehouse_location"])
        self.assertEqual(result["renamed"], {})
        self.assertEqual(result["unchanged"], ["price", "sku", "title"])

    def test_infers_rename_from_semantic_name_similarity_plus_identical_description(
        self,
    ):
        result = compare_item_lists(
            create_client(),
            [
                {
                    "name": "billing_address_line_1",
                    "description": "Primary street line for billing address",
                },
                {
                    "name": "billing_city",
                    "description": "City associated with the billing address",
                },
                {
                    "name": "billing_zip_code",
                    "description": "The five-digit postal code associated with the billing address",
                },
                {
                    "name": "billing_country_code",
                    "description": "ISO country code for the billing address",
                },
            ],
            [
                {
                    "name": "billing_address_line_1",
                    "description": "Primary street line for billing address",
                },
                {
                    "name": "billing_city",
                    "description": "City associated with the billing address",
                },
                {
                    "name": "billing_postal_code",
                    "description": "The five-digit postal code associated with the billing address",
                },
                {
                    "name": "billing_country_code",
                    "description": "ISO country code for the billing address",
                },
            ],
        )

        self.assertEqual(result["removed"], [])
        self.assertEqual(result["added"], [])
        self.assertEqual(
            result["unchanged"],
            ["billing_address_line_1", "billing_city", "billing_country_code"],
        )
        self.assertEqual(result["renamed"], {"billing_zip_code": "billing_postal_code"})

    def test_infers_rename_from_semantic_similarity_for_plain_string_items(self):
        result = compare_item_lists(
            create_client(),
            [
                "billing_address_line_1",
                "billing_city",
                "billing_zip_code",
                "billing_country_code",
            ],
            [
                "billing_address_line_1",
                "billing_city",
                "billing_postal_code",
                "billing_country_code",
            ],
        )

        self.assertEqual(result["removed"], [])
        self.assertEqual(result["added"], [])
        self.assertEqual(
            result["unchanged"],
            ["billing_address_line_1", "billing_city", "billing_country_code"],
        )
        self.assertEqual(result["renamed"], {"billing_zip_code": "billing_postal_code"})


if __name__ == "__main__":
    unittest.main()
