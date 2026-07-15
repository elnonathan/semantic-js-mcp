# Contributing

Semantic JS MCP is pre-release. Changes should preserve its read-only evidence contract and keep collection scope separate from response presentation.

## Requirements

- Node.js 22 or newer;
- npm with lockfile support;
- `rg` available on `PATH`.

## Setup

```bash
npm ci
npm run check
npm run check:runtime
npm run smoke:ci
npm run smoke
npm run smoke:vue
```

Run `npm run benchmark` for changes that affect repository scanning, reference verification, caching, lifecycle, or memory.

## Source Of Truth

- `protocol.mjs` owns public literals, server identity, schema identity, runtime components, and defaults.
- `skills/semantic-navigation/references/protocol-literals.md` is generated; update it with `node scripts/generate-protocol-reference.mjs`.
- `README.md` documents implemented behavior and known limitations.
- `ROADMAP.md` summarizes public development direction without defining implemented behavior.

## Change Expectations

- Centralize public literals in `protocol.mjs`.
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
```

Also run `npm run benchmark` when collection cost or memory could change. New behavior should use generic fixtures and cover complete, partial, limited, failed, stale, or untrusted outcomes as applicable.

## Changelog And Versioning

- Add user-visible behavior under `Unreleased` while developing.
- Move those entries to a dated version section when the package version is finalized.
- Increment the result-schema version when consumers must understand a changed canonical response shape or identity.
- A server-version change does not automatically require a result-schema change when the response contract remains compatible.
