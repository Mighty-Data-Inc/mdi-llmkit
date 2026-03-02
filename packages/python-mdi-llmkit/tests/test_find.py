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


from mdi_llmkit.semantic_match import SemanticItem, find_semantic_match


print(f"Loading .env from CWD={os.getcwd()}")
load_dotenv()


OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
if not OPENAI_API_KEY:
    raise RuntimeError(
        "OPENAI_API_KEY is required for find_semantic_match live API tests. "
        "Configure your test environment to provide it."
    )


def create_client() -> OpenAI:
    return OpenAI(api_key=OPENAI_API_KEY, timeout=30.0)


def create_intentionally_invalid_client(suffix: str) -> OpenAI:
    return OpenAI(api_key=f"{OPENAI_API_KEY}-{suffix}", timeout=30.0)


class FindSemanticMatchLiveAPITests(unittest.TestCase):
    # IMPORTANT: These tests intentionally use live OpenAI calls and DO NOT mock GptConversation.
    # We are validating real prompt+schema behavior end-to-end.

    def expect_match(
        self,
        item_list: list[SemanticItem],
        test_item: SemanticItem,
        expected_index: int,
        explanation: str | None = None,
    ) -> None:
        result = find_semantic_match(create_client(), item_list, test_item, explanation)
        self.assertEqual(result, expected_index)

    def expect_no_match(
        self,
        item_list: list[SemanticItem],
        test_item: SemanticItem,
        explanation: str | None = None,
    ) -> None:
        result = find_semantic_match(create_client(), item_list, test_item, explanation)
        self.assertEqual(result, -1)

    def expect_one_of_matches(
        self,
        item_list: list[SemanticItem],
        test_item: SemanticItem,
        expected_indexes: list[int],
        explanation: str | None = None,
    ) -> None:
        result = find_semantic_match(create_client(), item_list, test_item, explanation)
        self.assertIn(result, expected_indexes)

    # exact-match short-circuit behavior
    def test_returns_case_insensitive_exact_match_without_needing_llm_resolution(self):
        invalid_client = create_intentionally_invalid_client(
            "INTENTIONALLY-INVALID-FOR-EXACT-MATCH-TEST"
        )

        result = find_semantic_match(
            invalid_client,
            ["Chickenpox", "Measles", "Cold sore"],
            "measles",
        )

        self.assertEqual(result, 1)

    def test_returns_first_index_when_multiple_strings_match_case_insensitively(self):
        invalid_client = create_intentionally_invalid_client(
            "INTENTIONALLY-INVALID-FOR-DUPLICATE-INDEX-TEST"
        )

        result = find_semantic_match(
            invalid_client,
            ["Georgia", "France", "GEORGIA"],
            "georgia",
        )

        self.assertEqual(result, 0)

    def test_short_circuits_when_list_item_has_description_and_test_item_is_string(
        self,
    ):
        invalid_client = create_intentionally_invalid_client(
            "INTENTIONALLY-INVALID-FOR-STRING-OBJECT-SHORTCUT-TEST"
        )

        result = find_semantic_match(
            invalid_client,
            [
                {
                    "name": "Georgia",
                    "description": "A sovereign country in the South Caucasus. Capital: Tbilisi.",
                },
                {
                    "name": "France",
                    "description": "A country in Western Europe. Capital: Paris.",
                },
            ],
            "Georgia",
        )

        self.assertEqual(result, 0)

    def test_short_circuits_when_both_name_desc_items_have_equal_descriptions_after_trimming(
        self,
    ):
        invalid_client = create_intentionally_invalid_client(
            "INTENTIONALLY-INVALID-FOR-EQUAL-DESCRIPTION-SHORTCUT-TEST"
        )

        result = find_semantic_match(
            invalid_client,
            [
                {
                    "name": "Georgia",
                    "description": "A U.S. state in the southeastern U.S. Capital: Atlanta.",
                },
                {
                    "name": "France",
                    "description": "A country in Western Europe. Capital: Paris.",
                },
            ],
            {
                "name": "Georgia",
                "description": "  A U.S. state in the southeastern U.S. Capital: Atlanta.  ",
            },
        )

        self.assertEqual(result, 0)

    def test_does_not_short_circuit_when_names_match_but_descriptions_conflict(self):
        invalid_client = create_intentionally_invalid_client(
            "INTENTIONALLY-INVALID-FOR-CONFLICTING-DESCRIPTION-TEST"
        )

        with self.assertRaises(Exception):
            find_semantic_match(
                invalid_client,
                [
                    {
                        "name": "Georgia",
                        "description": "A U.S. state in the southeastern United States. Capital: Atlanta.",
                    },
                    {
                        "name": "France",
                        "description": "A country in Western Europe. Capital: Paris.",
                    },
                ],
                {
                    "name": "Georgia",
                    "description": "A sovereign country in the South Caucasus. Capital: Tbilisi.",
                },
            )

    # medicine colloquial vs clinical names
    def test_maps_varicella_to_chickenpox(self):
        self.expect_match(["Chickenpox", "Measles", "Cold sore"], "Varicella", 0)

    def test_maps_pertussis_to_whooping_cough(self):
        self.expect_match(["Whooping cough", "Mumps", "Tetanus"], "Pertussis", 0)

    def test_maps_rubella_to_german_measles(self):
        self.expect_match(["German measles", "Scarlet fever", "Shingles"], "Rubella", 0)

    def test_maps_conjunctivitis_to_pink_eye(self):
        self.expect_match(["Pink eye", "Flu", "Strep throat"], "Conjunctivitis", 0)

    def test_maps_infectious_mononucleosis_to_mono(self):
        self.expect_match(
            ["Mono", "Chickenpox", "Bronchitis"],
            "Infectious mononucleosis",
            0,
        )

    def test_returns_minus_one_for_unrelated_clinical_condition(self):
        self.expect_no_match(["Migraine", "Asthma", "Eczema"], "Appendicitis")

    # geography modern vs historical names
    def test_maps_nippon_to_japan(self):
        self.expect_match(["China", "Japan", "Singapore"], "Nippon", 1)

    def test_maps_persia_to_iran(self):
        self.expect_match(["Iran", "Iraq", "Turkey"], "Persia", 0)

    def test_maps_siam_to_thailand(self):
        self.expect_match(["Thailand", "Vietnam", "Laos"], "Siam", 0)

    def test_maps_ceylon_to_sri_lanka(self):
        self.expect_match(["Sri Lanka", "India", "Nepal"], "Ceylon", 0)

    def test_maps_burma_to_myanmar(self):
        self.expect_match(["Myanmar", "Bangladesh", "Bhutan"], "Burma", 0)

    def test_returns_minus_one_when_no_country_is_semantically_related(self):
        self.expect_no_match(["Canada", "Mexico", "Brazil"], "Prussia")

    # geography same-name disambiguation (Georgia)
    def test_chooses_georgia_country_when_state_and_country_are_present(self):
        self.expect_match(
            [
                {
                    "name": "Georgia",
                    "description": "A U.S. state in the southeastern United States. Capital: Atlanta.",
                },
                {
                    "name": "Georgia",
                    "description": "A sovereign country in the South Caucasus. Capital: Tbilisi.",
                },
                {
                    "name": "France",
                    "description": "A country in Western Europe. Capital: Paris.",
                },
            ],
            {
                "name": "Georgia",
                "description": "A country in the South Caucasus bordered by Turkey, Armenia, and Azerbaijan. Capital: Tbilisi.",
            },
            1,
        )

    def test_chooses_georgia_state_when_state_and_country_are_present(self):
        self.expect_match(
            [
                {
                    "name": "Georgia",
                    "description": "A U.S. state in the southeastern United States. Capital: Atlanta.",
                },
                {
                    "name": "Georgia",
                    "description": "A sovereign country in the South Caucasus. Capital: Tbilisi.",
                },
                {
                    "name": "France",
                    "description": "A country in Western Europe. Capital: Paris.",
                },
            ],
            {
                "name": "Georgia",
                "description": "A U.S. state in the southeastern U.S. with Atlanta as its capital.",
            },
            0,
        )

    def test_accepts_either_georgia_index_for_string_only_item_with_red_herrings(self):
        self.expect_one_of_matches(
            [
                {
                    "name": "Georgia",
                    "description": "A U.S. state in the southeastern United States. Capital: Atlanta.",
                },
                {
                    "name": "Georgia",
                    "description": "A sovereign country in the South Caucasus. Capital: Tbilisi.",
                },
                {
                    "name": "France",
                    "description": "A country in Western Europe. Capital: Paris.",
                },
                {
                    "name": "Florida",
                    "description": "A U.S. state in the southeastern U.S. Capital: Tallahassee.",
                },
                {
                    "name": "Armenia",
                    "description": "A country in the South Caucasus. Capital: Yerevan.",
                },
            ],
            "Georgia",
            [0, 1],
        )

    def test_matches_single_georgia_string_when_test_item_provides_state_description(
        self,
    ):
        self.expect_match(
            ["Georgia", "France", "Japan"],
            {
                "name": "Georgia",
                "description": "A U.S. state in the southeastern United States. Capital: Atlanta.",
            },
            0,
        )

    def test_returns_minus_one_when_list_has_country_but_test_item_describes_state(
        self,
    ):
        self.expect_no_match(
            [
                {
                    "name": "Georgia",
                    "description": "A sovereign country in the South Caucasus. Capital: Tbilisi.",
                },
                {
                    "name": "France",
                    "description": "A country in Western Europe. Capital: Paris.",
                },
                {
                    "name": "Alabama",
                    "description": "A U.S. state in the southeastern United States. Capital: Montgomery.",
                },
            ],
            {
                "name": "Georgia",
                "description": "A U.S. state in the southeastern United States. Capital: Atlanta.",
            },
        )

    # context-guided disambiguation
    def test_uses_explanation_to_choose_correct_congo_variant(self):
        self.expect_match(
            [
                "Republic of the Congo",
                "Democratic Republic of the Congo",
                "Gabon",
            ],
            "Congo-Brazzaville",
            0,
            "Interpret Congo-Brazzaville as the country whose capital is Brazzaville. "
            + "Do not map it to the Democratic Republic of the Congo.",
        )


if __name__ == "__main__":
    unittest.main()
