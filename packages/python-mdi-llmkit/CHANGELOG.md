# Changelog

All notable changes to this package will be documented in this file.

## 1.0.1 - 2026-02-27

- Promoted the package to the first stable line with immediate patch-level hardening.
- Normalized test API-key handling with trimming to avoid hidden-whitespace secret issues in CI.
- Retained masked CI secret diagnostics in workflow to make future environment debugging faster.

## 0.1.0 - 2026-02-25

- Added `gpt_submit` helper with retry behavior, datetime system-message injection, JSON mode support, and warning callback support.
- Added `GptConversation` with role helpers, submit wrappers, and last-reply convenience accessors.
- Added `json_surgery` iterative JSON mutation workflow with validation/progress hooks and iteration/time safety limits.
- Added package test coverage for GPT API helpers, schema formatting, JSON surgery, and subpackage imports.
