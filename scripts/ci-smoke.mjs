#!/usr/bin/env node

import {deepStrictEqual, strictEqual} from "node:assert";
import {spawn} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  CI_EXIT_CODE,
  CI_REASON,
  CI_STATUS,
  COLLECTION_STATUS,
  DEFINITION_SELECTION_STATUS,
  DIAGNOSTIC_SEVERITY,
  EVIDENCE_STATUS,
  PRESENTATION_MODE,
  PRODUCT,
  RESULT_SCHEMA,
  SEMANTIC_EVIDENCE_FOLLOW_UP_REASON,
  SEMANTIC_EVIDENCE_STATUS,
  SERVER_VERSION,
  TOOL,
} from "../protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evaluator = path.join(root, "scripts", "semantic-js-mcp-ci.mjs");
const workspace = await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-ci-smoke-"));

function runEvaluator(inputFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [evaluator, inputFile], {stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({code, stdout, stderr}));
  });
}

async function evaluate(name, input, expectedStatus, expectedExitCode, expectedReason) {
  const file = path.join(workspace, `${name}.json`);
  await writeFile(file, JSON.stringify(input));
  const execution = await runEvaluator(file);
  strictEqual(execution.stderr, "", `${name} wrote stderr`);
  strictEqual(execution.code, expectedExitCode, `${name} returned the wrong process exit code`);
  const result = JSON.parse(execution.stdout);
  deepStrictEqual({status: result.status, exitCode: result.exitCode}, {status: expectedStatus, exitCode: expectedExitCode});
  if (expectedReason) strictEqual(result.reason, expectedReason, `${name} returned the wrong reason`);
}

function canonicalResult(tool, collectionStatus, result, extra = {}) {
  return {
    producer: {name: PRODUCT.NAME, version: SERVER_VERSION, resultSchemaVersion: RESULT_SCHEMA.VERSION},
    tool,
    request: {},
    result,
    collection: {status: collectionStatus},
    presentation: {mode: PRESENTATION_MODE.ALL_ITEMS},
    continueWith: [],
    ...extra,
  };
}

