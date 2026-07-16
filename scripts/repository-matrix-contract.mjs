import {CI_EXIT_CODE, CI_STATUS, COLLECTION_STATUS, DEFINITION_SELECTION_STATUS, EVIDENCE_STATUS} from "../protocol.mjs";

export const REPOSITORY_MATRIX_ARGUMENT = Object.freeze({
  CONFIGURATION_OFFSET: 2,
});

export const REPOSITORY_MATRIX_MODE = "repository-matrix";

export const REPOSITORY_MATRIX_PROBE_KIND = Object.freeze({
  NAMED_SYMBOL: "named-symbol",
  DIAGNOSTICS: "diagnostics",
});

export const REPOSITORY_MATRIX_REASON = Object.freeze({
  CHECK_COMPLETED: "check-completed",
  CONFIGURATION_REQUIRED: "configuration-required",
  CONFIGURATION_INVALID: "configuration-invalid",
  REPOSITORY_UNAVAILABLE: "repository-unavailable",
  MCP_STARTUP_FAILED: "mcp-startup-failed",
  TOOL_EXECUTION_FAILED: "tool-execution-failed",
  COLLECTION_INCOMPLETE: "collection-is-limited-or-partial",
  DEFINITION_SELECTION_AMBIGUOUS: "definition-selection-is-not-exactly-one",
  DIAGNOSTICS_UNTRUSTED: "diagnostics-for-current-document-are-untrusted",
});

const STATUS_PRIORITY = Object.freeze({
  [CI_STATUS.PASS]: 0,
  [CI_STATUS.UNTRUSTED]: 1,
  [CI_STATUS.FAIL]: 2,
  [CI_STATUS.BLOCKED]: 3,
});

export function repositoryMatrixStatus(items) {
  if (items.length === 0) return CI_STATUS.BLOCKED;
  return items.reduce((current, item) => (STATUS_PRIORITY[item.status] > STATUS_PRIORITY[current] ? item.status : current), CI_STATUS.PASS);
}

export function repositoryMatrixExitCode(status) {
  return CI_EXIT_CODE[status.toUpperCase()];
}

export function collectionEvaluation(collectionStatus) {
  if (collectionStatus === COLLECTION_STATUS.COMPLETE) {
    return {status: CI_STATUS.PASS, reason: REPOSITORY_MATRIX_REASON.CHECK_COMPLETED};
  }
  if (collectionStatus === COLLECTION_STATUS.LIMITED || collectionStatus === COLLECTION_STATUS.PARTIAL) {
    return {status: CI_STATUS.UNTRUSTED, reason: REPOSITORY_MATRIX_REASON.COLLECTION_INCOMPLETE};
  }
  return {status: CI_STATUS.FAIL, reason: REPOSITORY_MATRIX_REASON.TOOL_EXECUTION_FAILED};
}

export function namedSymbolEvaluation(countResult, auditResult) {
  const collection = repositoryMatrixStatus([
    collectionEvaluation(countResult.collection.status),
    collectionEvaluation(auditResult.collection.status),
  ]);
  if (collection !== CI_STATUS.PASS) {
    return {
      status: collection,
      reason:
        collection === CI_STATUS.UNTRUSTED
          ? REPOSITORY_MATRIX_REASON.COLLECTION_INCOMPLETE
          : REPOSITORY_MATRIX_REASON.TOOL_EXECUTION_FAILED,
    };
  }
  const exactSelection =
    countResult.result.definitionSelectionStatus === DEFINITION_SELECTION_STATUS.ONE &&
    auditResult.result.definitionSelectionStatus === DEFINITION_SELECTION_STATUS.ONE;
  return exactSelection
    ? {status: CI_STATUS.PASS, reason: REPOSITORY_MATRIX_REASON.CHECK_COMPLETED}
    : {status: CI_STATUS.UNTRUSTED, reason: REPOSITORY_MATRIX_REASON.DEFINITION_SELECTION_AMBIGUOUS};
}

export function diagnosticEvaluation(result) {
  const collection = collectionEvaluation(result.collection.status);
  if (result.result.evidence?.status !== EVIDENCE_STATUS.VERIFIED) {
    return {status: CI_STATUS.UNTRUSTED, reason: REPOSITORY_MATRIX_REASON.DIAGNOSTICS_UNTRUSTED};
  }
  return collection;
}
