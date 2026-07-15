#!/usr/bin/env node

import {readFile} from "node:fs/promises";
import {parse as parseYaml, stringify as stringifyYaml} from "yaml";
import {
  CI_EXIT_CODE,
  CI_REASON,
  CI_STATUS,
  COLLECTION_STATUS,
  DIAGNOSTIC_SEVERITY,
  EVIDENCE_STATUS,
  PRESENTATION_MODE,
  PRODUCT,
  RESULT_SCHEMA,
  TOOL,
  TOOL_ORDER,
} from "../protocol.mjs";

const STANDARD_INPUT_PATH = "-";
const YAML_OUTPUT_ARGUMENT = "--yaml";
const COLLECTION_STATUSES = new Set(Object.values(COLLECTION_STATUS));
const PRESENTATION_MODES = new Set(Object.values(PRESENTATION_MODE));
const PUBLIC_TOOL_NAMES = new Set(TOOL_ORDER);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalResult(result) {
  const continuationsAreCanonical =
    Array.isArray(result?.continueWith) &&
    result.continueWith.every((continuation) => isObject(continuation) && PUBLIC_TOOL_NAMES.has(continuation.tool));
  return (
    result?.server?.name === PRODUCT.NAME &&
    typeof result.server.version === "string" &&
    result.server.version.length > 0 &&
    result?.resultSchema?.name === RESULT_SCHEMA.NAME &&
    result.resultSchema.version === RESULT_SCHEMA.VERSION &&
    PUBLIC_TOOL_NAMES.has(result.tool) &&
    isObject(result.request) &&
    isObject(result.result) &&
    isObject(result.collection) &&
    isObject(result.presentation) &&
    PRESENTATION_MODES.has(result.presentation.mode) &&
    continuationsAreCanonical &&
    COLLECTION_STATUSES.has(result.collection.status)
  );
}

async function readInput(inputPath) {
  return inputPath && inputPath !== STANDARD_INPUT_PATH
    ? readFile(inputPath, "utf8")
    : new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => chunks.push(chunk));
        process.stdin.on("end", () => resolve(chunks.join("")));
        process.stdin.on("error", reject);
      });
}

function parseInput(text) {
  try {
    return JSON.parse(text);
  } catch {
    return parseYaml(text);
  }
}

function decision(status, reason) {
  return {status, exitCode: CI_EXIT_CODE[status.toUpperCase()], reason};
}

function evaluate(data) {
  const result = data?.structuredContent || data;
  if (!isCanonicalResult(result)) {
    return {...decision(CI_STATUS.BLOCKED, CI_REASON.INVALID_INPUT), source: {}};
  }
  const source = {tool: result.tool, collectionStatus: result.collection.status};
  if (result.collection.status === COLLECTION_STATUS.FAILED || result.error) {
    return {...decision(CI_STATUS.BLOCKED, CI_REASON.TOOL_EXECUTION_FAILED), source};
  }
  if (
    result.tool === TOOL.DIAGNOSTICS &&
    (result.result?.evidence?.status !== EVIDENCE_STATUS.VERIFIED || !result.result?.diagnosticsForCurrentDocument)
  ) {
    return {...decision(CI_STATUS.UNTRUSTED, CI_REASON.UNTRUSTED_DIAGNOSTICS), source};
  }
  if (result.collection.status === COLLECTION_STATUS.LIMITED || result.collection.status === COLLECTION_STATUS.PARTIAL) {
    return {
      ...decision(CI_STATUS.UNTRUSTED, CI_REASON.INCOMPLETE_EVIDENCE),
      source,
    };
  }
  if (result.tool === TOOL.DIAGNOSTICS) {
    const diagnostics = result.result?.diagnosticsForCurrentDocument?.items || [];
    if (diagnostics.some((item) => item.severity === DIAGNOSTIC_SEVERITY.ERROR)) {
      return {...decision(CI_STATUS.FAIL, CI_REASON.VERIFIED_DIAGNOSTIC_ERRORS), source};
    }
  }
  return {...decision(CI_STATUS.PASS, CI_REASON.COMPLETE_EVIDENCE), source};
}

let output;
try {
  const input = parseInput(await readInput(process.argv[2]));
  output = {
    protocol: {name: RESULT_SCHEMA.NAME, resultSchemaVersion: RESULT_SCHEMA.VERSION},
    ...evaluate(input),
  };
} catch (error) {
  output = {
    protocol: {name: RESULT_SCHEMA.NAME, resultSchemaVersion: RESULT_SCHEMA.VERSION},
    ...decision(CI_STATUS.BLOCKED, CI_REASON.INVALID_INPUT),
    source: {},
    message: error instanceof Error ? error.message : String(error),
  };
}

const useYaml = process.argv.includes(YAML_OUTPUT_ARGUMENT);
process.stdout.write(useYaml ? stringifyYaml(output, {lineWidth: 0}) : `${JSON.stringify(output, null, 2)}\n`);
process.exitCode = output.exitCode;
