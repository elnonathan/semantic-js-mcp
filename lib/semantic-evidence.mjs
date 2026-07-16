import {
  COLLECTION_STATUS,
  DEFINITION_SELECTION_STATUS,
  SEMANTIC_EVIDENCE_FOLLOW_UP_REASON,
  SEMANTIC_EVIDENCE_STATUS,
  TOOL,
} from "../protocol.mjs";

const NAMED_SYMBOL_TOOLS = new Set([TOOL.COUNT_NAMED_SYMBOL, TOOL.AUDIT_NAMED_SYMBOL]);
const DEFINITION_SELECTION_STATUSES = new Set(Object.values(DEFINITION_SELECTION_STATUS));

export function isNamedSymbolTool(tool) {
  return NAMED_SYMBOL_TOOLS.has(tool);
}

export function namedSemanticEvidence(selectionStatus, collectionStatus) {
  const followUpReasons = [];
  if (collectionStatus === COLLECTION_STATUS.LIMITED) {
    followUpReasons.push(SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.COLLECTION_LIMITED);
  }
  if (collectionStatus === COLLECTION_STATUS.PARTIAL) {
    followUpReasons.push(SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.COLLECTION_PARTIAL);
  }
  if (selectionStatus === DEFINITION_SELECTION_STATUS.NONE) {
    followUpReasons.push(SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.NO_DEFINITION_SELECTED);
  }
  if (selectionStatus === DEFINITION_SELECTION_STATUS.MULTIPLE) {
    followUpReasons.push(SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.MULTIPLE_DEFINITIONS_SELECTED);
  }
  return {
    status: followUpReasons.length === 0 ? SEMANTIC_EVIDENCE_STATUS.USABLE : SEMANTIC_EVIDENCE_STATUS.FOLLOW_UP_REQUIRED,
    followUpReasons,
  };
}

export function namedSemanticEvidenceMatches(result, collectionStatus) {
  const actual = result?.semanticEvidence;
  if (!actual || !Array.isArray(actual.followUpReasons)) return false;
  if (!DEFINITION_SELECTION_STATUSES.has(result.definitionSelectionStatus)) return false;
  const expected = namedSemanticEvidence(result.definitionSelectionStatus, collectionStatus);
  if (actual.status !== expected.status) return false;
  if (actual.followUpReasons.length !== expected.followUpReasons.length) return false;
  return actual.followUpReasons.every((reason, index) => reason === expected.followUpReasons[index]);
}
