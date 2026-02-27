# Changelog

All notable changes to this package will be documented in this file.

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
