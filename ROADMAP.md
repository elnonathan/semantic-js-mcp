# Roadmap

Semantic JS MCP is under active development. This roadmap outlines areas of investigation and intended development. Items are directional and are not release commitments.

## Reliability

- Improve current-document diagnostic confirmation across supported language servers.
- Keep semantic evidence fresh across edits, file additions, removals, renames, and workspace configuration changes.
- Expand deterministic fixtures for complete, partial, limited, failed, stale, and untrusted outcomes.
- Continue measuring collection latency, memory use, and language-server lifecycle behavior at repository scale.

## Vue

- Improve named-component discovery for single-file components.
- Expand template binding resolution while preserving explicit uncertainty for global or dynamic registration.
- Improve diagnostics and signature recovery in complex Vue files.

## React And JSX

- Add framework-focused fixtures for components, hooks, props, re-exports, aliases, and higher-order patterns.
- Document the evidence boundaries for dynamic JSX composition and runtime component selection.

## Agent-Facing Results

- Keep result vocabulary literal, finite, and versioned.
- Measure compact audit summaries against large real-world symbols and smaller models without hiding collection scope or unresolved evidence.
- Expand examples for combining count, audit, reference, diagnostic, text-search, source-inspection, and test evidence.

## Distribution

- Maintain reproducible package and plugin release checks across supported Node.js LTS releases and operating systems.
- Document setup for additional MCP hosts using the same public server contract.
- Add immutable release-source, upgrade, rollback, and installed-plugin verification.

## Additional Language Domains

CSS, preprocessors, utility-class frameworks, and other language domains may be explored as independent providers. Any expansion must preserve source attribution, explicit uncertainty, and the read-only evidence contract.
