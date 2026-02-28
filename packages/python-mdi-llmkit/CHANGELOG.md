# Changelog

All notable changes to this package will be documented in this file.

## 1.1.1 - 2026-02-28

- Renamed semantic diff subpackage import path from `mdi_llmkit.comparison` to `mdi_llmkit.semanticMatch`.
- Renamed internal source module folder from `comparison` to `semanticMatch`.
- Marked as a clean breaking change (no compatibility alias for the old import path).

## 1.1.0 - 2026-02-28

- Removed root-level convenience re-exports from `mdi_llmkit` so package usage is subpackage-only.
- Preserved subpackage import paths for public APIs (`mdi_llmkit.gpt_api`, `mdi_llmkit.json_surgery`, `mdi_llmkit.semanticMatch`).
- Added import-surface regression coverage to ensure root exports remain empty while subpackage imports continue to work.

## 1.0.6 - 2026-02-27

- Version bump to align Python/TypeScript package versions and trigger a release pipeline test run.

## 1.0.4 - 2026-02-27

- Fixed an intermittently failing unit test by tightening prompt behavior for deterministic outcomes.

## 1.0.3 - 2026-02-27

- Version bump only, to trigger the release pipeline.

## 1.0.2 - 2026-02-27

- Added `mdi_llmkit.semanticMatch.compare_item_lists` with deterministic pre-processing plus LLM-guided rename/add/remove classification.
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
