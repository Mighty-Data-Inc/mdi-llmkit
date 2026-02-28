# Changelog

All notable changes to this package will be documented in this file.

## 1.0.2 - 2026-02-27

- Added `mdi_llmkit.comparison.compare_item_lists` with deterministic pre-processing plus LLM-guided rename/add/remove classification.
- Added Python comparison API types and callback contracts (`SemanticallyComparableListItem`, `ItemComparisonResult`, `OnComparingItemCallback`, `StringListComparison`).
- Added live API test coverage for comparison behavior and callback telemetry in `tests/test_compare_lists.py`.
- Added Python README documentation for semantic list comparison usage and input formats.

## 1.0.1 - 2026-02-27

- Promoted the package to the first stable line with immediate patch-level hardening.
- Normalized test API-key handling with trimming to avoid hidden-whitespace secret issues in CI.
- Retained masked CI secret diagnostics in workflow to make future environment debugging faster.

## 0.1.0 - 2026-02-25

- Added `gpt_submit` helper with retry behavior, datetime system-message injection, JSON mode support, and warning callback support.
- Added `GptConversation` with role helpers, submit wrappers, and last-reply convenience accessors.
- Added `json_surgery` iterative JSON mutation workflow with validation/progress hooks and iteration/time safety limits.
- Added package test coverage for GPT API helpers, schema formatting, JSON surgery, and subpackage imports.
