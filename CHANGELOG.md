# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.11.0] - 2026-07-23

### Security

- Enforce a workspace boundary on file and directory arguments. Paths are resolved through `realpath` and must stay within the allowed roots: the server launch directory and the package root by default, extendable with `SEMANTIC_JS_MCP_WORKSPACE_ROOTS` (path-delimiter-separated). Out-of-boundary requests return `PATH_OUTSIDE_WORKSPACE_BOUNDARY` without reading content. Repository discovery and cross-workspace scans use the same boundary.
- Use the bundled TypeScript SDK by default. The analyzed repository's `node_modules/typescript` is used only when `SEMANTIC_JS_MCP_ALLOW_WORKSPACE_TYPESCRIPT=1` is set, and the boundary still applies.
- Load TypeScript plugins only from the bundled runtime location (`--allowLocalPluginLoads` removed from the Vue tsserver bridge).
- Pass client-supplied search terms to `rg` after a `--` end-of-options separator, so a term beginning with `-` is not treated as a ripgrep flag.
- Drop `NODE_OPTIONS`, `NODE_PATH`, and `NODE_REPL_EXTERNAL_MODULE` from the environment of spawned processes (`rg`, tsserver, language servers).
- Handle malformed language-server output defensively: ignore non-`file:` URIs, skip incomplete tsserver definitions, and bound document-symbol recursion depth.
- Remove unreachable `clientForRoot` dead code.
- Replace `default_tools_approval_mode: "auto"` with `"prompt"` in `.mcp.json` so Codex asks before every `lsp_` tool call. Tools remain read-only; hosts that manage permissions themselves are unaffected.
- Allow the Codex plugin to forward `SEMANTIC_JS_MCP_WORKSPACE_ROOTS` and `SEMANTIC_JS_MCP_ALLOW_WORKSPACE_TYPESCRIPT` from Codex's environment to the bundled server.

### Changed

- Resolve `@emmetio/css-parser` from the npm registry instead of a Git branch, and require `@hono/node-server` >= 2.0.5, via `overrides`.
- Declare `@vue/typescript-plugin` as a direct, bundled dependency (previously relied on as a transitive).
- Update `@modelcontextprotocol/sdk` to 1.29.0, `@vue/language-server` to 3.3.8, `typescript-language-server` to 5.3.0, `@vue/compiler-sfc` to 3.5.40, `zod` to 4.4.3, and `prettier` to 3.9.6. `npm audit` reports no known vulnerabilities.

### Added

- Honor the MCP `roots` capability. When the host advertises `roots` (for example Claude Code), the server unions the host-provided workspace directories into the boundary after initialization and on `roots/list_changed`, so no `SEMANTIC_JS_MCP_WORKSPACE_ROOTS` is needed on those hosts. Authority stays with the host; the unset, no-roots default stays restrictive.
- Add a Claude Code plugin and marketplace catalog (`.claude-plugin/`) so the MCP server and the semantic-navigation skill install with `/plugin marketplace add` and `/plugin install`. The `claude mcp add` route remains available for the server alone.

## [0.10.4] - 2026-07-20

### Changed

- Make `lsp_diagnostics` state explicitly whether current-document diagnostics are available, whether an unconfirmed provider report exists, and whether the result is usable as current-document diagnostic evidence. Untrusted results now direct agents to repository-native validation without treating missing or stale diagnostics as a clean file.
- Rework setup into a numbered procedure that establishes command authority before any local tool call, separates the host application from its installation route, recommends the positively identified current application as the generic stdio target for confirmation, makes every generic-host command and configuration action user-run, rejects cross-route and temporary `npx` installation, and hands sandbox-blocked work back to the user without changing permissions or installation paths.
- Add an explicit verification-only operation, distinguish a host route from its Codex plugin, global-package, or source-checkout server source, require exact host-command help before registration or removal, reject saved commands or connection states that do not match the intended stdio entry, and keep optional functional tests scoped to one confirmed source file.
- Keep setup responses in the user's language and retain user-run version checks for generic hosts because low-risk commands can still observe a sandbox-specific runtime instead of the user's actual environment.

## [0.10.3] - 2026-07-18

### Changed

- Consolidate installation into `SETUP.md`, the shared setup procedure for people and coding agents. README now provides only a brief entry point. The procedure places guards, prerequisites, installation, and verification before troubleshooting and background; uses direct explanatory language; requires exact host and version checks; rejects partial npm extraction; and does not treat installation as permission to inspect source code.

## [0.10.2] - 2026-07-17

### Added

- Add `AGENT_SETUP.md` with safe installation, verification, update, rollback, and removal steps for Codex and standard stdio MCP hosts.
- Expand semantic-navigation guidance for values assembled from multiple sources so agents inspect existing merge rules, related helpers, consumers, and boundary cases before changing precedence or fallback behavior.

## [0.10.1] - 2026-07-17

### Added

- Publish release tags to npm through a protected GitHub Actions environment using short-lived OIDC credentials and automatic provenance.

### Fixed

- Document and validate marketplace refresh before reinstalling an existing Codex plugin.
- Install and verify ripgrep in the trusted-publishing runner before executing the release gate.

## [0.10.0] - 2026-07-17

### Added

- Add a deterministic semantic-evidence usability status to named counts and audits, with explicit follow-up reasons for incomplete collection or ambiguous definition selection.
- Add a repeated post-disposal memory benchmark that separates MCP heap, MCP resident memory, and child-provider resident memory under an explicitly scoped measurement method.
- Add cross-platform CI coverage for supported Node.js LTS lines.
- Add focused negative-verification and public-documentation gates.
- Add concise starter prompts and evidence examples for common agent workflows.

### Fixed

- Recover with fresh language-server and Vue tsserver clients after an initialized provider exits, while settling pending requests and diagnostics without leaving timeout handles active.
- Resolve cross-project import aliases consistently when a language server first returns the local import binding.
- Canonicalize Windows source positions when verifying and grouping cross-project references.
- Make release verification portable across Windows paths, executable shims, temporary-file locking, and checkout line endings.
- Keep declaration filtering and language-server client eviction stable across platform-specific provider output and slow initialization.

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
