import {
  ACCOUNTING_STATUS,
  CI_EXIT_CODE,
  CI_STATUS,
  COLLECTION_STATUS,
  DEFINITION_SELECTION_STATUS,
  SEMANTIC_EVIDENCE_FOLLOW_UP_REASON,
  SEMANTIC_EVIDENCE_STATUS,
  TOOL,
} from "../protocol.mjs";

export const AGENT_EVALUATION_ARGUMENT = Object.freeze({
  ANSWERS: "--answers",
});

export const AGENT_EVALUATION_COVERAGE = Object.freeze({
  COMPLETE: "complete",
  INCOMPLETE: "incomplete",
});

export const AGENT_EVALUATION_REASON = Object.freeze({
  ALL_DECISIONS_CORRECT: "all-decisions-correct",
  DECISIONS_INCORRECT: "decisions-incorrect",
  ANSWERS_INVALID: "answers-invalid",
});

export const AGENT_EVALUATION_CASES = Object.freeze([
  Object.freeze({
    id: "inspect-named-symbol-identity",
    question: "Which tool should inspect identity and signature before changing this named symbol?",
    compactResult: Object.freeze({
      tool: TOOL.COUNT_NAMED_SYMBOL,
      result: Object.freeze({
        requestedSymbol: "calculateTotal",
        exactDefinitionsFound: 1,
        definitionSelectionStatus: DEFINITION_SELECTION_STATUS.ONE,
        semanticEvidence: Object.freeze({status: SEMANTIC_EVIDENCE_STATUS.USABLE, followUpReasons: Object.freeze([])}),
        references: Object.freeze({verifiedTotal: 18}),
        unresolvedReferences: Object.freeze({count: 0}),
      }),
      collection: Object.freeze({status: COLLECTION_STATUS.COMPLETE, stoppedByLimit: false}),
      continueWith: Object.freeze([TOOL.AUDIT_NAMED_SYMBOL, TOOL.REFERENCE_PAGE]),
    }),
    expected: Object.freeze({nextTool: TOOL.AUDIT_NAMED_SYMBOL, coverage: AGENT_EVALUATION_COVERAGE.COMPLETE}),
  }),
  Object.freeze({
    id: "inspect-unresolved-references",
    question: "Which tool should inspect the unresolved candidates before claiming full impact coverage?",
    compactResult: Object.freeze({
      tool: TOOL.AUDIT_NAMED_SYMBOL,
      result: Object.freeze({
        requestedSymbol: "RequestHandler",
        exactDefinitionsFound: 1,
        definitionSelectionStatus: DEFINITION_SELECTION_STATUS.ONE,
        semanticEvidence: Object.freeze({
          status: SEMANTIC_EVIDENCE_STATUS.FOLLOW_UP_REQUIRED,
          followUpReasons: Object.freeze([SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.COLLECTION_PARTIAL]),
        }),
        references: Object.freeze({verifiedTotal: 52}),
        unresolvedReferences: Object.freeze({count: 1}),
      }),
      collection: Object.freeze({status: COLLECTION_STATUS.PARTIAL, stoppedByLimit: false}),
      continueWith: Object.freeze([TOOL.UNRESOLVED_REFERENCE_PAGE, TOOL.REFERENCE_PAGE]),
    }),
    expected: Object.freeze({nextTool: TOOL.UNRESOLVED_REFERENCE_PAGE, coverage: AGENT_EVALUATION_COVERAGE.INCOMPLETE}),
  }),
  Object.freeze({
    id: "disambiguate-homonymous-definitions",
    question: "Which tool should identify the intended declaration from an exact source position?",
    compactResult: Object.freeze({
      tool: TOOL.COUNT_NAMED_SYMBOL,
      result: Object.freeze({
        requestedSymbol: "createClient",
        exactDefinitionsFound: 3,
        definitionSelectionStatus: DEFINITION_SELECTION_STATUS.MULTIPLE,
        semanticEvidence: Object.freeze({
          status: SEMANTIC_EVIDENCE_STATUS.FOLLOW_UP_REQUIRED,
          followUpReasons: Object.freeze([SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.MULTIPLE_DEFINITIONS_SELECTED]),
        }),
        unresolvedReferences: Object.freeze({count: 0}),
      }),
      collection: Object.freeze({status: COLLECTION_STATUS.COMPLETE, stoppedByLimit: false}),
      continueWith: Object.freeze([TOOL.AUDIT_SYMBOL, TOOL.AUDIT_NAMED_SYMBOL]),
    }),
    expected: Object.freeze({nextTool: TOOL.AUDIT_SYMBOL, coverage: AGENT_EVALUATION_COVERAGE.COMPLETE}),
  }),
  Object.freeze({
    id: "reuse-file-hint-binding-position",
    question: "Which tool should reuse the verified source position without inventing a filename declaration?",
    compactResult: Object.freeze({
      tool: TOOL.AUDIT_NAMED_SYMBOL,
      result: Object.freeze({
        requestedSymbol: "RenamedPanel",
        exactDefinitionsFound: 0,
        definitionSelectionStatus: DEFINITION_SELECTION_STATUS.NONE,
        semanticEvidence: Object.freeze({
          status: SEMANTIC_EVIDENCE_STATUS.FOLLOW_UP_REQUIRED,
          followUpReasons: Object.freeze([SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.NO_DEFINITION_SELECTED]),
        }),
        fileHintResolution: Object.freeze({
          textMatchesFound: 2,
          textMatchesChecked: 2,
          textMatchesResolvingToFileFilter: 2,
          textMatchesWhoseDefinitionCouldNotBeResolved: 0,
          accountingStatus: ACCOUNTING_STATUS.COMPLETE,
          sourcePositionForAudit: Object.freeze({file: "src/Parent.vue", line: 2, column: 8}),
        }),
      }),
      collection: Object.freeze({status: COLLECTION_STATUS.COMPLETE, stoppedByLimit: false}),
      continueWith: Object.freeze([TOOL.AUDIT_SYMBOL]),
    }),
    expected: Object.freeze({nextTool: TOOL.AUDIT_SYMBOL, coverage: AGENT_EVALUATION_COVERAGE.COMPLETE}),
  }),
]);

