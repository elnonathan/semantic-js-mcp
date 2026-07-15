#!/usr/bin/env node

import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  ACCOUNTING_STATUS,
  COLLECTION_STATUS,
  CI_REASON,
  CI_STATUS,
  CLI_ARGUMENT,
  CLI_COMMAND,
  CLI_MESSAGE,
  CONFIGURATION_FILE,
  CONTENT_FRESHNESS,
  DEFAULT,
  DEFINITION_MATCH,
  DEFINITION_RESOLUTION_METHOD,
  DIAGNOSTIC_EVIDENCE_REASON,
  DIAGNOSTIC_FRESHNESS,
  DIAGNOSTIC_SEVERITY,
  DOCTOR_CHECK,
  DOCTOR_DISTRIBUTION_ACCEPTED_STATUS,
  DOCTOR_REASON,
  DOCTOR_STATUS_PRIORITY,
  EVIDENCE_STATUS,
  ENVIRONMENT_VARIABLE,
  ERROR_CODE,
  EVIDENCE_TYPE,
  FINGERPRINT_ALGORITHM,
  INTERNAL_RESOLUTION_SOURCE,
  LIMIT_MODE,
  NODE_EVENT,
  PRESENTATION_MODE,
  PACKAGE_PATH,
  PRODUCT,
  REFERENCE_DISCOVERY_METHOD,
  REFERENCE_SET_CHANGE_TYPE,
  REQUIRED_RUNTIME_COMPONENT,
  RUNTIME_COMMAND,
  RUNTIME_REQUIREMENT,
  RUNTIME_REQUIREMENT_KIND,
  RESULT_SCHEMA,
  TOOL,
  TYPESCRIPT_PROJECT_KIND,
  SOURCE_EXCLUDED_GLOBS,
  SOURCE_FILE_GLOBS,
  WORKSPACE_CONFIGURATION_FILE_NAMES,
  WORKSPACE_ROOT_MARKER_FILE_NAMES,
  RUNTIME_STATUS,
  UNRESOLVED_REFERENCE_REASON,
} from "../protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeSourceFiles = ["server.mjs", "cli.mjs", "lib/runtime.mjs", "lib/doctor.mjs"];
const runtimeSources = await Promise.all(
  runtimeSourceFiles.map(async (file) => ({
    file,
    source: await readFile(path.join(root, file), "utf8"),
  })),
);
const mcpConfig = JSON.parse(await readFile(path.join(root, ".mcp.json"), "utf8"));
const semanticServer = mcpConfig.mcpServers?.[PRODUCT.NAME];
if (semanticServer?.startup_timeout_sec !== DEFAULT.MCP_STARTUP_TIMEOUT_SECONDS) {
  throw new Error(".mcp.json startup_timeout_sec differs from protocol.mjs");
}
if (semanticServer?.tool_timeout_sec !== DEFAULT.MCP_TOOL_TIMEOUT_SECONDS) {
  throw new Error(".mcp.json tool_timeout_sec differs from protocol.mjs");
}
const groups = [
  TOOL,
  COLLECTION_STATUS,
  PRESENTATION_MODE,
  LIMIT_MODE,
  ACCOUNTING_STATUS,
  DEFINITION_MATCH,
  DIAGNOSTIC_FRESHNESS,
  DIAGNOSTIC_SEVERITY,
  DIAGNOSTIC_EVIDENCE_REASON,
  EVIDENCE_STATUS,
  CONTENT_FRESHNESS,
  ERROR_CODE,
  EVIDENCE_TYPE,
  FINGERPRINT_ALGORITHM,
  REFERENCE_DISCOVERY_METHOD,
  REFERENCE_SET_CHANGE_TYPE,
  DEFINITION_RESOLUTION_METHOD,
  INTERNAL_RESOLUTION_SOURCE,
  UNRESOLVED_REFERENCE_REASON,
  TYPESCRIPT_PROJECT_KIND,
  CI_STATUS,
  CI_REASON,
  CLI_COMMAND,
  CLI_ARGUMENT,
  CLI_MESSAGE,
  DOCTOR_CHECK,
  DOCTOR_REASON,
  Object.fromEntries(DOCTOR_DISTRIBUTION_ACCEPTED_STATUS.map((status) => [status, status])),
  DOCTOR_STATUS_PRIORITY,
  REQUIRED_RUNTIME_COMPONENT,
  RUNTIME_COMMAND,
  RUNTIME_REQUIREMENT,
  RUNTIME_REQUIREMENT_KIND,
  PACKAGE_PATH,
  RUNTIME_STATUS,
  NODE_EVENT,
  PRODUCT,
  ENVIRONMENT_VARIABLE,
  RESULT_SCHEMA,
  Object.fromEntries(WORKSPACE_CONFIGURATION_FILE_NAMES.map((name) => [name, name])),
  Object.fromEntries(WORKSPACE_ROOT_MARKER_FILE_NAMES.map((name) => [name, name])),
  Object.fromEntries(SOURCE_FILE_GLOBS.map((glob) => [glob, glob])),
  Object.fromEntries(SOURCE_EXCLUDED_GLOBS.map((glob) => [glob, glob])),
];
const duplicated = [];
for (const value of new Set(groups.flatMap((group) => Object.values(group)))) {
  if (typeof value !== "string") continue;
  const literal = JSON.stringify(value);
  for (const runtimeSource of runtimeSources) {
    if (runtimeSource.source.includes(literal)) duplicated.push(`${runtimeSource.file}: ${literal}`);
  }
}
if (duplicated.length > 0) {
  process.stderr.write(`Protocol string literals must come from protocol.mjs:\n${duplicated.join("\n")}\n`);
  process.exitCode = 1;
}
