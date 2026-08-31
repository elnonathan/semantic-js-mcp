# Result Schema Migration

Semantic JS MCP increments `producer.resultSchemaVersion` when a tool-result
shape changes incompatibly. Consumers should validate this value before parsing
tool-specific evidence.

## Schema 8

Schema 8 adds paginated call-hierarchy results, direct `typescript-server`
diagnostic provenance, and `sourceContext` plus `suggestedFollowUp` on unresolved
reference candidates. Call hierarchy is bounded static provider evidence and
does not establish runtime reachability. Diagnostic evidence is current only
when the exact synchronized content remains unchanged through acquisition.

## Schema 7

Schema 7 adds `result.semanticEvidence` to named counts and audits. Its
`status` is `usable-as-requested` only when collection is complete and exactly
one definition is selected. Otherwise `follow-up-required` includes every
applicable collection or definition-selection reason under `followUpReasons`.

Presentation mode, page size, and subset presentation never affect this
status. It summarizes whether the requested semantic result needs another
semantic step; it does not establish code correctness or runtime behavior.

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

Named counts and audits also report `definitionSelectionStatus`. Continuation
lists include `lsp_reference_page` only when at least one selected definition
produced a reusable reference set. Empty or multiple selection recommends
structural or position-based navigation instead of implying that a filename or
common symbol name established identity.

When `fileHint` selects no exact declaration, a named audit may additionally
return `fileHintResolution`. Its counts classify exact text matches by whether
their definitions resolve to the hinted path, elsewhere, or not at all. A
reported `sourcePositionForAudit` is one verified follow-up position and does
not change `definitionSelectionStatus`.

The collection contract is unchanged: omitted collection limits remain
unlimited, pagination affects presentation only, and unresolved candidates keep
the collection partial. Schema 6 does not convert incomplete evidence into a
complete result.

The CI adapter accepts only its canonical schema version. A schema 5 result is
reported as `blocked` rather than being interpreted through schema 6 rules.

Schema 6 diagnostic evidence may use
`current-document-snapshot-confirmed` for a pull result or
`document-content-changed-during-diagnostic-acquisition` when the source no
longer matches the analyzed snapshot.

Diagnostic results include one `provenance` object with `provider` and
`documentLanguage`. Each diagnostic item includes `embeddedRegion` and
`embeddedLanguage`. The finite values are generated in the protocol reference;
`unknown` means the source range or declared language did not establish a
supported classification.
