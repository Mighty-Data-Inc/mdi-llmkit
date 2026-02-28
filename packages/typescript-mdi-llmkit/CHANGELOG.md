# Changelog

All notable changes to this package will be documented in this file.

## 1.0.6 - 2026-02-27

- Version bump to align Python/TypeScript package versions and trigger a release pipeline test run.

## 1.0.5 - 2026-02-27

- Added repository metadata in `package.json` to satisfy npm provenance validation.
- Bumped package version for another release attempt.

## 1.0.4 - 2026-02-27

- Updated TypeScript release workflow to use token-based npm authentication (`NPM_TOKEN`).
- Bumped package version for a fresh release attempt.

## 1.0.3 - 2026-02-27

- Version bump only, to trigger the release pipeline.

## 1.0.2 - 2026-02-27

- Patch-level release to keep npm and PyPI package versions aligned.
- No TypeScript API behavior changes in this patch.

## 1.0.1 - 2026-02-27

- Promoted the package to the first stable line with immediate patch-level hardening.
- Added CI diagnostics that log a masked `OPENAI_API_KEY` fingerprint for easier secret troubleshooting.
- Normalized test API-key handling with trimming to avoid hidden-whitespace secret issues in CI.

## 0.1.0 - 2026-02-25

- Added `gptSubmit` helper with retry behavior, datetime system-message injection, JSON mode support, and warning callback support.
- Added `GptConversation` with role helpers, submit wrappers, and last-reply convenience accessors.
- Added `JSONSchemaFormat` with compact DSL support and recursive schema expansion for OpenAI Structured Outputs.
- Added parity-oriented test coverage for submit helpers, conversation helpers, and JSON schema edge cases.
- Added TypeScript package README usage examples and Python-to-TypeScript migration notes.
