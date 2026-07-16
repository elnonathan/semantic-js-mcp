# Result Schema Migration

Semantic JS MCP increments `producer.resultSchemaVersion` when a tool-result
shape changes incompatibly. Consumers should validate this value before parsing
tool-specific evidence.

## Schema 6

Schema 6 replaces representational duplication with a compact response while
preserving collection scope and reusable evidence.

| Schema 5                                                                      | Schema 6                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `server` and `resultSchema` objects                                           | one `producer` object with `name`, `version`, and `resultSchemaVersion` |
| `continueWith` objects containing `tool` and `provides`                       | a list of exact tool names                                              |
| `presentation.mode: summary-by-file` for audits                               | `presentation.mode: compact-summary`                                    |
| per-file locations and operational metrics in count and audit summaries       | `filesContainingReferences` plus a reusable `referenceSetId`            |
| flat `result.locations` in reference pages                                    | `result.referenceGroups`, grouped by exact source file                  |
| repeated `referenceSetId` values across result sections                       | one identifier in the initial count, audit, or reference result         |
| diagnostic algorithm and hash in separate fields                              | `contentFingerprint: sha256:<hex>`                                      |
| page offsets, requested page size, and derivable subset flags in presentation | normalized request values, returned counts, and `nextCursor`            |

Use `lsp_reference_page` with a count or audit `referenceSetId` to retrieve
verified locations. Use `lsp_references` when starting from an exact source
position without an existing reference set.

The collection contract is unchanged: omitted collection limits remain
unlimited, pagination affects presentation only, and unresolved candidates keep
the collection partial. Schema 6 does not convert incomplete evidence into a
complete result.

The CI adapter accepts only its canonical schema version. A schema 5 result is
reported as `blocked` rather than being interpreted through schema 6 rules.