try {
  await evaluate("pass", canonicalResult(TOOL.COUNT_REFERENCES, COLLECTION_STATUS.COMPLETE, {}), CI_STATUS.PASS, CI_EXIT_CODE.PASS);
  await evaluate(
    "named-semantic-evidence-usable",
    canonicalResult(TOOL.COUNT_NAMED_SYMBOL, COLLECTION_STATUS.COMPLETE, {
      definitionSelectionStatus: DEFINITION_SELECTION_STATUS.ONE,
      semanticEvidence: {status: SEMANTIC_EVIDENCE_STATUS.USABLE, followUpReasons: []},
    }),
    CI_STATUS.PASS,
    CI_EXIT_CODE.PASS,
  );
  await evaluate(
    "named-semantic-follow-up-required",
    canonicalResult(TOOL.AUDIT_NAMED_SYMBOL, COLLECTION_STATUS.COMPLETE, {
      definitionSelectionStatus: DEFINITION_SELECTION_STATUS.MULTIPLE,
      semanticEvidence: {
        status: SEMANTIC_EVIDENCE_STATUS.FOLLOW_UP_REQUIRED,
        followUpReasons: [SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.MULTIPLE_DEFINITIONS_SELECTED],
      },
    }),
    CI_STATUS.UNTRUSTED,
    CI_EXIT_CODE.UNTRUSTED,
  );
  await evaluate(
    "named-semantic-evidence-conflicts-with-source-fields",
    canonicalResult(TOOL.COUNT_NAMED_SYMBOL, COLLECTION_STATUS.PARTIAL, {
      definitionSelectionStatus: DEFINITION_SELECTION_STATUS.ONE,
      semanticEvidence: {status: SEMANTIC_EVIDENCE_STATUS.USABLE, followUpReasons: []},
    }),
    CI_STATUS.BLOCKED,
    CI_EXIT_CODE.BLOCKED,
  );
  await evaluate(
    "named-semantic-evidence-requires-definition-selection",
    canonicalResult(TOOL.COUNT_NAMED_SYMBOL, COLLECTION_STATUS.COMPLETE, {
      semanticEvidence: {status: SEMANTIC_EVIDENCE_STATUS.USABLE, followUpReasons: []},
    }),
    CI_STATUS.BLOCKED,
    CI_EXIT_CODE.BLOCKED,
  );
  await evaluate(
    "fail",
    canonicalResult(TOOL.DIAGNOSTICS, COLLECTION_STATUS.COMPLETE, {
      evidence: {status: EVIDENCE_STATUS.VERIFIED},
      diagnosticsForCurrentDocument: {items: [{severity: DIAGNOSTIC_SEVERITY.ERROR}]},
    }),
    CI_STATUS.FAIL,
    CI_EXIT_CODE.FAIL,
  );
  await evaluate(
    "untrusted",
    canonicalResult(TOOL.DIAGNOSTICS, COLLECTION_STATUS.PARTIAL, {evidence: {status: EVIDENCE_STATUS.UNTRUSTED}}),
    CI_STATUS.UNTRUSTED,
    CI_EXIT_CODE.UNTRUSTED,
  );
  await evaluate(
    "untrusted-diagnostics-cannot-pass-with-complete-collection",
    canonicalResult(TOOL.DIAGNOSTICS, COLLECTION_STATUS.COMPLETE, {
      evidence: {status: EVIDENCE_STATUS.UNTRUSTED},
      diagnosticsForCurrentDocument: null,
    }),
    CI_STATUS.UNTRUSTED,
    CI_EXIT_CODE.UNTRUSTED,
  );
  await evaluate(
    "blocked",
    canonicalResult(TOOL.REFERENCES, COLLECTION_STATUS.FAILED, {}, {error: {code: "fixture"}}),
    CI_STATUS.BLOCKED,
    CI_EXIT_CODE.BLOCKED,
  );
  await evaluate(
    "named-tool-execution-failed",
    canonicalResult(TOOL.COUNT_NAMED_SYMBOL, COLLECTION_STATUS.FAILED, {}, {error: {code: "fixture"}}),
    CI_STATUS.BLOCKED,
    CI_EXIT_CODE.BLOCKED,
    CI_REASON.TOOL_EXECUTION_FAILED,
  );
  await evaluate(
    "named-tool-invalid-error-shape",
    canonicalResult(TOOL.COUNT_NAMED_SYMBOL, COLLECTION_STATUS.FAILED, {}, {error: "fixture"}),
    CI_STATUS.BLOCKED,
    CI_EXIT_CODE.BLOCKED,
    CI_REASON.INVALID_INPUT,
  );
  await evaluate(
    "missing-canonical-identity",
    {
      tool: TOOL.COUNT_REFERENCES,
      collection: {status: COLLECTION_STATUS.COMPLETE},
      result: {},
    },
    CI_STATUS.BLOCKED,
    CI_EXIT_CODE.BLOCKED,
  );
  await evaluate(
    "wrong-result-schema-version",
    {
      ...canonicalResult(TOOL.COUNT_REFERENCES, COLLECTION_STATUS.COMPLETE, {}),
      producer: {name: PRODUCT.NAME, version: SERVER_VERSION, resultSchemaVersion: RESULT_SCHEMA.VERSION + 1},
    },
    CI_STATUS.BLOCKED,
    CI_EXIT_CODE.BLOCKED,
  );

  await evaluate(
    "schema-5-envelope",
    {
      server: {name: PRODUCT.NAME, version: SERVER_VERSION},
      resultSchema: {name: RESULT_SCHEMA.NAME, version: RESULT_SCHEMA.VERSION - 1},
      tool: TOOL.COUNT_REFERENCES,
      request: {},
      result: {},
      collection: {status: COLLECTION_STATUS.COMPLETE},
      presentation: {mode: PRESENTATION_MODE.COUNT_ONLY},
      continueWith: [{tool: TOOL.AUDIT_SYMBOL}],
    },
    CI_STATUS.BLOCKED,
    CI_EXIT_CODE.BLOCKED,
  );
  await evaluate(
    "unknown-tool",
    {
      ...canonicalResult(TOOL.COUNT_REFERENCES, COLLECTION_STATUS.COMPLETE, {}),
      tool: "unknown_tool",
    },
    CI_STATUS.BLOCKED,
    CI_EXIT_CODE.BLOCKED,
  );
  await evaluate(
    "unknown-presentation-mode",
    {
      ...canonicalResult(TOOL.COUNT_REFERENCES, COLLECTION_STATUS.COMPLETE, {}),
      presentation: {mode: "unknown-mode"},
    },
    CI_STATUS.BLOCKED,
    CI_EXIT_CODE.BLOCKED,
  );
  await evaluate(
    "unknown-continuation-tool",
    {
      ...canonicalResult(TOOL.COUNT_REFERENCES, COLLECTION_STATUS.COMPLETE, {}),
      continueWith: ["unknown_tool"],
    },
    CI_STATUS.BLOCKED,
    CI_EXIT_CODE.BLOCKED,
  );
  process.stdout.write(`${JSON.stringify({ciStatuses: Object.values(CI_STATUS), exitCodes: CI_EXIT_CODE}, null, 2)}\n`);
} finally {
  await rm(workspace, {recursive: true, force: true});
}
