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
  COMMON_VALUE,
  CONFIGURATION_FILE,
  CONTENT_FRESHNESS,
  DEFAULT,
  DEFINITION_MATCH,
  DEFINITION_RESOLUTION_METHOD,
  DEFINITION_SELECTION_STATUS,
  DIAGNOSTIC_EVIDENCE_REASON,
  DIAGNOSTIC_FRESHNESS,
  DIAGNOSTIC_GUIDANCE,
  DIAGNOSTIC_LANGUAGE,
  DIAGNOSTIC_PROVIDER,
  DIAGNOSTIC_REGION,
  DIAGNOSTIC_RESULT_FIELD,
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
  FINGERPRINT_FORMAT,
  INTERNAL_RESOLUTION_SOURCE,
  LIMIT_MODE,
  LSP_COMMAND,
  LSP_METHOD,
  NODE_EVENT,
  OPERATING_SYSTEM,
  PRESENTATION_MODE,
  PACKAGE_PATH,
  PRODUCT,
  REFERENCE_DISCOVERY_METHOD,
  REFERENCE_SET_CHANGE_TYPE,
  REQUIRED_RUNTIME_COMPONENT,
  RUNTIME_COMMAND,
  RUNTIME_PACKAGE,
  RUNTIME_REQUIREMENT,
  RUNTIME_REQUIREMENT_KIND,
  RESULT_SCHEMA,
  SEARCH_SCOPE,
  SEMANTIC_EVIDENCE_FOLLOW_UP_REASON,
  SEMANTIC_EVIDENCE_STATUS,
  TOOL,
  TOOL_DESCRIPTION,
  TYPESCRIPT_SERVER_COMMAND,
  TYPESCRIPT_PROJECT_KIND,
  SOURCE_EXCLUDED_GLOBS,
  SOURCE_FILE_GLOBS,
  WORKSPACE_CONFIGURATION_FILE_NAMES,
  WORKSPACE_ROOT_MARKER_FILE_NAMES,
  RUNTIME_STATUS,
  UNRESOLVED_REFERENCE_REASON,
} from "../protocol.mjs";
import {CODEX_SESSION_ROOT_AUTHORIZATION} from "../lib/codex-session-root-authorization.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeSourceFiles = ["server.mjs", "cli.mjs", "lib/runtime.mjs", "lib/doctor.mjs", "lib/diagnostic-evidence.mjs"];
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
if (semanticServer?.default_tools_approval_mode !== "prompt") {
  throw new Error(".mcp.json must prompt before Codex MCP tool calls");
}
if (semanticServer?.env?.[CODEX_SESSION_ROOT_AUTHORIZATION.ENVIRONMENT_VARIABLE] !== CODEX_SESSION_ROOT_AUTHORIZATION.ENABLED_VALUE) {
  throw new Error(".mcp.json does not enable the Codex human-approved session-root boundary");
}
for (const tool of [TOOL.PREPARE_WORKSPACE_ROOT, TOOL.AUTHORIZE_WORKSPACE_ROOT]) {
  if (semanticServer?.tools?.[tool]?.approval_mode !== "prompt") {
    throw new Error(`.mcp.json does not require prompt approval for ${tool}`);
  }
}
const groups = [
  COMMON_VALUE,
  SEARCH_SCOPE,
  RUNTIME_PACKAGE,
  TOOL,
  TOOL_DESCRIPTION,
  COLLECTION_STATUS,
  PRESENTATION_MODE,
  LIMIT_MODE,
  ACCOUNTING_STATUS,
  DEFINITION_MATCH,
  DEFINITION_SELECTION_STATUS,
  SEMANTIC_EVIDENCE_STATUS,
  SEMANTIC_EVIDENCE_FOLLOW_UP_REASON,
  DIAGNOSTIC_FRESHNESS,
  DIAGNOSTIC_PROVIDER,
  DIAGNOSTIC_REGION,
  DIAGNOSTIC_LANGUAGE,
  DIAGNOSTIC_SEVERITY,
  DIAGNOSTIC_EVIDENCE_REASON,
  DIAGNOSTIC_RESULT_FIELD,
  DIAGNOSTIC_GUIDANCE,
  EVIDENCE_STATUS,
  CONTENT_FRESHNESS,
  ERROR_CODE,
  EVIDENCE_TYPE,
  FINGERPRINT_ALGORITHM,
  FINGERPRINT_FORMAT,
  REFERENCE_DISCOVERY_METHOD,
  REFERENCE_SET_CHANGE_TYPE,
  DEFINITION_RESOLUTION_METHOD,
  INTERNAL_RESOLUTION_SOURCE,
  LSP_METHOD,
  LSP_COMMAND,
  TYPESCRIPT_SERVER_COMMAND,
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
  OPERATING_SYSTEM,
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
