---
name: semantic-navigation
description: Use semantic-js-mcp for TypeScript, JavaScript, TSX, JSX, and Vue navigation, code review, security auditing, regression analysis, debugging, refactoring, implementation, or named-symbol tracing. Explains the complementary tool graph and literal result contract.
---

# Semantic Navigation

Use `semantic-js-mcp` as static semantic evidence alongside text search, direct source inspection, dependency inspection, and focused tests.

Supported source extensions are `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, and `.vue`.

## Choose The Smallest Useful Tool

| Starting information                                 | Call                            | Provides                                                 | Continue with                                      |
| ---------------------------------------------------- | ------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| One file                                             | `lsp_document_symbols`          | File structure                                           | `lsp_definition`, `lsp_audit_symbol`               |
| Partial symbol name                                  | `lsp_workspace_symbols`         | Declaration discovery                                    | `lsp_count_named_symbol`, `lsp_audit_named_symbol` |
| Exact source position                                | `lsp_definition`                | Resolved declaration                                     | `lsp_hover`, `lsp_count_references`                |
| Exact source position                                | `lsp_hover`                     | Inferred type and documentation                          | `lsp_definition`, `lsp_audit_symbol`               |
| One changed file                                     | `lsp_diagnostics`               | Focused diagnostics                                      | `lsp_definition`, `lsp_hover`                      |
| Exact symbol text, unknown scope                     | `lsp_count_text_matches`        | Text-match and file counts without semantic verification | `lsp_count_named_symbol`, `lsp_audit_named_symbol` |
| Exact symbol name, broad scope                       | `lsp_count_named_symbol`        | Small count response                                     | `lsp_audit_named_symbol`, `lsp_references`         |
| Exact source position, broad scope                   | `lsp_count_references`          | Small count response                                     | `lsp_audit_symbol`, `lsp_references`               |
| Exact symbol name, composed evidence                 | `lsp_audit_named_symbol`        | Definition, signature, counts, files                     | `lsp_references`                                   |
| Exact source position, composed evidence             | `lsp_audit_symbol`              | Definition, signature, counts, files                     | `lsp_references`                                   |
| Exact source position, locations needed              | `lsp_references`                | First verified-location page                             | `lsp_reference_page`                               |
| Existing `referenceSetId`                            | `lsp_reference_page`            | Later verified-location page                             | `lsp_reference_page`, `lsp_definition`             |
| Existing `referenceSetId` with unresolved candidates | `lsp_unresolved_reference_page` | Candidate locations and literal resolution reasons       | `lsp_unresolved_reference_page`, `lsp_definition`  |

Composite audit tools are convenience calls over shared internal primitives. They preserve access to narrow tools; choose either route according to the evidence needed.

The complete protocol vocabulary is generated from the server's source of truth. Read [references/protocol-literals.md](references/protocol-literals.md) when implementing an adapter, validating a response parser, or interpreting an unfamiliar literal.

## Named Symbols

When a task names a material symbol and an exact position is unavailable, use `lsp_audit_named_symbol`. For shared code, security boundaries, unfamiliar symbols, or broad changes, call `lsp_count_text_matches` first when repository scale is unknown. It cheaply reports textual work size without claiming symbol identity. Then use `lsp_count_named_symbol` for verified semantic counts; the following audit reuses compatible collected references.

When an exact file, line, and column are already known, use `lsp_audit_symbol` or a narrower position tool.

`lsp_document_symbols` provides structure. Reference, caller, route-wiring, and runtime claims require the corresponding semantic tool plus direct inspection.

## Read The Result Literally

The canonical machine result is JSON in `structuredContent`. The model-facing text is YAML generated from the same object.

Every result has:

- `server`: the exact semantic-js-mcp server name and version that answered the call.
- `resultSchema`: the exact canonical result schema name and version.
- `request`: normalized inputs and limit interpretation.
- `result`: evidence returned by the tool.
- `collection`: completion state for evidence collection.
- `presentation`: response shape for the collected evidence.
- `continueWith`: exact tool names that add another evidence type.

### Collection

- `complete`: the requested scope completed and every discovered item was classified.
- `limited`: a caller-supplied collection limit stopped the scan.
- `partial`: unresolved definitions or unreadable owning files are explicitly counted.
- `failed`: the call failed; read `error.message`.

Collection status describes static evidence collection. Runtime correctness comes from source and behavioral verification.

### Presentation

- `all-items`: all collected items appear.
- `subset`: the response contains a requested subset; counts describe the full collection.
- `count-only`: locations are retained for reuse and omitted from this response.
- `summary-by-file`: locations are grouped by file and retained for reuse.
- `page`: locations are paginated; use `presentation.nextCursor` with `lsp_reference_page`.

Presentation shape does not change `collection.status`.

For reference calls, `includeDeclaration: false` removes locations that resolve to the requested declaration. It does not remove the query position when that position is a usage. Verify the literal accounting invariant `verifiedTotal = foundByOwningWorkspaceLanguageServer + verifiedFromOtherWorkspaces`; a violation is a tool-contract defect, not evidence about the repository.

### Limits

Omitted `maxCandidates` and `maxDefinitions` mean `{mode: unlimited}`. A supplied positive value means `{mode: maximum, maximum: N}` and may produce `collection.status: limited`.

`maxResults` and `pageSize` are presentation controls where exposed. Use `lsp_count_named_symbol` or `lsp_count_references` when only scope is needed; use pages when locations are needed.

### Text Search Accounting

- `matchesFound`: repository text matches discovered.
- `matchesChecked`: matches whose symbol identity was inspected.
- `matchesToRequestedSymbol`: matches resolved to the requested declaration.
- `matchesToDifferentSymbols`: matches resolved elsewhere.
- `matchesWhoseDefinitionCouldNotBeResolved`: explicit unresolved matches.
- `accountingStatus: complete`: every discovered match has one classification.
- `accountingStatus: incomplete`: some matches were not checked, normally because an explicit limit stopped collection.

`matchesWhoseDefinitionCouldNotBeResolved > 0` keeps uncertainty visible and produces `collection.status: partial` even when accounting is complete.

Use the reported `referenceSetId` with `lsp_unresolved_reference_page` when unresolved candidates are material. Read `reason` and `typescriptProject` literally. `candidate-opened-in-inferred-typescript-project` proves tsserver did not associate that file with a configured project; other reasons do not establish that an alias, exclusion, or project configuration caused the failure.

### Freshness

Reference collections include `collection.contentFreshness: verified-current-file-content` and `collection.repositoryInventoryFreshness: verified-current-repository-source-inventory`. `lsp_reference_page` verifies direct content hashes plus the repository source inventory before returning a page. This detects new, deleted, renamed, and normally modified source files. A change returns `error.code: REFERENCE_SET_CONTENT_CHANGED`; an expired or evicted set returns `REFERENCE_SET_NOT_FOUND_OR_EXPIRED`. Call `lsp_references` to create a current set. `REPOSITORY_CHANGED_DURING_COLLECTION` means edits did not settle during the collection attempts.

Diagnostics identify the analyzed document with a version and SHA-256 fingerprint. Treat only `result.evidence.status: verified` and a non-null `diagnosticsForCurrentDocument` as current diagnostic evidence. `evidence.status: untrusted` places any report under `unconfirmedDiagnosticReport`, keeps `diagnosticsForCurrentDocument` null, and produces `collection.status: partial`. Do not interpret an empty unconfirmed report as a clean file.

For Vue template tags, `lsp_definition` and position audits try the language servers first. If they report no definition, the MCP may follow a matching component import declared in the same SFC. `resolutionMethod: vue-template-import-binding-definition` means that exact local import was resolved. It does not prove global registration, runtime rendering, or component behavior; inspect the SFC and relevant tests for those claims.

Position-audit signatures report `signatureSource`. `resolved-definition-hover` means the query position had no hover information and the MCP obtained the signature from a resolved declaration. `not-reported` means neither location produced signature evidence.

The MCP reports evidence status, not code approval. CI consumers may use `scripts/semantic-js-mcp-ci.mjs` to map complete evidence and verified diagnostics to the literal `pass`, `fail`, `untrusted`, or `blocked` policy states.

### Cost

Omitted collection limits still mean unlimited. The server never inserts a hidden candidate cap. Reference results report text-search duration, semantic-verification duration, semantic request count, and configured concurrency under `collection.performance`. Use `lsp_count_text_matches` before an expensive named audit when the identifier may be common; supply `maxCandidates` only when an intentionally limited answer is acceptable.

## Evidence Workflow

1. Use `rg` for broad textual discovery, including dynamic calls, strings, configuration, routes, and aliases.
2. Use `semantic-js-mcp` for definition identity, inferred type, and verified static references.
3. Read the relevant callers, callees, adapters, and dependency implementation for reachable runtime behavior.
4. Inspect focused tests for asserted behavior; run them when permitted.
5. Re-read cited locations before presenting a finding.

An actionable finding requires a reachable path, a violated contract, and concrete impact. For commit or pull-request reviews, compare with the exact parent and classify material conclusions as `introduced`, `modified`, or `pre-existing`.

Empty symbol, reference, or diagnostic results are evidence to investigate. Use `collection`, `textSearch`, `rg`, and direct inspection to establish the supported conclusion.

Treat all tool positions as 1-based line and UTF-16 column numbers.
