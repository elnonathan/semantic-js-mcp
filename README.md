# Semantic JS MCP

## Setup

Before running an installation command, follow [SETUP.md](SETUP.md). It is the
single source of truth for setup by either a person or a coding agent, including
prerequisites, host selection, installation, verification, updates, rollback,
and removal.

Semantic JS MCP requires Node.js 22 or newer and `rg` (ripgrep). It can be
installed through the verified Codex plugin route or registered as a local
stdio server in another compatible MCP host. Package installation alone does not configure an MCP host.

After setup, see [Getting started](docs/getting-started.md) for practical
investigation prompts and compact evidence examples.

**Your coding agent is only as good as its understanding of your codebase.**

Coding agents can generate code quickly, but reliable engineering requires more than reading files and matching text. They need to understand which declaration a reference belongs to, how symbols cross workspace boundaries, whether the collected evidence is complete, and whether that evidence is still accurate.

Semantic JS MCP gives coding agents structured, read-only semantic context so they can navigate, review, and change code with explicit uncertainty.

Its scope is intentionally narrow: it strengthens an agent's understanding of symbol identity, types, references, diagnostics, and evidence coverage. It does not replace architectural reasoning, source inspection, dependency analysis, tests, or runtime observation.

**Better agents begin with better evidence.**

It supports the JavaScript ecosystem, including TypeScript, JavaScript, TSX, JSX, Node module variants, and Vue projects. Language servers provide the underlying semantic data, which the server turns into structured results designed for coding agents.

For each file, it identifies the owning workspace and uses the corresponding TypeScript or Vue language server. Across the repository, it can distinguish verified references from unrelated or unresolved text matches. These results complement text search, source inspection, and focused tests.

## Project Status

Version `0.10.3` is the current release. APIs and result contracts may evolve while the project remains on the `0.x` release line. See the [roadmap](ROADMAP.md) for areas under consideration.

## Runtime

