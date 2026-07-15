# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
