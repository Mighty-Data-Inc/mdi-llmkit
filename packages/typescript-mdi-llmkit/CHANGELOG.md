# Changelog

All notable changes to this package will be documented in this file.

## 1.0.8 - 2026-03-15

- Version bump only to induce CI/CD after the previous release workflow did not fire.

## 1.0.7 - 2026-03-15

- Added a high-visibility link in the package README to the full repository README on GitHub.
- Added npm metadata links (`homepage` and `bugs`) for improved registry-side discoverability.

## 1.0.6 - 2026-03-15

- Bumped to a shared Python/TypeScript version line.
- Aligned with the higher prior package version and moved both packages forward together.

## 1.0.5 - 2026-03-15

- Bumped the meta-package version after dependency updates.
- Continued keeping dependency packages up to date.

## 1.0.2 - 2026-03-15

- Converted the TypeScript package in this repository to a meta-package structure.
- The package now acts as a convenience installer for the core Mighty Data TypeScript packages rather than exposing its own runtime implementation.
- Updated package metadata and release handling to match the new meta-package layout.

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