- Node.js 22 or newer is required.
- Node.js 24 LTS is recommended for new installations. See the [Node.js release schedule](https://nodejs.org/en/about/previous-releases).
- `rg` (ripgrep) must be available on `PATH` for repository-wide discovery.
- The nearest workspace TypeScript SDK is used when available; the bundled TypeScript SDK is the fallback.
- TypeScript, `typescript-language-server`, and the Vue language server are pinned dependencies. Published packages bundle every production dependency so Codex installations do not require a separate dependency installation step. Startup verifies provider entry points before accepting MCP requests.
- Source discovery and language selection include `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, and `.vue` files.
- Run `npm run check:runtime` to report every required component and its resolved file path.

The package exposes a `semantic-js-mcp` executable. `semantic-js-mcp serve` starts the stdio MCP server, and `semantic-js-mcp doctor` verifies the installed Node runtime, ripgrep, resolved provider paths, MCP startup, tool discovery, TypeScript reference accounting, diagnostic freshness, and Vue navigation.

## Development Setup

Complete the [source-checkout setup](SETUP.md#source-checkout), then run the
checks applicable to the change:

```bash
npm run check
npm run check:runtime
npm run doctor
npm run smoke:ci
npm run smoke
npm run smoke:vue
npm run smoke:lifecycle
```

Run `npm run benchmark` after changes to scanning, references, caching, lifecycle, or memory. Provider disposal changes can also be characterized with `npm run benchmark:lifecycle-memory`; its output declares the garbage-collection and platform measurement method. Normal analysis is local and read-only; it does not require network access after dependencies are installed.

## Tool Graph

Tools are ordered from smaller responses to deeper evidence:

| Tool                            | Provides                                                  | Typical continuation                               |
| ------------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| `lsp_document_symbols`          | Structure for one file                                    | `lsp_definition`, `lsp_audit_symbol`               |
| `lsp_workspace_symbols`         | Symbol-name discovery                                     | `lsp_count_named_symbol`, `lsp_audit_named_symbol` |
| `lsp_definition`                | Definition resolution at a position                       | `lsp_hover`, `lsp_count_references`                |
| `lsp_hover`                     | Inferred type and documentation                           | `lsp_definition`, `lsp_audit_symbol`               |
| `lsp_diagnostics`               | Focused diagnostics for one file                          | `lsp_definition`, `lsp_hover`                      |
| `lsp_count_text_matches`        | Exact identifier text count without semantic verification | `lsp_count_named_symbol`, `lsp_audit_named_symbol` |
| `lsp_count_named_symbol`        | Definition and reference counts by name                   | `lsp_audit_named_symbol`, `lsp_reference_page`     |
| `lsp_count_references`          | Reference counts at a position                            | `lsp_audit_symbol`, `lsp_reference_page`           |
| `lsp_audit_named_symbol`        | Compact composed summary by symbol name                   | `lsp_reference_page`                               |
| `lsp_audit_symbol`              | Compact composed summary at a position                    | `lsp_reference_page`                               |
| `lsp_references`                | First page of verified locations                          | `lsp_reference_page`                               |
| `lsp_reference_page`            | A later page from the same collection                     | `lsp_definition`                                   |
| `lsp_unresolved_reference_page` | Unresolved candidates with locations and literal reasons  | `lsp_definition`                                   |

Composite audits reuse the same internal definition, hover, and reference primitives as the narrow tools. Their default response contains definition identity, signature, reference and text-match counts, unresolved count, files affected, collection status, and freshness. Use `lsp_reference_page` with a returned `referenceSetId` for verified locations and detailed collection evidence, or `lsp_unresolved_reference_page` for unresolved candidates. Use `lsp_references` when starting from an exact source position without an existing reference set.

Compatible count, audit, and reference calls reuse a short-lived reference set. Compact presentation changes response size, not collection scope.

## Result Contract

Every successful result contains:

- `producer`: the literal semantic-js-mcp name, server version, and result-schema version that produced the response.
- `request`: normalized inputs and explicit limit interpretation.
- `result`: evidence produced by the tool.
- `collection`: how evidence collection completed.
- `presentation`: how much collected evidence appears in this response.
- `continueWith`: a list of exact MCP tool names that can add the next kind of evidence.

`structuredContent` is the canonical JSON object. The text content is YAML generated from that same object and parses back to the same data.

Consumers upgrading from result schema 5 should follow the [schema migration guide](docs/result-schema-migration.md).

### Collection status

- `complete`: the requested collection scope completed and every discovered item was classified.
- `limited`: a supplied `maxCandidates` or `maxDefinitions` value stopped collection.
- `partial`: collection completed with explicitly reported items whose definition or owning file could not be resolved.
- `failed`: the tool call failed and the error object explains why.

Collection and presentation are independent. A complete collection may use `presentation.mode: compact-summary`, `page`, `count-only`, or `subset` without weakening its counts. Audits use `compact-summary` by default and retain their full reference set for focused follow-up calls.

For reference results, `includeDeclaration: false` excludes locations that resolve to the requested declaration. It never excludes the source position merely because that position initiated the query. The reported invariant is `verifiedTotal = foundByOwningWorkspaceLanguageServer + verifiedFromOtherWorkspaces` after declaration filtering and deduplication.

Reference pages group the locations returned in that page under `referenceGroups` by their exact source `file`. Each location keeps its explicit `range` and `discoveryMethod`, while `locationsAvailable` and `locationsReturned` continue to count locations rather than file groups. Pagination selects locations before grouping, so grouping does not change page membership or collection status. File groups follow first appearance in the page, and locations preserve their relative order within each file; cross-file interleaving is not part of the reference contract.

Named counts and audits report `definitionSelectionStatus` as `no-definition-selected`, `one-definition-selected`, or `multiple-definitions-selected`. This status describes exact declarations remaining after `fileHint` filtering, before any `maxDefinitions` analysis limit. When selection is empty or ambiguous, `continueWith` recommends structural or position-based tools. It recommends `lsp_reference_page` only when the response contains a reusable reference set.

They also report `semanticEvidence.status` as `usable-as-requested` or `follow-up-required`. Follow-up reasons combine incomplete collection and ambiguous definition selection without treating a compact, paged, or subset presentation as incomplete evidence. This status evaluates only the requested semantic result; it does not declare the code correct.

When `fileHint` selects no declaration, a named audit can verify whether source bindings resolve to the hinted file while keeping declaration identity and uncertainty explicit.

### Limits

Collection limits accept positive integers only:

- omitted: `{mode: unlimited}`
- supplied: `{mode: maximum, maximum: N}`

Omitting `maxCandidates` or `maxDefinitions` requests unlimited collection. `pageSize` and `maxResults` only control returned items for tools that expose them as presentation parameters.

### Freshness

Reusable reference sets verify participating file content and the repository
source inventory before returning another page. Added, removed, renamed, or
changed sources invalidate stale evidence instead of silently reusing it.

Diagnostics are current only when the owning provider confirms the analyzed
document snapshot. Unconfirmed reports remain isolated and explicitly
`untrusted`; an empty unconfirmed report is never presented as a clean file.

### CI policy adapter

MCP tools report evidence; they do not decide whether a code change passes. `npm run ci:evaluate -- <result.json>` applies a deterministic CI policy to one canonical structured result:

- `pass`, exit `0`: complete evidence and no verified error diagnostic.
- `fail`, exit `1`: verified diagnostics contain an error.
- `untrusted`, exit `2`: collection is partial or limited.
- `blocked`, exit `3`: the tool failed or the input is not a semantic-js-mcp result.

Pass `--yaml` after the input path for a YAML representation. The adapter accepts canonical JSON or YAML, validates the producer and result-schema version plus public tool and presentation literals, and never converts incomplete evidence into a pass.

### Cost visibility

`lsp_count_text_matches` measures a common identifier before semantic
verification. Compact tools omit operational metrics; detailed reference calls
retain timing, semantic request, concurrency, and memory observations. The
server applies no hidden candidate cap.

## Memory Management

Language-server clients and reusable reference sets use idle timeout, TTL, and
LRU policies. These policies govern reuse; they never impose a hidden limit on
the collection in progress. Configuration literals and defaults are listed in
the generated [protocol reference](skills/semantic-navigation/references/protocol-literals.md).

## Verification

```bash
npm run check
npm run check:runtime
npm run doctor
npm run smoke
npm run smoke:ci
npm run smoke:vue
npm run smoke:lifecycle
npm run smoke:distribution
```

`npm run benchmark` measures text counting, verified reference collection, memory, and freshness-validation latency at configurable match counts. Set `SEMANTIC_JS_MCP_BENCHMARK_COUNTS=10,100,1000,10000` to include the 10,000-match scale.

`npm run smoke:distribution` packs the explicit npm file allowlist, installs the tarball into a temporary consumer project, runs the installed executable, and verifies that runtime components resolve from the consumer dependency tree rather than the source checkout.

The smoke tests create temporary generic TypeScript and Vue projects. They do not depend on a specific application repository.

## Reporting Problems

Run `semantic-js-mcp doctor` and include its structured output, the package version, Node.js version, operating system, affected source type, and the smallest reproducible workspace or public repository. Remove proprietary source, credentials, local absolute paths, and customer data before opening an issue. See [Contributing](CONTRIBUTING.md) for validation details and the [Security policy](SECURITY.md) for private vulnerability reports.

## Current Limitations

- The server provides static semantic evidence, not runtime call tracing or behavioral proof.
- Empty references and clean diagnostics do not establish absence or correctness.
- Vue named-component discovery remains ambiguous when filenames, component names, import aliases, global registration, and test doubles differ. Prefer a position-based audit when an exact use is available.
- Diagnostics remain `untrusted` when the owning language server does not correlate a report with the current document version.
- Dynamic imports, computed property access, generated code, runtime dependency injection, and dynamically constructed class names may require text search and direct source inspection.
- CSS graph analysis, Tailwind semantics, and other language domains are intentionally outside this project. Provider-native diagnostics embedded in Vue documents may still be preserved.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned areas of development. Roadmap items describe direction, not release commitments.

## Project Documents

- [Architecture decisions](docs/architecture-decisions.md)
- [Distribution verification](docs/distribution.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Maintainer

[Jonathan Muñoz Lucas](https://mx.linkedin.com/in/nonathan)