function publicCase(evaluationCase) {
  return {
    id: evaluationCase.id,
    question: evaluationCase.question,
    compactResult: evaluationCase.compactResult,
  };
}

export function evaluationPrompt() {
  return {
    instructions: "For each case, choose one exact tool from continueWith and classify collection coverage as complete or incomplete.",
    answerFormat: {
      answers: "array with one object per case",
      answer: {
        id: "exact case id",
        nextTool: "one exact tool from that case's continueWith list",
        coverage: {enum: Object.values(AGENT_EVALUATION_COVERAGE)},
      },
    },
    cases: AGENT_EVALUATION_CASES.map(publicCase),
  };
}

export function gradeAgentAnswers(input) {
  const suppliedAnswers = Array.isArray(input?.answers) ? input.answers : [];
  const answerById = new Map(suppliedAnswers.map((answer) => [answer.id, answer]));
  const cases = AGENT_EVALUATION_CASES.map((evaluationCase) => {
    const answer = answerById.get(evaluationCase.id);
    const nextToolCorrect = answer?.nextTool === evaluationCase.expected.nextTool;
    const coverageCorrect = answer?.coverage === evaluationCase.expected.coverage;
    return {
      id: evaluationCase.id,
      correct: nextToolCorrect && coverageCorrect,
      nextToolCorrect,
      coverageCorrect,
    };
  });
  const correctCases = cases.filter((item) => item.correct).length;
  const complete = suppliedAnswers.length === AGENT_EVALUATION_CASES.length && correctCases === AGENT_EVALUATION_CASES.length;
  const status = complete ? CI_STATUS.PASS : CI_STATUS.FAIL;
  return {
    status,
    exitCode: CI_EXIT_CODE[status.toUpperCase()],
    reason: complete ? AGENT_EVALUATION_REASON.ALL_DECISIONS_CORRECT : AGENT_EVALUATION_REASON.DECISIONS_INCORRECT,
    casesAvailable: AGENT_EVALUATION_CASES.length,
    answersSupplied: suppliedAnswers.length,
    correctCases,
    cases,
  };
}
