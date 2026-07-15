# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.8.0] - 2026-07-14

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
