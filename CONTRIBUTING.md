# Contributing

Semantic JS MCP is pre-release. Changes should preserve its read-only evidence contract and keep collection scope separate from response presentation.

## Requirements

- Node.js 22 or newer;
- npm with lockfile support;
- `rg` available on `PATH`.

## Setup

```bash
npm ci
npm run format:check
npm run check
npm run check:runtime
npm run doctor
npm run smoke:ci
npm run smoke
npm run smoke:vue
npm run smoke:lifecycle
npm run smoke:release
npm run smoke:evaluation
npm run smoke:matrix
npm run smoke:distribution
```

Run `npm run benchmark` for changes that affect repository scanning, reference verification, caching, lifecycle, or memory. Provider disposal changes should also run `npm run benchmark:lifecycle-memory`; it uses explicit garbage collection and POSIX process metrics, remains separate from the deterministic release gate, and reports its measurement scope.

## Source Of Truth

- `protocol.mjs` owns public literals, producer identity, schema identity, runtime components, and defaults.
- `.prettierrc.json` and the `format` scripts define the public source style.
- `skills/semantic-navigation/references/protocol-literals.md` is generated; update it with `node scripts/generate-protocol-reference.mjs`.
- `README.md` documents implemented behavior and known limitations.
- `ROADMAP.md` summarizes public development direction without defining implemented behavior.

## Change Expectations

- Centralize public literals in `protocol.mjs`.
- Keep release, host, fixture, and CI-only literals in their focused modules rather than expanding the public protocol vocabulary.
- Run `npm run format` after changing public source or documentation.
- Regenerate protocol documentation instead of editing it directly.
- Add isolated fixtures for positive, partial, and failed evidence.
- Preserve explicit unresolved candidates and freshness status.
- Avoid project-specific assumptions in the public MCP or skill.
- Do not commit `node_modules`, local caches, credentials, or third-party source.

## Validation Expectations

Run the smallest relevant checks while developing, then run the complete local validation suite before submitting a change:

```bash
npm run check
npm run check:runtime
npm run smoke:ci
npm run smoke
npm run smoke:vue
npm run smoke:lifecycle
npm run smoke:release
npm run smoke:evaluation
npm run smoke:matrix
npm run smoke:distribution
```

Also run `npm run benchmark` when collection cost or memory could change, and `npm run benchmark:lifecycle-memory` when provider disposal behavior changes. Run `npm run doctor` when changing runtime resolution, provider startup, the CLI, or diagnostic trust. New behavior should use generic fixtures and cover complete, partial, limited, failed, stale, or untrusted outcomes as applicable.

`npm run check:documentation` validates the durable public documentation contract. `npm run smoke:negative` exercises missing runtime providers, invalid workspaces and limits, stale or expired reference sets, repository mutation, unresolved candidates, and diagnostic trust. The complete `npm run release:verify` gate includes both checks.

`npm run release:verify` executes the complete local release gate and reports every check in one machine-readable result. It does not publish, tag, or modify an installed plugin.

Use `npm run verify:published -- <version>` after publishing npm and the matching `v<version>` repository tag. It queries that exact registry version, installs it with isolated temporary state, verifies the installed executable, runs its doctor, then installs the plugin from the tag-pinned Codex marketplace in a temporary `CODEX_HOME`. Registry or network unavailability returns `blocked` rather than passing or failing the package.

Use `npm run validate:repositories -- <configuration.json|yaml>` for authorized real-repository observations. Configuration stays external to the project and contains repository entries with an `id`, absolute `root`, and `probes`. Supported probe kinds are `named-symbol` with `symbol` and optional `fileHint`, and `diagnostics` with a repository-relative `file`. The runner reports tool failures, incomplete evidence, untrusted diagnostics, and unavailable repositories separately.

`npm run evaluate:agent` prints model-independent compact-result cases. An answer file can be graded with `npm run evaluate:agent -- --answers <file>`; hosted or local model execution remains optional and outside the fixture contract.

## Changelog And Versioning

- Add user-visible behavior under `Unreleased` while developing.
- Move those entries to a dated version section when the package version is finalized.
- Increment the result-schema version when consumers must understand a changed canonical response shape or identity.
- A server-version change does not automatically require a result-schema change when the response contract remains compatible.
