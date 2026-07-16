# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Cross-platform CI coverage for supported Node.js LTS lines.
- Focused negative-verification and public-documentation gates.
- Concise starter prompts and evidence examples for common agent workflows.

## [0.10.0] - 2026-07-16

### Added

- Add a deterministic semantic-evidence usability status to named counts and audits, with explicit follow-up reasons for incomplete collection or ambiguous definition selection.
- Add a repeated post-disposal memory benchmark that separates MCP heap, MCP resident memory, and child-provider resident memory under an explicitly scoped measurement method.

### Fixed

- Recover with fresh language-server and Vue tsserver clients after an initialized provider exits, while settling pending requests and diagnostics without leaving timeout handles active.

## [0.9.0] - 2026-07-16

### Changed

- Make count and audit results compact by default while preserving complete requested reference collections for paged follow-up tools.
- Centralize concise, tool-specific continuation guidance in the versioned protocol vocabulary.
- Consolidate server and schema identity under `producer`, and represent document fingerprints as `sha256:<hex>`.
- Return continuation guidance as exact tool-name lists, expose one reusable reference-set identifier per logical response, and remove page fields derivable from the normalized request and presentation counts.
- Group verified page locations by source file while preserving explicit ranges, discovery methods, location-based pagination, and evidence accounting.
- Advance the canonical result schema to version 6 for the compact audit presentation contract.
- Document migration from schema 5 and reject legacy envelopes in canonical-result validation.
- Report whether named-symbol filtering selected zero, one, or multiple exact definitions, and recommend only continuation tools supported by the returned evidence.
- Verify import and usage bindings against `fileHint` during named audits without treating the hinted filename as a declaration.
- Share concurrent diagnostic acquisition, negotiate provider pull support, and reject evidence when file content changes during acquisition.
- Report the owning diagnostic provider and document language once per result, with source region and embedded language on each diagnostic when its range establishes them.
- Order continuation tools so position-based disambiguation and unresolved-candidate inspection precede broader follow-up pages when those uncertainties are present.

### Added

- Add deterministic release verification, isolated postpublication package verification, and externally configured repository-matrix commands.
- Reject repository-matrix diagnostic paths whose canonical target escapes the configured repository root.
- Add model-independent fixtures for compact-result continuation and coverage decisions.
- Cover named symbol discovery and audits for standalone JavaScript modules at workspace-root and nested source locations.
- Add npm keywords for MCP, language-server, JavaScript, and semantic-navigation discovery.

## [0.8.1] - 2026-07-15

### Fixed

- Bundle production dependencies in the npm artifact so Codex plugin installations run without a separate dependency installation step.
- Validate the distribution from an empty npm cache in offline mode.

## [0.8.0] - 2026-07-15

### Added

- Initial pre-release of the read-only semantic evidence server for TypeScript, JavaScript, TSX, JSX, Node module variants, and Vue.
- Definition, hover, diagnostics, document-symbol, workspace-symbol, named-symbol audit, position audit, and verified-reference tools.
- Repository-wide text-match accounting that separates requested-symbol matches, different symbols, and unresolved candidates.
- Explicit collection, presentation, completeness, and diagnostic-trust states.
- Paged reference collections with content and repository-inventory freshness validation.
- Workspace-aware TypeScript and Vue language-server selection with cross-workspace reference verification.
- Vue template fallback for locally imported component bindings and signature recovery from resolved declarations.
- Visible server and result-schema identity in canonical responses.
- Runtime checks, generic TypeScript and Vue smoke fixtures, canonical-input CI policy evaluation, and reproducible benchmarks.
- Literal `not-reported` diagnostic severity when a language server omits severity instead of silently assigning another severity.
- Codex plugin metadata, semantic-navigation skill, architecture decisions, contribution guide, security policy, and public roadmap.
- `semantic-js-mcp` executable with `serve`, `doctor`, version, help, JSON, and YAML output paths.
- Deterministic installation doctor for runtime requirements, provider resolution, MCP startup, tool discovery, TypeScript evidence, diagnostic freshness, and Vue navigation.
- Explicit npm package allowlist and an isolated tarball installation smoke that prevents runtime reuse of the source checkout.
- Reproducible Prettier formatting with a repository-wide public-source check in the validation gate.

### Changed

- Runtime provider entry points resolve through Node's package resolution algorithm so npm dependency hoisting is supported.
