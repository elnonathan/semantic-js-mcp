# Getting Started

Semantic JS MCP adds static semantic evidence to an agent's existing code investigation. These prompts are starting points; the agent should still inspect source, search text, and run focused checks when behavior matters.

Analysis is confined to the server's workspace boundary (the directory it was started in by default). Files outside it return `PATH_OUTSIDE_WORKSPACE_BOUNDARY`. Hosts with MCP roots support provide their approved directories automatically. The Codex plugin can prepare a human-selected canonical root and add it only after a separate human-approved call; that access disappears with the MCP process. Other hosts can preconfigure extra roots with `SEMANTIC_JS_MCP_WORKSPACE_ROOTS`. Each language-server process receives a fixed canonical-root snapshot, and changing authorized roots restarts providers and invalidates cached reference sets.

## Trace A Symbol

> Trace the named symbol `parseRequest` across this repository. Measure its scope first, verify the exact declaration and references, then inspect its direct callers and callees. Report unresolved or incomplete evidence explicitly.

## Review A Security-Sensitive Change

> Review the authentication changes in this diff. Use semantic evidence to verify every material symbol and cross-workspace reference, corroborate reachability with text search and direct source inspection, and distinguish introduced defects from pre-existing behavior.

## Review Combination Logic

> Review this precedence, fallback, normalization, or merge change. Identify every producer of the combined domain value, recover the invariant encoded by existing helpers and direct consumers, verify the discovered symbols and references with semantic evidence, and test a boundary case that could disprove the proposed rule.

## Check Current Diagnostics

> Check current diagnostics for `src/handler.ts`. Treat the file as clean only if the language server confirms the current document snapshot; otherwise report the result as untrusted and explain the required follow-up.

## Reading Compact Results

The examples below show the decision-bearing fields. Actual responses also identify the producer, normalized request, presentation mode, and exact continuation tools.

### Complete Evidence

```yaml
result:
  definitionSelectionStatus: one-definition-selected
  semanticEvidence:
    status: usable-as-requested
    followUpReasons: []
collection:
  status: complete
```

This supports the requested static symbol claim. It does not prove runtime behavior or approve a change.

### Partial Evidence

```yaml
result:
  semanticEvidence:
    status: follow-up-required
    followUpReasons:
      - collection-is-partial
collection:
  status: partial
continueWith:
  - lsp_unresolved_reference_page
```

Inspect the unresolved candidates and relevant source before making a coverage claim.

### Untrusted Diagnostics

```yaml
result:
  diagnosticUse:
    currentDocumentDiagnosticsAvailable: false
    unconfirmedDiagnosticReportAvailable: false
    usableAsCurrentDocumentDiagnosticEvidence: false
    guidance: Current-document diagnostics are unavailable. Do not interpret this as a clean file. Run applicable repository-native typecheck, compile, or focused test commands.
  evidence:
    status: untrusted
    reason: language-server-did-not-report-current-document
  diagnosticsForCurrentDocument: null
  unconfirmedDiagnosticReport:
    reportReceived: false
collection:
  status: partial
```

When `usableAsCurrentDocumentDiagnosticEvidence` is false, use any unconfirmed
items only as context. Run the repository's applicable typecheck, compile, or
focused test commands before making a validation claim. An empty or unavailable
unconfirmed report is not a clean diagnostic result.

### Startup Failure

```yaml
status: blocked
reason: runtime-component-missing
```

Run `semantic-js-mcp doctor` and report its structured runtime component evidence. A missing provider or unavailable command is an environment blocker, not a code pass or diagnostic result.
