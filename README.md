# Semantic JS MCP

**Your coding agent is only as good as its understanding of your codebase.**

Coding agents can generate code quickly, but reliable engineering requires more than reading files and matching text. They need to understand which declaration a reference belongs to, how symbols cross workspace boundaries, whether the collected evidence is complete, and whether that evidence is still accurate.

Semantic JS MCP gives coding agents structured, read-only semantic context so they can navigate, review, and change code with explicit uncertainty.

**Better agents begin with better evidence.**

It supports the JavaScript ecosystem, including TypeScript, JavaScript, TSX, JSX, Node module variants, and Vue projects. Language servers provide the underlying semantic data, which the server turns into structured results designed for coding agents.

For each file, it identifies the owning workspace and uses the corresponding TypeScript or Vue language server. Across the repository, it can distinguish verified references from unrelated or unresolved text matches. These results complement text search, source inspection, and focused tests.

## Project Status

Version `0.8.0` is a pre-release. See the [roadmap](ROADMAP.md) for areas under consideration.

## Runtime

- Node.js 22 or newer is supported.
- Node.js 24 LTS is recommended for new installations. See the [Node.js release schedule](https://nodejs.org/en/about/previous-releases).
- `rg` (ripgrep) must be available on `PATH` for repository-wide discovery.
- The nearest workspace TypeScript SDK is used when available; the bundled TypeScript SDK is the fallback.
- TypeScript, `typescript-language-server`, and the Vue language server are pinned dependencies. Install with `npm ci`; startup verifies their bundled entry points before accepting MCP requests.
- Source discovery and language selection include `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, and `.vue` files.
- Run `npm run check:runtime` to report every required component and its resolved file path.

## Development Setup

From a source checkout:

```bash
npm ci
npm run check
npm run check:runtime
npm run smoke:ci
npm run smoke
npm run smoke:vue
```

Run `npm run benchmark` after changes to scanning, references, caching, lifecycle, or memory. Normal analysis is local and read-only; it does not require network access after dependencies are installed.

For an MCP host that accepts a direct stdio configuration, point it at the checked-out server using an absolute path:

```json
{
  "mcpServers": {
    "semantic-js-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/semantic-js-mcp/server.mjs"]
    }
  }
}
```

The bundled [`.mcp.json`](.mcp.json) provides the relative-path configuration used when the repository is installed as a Codex plugin.

## Tool Graph

Tools are ordered from smaller responses to deeper evidence:

| Tool | Provides | Typical continuation |
| --- | --- | --- |
| `lsp_document_symbols` | Structure for one file | `lsp_definition`, `lsp_audit_symbol` |
| `lsp_workspace_symbols` | Symbol-name discovery | `lsp_count_named_symbol`, `lsp_audit_named_symbol` |
| `lsp_definition` | Definition resolution at a position | `lsp_hover`, `lsp_count_references` |
| `lsp_hover` | Inferred type and documentation | `lsp_definition`, `lsp_audit_symbol` |
| `lsp_diagnostics` | Focused diagnostics for one file | `lsp_definition`, `lsp_hover` |
| `lsp_count_text_matches` | Exact identifier text count without semantic verification | `lsp_count_named_symbol`, `lsp_audit_named_symbol` |
| `lsp_count_named_symbol` | Definition and reference counts by name | `lsp_audit_named_symbol`, `lsp_references` |
| `lsp_count_references` | Reference counts at a position | `lsp_audit_symbol`, `lsp_references` |
| `lsp_audit_named_symbol` | Composed summary by symbol name | `lsp_references` |
| `lsp_audit_symbol` | Composed summary at a position | `lsp_references` |
| `lsp_references` | First page of verified locations | `lsp_reference_page` |
| `lsp_reference_page` | A later page from the same collection | `lsp_definition` |
| `lsp_unresolved_reference_page` | Unresolved candidates with locations and literal reasons | `lsp_definition` |

Composite audits reuse the same internal definition, hover, and reference primitives as the narrow tools. Compatible count, audit, and reference calls reuse a short-lived reference set.

## Result Contract

Every successful result contains:

- `server`: the literal semantic-js-mcp server name and version that produced the response.
- `resultSchema`: the literal canonical result schema name and version.
- `request`: normalized inputs and explicit limit interpretation.
- `result`: evidence produced by the tool.
- `collection`: how evidence collection completed.
- `presentation`: how much collected evidence appears in this response.
- `continueWith`: exact MCP tool names that can add the next kind of evidence.

`structuredContent` is the canonical JSON object. The text content is YAML generated from that same object and parses back to the same data.

### Collection status

- `complete`: the requested collection scope completed and every discovered item was classified.
- `limited`: a supplied `maxCandidates` or `maxDefinitions` value stopped collection.
- `partial`: collection completed with explicitly reported items whose definition or owning file could not be resolved.
- `failed`: the tool call failed and the error object explains why.

Collection and presentation are independent. A complete collection may use `presentation.mode: page`, `count-only`, `summary-by-file`, or `subset` without weakening its counts.

For reference results, `includeDeclaration: false` excludes locations that resolve to the requested declaration. It never excludes the source position merely because that position initiated the query. The reported invariant is `verifiedTotal = foundByOwningWorkspaceLanguageServer + verifiedFromOtherWorkspaces` after declaration filtering and deduplication.

### Vue template definitions

Definition lookup uses the Vue language server and TypeScript server first. If both leave a Vue template tag unresolved, the server parses the SFC and follows only a matching local import from `<script>` or `<script setup>`. A successful fallback reports `resolutionMethod: vue-template-import-binding-definition`. This proves an imported component binding; it does not infer global component registration or filename-based identity.

The Vue parser and TypeScript AST dependencies are loaded lazily only when this fallback is needed.

### Signature source

Position audits first request hover information at the query position. If that position has a resolved definition but no hover information, the audit requests hover at the resolved declaration. `signatureSource` reports `query-position-hover`, `resolved-definition-hover`, or `not-reported`; `signatureDefinition` identifies the declaration used by the fallback.

### Limits

Collection limits accept positive integers only:

- omitted: `{mode: unlimited}`
- supplied: `{mode: maximum, maximum: N}`

Omitting `maxCandidates` or `maxDefinitions` requests unlimited collection. `pageSize` and `maxResults` only control returned items for tools that expose them as presentation parameters.

### Text-match accounting

Repository verification reports:

- `matchesFound`
- `matchesChecked`
- `matchesToRequestedSymbol`
- `matchesToDifferentSymbols`
- `matchesWhoseDefinitionCouldNotBeResolved`
- `accountingStatus: complete | incomplete`

`accountingStatus: complete` means every discovered text match appears in exactly one classification. Unresolved matches remain explicit and make semantic collection `partial`.

Count and audit responses expose the `referenceSetId` and unresolved-candidate count. Use `lsp_unresolved_reference_page` to inspect those candidates without inflating every summary. The server also queries tsserver `projectInfo` for unresolved candidates and reports whether the file belongs to a configured or inferred TypeScript project. Reasons describe only observed behavior; they do not speculate that an alias caused a failure.

### Freshness

Reusable reference sets store SHA-256 fingerprints for the source file, native reference files, every cross-workspace candidate file, and the relevant `package.json`, `tsconfig.json`, or `jsconfig.json` files. They also store a repository source-inventory fingerprint built from every relevant path, file size, and high-resolution modification time. Reuse and pagination verify both layers, so new, deleted, renamed, or normally modified source files invalidate repository-wide completeness. Changed evidence produces `REFERENCE_SET_CONTENT_CHANGED` and requires a new `lsp_references` collection. Expired or evicted sets produce `REFERENCE_SET_NOT_FOUND_OR_EXPIRED`.

The inventory is sampled before and after collection. If repository sources change during collection, the server retries once and then returns `REPOSITORY_CHANGED_DURING_COLLECTION` instead of publishing an unstable result.

Diagnostics clear their cache on `didChange` and report the analyzed document version and SHA-256 content fingerprint. Only a language-server report for that exact document version appears under `diagnosticsForCurrentDocument`. Otherwise that field is `null`, `evidence.status` is `untrusted`, and any unconfirmed report is isolated under `unconfirmedDiagnosticReport`. Untrusted diagnostics always produce a partial collection.

Diagnostic severities are preserved literally. If a language server omits severity, the result reports `not-reported`; it is not silently treated as information, warning, or error.

### CI policy adapter

MCP tools report evidence; they do not decide whether a code change passes. `npm run ci:evaluate -- <result.json>` applies a deterministic CI policy to one canonical structured result:

- `pass`, exit `0`: complete evidence and no verified error diagnostic.
- `fail`, exit `1`: verified diagnostics contain an error.
- `untrusted`, exit `2`: collection is partial or limited.
- `blocked`, exit `3`: the tool failed or the input is not a semantic-js-mcp result.

Pass `--yaml` after the input path for a YAML representation. The adapter accepts canonical JSON or YAML, validates the server and result-schema identity plus public tool and presentation literals, and never converts incomplete evidence into a pass.

### Cost visibility

`lsp_count_text_matches` scans repository text without issuing per-match semantic requests. Use it to measure common identifiers before requesting verified counts or audits. Semantic collections preserve omitted limits as unlimited and report text-search time, semantic-verification time, semantic request count, and maximum concurrency. There is no hidden candidate cap.

The bundled Codex MCP configuration allows up to 300 seconds for one tool call. Reaching a client or language-server timeout returns a failed call; it never changes collection scope or reports a timed-out collection as complete.

## Memory Management

Language-server clients and reusable reference sets are released automatically using idle timeout, TTL, and LRU policies. These policies affect reuse only; they do not cap a collection being computed.

Environment variables:

- `SEMANTIC_JS_MCP_CLIENT_IDLE_TIMEOUT_MS` default `60000`
- `SEMANTIC_JS_MCP_CLIENT_MINIMUM_EVICTION_AGE_MS` default `15000`
- `SEMANTIC_JS_MCP_MAXIMUM_ACTIVE_CLIENTS` default `4`
- `SEMANTIC_JS_MCP_REFERENCE_SET_TTL_MS` default `300000`
- `SEMANTIC_JS_MCP_MAXIMUM_REFERENCE_SETS` default `12`
- `SEMANTIC_JS_MCP_MAXIMUM_CHANGED_REFERENCE_SET_MARKERS` default `24`
- `SEMANTIC_JS_MCP_MAXIMUM_CACHED_REFERENCE_LOCATIONS` default `50000`
- `SEMANTIC_JS_MCP_DEFAULT_REFERENCE_PAGE_SIZE` default `100`
- `SEMANTIC_JS_MCP_CROSS_WORKSPACE_CONCURRENCY` default `6`

A single reference collection may exceed the cache-location budget so it can still be paged. Older collections are evicted first.

## Verification

```bash
npm run check
npm run check:runtime
npm run smoke
npm run smoke:ci
npm run smoke:vue
```

`npm run benchmark` measures text counting, verified reference collection, memory, and freshness-validation latency at configurable match counts. Set `SEMANTIC_JS_MCP_BENCHMARK_COUNTS=10,100,1000,10000` to include the 10,000-match scale.

The smoke tests create temporary generic TypeScript and Vue projects. They do not depend on a specific application repository.

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
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Maintainer

[Jonathan Muñoz Lucas](https://mx.linkedin.com/in/nonathan)
