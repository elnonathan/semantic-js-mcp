#!/usr/bin/env node

import {spawn} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {createReadStream, existsSync, realpathSync} from "node:fs";
import {mkdtemp, readFile, realpath, stat} from "node:fs/promises";
import {homedir, tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {RootsListChangedNotificationSchema} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import {stringify as stringifyYaml} from "yaml";
import {PACKAGE_ROOT, inspectRuntimeComponents, resolveRuntimeComponent, runtimeDependencyRoot} from "./lib/runtime.mjs";
import {canonicalPathInsideBoundary, fileIdentity, fileIdentityContains, locationKey, locationKeyAt} from "./lib/file-identity.mjs";
import {providerPermissionArguments} from "./lib/provider-permission.mjs";
import {diagnosticUseSummary} from "./lib/diagnostic-evidence.mjs";
import {isNamedSymbolTool, namedSemanticEvidence, namedSemanticEvidenceMatches} from "./lib/semantic-evidence.mjs";
import {PendingRequestRegistry} from "./lib/pending-requests.mjs";
import {collectStableSnapshot} from "./lib/stable-collection.mjs";
import {removeTemporaryDirectory} from "./lib/temporary-directory.mjs";
import {CODEX_SESSION_ROOT_AUTHORIZATION} from "./lib/codex-session-root-authorization.mjs";
import {sanitizedChildEnvironment} from "./lib/child-process-environment.mjs";
import {
  ACCOUNTING_STATUS,
  CALL_HIERARCHY_DIRECTION,
  CALL_HIERARCHY_EVIDENCE,
  CALL_HIERARCHY_UNRESOLVED_REASON,
  COLLECTION_STATUS,
  COMMON_VALUE,
  CONTENT_FRESHNESS,
  DEFAULT,
  DEFINITION_MATCH,
  DEFINITION_RESOLUTION_METHOD,
  DEFINITION_SELECTION_STATUS,
  DIAGNOSTIC_EVIDENCE_REASON,
  DIAGNOSTIC_FRESHNESS,
  DIAGNOSTIC_LANGUAGE,
  DIAGNOSTIC_PROVIDER,
  DIAGNOSTIC_REGION,
  DIAGNOSTIC_RESULT_FIELD,
  DIAGNOSTIC_SEVERITY,
  EVIDENCE_STATUS,
  ENVIRONMENT_VARIABLE,
  ERROR_CODE,
  EVIDENCE_TYPE,
  FINGERPRINT_ALGORITHM,
  FINGERPRINT_FORMAT,
  FORBIDDEN_PUBLIC_FIELD,
  LANGUAGE_ID,
  LIMIT_MODE,
  LSP_COMMAND,
  LSP_METHOD,
  NODE_EVENT,
  OPERATING_SYSTEM,
  INTERNAL_RESOLUTION_SOURCE,
  PRESENTATION_MODE,
  PROCESS_EXIT_CODE,
  PRODUCT,
  REFERENCE_DISCOVERY_METHOD,
  REFERENCE_SET_CHANGE_TYPE,
  REQUIRED_RUNTIME_COMPONENT,
  RUNTIME_PACKAGE,
  RUNTIME_COMMAND,
  RESULT_SCHEMA,
  SERVER_VERSION,
  SIGNATURE_SOURCE,
  SEARCH_SCOPE,
  TOOL,
  TOOL_DESCRIPTION,
  TOOL_ORDER,
  TYPESCRIPT_SERVER_COMMAND,
  TYPESCRIPT_PROJECT_KIND,
  WORKSPACE_CONFIGURATION_FILE_NAMES,
  WORKSPACE_ROOT_MARKER_FILE_NAMES,
  SOURCE_EXCLUDED_GLOBS,
  SOURCE_EXTENSION,
  SOURCE_FILE_GLOBS,
  UNRESOLVED_REFERENCE_REASON,
  UNRESOLVED_REFERENCE_CONTEXT,
  UNRESOLVED_REFERENCE_FOLLOW_UP,
  VUE_SCRIPT_LANGUAGE,
} from "./protocol.mjs";

const PLUGIN_ROOT = PACKAGE_ROOT;
const PROCESS_EVENT = Object.freeze({DATA: "data", EXIT: "exit"});
const PROCESS_SIGNAL = Object.freeze({INTERRUPT: "SIGINT", TERMINATE: "SIGTERM"});
const CONFIGURED_PROCESS_CWD = process.env[ENVIRONMENT_VARIABLE.PROCESS_CWD]
  ? path.resolve(process.env[ENVIRONMENT_VARIABLE.PROCESS_CWD])
  : undefined;
const ALLOW_WORKSPACE_TYPESCRIPT = /^(?:1|true)$/i.test(process.env[ENVIRONMENT_VARIABLE.ALLOW_WORKSPACE_TYPESCRIPT] || "");
const PROVIDER_ENVIRONMENT_VARIABLE = Object.freeze({
  READ_ROOTS: "SEMANTIC_JS_MCP_INTERNAL_PROVIDER_READ_ROOTS",
  WRITE_ROOTS: "SEMANTIC_JS_MCP_INTERNAL_PROVIDER_WRITE_ROOTS",
  CHILD_ENTRY: "SEMANTIC_JS_MCP_INTERNAL_PROVIDER_CHILD_ENTRY",
  // Force the Node permission model back on for Windows providers (diagnosis only).
  WINDOWS_PERMISSION: "SEMANTIC_JS_MCP_INTERNAL_WINDOWS_PROVIDER_PERMISSION",
});
const PROVIDER_FILESYSTEM_GUARD = path.join(PLUGIN_ROOT, "lib", "provider-filesystem-guard.mjs");
const SESSION_ROOT_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
const MAXIMUM_PENDING_SESSION_ROOT_AUTHORIZATIONS = 32;
const CODEX_SESSION_ROOT_AUTHORIZATION_ENABLED =
  process.env[CODEX_SESSION_ROOT_AUTHORIZATION.ENVIRONMENT_VARIABLE] === CODEX_SESSION_ROOT_AUTHORIZATION.ENABLED_VALUE;
const ROOT_PREPARATION_ERROR_CODES = new Set([
  ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_INVALID,
  ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_EXPIRED,
  ERROR_CODE.WORKSPACE_ROOT_TOO_BROAD,
]);
const MAX_SYMBOL_NESTING_DEPTH = 100;
let WORKSPACE_BOUNDARY_ROOTS = [];
let baseWorkspaceRoots = [];
let clientWorkspaceRoots = [];
let sessionWorkspaceRoots = [];
let workspaceBoundaryGeneration = 0;
let providerTemporaryDirectory;
let workspaceRootsRefreshSequence = 0;
let latestWorkspaceRootsRefresh = Promise.resolve();
const pendingSessionRootAuthorizations = new Map();

async function resolveWorkspaceBoundaryRoots() {
  const configured = (process.env[ENVIRONMENT_VARIABLE.WORKSPACE_ROOTS] || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  // PLUGIN_ROOT is always allowed so the bundled runtime and doctor fixtures remain analyzable.
  const candidates = [...new Set([...(configured.length > 0 ? configured : [process.cwd()]), PLUGIN_ROOT])];
  return Promise.all(
    candidates.map(async (candidate) => {
      const resolved = await realpath(path.resolve(candidate));
      if (!(await stat(resolved)).isDirectory()) {
        throw new Error(`Configured workspace root is not a directory: ${candidate}`);
      }
      return resolved;
    }),
  );
}

function sameRoots(left, right) {
  return left.length === right.length && left.every((root) => right.includes(root));
}

function applyWorkspaceBoundaryRoots({invalidate = false} = {}) {
  const nextRoots = [...new Set([...baseWorkspaceRoots, ...clientWorkspaceRoots, ...sessionWorkspaceRoots])];
  if (sameRoots(WORKSPACE_BOUNDARY_ROOTS, nextRoots)) return false;
  WORKSPACE_BOUNDARY_ROOTS = nextRoots;
  workspaceBoundaryGeneration++;
  if (invalidate) invalidateWorkspaceBoundaryState();
  return true;
}

// Hosts that advertise the MCP `roots` capability (e.g. Claude Code) report the
// active workspace directly, so the boundary follows the host without manual
// SEMANTIC_JS_MCP_WORKSPACE_ROOTS configuration. Host roots are unioned with the
// base roots; a non-file or unreadable root is skipped rather than fatal.
async function resolveClientWorkspaceRoots() {
  if (!server.server.getClientCapabilities()?.roots) return [];
  const response = await server.server.listRoots().catch(() => undefined);
  const resolved = [];
  for (const root of response?.roots || []) {
    if (typeof root?.uri !== "string" || !root.uri.startsWith("file:")) continue;
    try {
      const directory = await realpath(fromUri(root.uri));
      if ((await stat(directory)).isDirectory()) resolved.push(directory);
    } catch {
      // Skip a root the host lists but the server cannot resolve.
    }
  }
  return resolved;
}

function refreshClientWorkspaceRoots() {
  const sequence = ++workspaceRootsRefreshSequence;
  const refresh = resolveClientWorkspaceRoots().then((roots) => {
    if (sequence !== workspaceRootsRefreshSequence) return false;
    clientWorkspaceRoots = roots;
    return applyWorkspaceBoundaryRoots({invalidate: true});
  });
  latestWorkspaceRootsRefresh = refresh;
  return refresh;
}

async function ensureWorkspaceBoundaryReady() {
  if (!server.server.getClientCapabilities()?.roots) return;
  if (workspaceRootsRefreshSequence === 0) refreshClientWorkspaceRoots();
  while (true) {
    const sequence = workspaceRootsRefreshSequence;
    await latestWorkspaceRootsRefresh;
    if (sequence === workspaceRootsRefreshSequence) return;
  }
}

function workspaceBoundaryFor(resolvedPath) {
  let match;
  for (const root of WORKSPACE_BOUNDARY_ROOTS) {
    if (!fileIdentityContains(root, resolvedPath)) continue;
    // Prefer the outermost (shortest) containing root so repository discovery can walk up to it.
    if (!match || root.length < match.length) match = root;
  }
  return match;
}

function assertInsideWorkspaceBoundary(resolvedPath, candidate) {
  if (workspaceBoundaryFor(resolvedPath)) return resolvedPath;
  const nextStep = CODEX_SESSION_ROOT_AUTHORIZATION_ENABLED
    ? ` Ask the human whether to authorize the current Codex project or another directory, then use ${TOOL.PREPARE_WORKSPACE_ROOT}.`
    : ` Set ${ENVIRONMENT_VARIABLE.WORKSPACE_ROOTS} to allow additional analysis roots.`;
  const error = new Error(`Path is outside the configured workspace boundary: ${candidate}.${nextStep}`);
  error.code = ERROR_CODE.PATH_OUTSIDE_WORKSPACE_BOUNDARY;
  error.details = {
    allowedWorkspaceRoots: WORKSPACE_BOUNDARY_ROOTS,
    sessionWorkspaceRootAuthorizationAvailable: CODEX_SESSION_ROOT_AUTHORIZATION_ENABLED,
  };
  throw error;
}

function workspaceRootAuthorizationError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function assertSessionRootAuthorizationEnabled() {
  if (CODEX_SESSION_ROOT_AUTHORIZATION_ENABLED) return;
  throw workspaceRootAuthorizationError(
    ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_UNAVAILABLE,
    "Session workspace-root authorization is unavailable. Use a host-provided MCP root or configure SEMANTIC_JS_MCP_WORKSPACE_ROOTS before starting the server.",
  );
}

function protectedSessionRootCandidates(filesystemRoot) {
  if (process.platform === OPERATING_SYSTEM.WINDOWS) {
    return [
      path.join(filesystemRoot, "Program Files"),
      path.join(filesystemRoot, "Program Files (x86)"),
      path.join(filesystemRoot, "ProgramData"),
      path.join(filesystemRoot, "Windows"),
      tmpdir(),
    ];
  }
  const common = ["/bin", "/dev", "/etc", "/opt", "/sbin", "/usr", "/var", tmpdir()];
  if (process.platform !== OPERATING_SYSTEM.MACOS) return common;
  return [...common, "/Applications", "/Library", "/private", "/System", "/Volumes"];
}

async function canonicalProtectedSessionRoots(filesystemRoot) {
  const roots = [];
  for (const candidate of protectedSessionRootCandidates(filesystemRoot)) {
    try {
      roots.push(await realpath(candidate));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw workspaceRootAuthorizationError(
        ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_UNAVAILABLE,
        "Session workspace-root authorization is unavailable because a protected system directory could not be verified safely.",
      );
    }
  }
  return [...new Set(roots)];
}

async function canonicalSessionWorkspaceRoot(candidate) {
  if (!path.isAbsolute(candidate)) {
    throw workspaceRootAuthorizationError(
      ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_INVALID,
      "Workspace-root authorization requires an absolute directory path.",
    );
  }
  let resolved;
  try {
    resolved = await realpath(candidate);
    if (!(await stat(resolved)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw workspaceRootAuthorizationError(
      ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_INVALID,
      "The selected workspace root does not resolve to a readable directory.",
    );
  }
  const filesystemRoot = path.parse(resolved).root;
  let canonicalHome;
  try {
    canonicalHome = await realpath(homedir());
  } catch {
    throw workspaceRootAuthorizationError(
      ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_UNAVAILABLE,
      "Session workspace-root authorization is unavailable because the home-directory boundary could not be verified safely.",
    );
  }
  const protectedRoots = await canonicalProtectedSessionRoots(filesystemRoot);
  if (
    fileIdentity(resolved) === fileIdentity(filesystemRoot) ||
    fileIdentityContains(resolved, canonicalHome) ||
    protectedRoots.some((root) => fileIdentity(root) === fileIdentity(resolved))
  ) {
    throw workspaceRootAuthorizationError(
      ERROR_CODE.WORKSPACE_ROOT_TOO_BROAD,
      "The selected workspace root is too broad. Select one project or repository, not a filesystem root, home boundary, temporary root, or protected system directory.",
      {canonicalRoot: resolved},
    );
  }
  return resolved;
}

function prunePendingSessionRootAuthorizations(now = Date.now()) {
  for (const [authorizationRequestId, request] of pendingSessionRootAuthorizations) {
    if (request.expiresAt > now) continue;
    pendingSessionRootAuthorizations.delete(authorizationRequestId);
  }
  while (pendingSessionRootAuthorizations.size >= MAXIMUM_PENDING_SESSION_ROOT_AUTHORIZATIONS) {
    const oldest = pendingSessionRootAuthorizations.keys().next().value;
    pendingSessionRootAuthorizations.delete(oldest);
  }
}

async function prepareSessionWorkspaceRoot(candidate) {
  assertSessionRootAuthorizationEnabled();
  await ensureWorkspaceBoundaryReady();
  const canonicalRoot = await canonicalSessionWorkspaceRoot(candidate);
  if (workspaceBoundaryFor(canonicalRoot)) {
    return {
      canonicalRoot,
      authorizationRequired: false,
      allowedWorkspaceRoots: WORKSPACE_BOUNDARY_ROOTS,
    };
  }
  const now = Date.now();
  prunePendingSessionRootAuthorizations(now);
  const authorizationRequestId = `workspace-root-${randomUUID()}`;
  const authorizationRequestExpiresAt = now + SESSION_ROOT_AUTHORIZATION_TTL_MS;
  pendingSessionRootAuthorizations.set(authorizationRequestId, {
    canonicalRoot,
    expiresAt: authorizationRequestExpiresAt,
  });
  return {
    canonicalRoot,
    authorizationRequired: true,
    authorizationRequestId,
    authorizationRequestExpiresAt,
    allowedWorkspaceRoots: WORKSPACE_BOUNDARY_ROOTS,
  };
}

async function authorizeSessionWorkspaceRoot(authorizationRequestId, candidate) {
  assertSessionRootAuthorizationEnabled();
  const request = pendingSessionRootAuthorizations.get(authorizationRequestId);
  pendingSessionRootAuthorizations.delete(authorizationRequestId);
  if (!request) {
    throw workspaceRootAuthorizationError(
      ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_INVALID,
      "The workspace-root authorization request is invalid or was already used. Prepare the root again.",
    );
  }
  if (request.expiresAt <= Date.now()) {
    throw workspaceRootAuthorizationError(
      ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_EXPIRED,
      "The workspace-root authorization request expired. Prepare the root again and ask the human to reconfirm it.",
      {canonicalRoot: request.canonicalRoot},
    );
  }
  if (candidate !== request.canonicalRoot) {
    throw workspaceRootAuthorizationError(
      ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_INVALID,
      "The approved root does not exactly match the prepared canonical root. Prepare the root again.",
      {preparedCanonicalRoot: request.canonicalRoot},
    );
  }
  const canonicalRoot = await canonicalSessionWorkspaceRoot(candidate);
  if (canonicalRoot !== request.canonicalRoot) {
    throw workspaceRootAuthorizationError(
      ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_INVALID,
      "The selected directory changed after preparation. Prepare the root again.",
      {preparedCanonicalRoot: request.canonicalRoot, currentCanonicalRoot: canonicalRoot},
    );
  }
  sessionWorkspaceRoots = [...new Set([...sessionWorkspaceRoots, canonicalRoot])];
  const boundaryChanged = applyWorkspaceBoundaryRoots({invalidate: true});
  return {
    authorizedWorkspaceRoot: canonicalRoot,
    allowedWorkspaceRoots: WORKSPACE_BOUNDARY_ROOTS,
    boundaryChanged,
    persistsAfterServerExit: false,
  };
}

function childEnvironment(overrides = {}) {
  const environment = sanitizedChildEnvironment({...process.env, ...overrides});
  delete environment[CODEX_SESSION_ROOT_AUTHORIZATION.ENVIRONMENT_VARIABLE];
  return environment;
}

function providerEnvironment(expectedChildEntry) {
  return childEnvironment({
    [PROVIDER_ENVIRONMENT_VARIABLE.READ_ROOTS]: JSON.stringify([...WORKSPACE_BOUNDARY_ROOTS, providerTemporaryDirectory]),
    [PROVIDER_ENVIRONMENT_VARIABLE.WRITE_ROOTS]: JSON.stringify([providerTemporaryDirectory]),
    [PROVIDER_ENVIRONMENT_VARIABLE.CHILD_ENTRY]: expectedChildEntry,
    TMPDIR: providerTemporaryDirectory,
    TMP: providerTemporaryDirectory,
    TEMP: providerTemporaryDirectory,
  });
}

function providerNodeArguments({allowChildProcess = false} = {}) {
  // The in-process guard preload always applies. The Node permission model is
  // added only where it is active (macOS and Linux, or Windows with the internal
  // toggle set for diagnosis). Without the permission model there is no
  // child-process capability to relax, so `--allow-child-process` is added only
  // alongside `--permission`; the guard's JavaScript child-process denial is the
  // sole gate otherwise.
  const guardImport = `--import=${pathToFileURL(PROVIDER_FILESYSTEM_GUARD).href}`;
  const permissionArguments = providerPermissionArguments({
    operatingSystem: process.platform,
    windowsPermissionForced: process.env[PROVIDER_ENVIRONMENT_VARIABLE.WINDOWS_PERMISSION] === "1",
    readRoots: [...WORKSPACE_BOUNDARY_ROOTS, providerTemporaryDirectory],
    writeRoots: [providerTemporaryDirectory],
  });
  const childProcessArguments =
    permissionArguments.length > 0 && allowChildProcess ? ["--allow-child-process", "--disable-warning=SecurityWarning"] : [];
  return [...permissionArguments, ...childProcessArguments, guardImport];
}
const REQUEST_TIMEOUT_MS = DEFAULT.REQUEST_TIMEOUT_MS;
const DIAGNOSTIC_WAIT_MS = DEFAULT.DIAGNOSTIC_WAIT_MS;
let vueParsingDependenciesPromise;

function vueParsingDependencies() {
  if (!vueParsingDependenciesPromise) {
    vueParsingDependenciesPromise = Promise.all([import("@vue/compiler-sfc"), import(RUNTIME_PACKAGE.TYPESCRIPT)]).then(
      ([compiler, typescript]) => ({
        parseVueSfc: compiler.parse,
        ts: typescript.default,
      }),
    );
  }
  return vueParsingDependenciesPromise;
}

function positiveEnvironmentInteger(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const CLIENT_IDLE_TIMEOUT_MS = positiveEnvironmentInteger(ENVIRONMENT_VARIABLE.CLIENT_IDLE_TIMEOUT_MS, DEFAULT.CLIENT_IDLE_TIMEOUT_MS);
const CLIENT_MINIMUM_EVICTION_AGE_MS = positiveEnvironmentInteger(
  ENVIRONMENT_VARIABLE.CLIENT_MINIMUM_EVICTION_AGE_MS,
  DEFAULT.CLIENT_MINIMUM_EVICTION_AGE_MS,
);
const MAXIMUM_ACTIVE_CLIENTS = positiveEnvironmentInteger(ENVIRONMENT_VARIABLE.MAXIMUM_ACTIVE_CLIENTS, DEFAULT.MAXIMUM_ACTIVE_CLIENTS);
const REFERENCE_SET_TTL_MS = positiveEnvironmentInteger(ENVIRONMENT_VARIABLE.REFERENCE_SET_TTL_MS, DEFAULT.REFERENCE_SET_TTL_MS);
const MAXIMUM_REFERENCE_SETS = positiveEnvironmentInteger(ENVIRONMENT_VARIABLE.MAXIMUM_REFERENCE_SETS, DEFAULT.MAXIMUM_REFERENCE_SETS);
const MAXIMUM_CHANGED_REFERENCE_SET_MARKERS = positiveEnvironmentInteger(
  ENVIRONMENT_VARIABLE.MAXIMUM_CHANGED_REFERENCE_SET_MARKERS,
  DEFAULT.MAXIMUM_CHANGED_REFERENCE_SET_MARKERS,
);
const MAXIMUM_CACHED_REFERENCE_LOCATIONS = positiveEnvironmentInteger(
  ENVIRONMENT_VARIABLE.MAXIMUM_CACHED_REFERENCE_LOCATIONS,
  DEFAULT.MAXIMUM_CACHED_REFERENCE_LOCATIONS,
);
const DEFAULT_REFERENCE_PAGE_SIZE = positiveEnvironmentInteger(
  ENVIRONMENT_VARIABLE.DEFAULT_REFERENCE_PAGE_SIZE,
  DEFAULT.REFERENCE_PAGE_SIZE,
);
const CROSS_WORKSPACE_CONCURRENCY = positiveEnvironmentInteger(
  ENVIRONMENT_VARIABLE.CROSS_WORKSPACE_CONCURRENCY,
  DEFAULT.CROSS_WORKSPACE_CONCURRENCY,
);
const PUBLIC_TOOL_NAMES = new Set(TOOL_ORDER);
const COLLECTION_STATUSES = new Set(Object.values(COLLECTION_STATUS));
const PRESENTATION_MODES = new Set(Object.values(PRESENTATION_MODE));
const AMBIGUOUS_PUBLIC_KEYS = new Set(FORBIDDEN_PUBLIC_FIELD);

const symbolKinds = [
  "File",
  "Module",
  "Namespace",
  "Package",
  "Class",
  "Method",
  "Property",
  "Field",
  "Constructor",
  "Enum",
  "Interface",
  "Function",
  "Variable",
  "Constant",
  "String",
  "Number",
  "Boolean",
  "Array",
  "Object",
  "Key",
  "Null",
  "EnumMember",
  "Struct",
  "Event",
  "Operator",
  "TypeParameter",
];
const diagnosticSeverities = Object.values(DIAGNOSTIC_SEVERITY);
const diagnosticProviders = Object.freeze({
  [LANGUAGE_ID.TYPESCRIPT]: DIAGNOSTIC_PROVIDER.TYPESCRIPT_LANGUAGE_SERVER,
  [LANGUAGE_ID.VUE]: DIAGNOSTIC_PROVIDER.VUE_LANGUAGE_SERVER,
  [DIAGNOSTIC_PROVIDER.TYPESCRIPT_SERVER]: DIAGNOSTIC_PROVIDER.TYPESCRIPT_SERVER,
});
const vueEmbeddedLanguages = Object.freeze({
  [VUE_SCRIPT_LANGUAGE.TYPESCRIPT]: DIAGNOSTIC_LANGUAGE.TYPESCRIPT,
  [VUE_SCRIPT_LANGUAGE.TYPESCRIPT_REACT]: DIAGNOSTIC_LANGUAGE.TYPESCRIPT_REACT,
  [VUE_SCRIPT_LANGUAGE.JAVASCRIPT]: DIAGNOSTIC_LANGUAGE.JAVASCRIPT,
  [VUE_SCRIPT_LANGUAGE.JAVASCRIPT_REACT]: DIAGNOSTIC_LANGUAGE.JAVASCRIPT_REACT,
  [DIAGNOSTIC_LANGUAGE.HTML]: DIAGNOSTIC_LANGUAGE.HTML,
  [DIAGNOSTIC_LANGUAGE.PUG]: DIAGNOSTIC_LANGUAGE.PUG,
  [DIAGNOSTIC_LANGUAGE.CSS]: DIAGNOSTIC_LANGUAGE.CSS,
  [DIAGNOSTIC_LANGUAGE.SCSS]: DIAGNOSTIC_LANGUAGE.SCSS,
  [DIAGNOSTIC_LANGUAGE.LESS]: DIAGNOSTIC_LANGUAGE.LESS,
});

function verifyBundledRuntime() {
  const missingComponents = inspectRuntimeComponents(PLUGIN_ROOT).filter(({available}) => !available);
  if (missingComponents.length > 0) {
    const error = new Error(
      `Required language-server components are missing. Reinstall ${PRODUCT.NAME} dependencies before starting the MCP server.`,
    );
    error.code = ERROR_CODE.RUNTIME_DEPENDENCY_MISSING;
    error.details = {missingComponents};
    throw error;
  }
}

function runtimeNodeModules() {
  return runtimeDependencyRoot(REQUIRED_RUNTIME_COMPONENT.VUE_TYPESCRIPT_PLUGIN, PLUGIN_ROOT);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function processCwd(workspaceRoot) {
  if (CONFIGURED_PROCESS_CWD && existsSync(CONFIGURED_PROCESS_CWD)) {
    try {
      const configured = realpathSync(CONFIGURED_PROCESS_CWD);
      if (workspaceBoundaryFor(configured)) return configured;
    } catch {
      // Fall back to the authorized workspace root.
    }
  }
  return workspaceRoot;
}

function toUri(file) {
  return pathToFileURL(file).href;
}

function fromUri(uri) {
  return fileURLToPath(uri);
}

function lspPosition(line, column) {
  return {line: line - 1, character: column - 1};
}

function displayPosition(position) {
  return {line: position.line + 1, column: position.character + 1};
}

function displayRange(range) {
  return {start: displayPosition(range.start), end: displayPosition(range.end)};
}

function normalizeTsserverDiagnostic(item) {
  const start = item?.startLocation;
  const end = item?.endLocation;
  if (!start || !end) return undefined;
  const category = typeof item.category === "string" ? item.category.toLowerCase() : item.category;
  const severity =
    category === DIAGNOSTIC_SEVERITY.ERROR || category === 1
      ? 1
      : category === DIAGNOSTIC_SEVERITY.WARNING || category === 0
        ? 2
        : category === "suggestion" || category === 2
          ? 4
          : 3;
  const message =
    typeof item.text === "string" ? item.text : typeof item.message === "string" ? item.message : String(item.messageText || "");
  return {
    severity,
    code: item.code,
    source: DIAGNOSTIC_LANGUAGE.TYPESCRIPT,
    message,
    range: {
      start: {line: start.line - 1, character: start.offset - 1},
      end: {line: end.line - 1, character: end.offset - 1},
    },
  };
}

function limit(items, maxResults) {
  if (maxResults === undefined) return items.slice();
  return items.slice(0, maxResults);
}

function normalizedLimit(value) {
  return value === undefined ? {mode: LIMIT_MODE.UNLIMITED} : {mode: LIMIT_MODE.MAXIMUM, maximum: value};
}

function diagnosticEvidenceReason(freshness, snapshotConfirmed = false) {
  if (freshness === DIAGNOSTIC_FRESHNESS.DIFFERENT_CONTENT) {
    return DIAGNOSTIC_EVIDENCE_REASON.DOCUMENT_CONTENT_CHANGED_DURING_ACQUISITION;
  }
  if (snapshotConfirmed) {
    return DIAGNOSTIC_EVIDENCE_REASON.CURRENT_DOCUMENT_SNAPSHOT_CONFIRMED;
  }
  if (freshness === DIAGNOSTIC_FRESHNESS.CURRENT) {
    return DIAGNOSTIC_EVIDENCE_REASON.CURRENT_DOCUMENT_VERSION_CONFIRMED;
  }
  if (freshness === DIAGNOSTIC_FRESHNESS.VERSION_NOT_REPORTED) {
    return DIAGNOSTIC_EVIDENCE_REASON.LANGUAGE_SERVER_VERSION_NOT_REPORTED;
  }
  if (freshness === DIAGNOSTIC_FRESHNESS.DIFFERENT_VERSION) {
    return DIAGNOSTIC_EVIDENCE_REASON.LANGUAGE_SERVER_REPORTED_DIFFERENT_VERSION;
  }
  return DIAGNOSTIC_EVIDENCE_REASON.LANGUAGE_SERVER_DID_NOT_REPORT_CURRENT_DOCUMENT;
}

function textFingerprint(text) {
  return createHash(FINGERPRINT_ALGORITHM.SHA_256).update(text).digest("hex");
}

function collectionStatus({stoppedByLimit, unresolvedCount = 0, failed = false}) {
  if (failed) return COLLECTION_STATUS.FAILED;
  if (stoppedByLimit) return COLLECTION_STATUS.LIMITED;
  if (unresolvedCount > 0) return COLLECTION_STATUS.PARTIAL;
  return COLLECTION_STATUS.COMPLETE;
}

async function existingDirectory(candidate) {
  await ensureWorkspaceBoundaryReady();
  const resolved = await realpath(path.resolve(candidate));
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error(`Not a directory: ${candidate}`);
  }
  return assertInsideWorkspaceBoundary(resolved, candidate);
}

async function existingFile(candidate) {
  await ensureWorkspaceBoundaryReady();
  const resolved = await realpath(path.resolve(candidate));
  if (!(await stat(resolved)).isFile()) {
    throw new Error(`Not a file: ${candidate}`);
  }
  return assertInsideWorkspaceBoundary(resolved, candidate);
}

async function discoverRoots(file, requestedRoot) {
  let boundaryRoot;
  if (requestedRoot) {
    boundaryRoot = await existingDirectory(requestedRoot);
    if (file !== boundaryRoot && !file.startsWith(`${boundaryRoot}${path.sep}`)) {
      throw new Error(`File is outside requested workspace root: ${boundaryRoot}`);
    }
  }

  const boundaryLimit = workspaceBoundaryFor(file);
  let current = path.dirname(file);
  let nearestProject;
  let repositoryRoot;
  while (true) {
    if (!nearestProject && WORKSPACE_ROOT_MARKER_FILE_NAMES.some((name) => existsSync(path.join(current, name)))) {
      nearestProject = current;
    }
    if (existsSync(path.join(current, ".git"))) {
      repositoryRoot = current;
      break;
    }
    const parent = path.dirname(current);
    if (parent === current || current === boundaryLimit) {
      repositoryRoot = nearestProject || boundaryLimit || path.dirname(file);
      break;
    }
    current = parent;
  }

  return {
    boundaryRoot: boundaryRoot || repositoryRoot,
    repositoryRoot,
    workspaceRoot: nearestProject || repositoryRoot,
  };
}

function workspaceConfigurationFiles(workspaceRoot, repositoryRoot) {
  const files = [];
  let current = workspaceRoot;
  while (true) {
    for (const name of WORKSPACE_CONFIGURATION_FILE_NAMES) {
      files.push(path.join(current, name));
    }
    if (current === repositoryRoot) break;
    const parent = path.dirname(current);
    if (parent === current || !current.startsWith(`${repositoryRoot}${path.sep}`)) break;
    current = parent;
  }
  return files;
}

function dedupeLocations(locations) {
  const seen = new Set();
  return locations.filter((location) => {
    const key = locationKey(location);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }
  return Promise.all(Array.from({length: Math.min(concurrency, items.length)}, worker)).then(() => results);
}

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: processCwd(cwd),
      env: childEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on(PROCESS_EVENT.DATA, (chunk) => stdout.push(chunk));
    child.stderr.on(PROCESS_EVENT.DATA, (chunk) => stderr.push(chunk));
    child.on(NODE_EVENT.ERROR, reject);
    child.on(PROCESS_EVENT.EXIT, (code) => {
      if (code === 0 || code === 1) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`${command} exited ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
  });
}

async function identifierAt(file, line, column) {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  const text = lines[line - 1];
  if (text === undefined) throw new Error(`Line ${line} is outside ${file}`);
  let index = Math.min(column - 1, text.length);
  if (!/[A-Za-z0-9_$]/.test(text[index] || "")) {
    if (/[A-Za-z_$]/.test(text[index + 1] || "")) index++;
    else if (index > 0) index--;
  }
  let start = index;
  let end = index;
  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) start--;
  while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) end++;
  const identifier = text.slice(start, end);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)) {
    throw new Error(`No JavaScript identifier at ${file}:${line}:${column}`);
  }
  return {identifier, line, column: start + 1};
}

async function rgIdentifierCandidates(root, identifier, maxCandidates, wholeIdentifier = true) {
  const startedAt = performance.now();
  const output = await runProcess(
    RUNTIME_COMMAND.RIPGREP,
    [
      "--json",
      "--fixed-strings",
      ...SOURCE_FILE_GLOBS.flatMap((glob) => ["--glob", glob]),
      ...SOURCE_EXCLUDED_GLOBS.flatMap((glob) => ["--glob", glob]),
      "--",
      identifier,
      root,
    ],
    root,
  );
  const candidates = [];
  const candidateFiles = new Set();
  const canonicalFiles = new Map();
  let totalCandidateCount = 0;
  for (const recordLine of output.split("\n")) {
    if (!recordLine) continue;
    let record;
    try {
      record = JSON.parse(recordLine);
    } catch {
      continue;
    }
    if (record.type !== "match") continue;
    const reportedFile = path.isAbsolute(record.data.path.text) ? record.data.path.text : path.resolve(root, record.data.path.text);
    if (!canonicalFiles.has(reportedFile)) {
      canonicalFiles.set(reportedFile, canonicalPathInsideBoundary(reportedFile, workspaceBoundaryFor));
    }
    const file = await canonicalFiles.get(reportedFile);
    if (!file) continue;
    const lineText = record.data.lines.text;
    for (const match of record.data.submatches || []) {
      const prefix = Buffer.from(lineText, "utf8").subarray(0, match.start).toString("utf8");
      const start = prefix.length;
      const before = lineText[start - 1] || "";
      const after = lineText[start + identifier.length] || "";
      if (wholeIdentifier && (/[A-Za-z0-9_$]/.test(before) || /[A-Za-z0-9_$]/.test(after))) continue;
      totalCandidateCount++;
      candidateFiles.add(file);
      if (maxCandidates === undefined || candidates.length < maxCandidates) {
        candidates.push({file, line: record.data.line_number, column: start + 1});
      }
    }
  }
  return {
    candidates,
    totalCandidateCount,
    totalCandidateFileCount: candidateFiles.size,
    truncated: totalCandidateCount > candidates.length,
    elapsedMilliseconds: Math.round(performance.now() - startedAt),
  };
}

function languageId(file) {
  switch (path.extname(file).toLowerCase()) {
    case SOURCE_EXTENSION.TYPESCRIPT:
    case SOURCE_EXTENSION.TYPESCRIPT_MODULE:
    case SOURCE_EXTENSION.TYPESCRIPT_COMMONJS:
      return LANGUAGE_ID.TYPESCRIPT;
    case SOURCE_EXTENSION.TYPESCRIPT_REACT:
      return LANGUAGE_ID.TYPESCRIPT_REACT;
    case SOURCE_EXTENSION.JAVASCRIPT:
    case SOURCE_EXTENSION.JAVASCRIPT_MODULE:
    case SOURCE_EXTENSION.JAVASCRIPT_COMMONJS:
      return LANGUAGE_ID.JAVASCRIPT;
    case SOURCE_EXTENSION.JAVASCRIPT_REACT:
      return LANGUAGE_ID.JAVASCRIPT_REACT;
    case SOURCE_EXTENSION.VUE:
      return LANGUAGE_ID.VUE;
    default:
      throw new Error(`Unsupported file type: ${path.extname(file) || "none"}`);
  }
}

function serverKind(file) {
  return path.extname(file).toLowerCase() === SOURCE_EXTENSION.VUE ? LANGUAGE_ID.VUE : LANGUAGE_ID.TYPESCRIPT;
}

function findTsdk(root) {
  if (ALLOW_WORKSPACE_TYPESCRIPT) {
    const boundaryLimit = workspaceBoundaryFor(root);
    let current = root;
    while (true) {
      const workspaceTsdk = path.join(current, "node_modules", RUNTIME_PACKAGE.TYPESCRIPT, "lib");
      const workspaceServer = path.join(workspaceTsdk, "tsserver.js");
      if (existsSync(workspaceServer)) {
        try {
          const resolvedServer = realpathSync(workspaceServer);
          if (workspaceBoundaryFor(resolvedServer)) return path.dirname(resolvedServer);
        } catch {
          // Ignore an unreadable or boundary-escaping workspace SDK.
        }
      }
      const parent = path.dirname(current);
      if (parent === current || current === boundaryLimit) break;
      current = parent;
    }
  }
  return path.dirname(resolveRuntimeComponent(REQUIRED_RUNTIME_COMPONENT.TYPESCRIPT_SERVER, PLUGIN_ROOT));
}

function languageServerEntry(kind) {
  return kind === LANGUAGE_ID.VUE
    ? resolveRuntimeComponent(REQUIRED_RUNTIME_COMPONENT.VUE_LANGUAGE_SERVER, PLUGIN_ROOT)
    : resolveRuntimeComponent(REQUIRED_RUNTIME_COMPONENT.TYPESCRIPT_LANGUAGE_SERVER, PLUGIN_ROOT);
}

class TsserverBridge {
  constructor(root, tsdk, enableVuePlugin = false, onExit) {
    this.root = root;
    this.nextId = 1;
    this.pending = new PendingRequestRegistry({
      timeoutMilliseconds: REQUEST_TIMEOUT_MS,
      timeoutMessage: (command) => `tsserver request timed out: ${command}`,
    });
    this.openFiles = new Map();
    this.openFileSynchronizations = new Map();
    this.buffer = Buffer.alloc(0);
    this.onExit = onExit;
    this.closed = false;
    this.processError = undefined;
    this.boundaryGeneration = workspaceBoundaryGeneration;
    const args = [
      ...providerNodeArguments(),
      path.join(tsdk, "tsserver.js"),
      "--useInferredProjectPerProjectRoot",
      "--disableAutomaticTypingAcquisition",
    ];
    if (enableVuePlugin) {
      args.push("--globalPlugins", "@vue/typescript-plugin", "--pluginProbeLocations", runtimeNodeModules());
    }
    this.process = spawn(process.execPath, args, {
      cwd: processCwd(root),
      env: providerEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    process.stderr.write(`[${PRODUCT.NAME}:vue-tsserver] starting bridge ${this.process.pid}\n`);
    this.process.stdout.on(PROCESS_EVENT.DATA, (chunk) => this.onData(chunk));
    this.process.stderr.on(PROCESS_EVENT.DATA, (chunk) => {
      const message = chunk.toString().trim();
      if (message) process.stderr.write(`[${PRODUCT.NAME}:vue-tsserver] ${message}\n`);
    });
    this.process.on(NODE_EVENT.ERROR, (error) => {
      this.processError = error;
      process.stderr.write(`[${PRODUCT.NAME}:vue-tsserver] ${error.message}\n`);
    });
    this.process.stdin.on(NODE_EVENT.ERROR, (error) => {
      this.processError = error;
      this.handleBridgeProcessFailure(error);
    });
    this.process.on(PROCESS_EVENT.EXIT, (code, signal) => {
      this.handleBridgeProcessFailure(
        this.processError || new Error(`Vue tsserver bridge exited (${code ?? signal ?? COMMON_VALUE.UNKNOWN})`),
      );
    });
    this.process.on(NODE_EVENT.CLOSE, (code, signal) => {
      this.handleBridgeProcessFailure(
        this.processError || new Error(`Vue tsserver bridge exited (${code ?? signal ?? COMMON_VALUE.UNKNOWN})`),
      );
    });
  }

  handleBridgeProcessFailure(error) {
    if (!this.process) return;
    const failedProcess = this.process;
    this.process = undefined;
    this.rejectPending(error);
    if (failedProcess.exitCode === null && !failedProcess.killed) failedProcess.kill(PROCESS_SIGNAL.TERMINATE);
    if (!this.closed) this.onExit?.(this);
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        const message = JSON.parse(body);
        if (message.type === "response") {
          const pending = this.pending.take(message.request_seq);
          if (!pending) continue;
          if (message.success === false) pending.reject(new Error(message.message || "tsserver request failed"));
          else pending.resolve(message.body);
        }
      } catch (error) {
        process.stderr.write(`[${PRODUCT.NAME}:vue-tsserver] Invalid message: ${error.message}\n`);
      }
    }
  }

  send(command, args, expectResponse = true) {
    if (this.closed || !this.process?.stdin.writable) throw new Error("Vue tsserver bridge is not writable");
    const seq = this.nextId++;
    const message = JSON.stringify({seq, type: "request", command, arguments: args});
    const response = expectResponse ? this.pending.create(seq, command) : Promise.resolve(undefined);
    try {
      this.process.stdin.write(`${message}\n`);
    } catch (error) {
      if (!expectResponse) return Promise.reject(error);
      this.pending.take(seq)?.reject(error);
    }
    return response;
  }

  async synchronizeOpenFile(file, suppliedText) {
    const previous = this.openFileSynchronizations.get(file) || Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const fileContent = suppliedText ?? (await readFile(file, "utf8"));
        const fingerprint = textFingerprint(fileContent);
        if (this.openFiles.get(file) === fingerprint) return;
        if (this.openFiles.has(file)) await this.send(NODE_EVENT.CLOSE, {file}, false);
        await this.send("open", {file, fileContent, projectRootPath: this.root}, false);
        this.openFiles.set(file, fingerprint);
      });
    this.openFileSynchronizations.set(file, operation);
    try {
      await operation;
    } finally {
      if (this.openFileSynchronizations.get(file) === operation) this.openFileSynchronizations.delete(file);
    }
  }

  async request(command, args, {fileContent} = {}) {
    const file = args?.file;
    if (file) await this.synchronizeOpenFile(file, fileContent);
    const result = await this.send(command, args);
    if (this.closed || this.boundaryGeneration !== workspaceBoundaryGeneration) {
      throw new Error("Workspace boundary changed while the tsserver request was running");
    }
    return result;
  }

  rejectPending(error) {
    this.pending.rejectAll(error);
  }

  close(reason = new Error("Vue tsserver bridge closed")) {
    this.closed = true;
    this.rejectPending(reason);
    if (this.process && !this.process.killed) this.process.kill(PROCESS_SIGNAL.TERMINATE);
  }
}

class LspClient {
  constructor(root, kind, onExit) {
    this.root = root;
    this.kind = kind;
    this.process = undefined;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new PendingRequestRegistry({
      timeoutMilliseconds: REQUEST_TIMEOUT_MS,
      timeoutMessage: (method) => `LSP request timed out: ${method}`,
    });
    this.documents = new Map();
    this.diagnosticsCache = new Map();
    this.diagnosticWaiters = new Map();
    this.diagnosticAcquisitions = new Map();
    this.activeDocumentSynchronizations = 0;
    this.serverCapabilities = {};
    this.tsserverBridge = undefined;
    this.onExit = onExit;
    this.closed = false;
    this.processError = undefined;
    this.boundaryGeneration = workspaceBoundaryGeneration;
    this.ready = this.start();
  }

  async start() {
    const entry = languageServerEntry(this.kind);
    if (!existsSync(entry)) {
      throw new Error(`Language server is not installed: ${entry}`);
    }

    const tsdk = findTsdk(this.root);
    const expectedChildEntry = this.kind === LANGUAGE_ID.TYPESCRIPT ? path.join(tsdk, "tsserver.js") : undefined;
    this.process = spawn(process.execPath, [...providerNodeArguments({allowChildProcess: Boolean(expectedChildEntry)}), entry, "--stdio"], {
      cwd: processCwd(this.root),
      env: providerEnvironment(expectedChildEntry),
      stdio: ["pipe", "pipe", "pipe"],
    });
    process.stderr.write(`[${PRODUCT.NAME}:${this.kind}] starting provider ${this.process.pid}\n`);
    this.process.stdout.on(PROCESS_EVENT.DATA, (chunk) => this.onData(chunk));
    this.process.stderr.on(PROCESS_EVENT.DATA, (chunk) => {
      const message = chunk.toString().trim();
      if (message) process.stderr.write(`[${PRODUCT.NAME}:${this.kind}] ${message}\n`);
    });
    this.process.on(NODE_EVENT.ERROR, (error) => {
      this.processError = error;
      process.stderr.write(`[${PRODUCT.NAME}:${this.kind}] ${error.message}\n`);
    });
    this.process.stdin.on(NODE_EVENT.ERROR, (error) => {
      this.processError = error;
      this.handleLanguageServerProcessFailure(error);
    });
    this.process.on(PROCESS_EVENT.EXIT, (code, signal) => {
      process.stderr.write(`[${PRODUCT.NAME}:${this.kind}] exited (${code ?? signal ?? COMMON_VALUE.UNKNOWN})\n`);
      this.handleLanguageServerProcessFailure(
        this.processError || new Error(`${this.kind} language server exited (${code ?? signal ?? COMMON_VALUE.UNKNOWN})`),
      );
    });
    this.process.on(NODE_EVENT.CLOSE, (code, signal) => {
      this.handleLanguageServerProcessFailure(
        this.processError || new Error(`${this.kind} language server exited (${code ?? signal ?? COMMON_VALUE.UNKNOWN})`),
      );
    });

    if (this.kind === LANGUAGE_ID.VUE) this.createTsserverBridge();
    const initializeResult = await this.request(
      "initialize",
      {
        processId: process.pid,
        rootUri: toUri(this.root),
        workspaceFolders: [{uri: toUri(this.root), name: path.basename(this.root)}],
        capabilities: {
          textDocument: {
            synchronization: {didSave: false, dynamicRegistration: false},
            hover: {contentFormat: ["markdown", "plaintext"]},
            definition: {linkSupport: true},
            references: {},
            callHierarchy: {dynamicRegistration: false},
            documentSymbol: {hierarchicalDocumentSymbolSupport: true},
            publishDiagnostics: {relatedInformation: true},
            diagnostic: {dynamicRegistration: false, relatedDocumentSupport: false},
          },
          workspace: {symbol: {}, diagnostics: {refreshSupport: true}},
        },
        initializationOptions:
          this.kind === LANGUAGE_ID.VUE
            ? {typescript: {tsdk}, vue: {hybridMode: false}}
            : {disableAutomaticTypingAcquisition: true, tsserver: {path: path.join(tsdk, "tsserver.js")}},
      },
      true,
    );
    this.serverCapabilities = initializeResult?.capabilities || {};
    process.stderr.write(`[${PRODUCT.NAME}:${this.kind}] initialized\n`);
    this.notify("initialized", {});
  }

  handleLanguageServerProcessFailure(error) {
    if (!this.process) return;
    const failedProcess = this.process;
    this.process = undefined;
    this.rejectPending(error);
    this.invalidateAllDiagnostics(error);
    this.tsserverBridge?.close(error);
    this.tsserverBridge = undefined;
    if (failedProcess.exitCode === null && !failedProcess.killed) failedProcess.kill(PROCESS_SIGNAL.TERMINATE);
    if (!this.closed) this.onExit?.(this);
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body));
      } catch (error) {
        process.stderr.write(`[${PRODUCT.NAME}] Invalid LSP message: ${error.message}\n`);
      }
    }
  }

  onMessage(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined) && !message.method) {
      const pending = this.pending.take(message.id);
      if (!pending) return;
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }

    if (message.method === LSP_METHOD.PUBLISH_DIAGNOSTICS) {
      const openDocument = this.documents.get(message.params.uri);
      const entry = {
        items: message.params.diagnostics || [],
        reportedDocumentVersion: message.params.version,
        openDocumentVersionAtReceipt: openDocument?.version,
        receivedAt: Date.now(),
      };
      const acquisition = this.diagnosticAcquisitions.get(message.params.uri);
      if (acquisition?.completed && acquisition.sourceReport !== entry) {
        this.diagnosticAcquisitions.delete(message.params.uri);
      }
      this.diagnosticsCache.set(message.params.uri, entry);
      const waiters = this.diagnosticWaiters.get(message.params.uri) || [];
      const remaining = [];
      for (const waiter of waiters) {
        if (waiter.documentVersion !== entry.reportedDocumentVersion) {
          remaining.push(waiter);
          continue;
        }
        clearTimeout(waiter.timer);
        waiter.resolve(entry);
      }
      if (remaining.length > 0) this.diagnosticWaiters.set(message.params.uri, remaining);
      else this.diagnosticWaiters.delete(message.params.uri);
      return;
    }

    if (message.method === "tsserver/request") {
      const params = Array.isArray(message.params?.[0]) ? message.params[0] : message.params;
      const [requestId, command, args] = params || [];
      void this.rawTsserver()
        .request(command, args)
        .then((result) => this.notify("tsserver/response", [[requestId, result]]))
        .catch((error) => {
          process.stderr.write(`[${PRODUCT.NAME}:vue-tsserver] ${error.message}\n`);
          this.notify("tsserver/response", [[requestId, undefined]]);
        });
      return;
    }

    if (message.id !== undefined && message.method) {
      let result = null;
      if (message.method === "workspace/configuration") {
        result = (message.params?.items || []).map(() => ({}));
      } else if (message.method === LSP_METHOD.WORKSPACE_DIAGNOSTIC_REFRESH) {
        this.invalidateAllDiagnostics();
      } else if (message.method === "workspace/applyEdit") {
        result = {applied: false, failureReason: `${PRODUCT.DISPLAY_NAME} is read-only`};
      }
      this.respond(message.id, result);
    }
  }

  send(message) {
    if (!this.process?.stdin.writable) throw new Error(`${this.kind} language server is not writable`);
    const body = JSON.stringify({...message, jsonrpc: "2.0"});
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  async request(method, params, duringInitialization = false) {
    if (!duringInitialization && !this.process) throw new Error("Language server has not started");
    const id = this.nextId++;
    const response = this.pending.create(id, method);
    try {
      this.send({id, method, params});
    } catch (error) {
      this.pending.take(id)?.reject(error);
    }
    const result = await response;
    if (this.closed || this.boundaryGeneration !== workspaceBoundaryGeneration) {
      throw new Error("Workspace boundary changed while the language-server request was running");
    }
    return result;
  }

  notify(method, params) {
    this.send({method, params});
  }

  respond(id, result) {
    this.send({id, result});
  }

  rejectPending(error) {
    this.pending.rejectAll(error);
  }

  async syncDocument(file) {
    this.activeDocumentSynchronizations += 1;
    try {
      await this.ready;
      const uri = toUri(file);
      const text = await readFile(file, "utf8");
      const current = this.documents.get(uri);
      if (!current) {
        this.documents.set(uri, {text, version: 1});
        this.notify("textDocument/didOpen", {textDocument: {uri, languageId: languageId(file), version: 1, text}});
      } else if (current.text !== text) {
        invalidateReferenceSetsForFile(file);
        this.invalidateDiagnostics(uri);
        const version = current.version + 1;
        this.documents.set(uri, {text, version});
        this.notify("textDocument/didChange", {textDocument: {uri, version}, contentChanges: [{text}]});
      }
      return uri;
    } finally {
      this.activeDocumentSynchronizations -= 1;
    }
  }

  async textRequest(method, file, extra = {}) {
    const uri = await this.syncDocument(file);
    return this.request(method, {textDocument: {uri}, ...extra});
  }

  rawTsserver() {
    if (this.closed || !this.process) throw new Error(`${this.kind} language server is unavailable`);
    return this.tsserverBridge || this.createTsserverBridge();
  }

  createTsserverBridge() {
    const bridge = new TsserverBridge(this.root, findTsdk(this.root), this.kind === LANGUAGE_ID.VUE, (exitedBridge) => {
      if (this.tsserverBridge === exitedBridge) this.tsserverBridge = undefined;
    });
    this.tsserverBridge = bridge;
    return bridge;
  }

  clearDiagnosticWaiters(uri, error) {
    const waiters = this.diagnosticWaiters.get(uri) || [];
    this.diagnosticWaiters.delete(uri);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      if (error) waiter.reject(error);
      else waiter.resolve(undefined);
    }
  }

  invalidateDiagnostics(uri, error) {
    this.diagnosticsCache.delete(uri);
    this.clearDiagnosticWaiters(uri, error);
    this.diagnosticAcquisitions.delete(uri);
  }

  invalidateAllDiagnostics(error) {
    const uris = new Set([...this.diagnosticsCache.keys(), ...this.diagnosticWaiters.keys(), ...this.diagnosticAcquisitions.keys()]);
    for (const uri of uris) this.invalidateDiagnostics(uri, error);
  }

  waitForPublishedDiagnostics(uri, documentVersion) {
    const cached = this.diagnosticsCache.get(uri);
    if (cached?.reportedDocumentVersion === documentVersion) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const waiter = {documentVersion, resolve, reject, timer: undefined};
      waiter.timer = setTimeout(() => {
        const waiters = this.diagnosticWaiters.get(uri) || [];
        const remaining = waiters.filter((candidate) => candidate !== waiter);
        if (remaining.length > 0) this.diagnosticWaiters.set(uri, remaining);
        else this.diagnosticWaiters.delete(uri);
        resolve(this.diagnosticsCache.get(uri));
      }, DIAGNOSTIC_WAIT_MS);
      this.diagnosticWaiters.set(uri, [...(this.diagnosticWaiters.get(uri) || []), waiter]);
    });
  }

  supportsDiagnosticPull() {
    return Boolean(this.serverCapabilities.diagnosticProvider);
  }

  async acquireDiagnostics(uri, documentVersion, documentContentFingerprint) {
    if (this.supportsDiagnosticPull()) {
      try {
        const pulled = await this.request(LSP_METHOD.DOCUMENT_DIAGNOSTIC, {textDocument: {uri}});
        const current = this.documents.get(uri);
        const snapshotConfirmed = current?.version === documentVersion && textFingerprint(current.text) === documentContentFingerprint;
        return {
          items: pulled?.items || [],
          documentVersion,
          reportedDocumentVersion: undefined,
          reportReceived: true,
          sourceReport: undefined,
          snapshotConfirmed,
        };
      } catch {
        // A provider can advertise pull support and still reject a request. Its
        // push channel remains eligible for current-version evidence.
      }
    }
    const published = await this.waitForPublishedDiagnostics(uri, documentVersion);
    return {
      items: published?.items || [],
      documentVersion,
      reportedDocumentVersion: published?.reportedDocumentVersion,
      reportReceived: Boolean(published),
      sourceReport: published,
      snapshotConfirmed: false,
    };
  }

  async acquireTypescriptServerDiagnostics(file, documentText, documentVersion, documentContentFingerprint) {
    const bridge = this.rawTsserver();
    const commands = [
      TYPESCRIPT_SERVER_COMMAND.SYNTACTIC_DIAGNOSTICS_SYNC,
      TYPESCRIPT_SERVER_COMMAND.SEMANTIC_DIAGNOSTICS_SYNC,
      TYPESCRIPT_SERVER_COMMAND.SUGGESTION_DIAGNOSTICS_SYNC,
    ];
    await bridge.request("projectInfo", {file, needFileNameList: false}, {fileContent: documentText});
    const groups = [];
    for (const command of commands) {
      groups.push(await bridge.request(command, {file, includeLinePosition: true}, {fileContent: documentText}));
    }
    const items = groups.flat().map(normalizeTsserverDiagnostic).filter(Boolean);
    const currentText = await readFile(file, "utf8").catch(() => undefined);
    const uri = toUri(file);
    const currentDocument = this.documents.get(uri);
    const snapshotConfirmed =
      currentText !== undefined &&
      textFingerprint(currentText) === documentContentFingerprint &&
      currentDocument?.version === documentVersion &&
      textFingerprint(currentDocument.text) === documentContentFingerprint;
    return {
      items,
      documentVersion,
      reportedDocumentVersion: undefined,
      reportReceived: true,
      sourceReport: undefined,
      snapshotConfirmed,
      providerKind: DIAGNOSTIC_PROVIDER.TYPESCRIPT_SERVER,
    };
  }

  async diagnostics(file) {
    const uri = await this.syncDocument(file);
    const document = this.documents.get(uri);
    const documentVersion = document?.version;
    const documentText = document?.text || "";
    const documentContentFingerprint = textFingerprint(documentText);
    const existing = this.diagnosticAcquisitions.get(uri);
    if (existing?.documentVersion === documentVersion && existing.documentContentFingerprint === documentContentFingerprint) {
      return existing.promise;
    }
    const startedAt = Date.now();
    const acquisition = {
      documentVersion,
      documentContentFingerprint,
      promise: undefined,
      completed: false,
      sourceReport: undefined,
    };
    acquisition.promise = this.acquireDiagnostics(uri, documentVersion, documentContentFingerprint).then(async (initialReport) => {
      const currentText = await readFile(fromUri(uri), "utf8").catch(() => undefined);
      const contentStillCurrent = currentText !== undefined && textFingerprint(currentText) === documentContentFingerprint;
      let report = initialReport;
      let freshness = !contentStillCurrent
        ? DIAGNOSTIC_FRESHNESS.DIFFERENT_CONTENT
        : report.snapshotConfirmed
          ? DIAGNOSTIC_FRESHNESS.CURRENT
          : report.reportedDocumentVersion === undefined
            ? report.reportReceived
              ? DIAGNOSTIC_FRESHNESS.VERSION_NOT_REPORTED
              : DIAGNOSTIC_FRESHNESS.NOT_REPORTED_FOR_CURRENT_DOCUMENT
            : report.reportedDocumentVersion === documentVersion
              ? DIAGNOSTIC_FRESHNESS.CURRENT
              : DIAGNOSTIC_FRESHNESS.DIFFERENT_VERSION;
      if (freshness !== DIAGNOSTIC_FRESHNESS.CURRENT && contentStillCurrent && this.kind !== LANGUAGE_ID.VUE) {
        try {
          report = await this.acquireTypescriptServerDiagnostics(fromUri(uri), documentText, documentVersion, documentContentFingerprint);
          freshness = report.snapshotConfirmed ? DIAGNOSTIC_FRESHNESS.CURRENT : DIAGNOSTIC_FRESHNESS.DIFFERENT_CONTENT;
        } catch {
          report = initialReport;
        }
      }
      acquisition.completed = true;
      acquisition.sourceReport = report.sourceReport;
      const newerPublishedReport = report.sourceReport && this.diagnosticsCache.get(uri) !== report.sourceReport;
      const directSnapshot = report.providerKind === DIAGNOSTIC_PROVIDER.TYPESCRIPT_SERVER;
      if (
        (freshness !== DIAGNOSTIC_FRESHNESS.CURRENT || newerPublishedReport || directSnapshot) &&
        this.diagnosticAcquisitions.get(uri) === acquisition
      ) {
        this.diagnosticAcquisitions.delete(uri);
      }
      return {
        ...report,
        providerKind: report.providerKind || this.kind,
        freshness,
        documentText,
        documentContentFingerprint,
        waitedMilliseconds: Date.now() - startedAt,
      };
    });
    this.diagnosticAcquisitions.set(uri, acquisition);
    return acquisition.promise;
  }

  close() {
    this.closed = true;
    const error = new Error(`${this.kind} language server client closed`);
    this.rejectPending(error);
    this.documents.clear();
    this.invalidateAllDiagnostics(error);
    this.tsserverBridge?.close(error);
    this.tsserverBridge = undefined;
    if (this.process && !this.process.killed) this.process.kill(PROCESS_SIGNAL.TERMINATE);
  }
}

const clients = new Map();

function clientIsBusy(client) {
  const diagnosticAcquisitionActive = [...client.diagnosticAcquisitions.values()].some((acquisition) => !acquisition.completed);
  return (
    client.activeDocumentSynchronizations > 0 ||
    client.pending.size > 0 ||
    client.diagnosticWaiters.size > 0 ||
    diagnosticAcquisitionActive ||
    (client.tsserverBridge?.pending.size || 0) > 0
  );
}

function closeClientEntry(key, entry) {
  if (clients.get(key) !== entry) return;
  clients.delete(key);
  entry.client.close();
}

function removeExitedClient(key, client) {
  const entry = clients.get(key);
  if (entry?.client !== client) return;
  clients.delete(key);
}

function pruneClients(now = Date.now()) {
  for (const [key, entry] of clients) {
    if (!clientIsBusy(entry.client) && now - entry.lastUsedAt >= CLIENT_IDLE_TIMEOUT_MS) {
      closeClientEntry(key, entry);
    }
  }
  if (clients.size <= MAXIMUM_ACTIVE_CLIENTS) return;
  const removable = [...clients.entries()]
    .filter(([, entry]) => !clientIsBusy(entry.client) && now - entry.lastUsedAt >= CLIENT_MINIMUM_EVICTION_AGE_MS)
    .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
  while (clients.size > MAXIMUM_ACTIVE_CLIENTS && removable.length > 0) {
    const [key, entry] = removable.shift();
    if (clients.get(key) === entry) closeClientEntry(key, entry);
  }
}

function getOrCreateClient(key, root, kind) {
  const now = Date.now();
  let entry = clients.get(key);
  if (!entry) {
    const client = new LspClient(root, kind, (exitedClient) => removeExitedClient(key, exitedClient));
    entry = {client, lastUsedAt: now};
    clients.set(key, entry);
  } else {
    entry.lastUsedAt = now;
  }
  pruneClients(now);
  return entry.client;
}

async function waitForReadyClient(key, client) {
  try {
    await client.ready;
    const entry = clients.get(key);
    if (entry?.client === client) entry.lastUsedAt = Date.now();
    return client;
  } catch (error) {
    const entry = clients.get(key);
    if (entry?.client === client) closeClientEntry(key, entry);
    throw error;
  }
}

const clientCleanupTimer = setInterval(() => pruneClients(), Math.min(CLIENT_IDLE_TIMEOUT_MS, 15_000));
clientCleanupTimer.unref();

async function clientForFile(fileInput, rootInput) {
  let file;
  try {
    file = await existingFile(fileInput);
  } catch (error) {
    if (!rootInput || error?.code === ERROR_CODE.PATH_OUTSIDE_WORKSPACE_BOUNDARY) throw error;
    const root = await existingDirectory(rootInput);
    const basename = path.basename(fileInput);
    const matches = (await runProcess(RUNTIME_COMMAND.RIPGREP, ["--files", "--glob", `**/${basename}`, "--", root], root))
      .split("\n")
      .filter(Boolean)
      .slice(0, DEFAULT.FILE_SUGGESTION_COUNT)
      .map((candidate) => path.resolve(root, candidate));
    const suggestion = matches.length > 0 ? ` Possible matches: ${matches.join(", ")}` : "";
    throw new Error(`Source file not found: ${fileInput}.${suggestion}`);
  }
  languageId(file);
  const kind = serverKind(file);
  const roots = await discoverRoots(file, rootInput);
  const key = `${kind}:${roots.workspaceRoot}`;
  const client = getOrCreateClient(key, roots.workspaceRoot, kind);
  await waitForReadyClient(key, client);
  return {client, file, root: roots.workspaceRoot, ...roots};
}

function normalizeLocation(location) {
  const uri = location.uri || location.targetUri;
  const range = location.range || location.targetSelectionRange || location.targetRange;
  if (!uri || !range || !uri.startsWith("file:")) return undefined;
  try {
    const file = realpathSync(fromUri(uri));
    if (!workspaceBoundaryFor(file)) return undefined;
    return {file, range: displayRange(range)};
  } catch {
    return undefined;
  }
}

function normalizeLocations(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map(normalizeLocation).filter(Boolean);
}

function filesAreEqual(left, right) {
  return fileIdentity(left) === fileIdentity(right);
}

function locationsAreEqual(left, right) {
  return (
    filesAreEqual(left.file, right.file) &&
    left.range.start.line === right.range.start.line &&
    left.range.start.column === right.range.start.column
  );
}

async function followLocalDefinitionBinding(context, definitions) {
  if (definitions.length !== 1) return definitions;
  const [localDefinition] = definitions;
  if (!filesAreEqual(localDefinition.file, context.file)) return definitions;
  const raw = await context.client.textRequest("textDocument/definition", context.file, {
    position: lspPosition(localDefinition.range.start.line, localDefinition.range.start.column),
  });
  const followedDefinitions = normalizeLocations(raw);
  if (followedDefinitions.length === 0) return definitions;
  if (followedDefinitions.length === 1 && locationsAreEqual(followedDefinitions[0], localDefinition)) return definitions;
  return followedDefinitions;
}

async function sourceDefinitionsAt(context, line, column) {
  const uri = await context.client.syncDocument(context.file);
  const result = await context.client.request(LSP_METHOD.EXECUTE_COMMAND, {
    command: LSP_COMMAND.GO_TO_SOURCE_DEFINITION,
    arguments: [uri, lspPosition(line, column)],
  });
  return normalizeLocations(result);
}

async function typescriptServerDefinitionsAt(context, line, column) {
  const result = await context.client.rawTsserver().request(TYPESCRIPT_SERVER_COMMAND.DEFINITION_AND_BOUND_SPAN, {
    file: context.file,
    line,
    offset: column,
  });
  return normalizeTsserverDefinitions(result);
}

function normalizeTsserverDefinitions(value) {
  return (value?.definitions || [])
    .filter((definition) => definition?.file && definition.start && definition.end)
    .map((definition) => {
      try {
        const file = realpathSync(definition.file);
        if (!workspaceBoundaryFor(file)) return undefined;
        return {
          file,
          range: {
            start: {line: definition.start.line, column: definition.start.offset},
            end: {line: definition.end.line, column: definition.end.offset},
          },
        };
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

async function definitionsAtWithoutVueTemplateFallback(file, root, line, column) {
  const context = await clientForFile(file, root);
  const raw = await context.client.textRequest("textDocument/definition", context.file, {position: lspPosition(line, column)});
  const lspDefinitions = normalizeLocations(raw);
  if (lspDefinitions.length > 0) {
    const definitions = await followLocalDefinitionBinding(context, lspDefinitions);
    const remainsAtLocalBinding =
      definitions.length === 1 &&
      lspDefinitions.length === 1 &&
      locationsAreEqual(definitions[0], lspDefinitions[0]) &&
      filesAreEqual(definitions[0].file, context.file);
    if (!remainsAtLocalBinding) return {context, definitions, via: INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP};

    try {
      const sourceDefinitions = await sourceDefinitionsAt(context, line, column);
      if (sourceDefinitions.length === 0 || (sourceDefinitions.length === 1 && locationsAreEqual(sourceDefinitions[0], definitions[0]))) {
        return {context, definitions, via: INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP};
      }
      return {
        context,
        definitions: sourceDefinitions,
        via: INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP,
      };
    } catch {
      return {context, definitions, via: INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP};
    }
  }
  const project = await typescriptProjectEvidence(context);
  try {
    const definitions = await typescriptServerDefinitionsAt(context, line, column);
    return {
      context,
      definitions,
      via: definitions.length > 0 ? INTERNAL_RESOLUTION_SOURCE.TYPESCRIPT_SERVER_FALLBACK : INTERNAL_RESOLUTION_SOURCE.UNRESOLVED,
      attempts: [INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP, INTERNAL_RESOLUTION_SOURCE.TYPESCRIPT_SERVER_FALLBACK],
      project,
    };
  } catch (error) {
    return {
      context,
      definitions: [],
      via: INTERNAL_RESOLUTION_SOURCE.UNRESOLVED,
      attempts: [INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP, INTERNAL_RESOLUTION_SOURCE.TYPESCRIPT_SERVER_FALLBACK],
      failure: error instanceof Error ? error.message : String(error),
      project,
    };
  }
}

function textOffsetAtPosition(text, line, column) {
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine++) {
    const newline = text.indexOf("\n", offset);
    if (newline < 0) return text.length;
    offset = newline + 1;
  }
  return Math.min(text.length, offset + column - 1);
}

function displayPositionAtTextOffset(text, offset) {
  const prefix = text.slice(0, offset);
  const lines = prefix.split("\n");
  return {line: lines.length, column: lines.at(-1).length + 1};
}

function importedBindingNodes(sourceFile, identifier, ts) {
  const nodes = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (clause?.name?.text === identifier) nodes.push(clause.name);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === identifier) nodes.push(bindings.name);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.name.text === identifier) nodes.push(element.name);
      }
    }
  }
  return nodes;
}

async function vueTemplateImportPositions(file, line, column, identifier) {
  const {parseVueSfc, ts} = await vueParsingDependencies();
  const text = await readFile(file, "utf8");
  const {descriptor, errors} = parseVueSfc(text, {filename: file});
  if (errors.length > 0 || !descriptor.template) return [];
  const queryOffset = textOffsetAtPosition(text, line, column);
  if (queryOffset < descriptor.template.loc.start.offset || queryOffset > descriptor.template.loc.end.offset) return [];
  const positions = [];
  for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
    const scriptKind =
      block.lang === VUE_SCRIPT_LANGUAGE.JAVASCRIPT || block.lang === VUE_SCRIPT_LANGUAGE.JAVASCRIPT_REACT
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file, block.content, ts.ScriptTarget.Latest, true, scriptKind);
    for (const node of importedBindingNodes(sourceFile, identifier, ts)) {
      positions.push(displayPositionAtTextOffset(text, block.loc.start.offset + node.getStart(sourceFile)));
    }
  }
  return positions;
}

async function definitionsAt(file, root, line, column) {
  const primary = await definitionsAtWithoutVueTemplateFallback(file, root, line, column);
  if (primary.definitions.length > 0 || path.extname(file).toLowerCase() !== SOURCE_EXTENSION.VUE) return primary;
  const token = await identifierAt(file, line, column);
  for (const position of await vueTemplateImportPositions(file, line, column, token.identifier)) {
    const imported = await definitionsAtWithoutVueTemplateFallback(file, root, position.line, position.column);
    if (imported.definitions.length > 0) {
      return {
        ...imported,
        via: INTERNAL_RESOLUTION_SOURCE.VUE_TEMPLATE_IMPORT_BINDING,
        attempts: [
          ...(primary.attempts || [INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP]),
          INTERNAL_RESOLUTION_SOURCE.VUE_TEMPLATE_IMPORT_BINDING,
        ],
      };
    }
  }
  return primary;
}

async function typescriptProjectEvidence(context) {
  try {
    const info = await context.client.rawTsserver().request("projectInfo", {
      file: context.file,
      needFileNameList: false,
    });
    const configurationFile = info?.configFileName;
    const normalized = configurationFile?.replaceAll("\\", "/").toLowerCase();
    const kind = !configurationFile
      ? TYPESCRIPT_PROJECT_KIND.UNKNOWN
      : normalized.includes("inferredproject")
        ? TYPESCRIPT_PROJECT_KIND.INFERRED
        : TYPESCRIPT_PROJECT_KIND.CONFIGURED;
    return {kind, configurationFile};
  } catch {
    return {kind: TYPESCRIPT_PROJECT_KIND.UNKNOWN};
  }
}

function classifyIdentifierNode(node, ts) {
  const parent = node.parent;
  for (let current = parent; current; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) return UNRESOLVED_REFERENCE_CONTEXT.IMPORT_EXPORT;
  }
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) return UNRESOLVED_REFERENCE_CONTEXT.CALL;
  if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) return UNRESOLVED_REFERENCE_CONTEXT.MEMBER_ACCESS;
  if (
    (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) &&
    parent.name === node
  ) {
    return UNRESOLVED_REFERENCE_CONTEXT.PROPERTY_KEY;
  }
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isParameter(parent)) &&
    parent.name === node
  ) {
    return UNRESOLVED_REFERENCE_CONTEXT.DECLARATION;
  }
  return UNRESOLVED_REFERENCE_CONTEXT.IDENTIFIER_USE;
}

function identifierContextInSource(text, file, offset, identifier, ts) {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    languageId(file).includes(LANGUAGE_ID.JAVASCRIPT) ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  let match;
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === identifier && node.getStart(sourceFile) <= offset && node.getEnd() >= offset) match = node;
    if (!match && node.getFullStart() <= offset && node.getEnd() >= offset) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return match ? classifyIdentifierNode(match, ts) : UNRESOLVED_REFERENCE_CONTEXT.STRING_OR_COMMENT;
}

async function unresolvedReferenceContext(candidateLocation, identifier) {
  try {
    const text = await readFile(candidateLocation.file, "utf8");
    const offset = textOffsetAtPosition(text, candidateLocation.range.start.line, candidateLocation.range.start.column);
    const {parseVueSfc, ts} = await vueParsingDependencies();
    if (path.extname(candidateLocation.file).toLowerCase() !== SOURCE_EXTENSION.VUE) {
      return identifierContextInSource(text, candidateLocation.file, offset, identifier, ts);
    }
    const {descriptor, errors} = parseVueSfc(text, {filename: candidateLocation.file});
    if (errors.length > 0) return UNRESOLVED_REFERENCE_CONTEXT.UNKNOWN;
    if (descriptor.template && offset >= descriptor.template.loc.start.offset && offset <= descriptor.template.loc.end.offset) {
      return UNRESOLVED_REFERENCE_CONTEXT.VUE_TEMPLATE;
    }
    for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
      if (offset < block.loc.start.offset || offset > block.loc.end.offset) continue;
      return identifierContextInSource(block.content, candidateLocation.file, offset - block.loc.start.offset, identifier, ts);
    }
    return UNRESOLVED_REFERENCE_CONTEXT.STRING_OR_COMMENT;
  } catch {
    return UNRESOLVED_REFERENCE_CONTEXT.UNKNOWN;
  }
}

function unresolvedReferenceFollowUp(context, reason) {
  if (context === UNRESOLVED_REFERENCE_CONTEXT.STRING_OR_COMMENT) return UNRESOLVED_REFERENCE_FOLLOW_UP.TREAT_AS_TEXT_ONLY;
  if (context === UNRESOLVED_REFERENCE_CONTEXT.VUE_TEMPLATE) return UNRESOLVED_REFERENCE_FOLLOW_UP.CHECK_VUE_TEMPLATE_BINDING;
  if (reason === UNRESOLVED_REFERENCE_REASON.CANDIDATE_OPENED_IN_INFERRED_TYPESCRIPT_PROJECT) {
    return UNRESOLVED_REFERENCE_FOLLOW_UP.CHECK_TYPESCRIPT_PROJECT;
  }
  if (
    reason === UNRESOLVED_REFERENCE_REASON.TYPESCRIPT_SERVER_REQUEST_FAILED ||
    reason === UNRESOLVED_REFERENCE_REASON.CANDIDATE_ANALYSIS_FAILED
  ) {
    return UNRESOLVED_REFERENCE_FOLLOW_UP.INSPECT_PROVIDER_FAILURE;
  }
  return UNRESOLVED_REFERENCE_FOLLOW_UP.CHECK_SOURCE_BINDING;
}

async function unresolvedReference(candidateLocation, identifier, result, reason, failure) {
  const sourceContext = await unresolvedReferenceContext(candidateLocation, identifier);
  return {
    file: candidateLocation.file,
    range: candidateLocation.range,
    identifier,
    owningWorkspace: result?.context?.workspaceRoot,
    typescriptProject: result?.project,
    reason,
    sourceContext,
    suggestedFollowUp: unresolvedReferenceFollowUp(sourceContext, reason),
    attemptedMethods: result?.attempts?.map(publicDefinitionMethod) || [
      DEFINITION_RESOLUTION_METHOD.LANGUAGE_SERVER,
      DEFINITION_RESOLUTION_METHOD.TYPESCRIPT_SERVER,
    ],
    failure,
  };
}

async function crossWorkspaceReferences(context, line, column, maxCandidates, knownReferenceKeys = new Set()) {
  const startedAt = performance.now();
  const token = await identifierAt(context.file, line, column);
  const target = await definitionsAt(context.file, context.boundaryRoot, token.line, token.column);
  const targetKeys = new Set(target.definitions.map(locationKey));
  if (targetKeys.size === 0) {
    targetKeys.add(locationKeyAt(context.file, token.line, token.column));
  }

  const search = await rgIdentifierCandidates(context.repositoryRoot, token.identifier, maxCandidates);
  let unresolvedCandidateCount = 0;
  const unresolvedCandidates = [];
  let definitionMismatchCount = 0;
  let semanticRequests = 0;
  let semanticRequestsAvoidedByOwningWorkspace = 0;
  const configurationFiles = new Set(workspaceConfigurationFiles(context.workspaceRoot, context.repositoryRoot));
  const semanticVerificationStartedAt = performance.now();
  const verified = await mapLimit(search.candidates, CROSS_WORKSPACE_CONCURRENCY, async (candidate) => {
    const candidateLocation = {
      file: candidate.file,
      range: {
        start: {line: candidate.line, column: candidate.column},
        end: {line: candidate.line, column: candidate.column + token.identifier.length},
      },
    };
    if (knownReferenceKeys.has(locationKey(candidateLocation))) {
      const roots = await discoverRoots(candidate.file, context.repositoryRoot);
      for (const file of workspaceConfigurationFiles(roots.workspaceRoot, context.repositoryRoot)) configurationFiles.add(file);
      semanticRequestsAvoidedByOwningWorkspace++;
      return {...candidateLocation, via: INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP};
    }
    try {
      semanticRequests++;
      const result = await definitionsAt(candidate.file, context.repositoryRoot, candidate.line, candidate.column);
      for (const file of workspaceConfigurationFiles(result.context.workspaceRoot, context.repositoryRoot)) configurationFiles.add(file);
      if (result.via === INTERNAL_RESOLUTION_SOURCE.UNRESOLVED) {
        unresolvedCandidateCount++;
        unresolvedCandidates.push(
          await unresolvedReference(
            candidateLocation,
            token.identifier,
            result,
            result.project?.kind === TYPESCRIPT_PROJECT_KIND.INFERRED
              ? UNRESOLVED_REFERENCE_REASON.CANDIDATE_OPENED_IN_INFERRED_TYPESCRIPT_PROJECT
              : result.failure
                ? UNRESOLVED_REFERENCE_REASON.TYPESCRIPT_SERVER_REQUEST_FAILED
                : UNRESOLVED_REFERENCE_REASON.DEFINITION_TOOLS_RETURNED_NO_LOCATION,
            result.failure,
          ),
        );
        return undefined;
      }
      if (!result.definitions.some((definition) => targetKeys.has(locationKey(definition)))) {
        definitionMismatchCount++;
        return undefined;
      }
      return {...candidateLocation, via: INTERNAL_RESOLUTION_SOURCE.CROSS_WORKSPACE_DEFINITION};
    } catch (error) {
      unresolvedCandidateCount++;
      unresolvedCandidates.push(
        await unresolvedReference(
          candidateLocation,
          token.identifier,
          undefined,
          UNRESOLVED_REFERENCE_REASON.CANDIDATE_ANALYSIS_FAILED,
          error instanceof Error ? error.message : String(error),
        ),
      );
      return undefined;
    }
  });
  return {
    identifier: token.identifier,
    references: verified.filter(Boolean),
    scannedCandidateCount: search.candidates.length,
    totalTextualCandidateCount: search.totalCandidateCount,
    semanticallyMatchedCandidateCount: verified.filter(Boolean).length,
    rejectedCandidateCount: definitionMismatchCount,
    rejectedCandidatesByReason: {definitionMismatch: definitionMismatchCount},
    candidateScanTruncated: search.truncated,
    unresolvedCandidateCount,
    unresolvedCandidates: unresolvedCandidates.sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.range.start.line - right.range.start.line ||
        left.range.start.column - right.range.start.column,
    ),
    candidateFiles: [...new Set(search.candidates.map((candidate) => candidate.file))],
    configurationFiles: [...configurationFiles],
    targetDefinitions: target.definitions,
    performance: {
      textSearchMilliseconds: search.elapsedMilliseconds,
      semanticVerificationMilliseconds: Math.round(performance.now() - semanticVerificationStartedAt),
      totalMilliseconds: Math.round(performance.now() - startedAt),
      semanticRequests,
      semanticRequestsAvoidedByOwningWorkspace,
      maximumConcurrentSemanticRequests: CROSS_WORKSPACE_CONCURRENCY,
    },
  };
}

async function collectReferences(context, line, column, includeDeclaration, crossWorkspace, maxCandidates) {
  const token = await identifierAt(context.file, line, column);
  const nativeRequest = (requestIncludesDeclaration) =>
    context.client.textRequest("textDocument/references", context.file, {
      position: lspPosition(line, column),
      context: {includeDeclaration: requestIncludesDeclaration},
    });
  const nativeResult = await nativeRequest(includeDeclaration);
  const nativeReferences = normalizeLocations(nativeResult).map((location) => ({
    ...location,
    via: INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP,
  }));
  const nativeReferencesWithDeclaration = includeDeclaration
    ? nativeReferences
    : normalizeLocations(await nativeRequest(true)).map((location) => ({
        ...location,
        via: INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP,
      }));
  const nativeReferenceKeys = new Set(nativeReferences.map(locationKey));
  const nativeDeclarationKeys = new Set(
    nativeReferencesWithDeclaration.filter((location) => !nativeReferenceKeys.has(locationKey(location))).map(locationKey),
  );
  const cross = crossWorkspace
    ? await crossWorkspaceReferences(context, line, column, maxCandidates, new Set(nativeReferences.map(locationKey)))
    : {
        identifier: token.identifier,
        references: [],
        scannedCandidateCount: 0,
        totalTextualCandidateCount: 0,
        semanticallyMatchedCandidateCount: 0,
        rejectedCandidateCount: 0,
        rejectedCandidatesByReason: {definitionMismatch: 0},
        candidateScanTruncated: false,
        unresolvedCandidateCount: 0,
        unresolvedCandidates: [],
        candidateFiles: [],
        configurationFiles: workspaceConfigurationFiles(context.workspaceRoot, context.repositoryRoot),
        targetDefinitions: [],
        performance: {
          textSearchMilliseconds: 0,
          semanticVerificationMilliseconds: 0,
          totalMilliseconds: 0,
          semanticRequests: 0,
          semanticRequestsAvoidedByOwningWorkspace: 0,
          maximumConcurrentSemanticRequests: 0,
        },
      };

  const nativeKeys = new Set(nativeReferences.map(locationKey));
  const declarationKeys = new Set([...cross.targetDefinitions.map(locationKey), ...nativeDeclarationKeys]);
  const nativeReferencesForResult = includeDeclaration
    ? nativeReferences
    : nativeReferences.filter((location) => !declarationKeys.has(locationKey(location)));
  const verifiedCrossWorkspace = cross.references.filter(
    (location) => !nativeKeys.has(locationKey(location)) && (includeDeclaration || !declarationKeys.has(locationKey(location))),
  );
  const all = dedupeLocations([...nativeReferencesForResult, ...verifiedCrossWorkspace]);
  const collectionTruncated = cross.candidateScanTruncated;
  return {
    identifier: cross.identifier,
    references: all,
    nativeReferenceCount: nativeReferencesForResult.length,
    verifiedCrossWorkspaceCount: verifiedCrossWorkspace.length,
    verifiedReferenceCount: all.length,
    scannedCandidateCount: cross.scannedCandidateCount,
    totalTextualCandidateCount: cross.totalTextualCandidateCount,
    semanticallyMatchedCandidateCount: cross.semanticallyMatchedCandidateCount,
    rejectedCandidateCount: cross.rejectedCandidateCount,
    rejectedCandidatesByReason: cross.rejectedCandidatesByReason,
    unresolvedCandidateCount: cross.unresolvedCandidateCount,
    unresolvedCandidates: cross.unresolvedCandidates,
    collectionTruncated,
    referenceFiles: groupedReferenceFiles(all),
    evidenceFiles: [
      ...new Set([
        context.file,
        ...nativeReferences.map((reference) => reference.file),
        ...cross.candidateFiles,
        ...cross.configurationFiles,
      ]),
    ],
    performance: {
      ...cross.performance,
      residentSetBytesAfterCollection: process.memoryUsage().rss,
      heapUsedBytesAfterCollection: process.memoryUsage().heapUsed,
    },
  };
}

const referenceSetsById = new Map();
const referenceSetIdByKey = new Map();
const changedReferenceSetsById = new Map();
const callHierarchySetsById = new Map();
const callHierarchySetIdByKey = new Map();

function invalidateWorkspaceBoundaryState() {
  for (const [key, entry] of [...clients.entries()]) closeClientEntry(key, entry);
  referenceSetsById.clear();
  referenceSetIdByKey.clear();
  changedReferenceSetsById.clear();
  callHierarchySetsById.clear();
  callHierarchySetIdByKey.clear();
}

function normalizeCallHierarchyItem(item) {
  if (!item?.uri?.startsWith("file:") || !item.range || !item.selectionRange) return undefined;
  try {
    const file = realpathSync(fromUri(item.uri));
    if (!workspaceBoundaryFor(file)) return undefined;
    return {
      file,
      name: item.name,
      detail: item.detail,
      kind: symbolKinds[item.kind - 1] || item.kind,
      range: displayRange(item.range),
      selectionRange: displayRange(item.selectionRange),
    };
  } catch {
    return undefined;
  }
}

function callHierarchyNodeKey(node) {
  return `${fileIdentity(node.file)}:${node.selectionRange.start.line}:${node.selectionRange.start.column}:${node.name}`;
}

async function collectCallHierarchy(context, line, column, direction, maxDepth) {
  let prepared;
  try {
    prepared = await context.client.textRequest(LSP_METHOD.PREPARE_CALL_HIERARCHY, context.file, {
      position: lspPosition(line, column),
    });
  } catch (error) {
    return {
      nodes: [],
      edges: [],
      unresolved: [
        {
          reason: CALL_HIERARCHY_UNRESOLVED_REASON.PROVIDER_REQUEST_FAILED,
          file: context.file,
          range: {start: {line, column}},
          failure: error instanceof Error ? error.message : String(error),
        },
      ],
      cyclesDetected: 0,
      evidenceFiles: [context.file, ...workspaceConfigurationFiles(context.workspaceRoot, context.repositoryRoot)],
    };
  }
  const roots = Array.isArray(prepared) ? prepared : prepared ? [prepared] : [];
  const nodesByKey = new Map();
  const edges = [];
  const unresolved = [];
  let cyclesDetected = 0;
  const requestedDirections =
    direction === CALL_HIERARCHY_DIRECTION.BOTH ? [CALL_HIERARCHY_DIRECTION.INCOMING, CALL_HIERARCHY_DIRECTION.OUTGOING] : [direction];
  if (roots.length === 0) {
    return {
      nodes: [],
      edges: [],
      unresolved: [{reason: CALL_HIERARCHY_UNRESOLVED_REASON.ITEM_NOT_FOUND, file: context.file, range: {start: {line, column}}}],
      cyclesDetected,
      evidenceFiles: [context.file, ...workspaceConfigurationFiles(context.workspaceRoot, context.repositoryRoot)],
    };
  }
  for (const traversalDirection of requestedDirections) {
    const queue = roots.map((item) => ({item, depth: 0}));
    const expanded = new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      const currentNode = normalizeCallHierarchyItem(current.item);
      if (!currentNode) {
        unresolved.push({
          reason: CALL_HIERARCHY_UNRESOLVED_REASON.LOCATION_OUTSIDE_WORKSPACE_BOUNDARY,
          direction: traversalDirection,
          depth: current.depth,
        });
        continue;
      }
      const currentKey = callHierarchyNodeKey(currentNode);
      nodesByKey.set(currentKey, currentNode);
      if (current.depth >= maxDepth || expanded.has(currentKey)) continue;
      expanded.add(currentKey);
      const method = traversalDirection === CALL_HIERARCHY_DIRECTION.INCOMING ? LSP_METHOD.INCOMING_CALLS : LSP_METHOD.OUTGOING_CALLS;
      let calls;
      try {
        calls = (await context.client.request(method, {item: current.item})) || [];
      } catch (error) {
        unresolved.push({
          reason: CALL_HIERARCHY_UNRESOLVED_REASON.PROVIDER_REQUEST_FAILED,
          direction: traversalDirection,
          depth: current.depth + 1,
          node: currentNode,
          failure: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      for (const call of calls) {
        const relatedItem = traversalDirection === CALL_HIERARCHY_DIRECTION.INCOMING ? call.from : call.to;
        const relatedNode = normalizeCallHierarchyItem(relatedItem);
        if (!relatedNode) {
          unresolved.push({
            reason: CALL_HIERARCHY_UNRESOLVED_REASON.LOCATION_OUTSIDE_WORKSPACE_BOUNDARY,
            direction: traversalDirection,
            depth: current.depth + 1,
            node: currentNode,
          });
          continue;
        }
        const relatedKey = callHierarchyNodeKey(relatedNode);
        nodesByKey.set(relatedKey, relatedNode);
        const caller = traversalDirection === CALL_HIERARCHY_DIRECTION.INCOMING ? relatedNode : currentNode;
        const callee = traversalDirection === CALL_HIERARCHY_DIRECTION.INCOMING ? currentNode : relatedNode;
        const cycle = expanded.has(relatedKey);
        if (cycle) cyclesDetected++;
        edges.push({
          caller,
          callee,
          callSites: (call.fromRanges || []).map(displayRange),
          callSiteFile: caller.file,
          depth: current.depth + 1,
          discoveryMethod: CALL_HIERARCHY_EVIDENCE.STATIC_PROVIDER_GRAPH,
          cycle,
        });
        if (!cycle) queue.push({item: relatedItem, depth: current.depth + 1});
      }
    }
  }
  return {
    nodes: [...nodesByKey.values()],
    edges,
    unresolved,
    cyclesDetected,
    evidenceFiles: [
      ...new Set([
        context.file,
        ...[...nodesByKey.values()].map((node) => node.file),
        ...workspaceConfigurationFiles(context.workspaceRoot, context.repositoryRoot),
      ]),
    ],
  };
}

function callHierarchySetKey(context, line, column, direction, maxDepth) {
  return JSON.stringify({repositoryRoot: context.repositoryRoot, file: context.file, line, column, direction, maxDepth});
}

function deleteCallHierarchySet(id, entry) {
  callHierarchySetsById.delete(id);
  if (entry && callHierarchySetIdByKey.get(entry.key) === id) callHierarchySetIdByKey.delete(entry.key);
}

function pruneCallHierarchySets(now = Date.now()) {
  for (const [id, entry] of callHierarchySetsById) if (entry.expiresAt <= now) deleteCallHierarchySet(id, entry);
  const oldest = [...callHierarchySetsById.entries()].sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
  while (callHierarchySetsById.size > MAXIMUM_REFERENCE_SETS && oldest.length > 0) {
    const [id, entry] = oldest.shift();
    deleteCallHierarchySet(id, entry);
  }
}

async function getCallHierarchySet(context, line, column, direction, maxDepth) {
  const now = Date.now();
  pruneCallHierarchySets(now);
  const key = callHierarchySetKey(context, line, column, direction, maxDepth);
  const existingId = callHierarchySetIdByKey.get(key);
  const existing = existingId ? callHierarchySetsById.get(existingId) : undefined;
  if (existing) {
    const freshness = await verifyReferenceSetFreshness(existing);
    if (freshness.current) {
      existing.lastUsedAt = now;
      existing.expiresAt = now + REFERENCE_SET_TTL_MS;
      existing.repositorySourceInventory = freshness.repositorySourceInventory;
      return {...existing, reused: true};
    }
    deleteCallHierarchySet(existing.id, existing);
  }
  const stable = await collectStableSnapshot({
    attempts: DEFAULT.COLLECTION_STABILITY_ATTEMPTS,
    collect: () => collectCallHierarchy(context, line, column, direction, maxDepth),
    inventory: () => repositorySourceInventory(context.repositoryRoot),
    sameInventory: sameRepositoryInventory,
    fingerprint: (analysis) => fingerprintFiles(analysis.evidenceFiles),
  });
  if (!stable) throw new RepositoryChangedDuringCollectionError(context.repositoryRoot, DEFAULT.COLLECTION_STABILITY_ATTEMPTS);
  const id = `call-hierarchy-${randomUUID()}`;
  const entry = {
    id,
    key,
    analysis: stable.value,
    repositoryRoot: context.repositoryRoot,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + REFERENCE_SET_TTL_MS,
    fileFingerprints: stable.fingerprints,
    repositorySourceInventory: stable.inventory,
  };
  callHierarchySetsById.set(id, entry);
  callHierarchySetIdByKey.set(key, id);
  return {...entry, reused: false};
}

async function getCallHierarchySetById(id) {
  await ensureWorkspaceBoundaryReady();
  pruneCallHierarchySets();
  const entry = callHierarchySetsById.get(id);
  if (!entry) {
    const error = new Error("Call-hierarchy set expired or was not found. Collect the hierarchy again.");
    error.code = ERROR_CODE.CALL_HIERARCHY_SET_NOT_FOUND_OR_EXPIRED;
    error.details = {callHierarchySetId: id};
    throw error;
  }
  const freshness = await verifyReferenceSetFreshness(entry);
  if (!freshness.current) {
    deleteCallHierarchySet(id, entry);
    const error = new Error("Call-hierarchy set no longer matches current repository state. Collect the hierarchy again.");
    error.code = ERROR_CODE.CALL_HIERARCHY_SET_CONTENT_CHANGED;
    error.details = {callHierarchySetId: id, ...freshness.details};
    throw error;
  }
  entry.lastUsedAt = Date.now();
  entry.expiresAt = entry.lastUsedAt + REFERENCE_SET_TTL_MS;
  entry.repositorySourceInventory = freshness.repositorySourceInventory;
  return entry;
}

function presentCallHierarchySet(entry, offset, pageSize) {
  const start = Math.max(0, offset);
  const edges = entry.analysis.edges.slice(start, start + pageSize);
  const nextOffset = start + edges.length;
  return {
    edges,
    presentation: {
      mode: PRESENTATION_MODE.PAGE,
      edgesAvailable: entry.analysis.edges.length,
      edgesReturned: edges.length,
      nextCursor: nextOffset < entry.analysis.edges.length ? String(nextOffset) : undefined,
    },
  };
}

class ReferenceSetStaleError extends Error {
  constructor(referenceSetId, details) {
    super("Reference set no longer matches current repository state. Call lsp_references again to collect current locations.");
    this.code = ERROR_CODE.REFERENCE_SET_CONTENT_CHANGED;
    this.details = {referenceSetId, ...details};
  }
}

class ReferenceSetUnavailableError extends Error {
  constructor(referenceSetId) {
    super("Reference set expired or was not found. Call lsp_references again to create a current reference set.");
    this.code = ERROR_CODE.REFERENCE_SET_NOT_FOUND_OR_EXPIRED;
    this.details = {referenceSetId};
  }
}

class RepositoryChangedDuringCollectionError extends Error {
  constructor(repositoryRoot, attempts) {
    super("Repository source inventory changed while references were being collected. Retry after repository edits settle.");
    this.code = ERROR_CODE.REPOSITORY_CHANGED_DURING_COLLECTION;
    this.details = {repositoryRoot, attempts};
  }
}

function contentFingerprint(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash(FINGERPRINT_ALGORITHM.SHA_256);
    const stream = createReadStream(file);
    stream.on(PROCESS_EVENT.DATA, (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on(NODE_EVENT.ERROR, (error) => {
      if (error?.code === "ENOENT") resolve(null);
      else reject(error);
    });
  });
}

function publicContentFingerprint(fingerprint) {
  return `${FINGERPRINT_FORMAT.SHA_256_PREFIX}${fingerprint}`;
}

async function fingerprintFiles(files) {
  const uniqueFiles = [...new Set(files)].sort();
  const fingerprints = await mapLimit(uniqueFiles, DEFAULT.FILE_FINGERPRINT_CONCURRENCY, async (file) => ({
    file,
    sha256: await contentFingerprint(file),
  }));
  return fingerprints;
}

async function changedFingerprintFiles(fingerprints) {
  const checked = await mapLimit(fingerprints, DEFAULT.FILE_FINGERPRINT_CONCURRENCY, async (fingerprint) => ({
    file: fingerprint.file,
    changed: (await contentFingerprint(fingerprint.file)) !== fingerprint.sha256,
  }));
  return checked.filter((item) => item.changed).map((item) => item.file);
}

async function repositorySourceInventory(repositoryRoot) {
  const startedAt = performance.now();
  const output = await runProcess(
    RUNTIME_COMMAND.RIPGREP,
    [
      "--files",
      ...SOURCE_FILE_GLOBS.flatMap((glob) => ["--glob", glob]),
      ...SOURCE_EXCLUDED_GLOBS.flatMap((glob) => ["--glob", glob]),
      "--",
      repositoryRoot,
    ],
    repositoryRoot,
  );
  const files = [
    ...new Set(
      output
        .split("\n")
        .filter(Boolean)
        .map((file) => (path.isAbsolute(file) ? path.resolve(file) : path.resolve(repositoryRoot, file))),
    ),
  ].sort();
  const entries = await mapLimit(files, DEFAULT.INVENTORY_STAT_CONCURRENCY, async (file) => {
    try {
      const metadata = await stat(file, {bigint: true});
      return `${file}\0${metadata.size}\0${metadata.mtimeNs}`;
    } catch (error) {
      if (error?.code === "ENOENT") return `${file}\0missing`;
      throw error;
    }
  });
  const hash = createHash(FINGERPRINT_ALGORITHM.SHA_256);
  for (const entry of entries) hash.update(entry).update("\n");
  return {
    sha256: hash.digest("hex"),
    sourceFileCount: files.length,
    elapsedMilliseconds: Math.round(performance.now() - startedAt),
  };
}

function sameRepositoryInventory(left, right) {
  return left.sha256 === right.sha256 && left.sourceFileCount === right.sourceFileCount;
}

async function verifyReferenceSetFreshness(entry) {
  const startedAt = performance.now();
  const [changedFiles, currentInventory] = await Promise.all([
    changedFingerprintFiles(entry.fileFingerprints),
    repositorySourceInventory(entry.repositoryRoot),
  ]);
  if (changedFiles.length > 0) {
    return {
      current: false,
      details: {
        changeType: REFERENCE_SET_CHANGE_TYPE.EVIDENCE_FILE_CONTENT_CHANGED,
        changedFiles,
      },
    };
  }
  if (!sameRepositoryInventory(entry.repositorySourceInventory, currentInventory)) {
    return {
      current: false,
      details: {
        changeType: REFERENCE_SET_CHANGE_TYPE.REPOSITORY_SOURCE_INVENTORY_CHANGED,
        previousSourceFileCount: entry.repositorySourceInventory.sourceFileCount,
        currentSourceFileCount: currentInventory.sourceFileCount,
      },
    };
  }
  return {
    current: true,
    repositorySourceInventory: currentInventory,
    elapsedMilliseconds: Math.round(performance.now() - startedAt),
  };
}

function deleteReferenceSet(id, entry) {
  referenceSetsById.delete(id);
  if (entry && referenceSetIdByKey.get(entry.key) === id) referenceSetIdByKey.delete(entry.key);
}

function rememberChangedReferenceSet(id, details) {
  const now = Date.now();
  changedReferenceSetsById.set(id, {details, createdAt: now, expiresAt: now + REFERENCE_SET_TTL_MS});
  pruneChangedReferenceSets(now);
}

function pruneChangedReferenceSets(now = Date.now()) {
  for (const [id, entry] of changedReferenceSetsById) {
    if (entry.expiresAt <= now) changedReferenceSetsById.delete(id);
  }
  const oldest = [...changedReferenceSetsById.entries()].sort((left, right) => left[1].createdAt - right[1].createdAt);
  while (changedReferenceSetsById.size > MAXIMUM_CHANGED_REFERENCE_SET_MARKERS && oldest.length > 0) {
    changedReferenceSetsById.delete(oldest.shift()[0]);
  }
}

function invalidateReferenceSetsForFile(file) {
  for (const [id, entry] of referenceSetsById) {
    const belongsToRepository = file === entry.repositoryRoot || file.startsWith(`${entry.repositoryRoot}${path.sep}`);
    if (!belongsToRepository) continue;
    const isDirectEvidenceFile = entry.fileFingerprints.some((fingerprint) => fingerprint.file === file);
    rememberChangedReferenceSet(id, {
      changeType: isDirectEvidenceFile
        ? REFERENCE_SET_CHANGE_TYPE.EVIDENCE_FILE_CONTENT_CHANGED
        : REFERENCE_SET_CHANGE_TYPE.REPOSITORY_SOURCE_INVENTORY_CHANGED,
      changedFiles: [file],
    });
    deleteReferenceSet(id, entry);
  }
  for (const [id, entry] of callHierarchySetsById) {
    const belongsToRepository = file === entry.repositoryRoot || file.startsWith(`${entry.repositoryRoot}${path.sep}`);
    if (belongsToRepository) deleteCallHierarchySet(id, entry);
  }
}

function pruneReferenceSets(now = Date.now()) {
  pruneChangedReferenceSets(now);
  for (const [id, entry] of referenceSetsById) {
    if (entry.expiresAt <= now) {
      deleteReferenceSet(id, entry);
    }
  }
  const oldest = [...referenceSetsById.entries()].sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
  let cachedLocations = [...referenceSetsById.values()].reduce((total, entry) => total + entry.analysis.references.length, 0);
  while (
    (referenceSetsById.size > MAXIMUM_REFERENCE_SETS || cachedLocations > MAXIMUM_CACHED_REFERENCE_LOCATIONS) &&
    referenceSetsById.size > 1 &&
    oldest.length > 0
  ) {
    const [id, entry] = oldest.shift();
    deleteReferenceSet(id, entry);
    cachedLocations -= entry.analysis.references.length;
  }
}

function referenceSetKey(context, line, column, includeDeclaration, crossWorkspace, maxCandidates) {
  return JSON.stringify({
    repositoryRoot: context.repositoryRoot,
    file: context.file,
    line,
    column,
    includeDeclaration,
    crossWorkspace,
    maxCandidates: maxCandidates ?? null,
  });
}

async function getReferenceSet(context, line, column, includeDeclaration, crossWorkspace, maxCandidates) {
  const now = Date.now();
  pruneReferenceSets(now);
  const key = referenceSetKey(context, line, column, includeDeclaration, crossWorkspace, maxCandidates);
  const existingId = referenceSetIdByKey.get(key);
  const existing = existingId ? referenceSetsById.get(existingId) : undefined;
  if (existing && existing.expiresAt > now) {
    const freshness = await verifyReferenceSetFreshness(existing);
    if (freshness.current) {
      const checkedAt = Date.now();
      existing.lastUsedAt = checkedAt;
      existing.expiresAt = checkedAt + REFERENCE_SET_TTL_MS;
      existing.repositorySourceInventory = freshness.repositorySourceInventory;
      return {...existing, reused: true, freshnessCheckedAt: checkedAt, freshnessCheckMilliseconds: freshness.elapsedMilliseconds};
    }
    rememberChangedReferenceSet(existing.id, freshness.details);
    deleteReferenceSet(existing.id, existing);
  }

  const stableCollection = await collectStableSnapshot({
    attempts: DEFAULT.COLLECTION_STABILITY_ATTEMPTS,
    collect: () => collectReferences(context, line, column, includeDeclaration, crossWorkspace, maxCandidates),
    inventory: () => repositorySourceInventory(context.repositoryRoot),
    sameInventory: sameRepositoryInventory,
    fingerprint: (analysis) => fingerprintFiles(analysis.evidenceFiles),
  });
  if (!stableCollection) {
    throw new RepositoryChangedDuringCollectionError(context.repositoryRoot, DEFAULT.COLLECTION_STABILITY_ATTEMPTS);
  }
  const completedAt = Date.now();
  const id = `references-${randomUUID()}`;
  const entry = {
    id,
    key,
    analysis: stableCollection.value,
    workspaceRoot: context.workspaceRoot,
    repositoryRoot: context.repositoryRoot,
    source: {file: context.file, line, column},
    createdAt: completedAt,
    lastUsedAt: completedAt,
    expiresAt: completedAt + REFERENCE_SET_TTL_MS,
    fileFingerprints: stableCollection.fingerprints,
    repositorySourceInventory: stableCollection.inventory,
    collectionStabilityAttempts: stableCollection.attempt,
  };
  referenceSetsById.set(id, entry);
  referenceSetIdByKey.set(key, id);
  pruneReferenceSets(now);
  return {
    ...entry,
    reused: false,
    freshnessCheckedAt: completedAt,
    freshnessCheckMilliseconds: stableCollection.inventory.elapsedMilliseconds,
  };
}

async function getReferenceSetById(id) {
  await ensureWorkspaceBoundaryReady();
  const now = Date.now();
  pruneReferenceSets(now);
  const entry = referenceSetsById.get(id);
  if (!entry) {
    const changed = changedReferenceSetsById.get(id);
    if (changed) throw new ReferenceSetStaleError(id, changed.details);
    return undefined;
  }
  const freshness = await verifyReferenceSetFreshness(entry);
  if (!freshness.current) {
    rememberChangedReferenceSet(id, freshness.details);
    deleteReferenceSet(id, entry);
    throw new ReferenceSetStaleError(id, freshness.details);
  }
  const checkedAt = Date.now();
  entry.lastUsedAt = checkedAt;
  entry.expiresAt = checkedAt + REFERENCE_SET_TTL_MS;
  entry.freshnessCheckedAt = checkedAt;
  entry.freshnessCheckMilliseconds = freshness.elapsedMilliseconds;
  entry.repositorySourceInventory = freshness.repositorySourceInventory;
  return entry;
}

function presentReferenceSet(entry, offset, pageSize) {
  const start = Math.max(0, offset);
  const references = entry.analysis.references.slice(start, start + pageSize);
  const referenceGroupsByFile = new Map();
  for (const reference of references) {
    const key = fileIdentity(reference.file);
    const group = referenceGroupsByFile.get(key) || {file: reference.file, locations: []};
    group.locations.push({range: reference.range, discoveryMethod: publicReferenceMethod(reference.via)});
    referenceGroupsByFile.set(key, group);
  }
  const nextOffset = start + references.length;
  return {
    referenceGroups: [...referenceGroupsByFile.values()],
    presentation: {
      mode: PRESENTATION_MODE.PAGE,
      locationsAvailable: entry.analysis.references.length,
      locationsReturned: references.length,
      nextCursor: nextOffset < entry.analysis.references.length ? String(nextOffset) : undefined,
    },
  };
}

function presentUnresolvedReferenceSet(entry, offset, pageSize) {
  const start = Math.max(0, offset);
  const candidates = entry.analysis.unresolvedCandidates.slice(start, start + pageSize);
  const nextOffset = start + candidates.length;
  return {
    candidates,
    presentation: {
      mode: PRESENTATION_MODE.PAGE,
      candidatesAvailable: entry.analysis.unresolvedCandidates.length,
      candidatesReturned: candidates.length,
      nextCursor: nextOffset < entry.analysis.unresolvedCandidates.length ? String(nextOffset) : undefined,
    },
  };
}

async function semanticWorkspaceSymbols(root, query, maxCandidates, {exactIdentifier = false} = {}) {
  const search = await rgIdentifierCandidates(root, query, maxCandidates, exactIdentifier);
  const candidateFiles = [...new Set(search.candidates.map((candidate) => candidate.file))];
  const files = candidateFiles;
  let unresolvedFileCount = 0;
  const groups = await mapLimit(files, DEFAULT.WORKSPACE_FILE_CONCURRENCY, async (file) => {
    try {
      const context = await clientForFile(file, root);
      const raw = await context.client.textRequest("textDocument/documentSymbol", context.file);
      return flattenDocumentSymbols(raw || [], context.file).filter((symbol) => symbol.name.toLowerCase().includes(query.toLowerCase()));
    } catch {
      unresolvedFileCount++;
      return [];
    }
  });
  return {
    symbols: groups.flat(),
    candidates: exactIdentifier ? search.candidates : undefined,
    candidateCount: search.candidates.length,
    totalTextualCandidateCount: search.totalCandidateCount,
    candidateScanTruncated: search.truncated,
    unresolvedFileCount,
  };
}

function hoverText(contents) {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join("\n\n");
  if (isObject(contents) && typeof contents.value === "string") return contents.value;
  return contents ? JSON.stringify(contents) : "";
}

function flattenDocumentSymbols(symbols, file, parent = [], output = [], depth = 0) {
  if (depth > MAX_SYMBOL_NESTING_DEPTH) return output;
  for (const symbol of symbols || []) {
    if (symbol.location) {
      const normalized = normalizeLocation(symbol.location);
      if (!normalized) continue;
      output.push({name: symbol.name, kind: symbolKinds[symbol.kind - 1] || symbol.kind, container: symbol.containerName, ...normalized});
    } else {
      output.push({
        name: symbol.name,
        kind: symbolKinds[symbol.kind - 1] || symbol.kind,
        container: parent.join("."),
        file,
        range: displayRange(symbol.selectionRange || symbol.range),
      });
      flattenDocumentSymbols(symbol.children, file, [...parent, symbol.name], output, depth + 1);
    }
  }
  return output;
}

function vueDiagnosticBlock(block, region, defaultLanguage) {
  if (!block) return undefined;
  const declaredLanguage = block.lang || defaultLanguage;
  return {
    startOffset: block.loc.start.offset,
    endOffset: block.loc.end.offset,
    region,
    language: vueEmbeddedLanguages[declaredLanguage] || DIAGNOSTIC_LANGUAGE.UNKNOWN,
  };
}

function diagnosticLineOffsets(text) {
  const offsets = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function strictDiagnosticOffset(text, lineOffsets, position) {
  const lineStart = lineOffsets[position.line];
  if (lineStart === undefined || position.character < 0) return undefined;
  const nextLineStart = lineOffsets[position.line + 1];
  let lineEnd = nextLineStart === undefined ? text.length : nextLineStart - 1;
  if (text[lineEnd - 1] === "\r") lineEnd--;
  const offset = lineStart + position.character;
  return offset <= lineEnd ? offset : undefined;
}

function diagnosticRangeOffsets(text, lineOffsets, range) {
  if (!range?.start || !range?.end) return undefined;
  const start = strictDiagnosticOffset(text, lineOffsets, range.start);
  const end = strictDiagnosticOffset(text, lineOffsets, range.end);
  if (start === undefined || end === undefined || end < start) return undefined;
  return {start, end};
}

async function diagnosticProvenance(file, providerKind, text, diagnostics) {
  const documentLanguage = languageId(file);
  const provider = diagnosticProviders[providerKind] || DIAGNOSTIC_PROVIDER.UNKNOWN;
  if (documentLanguage !== LANGUAGE_ID.VUE) {
    return {
      provider,
      documentLanguage,
      locate: () => ({embeddedRegion: DIAGNOSTIC_REGION.DOCUMENT, embeddedLanguage: documentLanguage}),
    };
  }

  const unknown = () => ({embeddedRegion: DIAGNOSTIC_REGION.UNKNOWN, embeddedLanguage: DIAGNOSTIC_LANGUAGE.UNKNOWN});
  if (diagnostics.length === 0) return {provider, documentLanguage, locate: unknown};
  const {parseVueSfc} = await vueParsingDependencies();
  const {descriptor, errors} = parseVueSfc(text, {filename: file});
  if (errors.length > 0) return {provider, documentLanguage, locate: unknown};

  const blocks = [
    vueDiagnosticBlock(descriptor.script, DIAGNOSTIC_REGION.SCRIPT, VUE_SCRIPT_LANGUAGE.JAVASCRIPT),
    vueDiagnosticBlock(descriptor.scriptSetup, DIAGNOSTIC_REGION.SCRIPT_SETUP, VUE_SCRIPT_LANGUAGE.JAVASCRIPT),
    vueDiagnosticBlock(descriptor.template, DIAGNOSTIC_REGION.TEMPLATE, DIAGNOSTIC_LANGUAGE.HTML),
    ...descriptor.styles.map((block) => vueDiagnosticBlock(block, DIAGNOSTIC_REGION.STYLE, DIAGNOSTIC_LANGUAGE.CSS)),
    ...descriptor.customBlocks.map((block) => vueDiagnosticBlock(block, DIAGNOSTIC_REGION.CUSTOM_BLOCK)),
  ].filter(Boolean);
  const lineOffsets = diagnosticLineOffsets(text);

  return {
    provider,
    documentLanguage,
    locate: (range) => {
      const offsets = diagnosticRangeOffsets(text, lineOffsets, range);
      if (!offsets) return unknown();
      const block = blocks.find(({startOffset, endOffset}) => offsets.start >= startOffset && offsets.end <= endOffset);
      if (!block) return unknown();
      return {embeddedRegion: block.region, embeddedLanguage: block.language};
    },
  };
}

function normalizeDiagnostics(raw, maxResults, provenance) {
  return limit(raw, maxResults).map((item) => ({
    severity: diagnosticSeverities[item.severity - 1] || DIAGNOSTIC_SEVERITY.NOT_REPORTED,
    code: item.code,
    source: item.source,
    message: item.message,
    range: displayRange(item.range),
    ...provenance.locate(item.range),
    relatedInformation: item.relatedInformation
      ?.map((related) => {
        const location = normalizeLocation(related.location);
        return location ? {message: related.message, ...location} : undefined;
      })
      .filter(Boolean),
  }));
}

async function auditSymbolAtPosition(file, root, line, column, options) {
  const context = await clientForFile(file, root);
  await context.client.syncDocument(context.file);
  const [definitionResult, hover, referenceSet, rawDiagnostics] = await Promise.all([
    definitionsAt(context.file, context.boundaryRoot, line, column),
    context.client.textRequest("textDocument/hover", context.file, {position: lspPosition(line, column)}),
    getReferenceSet(context, line, column, options.includeDeclaration, options.crossWorkspace ?? true, options.maxCandidates),
    options.includeDiagnostics ? context.client.diagnostics(context.file) : Promise.resolve([]),
  ]);
  const provenance = options.includeDiagnostics
    ? await diagnosticProvenance(
        context.file,
        rawDiagnostics.providerKind || context.client.kind,
        rawDiagnostics.documentText,
        rawDiagnostics.items,
      )
    : undefined;
  const diagnostics = options.includeDiagnostics ? normalizeDiagnostics(rawDiagnostics.items, options.maxDiagnostics, provenance) : [];
  let effectiveHover = hover;
  let signatureSource = hoverText(hover?.contents) ? SIGNATURE_SOURCE.QUERY_POSITION_HOVER : SIGNATURE_SOURCE.NOT_REPORTED;
  let signatureDefinition;
  if (signatureSource === SIGNATURE_SOURCE.NOT_REPORTED) {
    for (const definition of definitionResult.definitions) {
      try {
        const definitionContext = await clientForFile(definition.file, context.repositoryRoot);
        const definitionHover = await definitionContext.client.textRequest("textDocument/hover", definitionContext.file, {
          position: lspPosition(definition.range.start.line, definition.range.start.column),
        });
        if (!hoverText(definitionHover?.contents)) continue;
        effectiveHover = definitionHover;
        signatureSource = SIGNATURE_SOURCE.RESOLVED_DEFINITION_HOVER;
        signatureDefinition = definition;
        break;
      } catch {
        // Another resolved definition may still provide the signature.
      }
    }
  }
  const referenceAnalysis = referenceSet.analysis;
  return {
    workspaceRoot: context.workspaceRoot,
    repositoryRoot: context.repositoryRoot,
    identifier: referenceAnalysis.identifier,
    definition: {
      locations: definitionResult.definitions,
      via: definitionResult.via,
      attempts: definitionResult.attempts,
      failure: definitionResult.failure,
    },
    hover: {
      contents: hoverText(effectiveHover?.contents),
      range: effectiveHover?.range ? displayRange(effectiveHover.range) : undefined,
      source: signatureSource,
      definition: signatureDefinition,
    },
    references: referenceAnalysis.references,
    referenceSetId: referenceSet.id,
    referenceSetReused: referenceSet.reused,
    referenceSetContentFilesChecked: referenceSet.fileFingerprints.length,
    referenceSetFreshnessCheckedAt: referenceSet.freshnessCheckedAt,
    referenceSetFreshnessCheckMilliseconds: referenceSet.freshnessCheckMilliseconds,
    repositorySourceFilesChecked: referenceSet.repositorySourceInventory.sourceFileCount,
    collectionStabilityAttempts: referenceSet.collectionStabilityAttempts,
    referenceFiles: referenceAnalysis.referenceFiles,
    referenceSummary: {
      nativeReferenceCount: referenceAnalysis.nativeReferenceCount,
      verifiedCrossWorkspaceCount: referenceAnalysis.verifiedCrossWorkspaceCount,
      verifiedReferenceCount: referenceAnalysis.verifiedReferenceCount,
      scannedCandidateCount: referenceAnalysis.scannedCandidateCount,
      totalTextualCandidateCount: referenceAnalysis.totalTextualCandidateCount,
      semanticallyMatchedCandidateCount: referenceAnalysis.semanticallyMatchedCandidateCount,
      rejectedCandidateCount: referenceAnalysis.rejectedCandidateCount,
      rejectedCandidatesByReason: referenceAnalysis.rejectedCandidatesByReason,
      unresolvedCandidateCount: referenceAnalysis.unresolvedCandidateCount,
      unresolvedCandidates: referenceAnalysis.unresolvedCandidates,
      collectionTruncated: referenceAnalysis.collectionTruncated,
      performance: referenceAnalysis.performance,
    },
    diagnostics: options.includeDiagnostics
      ? {
          provenance: {provider: provenance.provider, documentLanguage: provenance.documentLanguage},
          items: diagnostics,
          totalCount: rawDiagnostics.items.length,
          itemsReturnedAreSubset: rawDiagnostics.items.length > diagnostics.length,
          documentVersion: rawDiagnostics.documentVersion,
          reportedDocumentVersion: rawDiagnostics.reportedDocumentVersion,
          freshness: rawDiagnostics.freshness,
        }
      : {included: false},
  };
}

function groupedReferenceFiles(references) {
  const groups = new Map();
  for (const reference of references) {
    const key = fileIdentity(reference.file);
    const current = groups.get(key) || {file: reference.file, count: 0, via: new Set()};
    current.count++;
    if (reference.via) current.via.add(reference.via);
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((group) => ({file: group.file, count: group.count, via: [...group.via].sort()}))
    .sort((left, right) => left.file.localeCompare(right.file));
}

function publicReferenceMethod(method) {
  if (method === INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP) return REFERENCE_DISCOVERY_METHOD.OWNING_WORKSPACE_LANGUAGE_SERVER;
  if (method === INTERNAL_RESOLUTION_SOURCE.CROSS_WORKSPACE_DEFINITION)
    return REFERENCE_DISCOVERY_METHOD.DEFINITION_MATCH_FROM_ANOTHER_WORKSPACE;
  return method;
}

function publicDefinitionMethod(method) {
  if (method === INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP) return DEFINITION_RESOLUTION_METHOD.LANGUAGE_SERVER;
  if (method === INTERNAL_RESOLUTION_SOURCE.TYPESCRIPT_SERVER_FALLBACK) return DEFINITION_RESOLUTION_METHOD.TYPESCRIPT_SERVER;
  if (method === INTERNAL_RESOLUTION_SOURCE.VUE_TEMPLATE_IMPORT_BINDING) return DEFINITION_RESOLUTION_METHOD.VUE_TEMPLATE_IMPORT_BINDING;
  return DEFINITION_RESOLUTION_METHOD.UNRESOLVED;
}

function referenceFacts(audit) {
  const summary = audit.referenceSummary;
  const classifiedTextMatches =
    summary.semanticallyMatchedCandidateCount + summary.rejectedCandidateCount + summary.unresolvedCandidateCount;
  const allTextMatchesAccountedFor =
    !summary.collectionTruncated &&
    summary.scannedCandidateCount === summary.totalTextualCandidateCount &&
    classifiedTextMatches === summary.scannedCandidateCount;
  return {
    references: {
      verifiedTotal: summary.verifiedReferenceCount,
      foundByOwningWorkspaceLanguageServer: summary.nativeReferenceCount,
      verifiedFromOtherWorkspaces: summary.verifiedCrossWorkspaceCount,
    },
    textSearch: {
      matchesFound: summary.totalTextualCandidateCount,
      matchesChecked: summary.scannedCandidateCount,
      matchesToRequestedSymbol: summary.semanticallyMatchedCandidateCount,
      matchesToDifferentSymbols: summary.rejectedCandidateCount,
      matchesWhoseDefinitionCouldNotBeResolved: summary.unresolvedCandidateCount,
      accountingStatus: allTextMatchesAccountedFor ? ACCOUNTING_STATUS.COMPLETE : ACCOUNTING_STATUS.INCOMPLETE,
    },
    unresolvedReferences: {
      candidatesAvailable: summary.unresolvedCandidates.length,
      pageWithTool: summary.unresolvedCandidates.length > 0 ? TOOL.UNRESOLVED_REFERENCE_PAGE : undefined,
    },
    collection: {
      status: collectionStatus({
        stoppedByLimit: summary.collectionTruncated,
        unresolvedCount: summary.unresolvedCandidateCount,
      }),
      stoppedByLimit: summary.collectionTruncated,
      reusedPreviousCollection: audit.referenceSetReused,
      expiresInSeconds: Math.ceil(REFERENCE_SET_TTL_MS / DEFAULT.MILLISECONDS_PER_SECOND),
      contentFreshness: CONTENT_FRESHNESS.VERIFIED_CURRENT,
      contentFilesChecked: audit.referenceSetContentFilesChecked,
      contentCheckedAt: new Date(audit.referenceSetFreshnessCheckedAt).toISOString(),
      repositoryInventoryFreshness: CONTENT_FRESHNESS.VERIFIED_REPOSITORY_SOURCE_INVENTORY,
      repositorySourceFilesChecked: audit.repositorySourceFilesChecked,
      freshnessCheckMilliseconds: audit.referenceSetFreshnessCheckMilliseconds,
      collectionStabilityAttempts: audit.collectionStabilityAttempts,
      performance: summary.performance,
    },
    referenceFiles: audit.referenceFiles.map((group) => ({
      file: group.file,
      references: group.count,
      discoveryMethods: group.via.map(publicReferenceMethod),
    })),
  };
}

function factsForReferenceSet(entry, reused = true) {
  const analysis = entry.analysis;
  return referenceFacts({
    referenceSummary: {
      nativeReferenceCount: analysis.nativeReferenceCount,
      verifiedCrossWorkspaceCount: analysis.verifiedCrossWorkspaceCount,
      verifiedReferenceCount: analysis.verifiedReferenceCount,
      scannedCandidateCount: analysis.scannedCandidateCount,
      totalTextualCandidateCount: analysis.totalTextualCandidateCount,
      semanticallyMatchedCandidateCount: analysis.semanticallyMatchedCandidateCount,
      rejectedCandidateCount: analysis.rejectedCandidateCount,
      unresolvedCandidateCount: analysis.unresolvedCandidateCount,
      unresolvedCandidates: analysis.unresolvedCandidates,
      collectionTruncated: analysis.collectionTruncated,
      performance: analysis.performance,
    },
    referenceFiles: analysis.referenceFiles,
    referenceSetId: entry.id,
    referenceSetReused: reused,
    referenceSetContentFilesChecked: entry.fileFingerprints.length,
    referenceSetFreshnessCheckedAt: entry.freshnessCheckedAt,
    referenceSetFreshnessCheckMilliseconds: entry.freshnessCheckMilliseconds,
    repositorySourceFilesChecked: entry.repositorySourceInventory.sourceFileCount,
    collectionStabilityAttempts: entry.collectionStabilityAttempts,
  });
}

function publicDefinition(definition) {
  return {
    match: definition.locations.length > 0 ? DEFINITION_MATCH.RESOLVED : DEFINITION_MATCH.UNRESOLVED,
    locations: definition.locations,
    method: publicDefinitionMethod(definition.via),
    attemptedMethods: definition.attempts?.map(publicDefinitionMethod),
    failure: definition.failure,
  };
}

function publicSymbol(symbol) {
  if (!symbol) return undefined;
  return {
    name: symbol.name,
    kind: symbol.kind,
    container: symbol.container,
    file: symbol.file,
    range: symbol.range,
  };
}

function auditSummary(audit, symbol, includeSignature = true) {
  const facts = referenceFacts(audit);
  return {
    symbol: publicSymbol(symbol),
    identifier: audit.identifier,
    definition: publicDefinition(audit.definition),
    signature: includeSignature ? audit.hover.contents : undefined,
    signatureSource: includeSignature ? audit.hover.source : undefined,
    signatureDefinition: includeSignature ? audit.hover.definition : undefined,
    references: facts.references,
    textSearch: facts.textSearch,
    unresolvedReferences: facts.unresolvedReferences,
    filesContainingReferences: facts.referenceFiles.length,
    referenceSetId: audit.referenceSetId,
    collection: compactReferenceCollection(facts.collection),
  };
}

function compactReferenceCollection(collection) {
  return {
    status: collection.status,
    stoppedByLimit: collection.stoppedByLimit,
    reusedPreviousCollection: collection.reusedPreviousCollection,
    contentFreshness: collection.contentFreshness,
    repositoryInventoryFreshness: collection.repositoryInventoryFreshness,
  };
}

function countSummary(audit, symbol) {
  const facts = referenceFacts(audit);
  return {
    symbol: publicSymbol(symbol),
    identifier: audit.identifier,
    definitionMatch: audit.definition.locations.length > 0 ? DEFINITION_MATCH.RESOLVED : DEFINITION_MATCH.UNRESOLVED,
    references: facts.references,
    textSearch: facts.textSearch,
    unresolvedReferences: facts.unresolvedReferences,
    filesContainingReferences: facts.referenceFiles.length,
    referenceSetId: audit.referenceSetId,
    collection: compactReferenceCollection(facts.collection),
  };
}

function definitionSelectionStatus(definitions) {
  if (definitions.length === 0) return DEFINITION_SELECTION_STATUS.NONE;
  if (definitions.length === 1) return DEFINITION_SELECTION_STATUS.ONE;
  return DEFINITION_SELECTION_STATUS.MULTIPLE;
}

function sourceRange(candidate, identifier) {
  return {
    start: {line: candidate.line, column: candidate.column},
    end: {line: candidate.line, column: candidate.column + identifier.length},
  };
}

async function resolveFileHintBindings(discovery, root, identifier, normalizedHint) {
  const results = await mapLimit(discovery.candidates, CROSS_WORKSPACE_CONCURRENCY, async (candidate) => {
    try {
      const resolved = await definitionsAt(candidate.file, root, candidate.line, candidate.column);
      if (resolved.definitions.length === 0) return {definitionUnresolved: true};
      const matchingDefinitions = resolved.definitions.filter((definition) =>
        definition.file.replaceAll("\\", "/").toLowerCase().includes(normalizedHint),
      );
      if (matchingDefinitions.length === 0) return {definitionResolvedElsewhere: true};
      return {
        sourcePosition: {file: candidate.file, range: sourceRange(candidate, identifier)},
        definitions: matchingDefinitions,
        resolutionMethod: publicDefinitionMethod(resolved.via),
      };
    } catch {
      return {definitionUnresolved: true};
    }
  });
  const matching = results.filter((result) => result.sourcePosition);
  const unresolvedCount = results.filter((result) => result.definitionUnresolved).length;
  const resolvedElsewhereCount = results.filter((result) => result.definitionResolvedElsewhere).length;
  const classifiedCount = matching.length + resolvedElsewhereCount + unresolvedCount;
  const [sourcePositionForAudit] = matching;
  return {
    textMatchesFound: discovery.totalTextualCandidateCount,
    textMatchesChecked: discovery.candidateCount,
    textMatchesResolvingToFileFilter: matching.length,
    textMatchesResolvingElsewhere: resolvedElsewhereCount,
    textMatchesWhoseDefinitionCouldNotBeResolved: unresolvedCount,
    accountingStatus:
      !discovery.candidateScanTruncated && classifiedCount === discovery.totalTextualCandidateCount
        ? ACCOUNTING_STATUS.COMPLETE
        : ACCOUNTING_STATUS.INCOMPLETE,
    sourcePositionForAudit: sourcePositionForAudit
      ? {
          ...sourcePositionForAudit.sourcePosition,
          definitions: sourcePositionForAudit.definitions,
          resolutionMethod: sourcePositionForAudit.resolutionMethod,
        }
      : undefined,
  };
}

function namedSymbolContinuations(operation, includeNamedAudit, hasFileHint) {
  const continuations = [];
  const selectionStatus = definitionSelectionStatus(operation.matchingDefinitions);
  const hasSelectedDefinitions = selectionStatus !== DEFINITION_SELECTION_STATUS.NONE;
  const hasOneSelectedDefinition = selectionStatus === DEFINITION_SELECTION_STATUS.ONE;
  const hasVerifiedFileHintBinding = Boolean(operation.fileHintResolution?.sourcePositionForAudit);
  const hasUnresolvedReferences = operation.audits.some((audit) => audit.referenceSummary.unresolvedCandidateCount > 0);

  if (selectionStatus === DEFINITION_SELECTION_STATUS.MULTIPLE) continuations.push(TOOL.AUDIT_SYMBOL);
  if (includeNamedAudit && (hasSelectedDefinitions || hasFileHint)) continuations.push(TOOL.AUDIT_NAMED_SYMBOL);
  if (includeNamedAudit && !hasSelectedDefinitions && hasFileHint) return continuations;
  if (!hasSelectedDefinitions && !hasVerifiedFileHintBinding) {
    continuations.push(hasFileHint ? TOOL.DOCUMENT_SYMBOLS : TOOL.WORKSPACE_SYMBOLS);
  }
  if (!hasOneSelectedDefinition && !continuations.includes(TOOL.AUDIT_SYMBOL)) continuations.push(TOOL.AUDIT_SYMBOL);
  if (hasUnresolvedReferences) continuations.push(TOOL.UNRESOLVED_REFERENCE_PAGE);
  if (operation.audits.length > 0) continuations.push(TOOL.REFERENCE_PAGE);
  return continuations;
}

async function collectNamedSymbolAudits(
  {root, symbol, fileHint, maxDefinitions, includeDeclaration, maxCandidates},
  {includeFileHintResolution = false} = {},
) {
  const resolvedRoot = await existingDirectory(root);
  const discovery = await semanticWorkspaceSymbols(resolvedRoot, symbol, maxCandidates, {exactIdentifier: true});
  const exactDefinitions = dedupeLocations(discovery.symbols.filter((candidate) => candidate.name === symbol));
  const normalizedHint = fileHint?.replaceAll("\\", "/").toLowerCase();
  const matchingDefinitions = normalizedHint
    ? exactDefinitions.filter((candidate) => candidate.file.replaceAll("\\", "/").toLowerCase().includes(normalizedHint))
    : exactDefinitions;
  const selectedDefinitions = maxDefinitions === undefined ? matchingDefinitions : matchingDefinitions.slice(0, maxDefinitions);
  const audits = await mapLimit(selectedDefinitions, DEFAULT.NAMED_DEFINITION_CONCURRENCY, (definition) =>
    auditSymbolAtPosition(definition.file, resolvedRoot, definition.range.start.line, definition.range.start.column, {
      includeDeclaration,
      maxCandidates,
      includeDiagnostics: false,
      maxDiagnostics: undefined,
    }),
  );
  const fileHintResolution =
    includeFileHintResolution && normalizedHint && matchingDefinitions.length === 0
      ? await resolveFileHintBindings(discovery, resolvedRoot, symbol, normalizedHint)
      : undefined;
  const stoppedByDefinitionLimit = selectedDefinitions.length < matchingDefinitions.length;
  const stoppedByCandidateLimit = discovery.candidateScanTruncated || audits.some((audit) => audit.referenceSummary.collectionTruncated);
  const unresolvedCount =
    discovery.unresolvedFileCount +
    audits.reduce((total, audit) => total + audit.referenceSummary.unresolvedCandidateCount, 0) +
    (fileHintResolution?.textMatchesWhoseDefinitionCouldNotBeResolved || 0);
  return {
    resolvedRoot,
    discovery,
    exactDefinitions,
    matchingDefinitions,
    selectedDefinitions,
    audits,
    fileHintResolution,
    collection: {
      status: collectionStatus({stoppedByLimit: stoppedByDefinitionLimit || stoppedByCandidateLimit, unresolvedCount}),
      stoppedByLimit: stoppedByDefinitionLimit || stoppedByCandidateLimit,
      symbolDefinitionsFound: exactDefinitions.length,
      definitionsMatchingFileFilter: matchingDefinitions.length,
      definitionsAnalyzed: audits.length,
      sourceFilesWhoseSymbolsCouldNotBeRead: discovery.unresolvedFileCount,
    },
  };
}

function toolResult(tool, body) {
  const data = JSON.parse(
    JSON.stringify({
      producer: {name: PRODUCT.NAME, version: SERVER_VERSION, resultSchemaVersion: RESULT_SCHEMA.VERSION},
      tool,
      ...body,
    }),
  );
  validatePublicResult(data);
  return {
    _meta: {resultSchema: RESULT_SCHEMA.NAME, resultSchemaVersion: RESULT_SCHEMA.VERSION},
    content: [{type: "text", text: stringifyYaml(data, {lineWidth: 0})}],
    structuredContent: data,
  };
}

function validatePublicResult(data) {
  const hasError = isObject(data.error);
  if (
    data.producer?.name !== PRODUCT.NAME ||
    data.producer?.version !== SERVER_VERSION ||
    data.producer?.resultSchemaVersion !== RESULT_SCHEMA.VERSION
  ) {
    throw new Error(`Tool result omitted the ${PRODUCT.NAME} producer identity`);
  }
  if (!PUBLIC_TOOL_NAMES.has(data.tool)) throw new Error(`Unknown public tool name: ${data.tool}`);
  if (!isObject(data.request) || !isObject(data.result)) {
    throw new Error(`${data.tool} must return request and result objects`);
  }
  if (!isObject(data.collection) || !isObject(data.presentation) || !Array.isArray(data.continueWith)) {
    throw new Error(`${data.tool} must return collection, presentation, and continueWith fields`);
  }
  if (!COLLECTION_STATUSES.has(data.collection.status)) {
    throw new Error(`${data.tool} returned an invalid collection status`);
  }
  if (!PRESENTATION_MODES.has(data.presentation.mode)) {
    throw new Error(`${data.tool} returned an invalid presentation mode`);
  }
  if (data.error !== undefined && !hasError) {
    throw new Error(`${data.tool} returned an invalid error object`);
  }
  if (isNamedSymbolTool(data.tool) && !hasError && !namedSemanticEvidenceMatches(data.result, data.collection.status)) {
    throw new Error(`${data.tool} returned semantic evidence that conflicts with collection or definition selection`);
  }
  for (const continuation of data.continueWith || []) {
    if (!PUBLIC_TOOL_NAMES.has(continuation)) {
      throw new Error(`${data.tool} returned an unknown continuation tool: ${continuation}`);
    }
  }

  const visit = (value, pathParts = []) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }
    if (!isObject(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (AMBIGUOUS_PUBLIC_KEYS.has(key)) {
        throw new Error(`${data.tool} returned ambiguous public field ${[...pathParts, key].join(".")}`);
      }
      visit(item, [...pathParts, key]);
    }
    if (isObject(value.textSearch)) {
      const search = value.textSearch;
      const accountedFor =
        search.matchesToRequestedSymbol + search.matchesToDifferentSymbols + search.matchesWhoseDefinitionCouldNotBeResolved;
      if (accountedFor !== search.matchesChecked) {
        throw new Error(`${data.tool} returned inconsistent text-match accounting`);
      }
      const expected = search.matchesChecked === search.matchesFound ? ACCOUNTING_STATUS.COMPLETE : ACCOUNTING_STATUS.INCOMPLETE;
      if (search.accountingStatus !== expected) {
        throw new Error(`${data.tool} returned an inconsistent text-search accounting status`);
      }
    }
  };
  visit(data);
}

function toolError(tool, error) {
  const message = error instanceof Error ? error.message : String(error);
  const preparationAvailable =
    (error?.code === ERROR_CODE.PATH_OUTSIDE_WORKSPACE_BOUNDARY && CODEX_SESSION_ROOT_AUTHORIZATION_ENABLED) ||
    ROOT_PREPARATION_ERROR_CODES.has(error?.code);
  const continueWith = preparationAvailable ? [TOOL.PREPARE_WORKSPACE_ROOT] : [];
  const data = {
    producer: {name: PRODUCT.NAME, version: SERVER_VERSION, resultSchemaVersion: RESULT_SCHEMA.VERSION},
    tool,
    request: {},
    result: {},
    collection: {status: COLLECTION_STATUS.FAILED, stoppedByLimit: false},
    presentation: {mode: PRESENTATION_MODE.ALL_ITEMS, itemsAvailable: 0, itemsReturned: 0, itemsReturnedAreSubset: false},
    continueWith,
    error: {
      code: typeof error?.code === "string" ? error.code : ERROR_CODE.TOOL_EXECUTION_FAILED,
      message,
      details: isObject(error?.details) ? error.details : undefined,
    },
  };
  validatePublicResult(data);
  return {
    isError: true,
    _meta: {resultSchema: RESULT_SCHEMA.NAME, resultSchemaVersion: RESULT_SCHEMA.VERSION},
    content: [{type: "text", text: stringifyYaml(data, {lineWidth: 0})}],
    structuredContent: data,
  };
}

const fileSchema = {
  file: z.string().describe("Absolute path to a TypeScript, JavaScript, TSX, JSX, or Vue file"),
  root: z.string().optional().describe("Optional absolute workspace or repository root"),
};
const positionSchema = {
  ...fileSchema,
  line: z.number().int().min(1).describe("1-based line number"),
  column: z.number().int().min(1).describe("1-based UTF-16 column number"),
};
const readOnly = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const rootPreparation = {readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false};
const rootAuthorization = {readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false};

try {
  verifyBundledRuntime();
  baseWorkspaceRoots = await resolveWorkspaceBoundaryRoots();
  applyWorkspaceBoundaryRoots();
  providerTemporaryDirectory = await realpath(await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-provider-")));
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      error: {
        code: error?.code || ERROR_CODE.RUNTIME_DEPENDENCY_MISSING,
        message: error instanceof Error ? error.message : String(error),
        details: error?.details,
      },
    })}\n`,
  );
  process.exit(PROCESS_EXIT_CODE.FAILURE);
}

const server = new McpServer({name: PRODUCT.NAME, version: SERVER_VERSION});

server.registerTool(
  TOOL.PREPARE_WORKSPACE_ROOT,
  {
    description: TOOL_DESCRIPTION[TOOL.PREPARE_WORKSPACE_ROOT],
    inputSchema: {
      root: z.string().describe("Absolute directory selected by the human; use the current Codex project unless they choose another"),
    },
    annotations: rootPreparation,
  },
  async ({root}) => {
    const tool = TOOL.PREPARE_WORKSPACE_ROOT;
    try {
      const prepared = await prepareSessionWorkspaceRoot(root);
      return toolResult(tool, {
        request: {root},
        result: prepared,
        collection: {status: COLLECTION_STATUS.COMPLETE, stoppedByLimit: false},
        presentation: {
          mode: PRESENTATION_MODE.ALL_ITEMS,
          itemsAvailable: 1,
          itemsReturned: 1,
          itemsReturnedAreSubset: false,
        },
        continueWith: [prepared.authorizationRequired ? TOOL.AUTHORIZE_WORKSPACE_ROOT : TOOL.DOCUMENT_SYMBOLS],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.AUTHORIZE_WORKSPACE_ROOT,
  {
    description: TOOL_DESCRIPTION[TOOL.AUTHORIZE_WORKSPACE_ROOT],
    inputSchema: {
      authorizationRequestId: z.string().describe(`One-time identifier returned by ${TOOL.PREPARE_WORKSPACE_ROOT}`),
      root: z.string().describe(`Exact canonicalRoot returned by ${TOOL.PREPARE_WORKSPACE_ROOT}`),
    },
    annotations: rootAuthorization,
  },
  async ({authorizationRequestId, root}) => {
    const tool = TOOL.AUTHORIZE_WORKSPACE_ROOT;
    try {
      const authorization = await authorizeSessionWorkspaceRoot(authorizationRequestId, root);
      return toolResult(tool, {
        request: {root},
        result: authorization,
        collection: {status: COLLECTION_STATUS.COMPLETE, stoppedByLimit: false},
        presentation: {
          mode: PRESENTATION_MODE.ALL_ITEMS,
          itemsAvailable: 1,
          itemsReturned: 1,
          itemsReturnedAreSubset: false,
        },
        continueWith: [TOOL.DOCUMENT_SYMBOLS],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.DOCUMENT_SYMBOLS,
  {
    description: TOOL_DESCRIPTION[TOOL.DOCUMENT_SYMBOLS],
    inputSchema: {
      ...fileSchema,
      maxResults: z.number().int().min(1).optional().describe("Optional number of symbols to return; omit to return all collected symbols"),
    },
    annotations: readOnly,
  },
  async ({file, root, maxResults}) => {
    const tool = TOOL.DOCUMENT_SYMBOLS;
    try {
      const context = await clientForFile(file, root);
      const raw = await context.client.textRequest("textDocument/documentSymbol", context.file);
      const all = flattenDocumentSymbols(raw || [], context.file);
      const symbols = limit(all, maxResults);
      return toolResult(tool, {
        request: {file: context.file, searchScope: SEARCH_SCOPE.DOCUMENT, resultLimit: normalizedLimit(maxResults)},
        result: {symbols, symbolsFound: all.length},
        collection: {status: COLLECTION_STATUS.COMPLETE, stoppedByLimit: false},
        presentation: {
          mode: symbols.length === all.length ? PRESENTATION_MODE.ALL_ITEMS : PRESENTATION_MODE.SUBSET,
          itemsAvailable: all.length,
          itemsReturned: symbols.length,
          itemsReturnedAreSubset: symbols.length < all.length,
        },
        continueWith: [TOOL.DEFINITION, TOOL.AUDIT_SYMBOL],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.WORKSPACE_SYMBOLS,
  {
    description: TOOL_DESCRIPTION[TOOL.WORKSPACE_SYMBOLS],
    inputSchema: {
      root: z.string().describe("Absolute workspace or repository root"),
      query: z.string().min(1).describe("Exact or partial symbol name"),
      maxResults: z.number().int().min(1).optional().describe("Optional number of symbols to return; omit to return all collected symbols"),
      maxCandidates: z.number().int().min(1).optional().describe("Optional number of text matches to inspect; omit to inspect all matches"),
    },
    annotations: readOnly,
  },
  async ({root, query, maxResults, maxCandidates}) => {
    const tool = TOOL.WORKSPACE_SYMBOLS;
    try {
      const resolvedRoot = await existingDirectory(root);
      const semantic = await semanticWorkspaceSymbols(resolvedRoot, query, maxCandidates);
      const all = dedupeLocations(semantic.symbols);
      const symbols = limit(all, maxResults);
      const stoppedByLimit = semantic.candidateScanTruncated;
      return toolResult(tool, {
        request: {
          root: resolvedRoot,
          query,
          searchScope: "repository",
          candidateLimit: normalizedLimit(maxCandidates),
          resultLimit: normalizedLimit(maxResults),
        },
        result: {
          symbols,
          symbolsFound: all.length,
          textMatchesFound: semantic.totalTextualCandidateCount,
          textMatchesChecked: semantic.candidateCount,
          sourceFilesWhoseSymbolsCouldNotBeRead: semantic.unresolvedFileCount,
        },
        collection: {status: collectionStatus({stoppedByLimit, unresolvedCount: semantic.unresolvedFileCount}), stoppedByLimit},
        presentation: {
          mode: symbols.length === all.length ? PRESENTATION_MODE.ALL_ITEMS : PRESENTATION_MODE.SUBSET,
          itemsAvailable: all.length,
          itemsReturned: symbols.length,
          itemsReturnedAreSubset: symbols.length < all.length,
        },
        continueWith: [TOOL.COUNT_NAMED_SYMBOL, TOOL.AUDIT_NAMED_SYMBOL],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.DEFINITION,
  {
    description: TOOL_DESCRIPTION[TOOL.DEFINITION],
    inputSchema: {
      ...positionSchema,
      maxResults: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Optional number of definitions to return; omit to return all resolved definitions"),
    },
    annotations: readOnly,
  },
  async ({file, root, line, column, maxResults}) => {
    const tool = TOOL.DEFINITION;
    try {
      const resolved = await definitionsAt(file, root, line, column);
      const definitions = limit(resolved.definitions, maxResults);
      return toolResult(tool, {
        request: {file: resolved.context.file, line, column, searchScope: "source-position", resultLimit: normalizedLimit(maxResults)},
        result: {
          definitionMatch: resolved.definitions.length > 0 ? DEFINITION_MATCH.RESOLVED : DEFINITION_MATCH.UNRESOLVED,
          definitions,
          definitionsFound: resolved.definitions.length,
          resolutionMethod: publicDefinitionMethod(resolved.via),
          attemptedMethods: resolved.attempts?.map(publicDefinitionMethod),
          failure: resolved.failure,
        },
        collection: {
          status: resolved.definitions.length > 0 ? COLLECTION_STATUS.COMPLETE : COLLECTION_STATUS.PARTIAL,
          stoppedByLimit: false,
        },
        presentation: {
          mode: definitions.length === resolved.definitions.length ? PRESENTATION_MODE.ALL_ITEMS : PRESENTATION_MODE.SUBSET,
          itemsAvailable: resolved.definitions.length,
          itemsReturned: definitions.length,
          itemsReturnedAreSubset: definitions.length < resolved.definitions.length,
        },
        continueWith: [TOOL.HOVER, TOOL.COUNT_REFERENCES],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.HOVER,
  {
    description: TOOL_DESCRIPTION[TOOL.HOVER],
    inputSchema: positionSchema,
    annotations: readOnly,
  },
  async ({file, root, line, column}) => {
    const tool = TOOL.HOVER;
    try {
      const context = await clientForFile(file, root);
      const hover = await context.client.textRequest("textDocument/hover", context.file, {position: lspPosition(line, column)});
      return toolResult(tool, {
        request: {file: context.file, line, column, searchScope: "source-position"},
        result: {
          typeAndDocumentation: hoverText(hover?.contents),
          range: hover?.range ? displayRange(hover.range) : undefined,
          informationFound: !!hover?.contents,
        },
        collection: {status: hover?.contents ? COLLECTION_STATUS.COMPLETE : COLLECTION_STATUS.PARTIAL, stoppedByLimit: false},
        presentation: {
          mode: PRESENTATION_MODE.ALL_ITEMS,
          itemsAvailable: hover?.contents ? 1 : 0,
          itemsReturned: hover?.contents ? 1 : 0,
          itemsReturnedAreSubset: false,
        },
        continueWith: [TOOL.DEFINITION, TOOL.AUDIT_SYMBOL],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.DIAGNOSTICS,
  {
    description: TOOL_DESCRIPTION[TOOL.DIAGNOSTICS],
    inputSchema: {
      ...fileSchema,
      maxResults: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Optional number of diagnostics to return; omit to return all reported diagnostics"),
    },
    annotations: readOnly,
  },
  async ({file, root, maxResults}) => {
    const tool = TOOL.DIAGNOSTICS;
    try {
      const context = await clientForFile(file, root);
      const report = await context.client.diagnostics(context.file);
      const provenance = await diagnosticProvenance(
        context.file,
        report.providerKind || context.client.kind,
        report.documentText,
        report.items,
      );
      const diagnostics = normalizeDiagnostics(report.items, maxResults, provenance);
      const versionConfirmed = report.freshness === DIAGNOSTIC_FRESHNESS.CURRENT;
      const diagnosticReport = {
        items: diagnostics,
        itemsReported: report.items.length,
        itemsReturnedAreSubset: diagnostics.length < report.items.length,
      };
      return toolResult(tool, {
        request: {file: context.file, searchScope: SEARCH_SCOPE.DOCUMENT, resultLimit: normalizedLimit(maxResults)},
        result: {
          [DIAGNOSTIC_RESULT_FIELD.DIAGNOSTIC_USE]: diagnosticUseSummary({versionConfirmed, reportReceived: report.reportReceived}),
          provenance: {provider: provenance.provider, documentLanguage: provenance.documentLanguage},
          evidence: {
            status: versionConfirmed ? EVIDENCE_STATUS.VERIFIED : EVIDENCE_STATUS.UNTRUSTED,
            reason: diagnosticEvidenceReason(report.freshness, report.snapshotConfirmed),
          },
          document: {
            version: report.documentVersion,
            contentFingerprint: publicContentFingerprint(report.documentContentFingerprint),
          },
          [DIAGNOSTIC_RESULT_FIELD.DIAGNOSTICS_FOR_CURRENT_DOCUMENT]: versionConfirmed ? diagnosticReport : null,
          [DIAGNOSTIC_RESULT_FIELD.UNCONFIRMED_DIAGNOSTIC_REPORT]: versionConfirmed
            ? undefined
            : {
                [DIAGNOSTIC_RESULT_FIELD.REPORT_RECEIVED]: report.reportReceived,
                ...diagnosticReport,
                languageServerReportedDocumentVersion: report.reportedDocumentVersion,
                freshness: report.freshness,
              },
          waitedMilliseconds: report.waitedMilliseconds,
        },
        collection: {
          status: versionConfirmed ? COLLECTION_STATUS.COMPLETE : COLLECTION_STATUS.PARTIAL,
          stoppedByLimit: false,
          currentDocumentVersionConfirmed: versionConfirmed,
        },
        presentation: {
          mode: diagnostics.length === report.items.length ? PRESENTATION_MODE.ALL_ITEMS : PRESENTATION_MODE.SUBSET,
          itemsAvailable: report.items.length,
          itemsReturned: diagnostics.length,
          itemsReturnedAreSubset: diagnostics.length < report.items.length,
        },
        continueWith: [TOOL.DEFINITION, TOOL.HOVER],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.CALL_HIERARCHY,
  {
    description: TOOL_DESCRIPTION[TOOL.CALL_HIERARCHY],
    inputSchema: {
      ...positionSchema,
      direction: z.enum(Object.values(CALL_HIERARCHY_DIRECTION)).default(CALL_HIERARCHY_DIRECTION.BOTH),
      maxDepth: z
        .number()
        .int()
        .min(1)
        .max(DEFAULT.CALL_HIERARCHY_MAXIMUM_DEPTH)
        .default(1)
        .describe(`Maximum static traversal depth; at most ${DEFAULT.CALL_HIERARCHY_MAXIMUM_DEPTH}`),
      pageSize: z.number().int().min(1).optional().describe(`Number of edges to return; default ${DEFAULT.REFERENCE_PAGE_SIZE}`),
    },
    annotations: readOnly,
  },
  async ({file, root, line, column, direction, maxDepth, pageSize}) => {
    const tool = TOOL.CALL_HIERARCHY;
    try {
      const context = await clientForFile(file, root);
      const entry = await getCallHierarchySet(context, line, column, direction, maxDepth);
      const page = presentCallHierarchySet(entry, 0, pageSize || DEFAULT.REFERENCE_PAGE_SIZE);
      return toolResult(tool, {
        request: {
          file: context.file,
          line,
          column,
          searchScope: "static-call-graph",
          direction,
          maxDepth,
          pageSize: pageSize || DEFAULT.REFERENCE_PAGE_SIZE,
        },
        result: {
          callHierarchySetId: entry.id,
          evidenceType: CALL_HIERARCHY_EVIDENCE.STATIC_PROVIDER_GRAPH,
          runtimeReachability: CALL_HIERARCHY_EVIDENCE.RUNTIME_REACHABILITY_NOT_ESTABLISHED,
          nodesFound: entry.analysis.nodes.length,
          edgesFound: entry.analysis.edges.length,
          cyclesDetected: entry.analysis.cyclesDetected,
          unresolvedNodes: entry.analysis.unresolved,
          edges: page.edges,
        },
        collection: {
          status: entry.analysis.unresolved.length > 0 ? COLLECTION_STATUS.PARTIAL : COLLECTION_STATUS.COMPLETE,
          stoppedByLimit: false,
          depthLimit: maxDepth,
          reusedPreviousCollection: entry.reused,
          contentFreshness: CONTENT_FRESHNESS.VERIFIED_CURRENT,
          contentFilesChecked: entry.fileFingerprints.length,
          repositoryInventoryFreshness: CONTENT_FRESHNESS.VERIFIED_REPOSITORY_SOURCE_INVENTORY,
          repositorySourceFilesChecked: entry.repositorySourceInventory.sourceFileCount,
        },
        presentation: page.presentation,
        continueWith: page.presentation.nextCursor ? [TOOL.CALL_HIERARCHY_PAGE, TOOL.DEFINITION] : [TOOL.DEFINITION],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.CALL_HIERARCHY_PAGE,
  {
    description: TOOL_DESCRIPTION[TOOL.CALL_HIERARCHY_PAGE],
    inputSchema: {
      callHierarchySetId: z.string().min(1).describe(`Identifier returned by ${TOOL.CALL_HIERARCHY}`),
      cursor: z.string().regex(/^\d+$/).default("0").describe("Cursor returned by the previous call-hierarchy page"),
      pageSize: z.number().int().min(1).optional().describe(`Number of edges to return; default ${DEFAULT.REFERENCE_PAGE_SIZE}`),
    },
    annotations: readOnly,
  },
  async ({callHierarchySetId, cursor, pageSize}) => {
    const tool = TOOL.CALL_HIERARCHY_PAGE;
    try {
      const entry = await getCallHierarchySetById(callHierarchySetId);
      const page = presentCallHierarchySet(entry, Number(cursor), pageSize || DEFAULT.REFERENCE_PAGE_SIZE);
      return toolResult(tool, {
        request: {callHierarchySetId, cursor, pageSize: pageSize || DEFAULT.REFERENCE_PAGE_SIZE},
        result: {
          evidenceType: CALL_HIERARCHY_EVIDENCE.STATIC_PROVIDER_GRAPH,
          runtimeReachability: CALL_HIERARCHY_EVIDENCE.RUNTIME_REACHABILITY_NOT_ESTABLISHED,
          edgesFound: entry.analysis.edges.length,
          edges: page.edges,
        },
        collection: {
          status: entry.analysis.unresolved.length > 0 ? COLLECTION_STATUS.PARTIAL : COLLECTION_STATUS.COMPLETE,
          stoppedByLimit: false,
          contentFreshness: CONTENT_FRESHNESS.VERIFIED_CURRENT,
          contentFilesChecked: entry.fileFingerprints.length,
        },
        presentation: page.presentation,
        continueWith: page.presentation.nextCursor ? [TOOL.CALL_HIERARCHY_PAGE] : [TOOL.DEFINITION],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.COUNT_TEXT_MATCHES,
  {
    description: TOOL_DESCRIPTION[TOOL.COUNT_TEXT_MATCHES],
    inputSchema: {
      root: z.string().describe("Absolute workspace or repository root"),
      symbol: z
        .string()
        .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
        .describe("Exact JavaScript or TypeScript identifier text to count"),
    },
    annotations: readOnly,
  },
  async ({root, symbol}) => {
    const tool = TOOL.COUNT_TEXT_MATCHES;
    try {
      const resolvedRoot = await existingDirectory(root);
      const search = await rgIdentifierCandidates(resolvedRoot, symbol, 1);
      return toolResult(tool, {
        request: {root: resolvedRoot, symbol, searchScope: "repository", evidenceType: EVIDENCE_TYPE.EXACT_IDENTIFIER_TEXT_MATCH},
        result: {
          matchesFound: search.totalCandidateCount,
          filesContainingMatches: search.totalCandidateFileCount,
          semanticVerificationPerformed: false,
          textSearchMilliseconds: search.elapsedMilliseconds,
        },
        collection: {status: COLLECTION_STATUS.COMPLETE, stoppedByLimit: false},
        presentation: {mode: PRESENTATION_MODE.COUNT_ONLY},
        continueWith: [TOOL.COUNT_NAMED_SYMBOL, TOOL.AUDIT_NAMED_SYMBOL],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.COUNT_NAMED_SYMBOL,
  {
    description: TOOL_DESCRIPTION[TOOL.COUNT_NAMED_SYMBOL],
    inputSchema: {
      root: z.string().describe("Absolute workspace or repository root"),
      symbol: z
        .string()
        .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
        .describe("Exact JavaScript or TypeScript identifier"),
      fileHint: z.string().optional().describe("Optional path fragment used to select exact homonymous definitions"),
      maxDefinitions: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Optional number of exact homonymous definitions to analyze; omit to analyze all"),
      includeDeclaration: z.boolean().default(true),
      maxCandidates: z.number().int().min(1).optional().describe("Optional number of text matches to verify; omit to verify all"),
    },
    annotations: readOnly,
  },
  async (args) => {
    const tool = TOOL.COUNT_NAMED_SYMBOL;
    try {
      const operation = await collectNamedSymbolAudits(args);
      const selectionStatus = definitionSelectionStatus(operation.matchingDefinitions);
      return toolResult(tool, {
        request: {
          root: operation.resolvedRoot,
          symbol: args.symbol,
          fileHint: args.fileHint,
          searchScope: "repository",
          definitionLimit: normalizedLimit(args.maxDefinitions),
          candidateLimit: normalizedLimit(args.maxCandidates),
          includeDeclaration: args.includeDeclaration,
        },
        result: {
          requestedSymbol: args.symbol,
          exactDefinitionsFound: operation.exactDefinitions.length,
          definitionsMatchingFileFilter: operation.matchingDefinitions.length,
          definitionSelectionStatus: selectionStatus,
          semanticEvidence: namedSemanticEvidence(selectionStatus, operation.collection.status),
          definitions: operation.audits.map((audit, index) => countSummary(audit, operation.selectedDefinitions[index])),
        },
        collection: operation.collection,
        presentation: {mode: PRESENTATION_MODE.COUNT_ONLY},
        continueWith: namedSymbolContinuations(operation, true, Boolean(args.fileHint)),
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.COUNT_REFERENCES,
  {
    description: TOOL_DESCRIPTION[TOOL.COUNT_REFERENCES],
    inputSchema: {
      ...positionSchema,
      includeDeclaration: z.boolean().default(true),
      crossWorkspace: z.boolean().default(true).describe("Include text matches from other workspaces after definition verification"),
      maxCandidates: z.number().int().min(1).optional().describe("Optional number of text matches to verify; omit to verify all"),
    },
    annotations: readOnly,
  },
  async ({file, root, line, column, includeDeclaration, crossWorkspace, maxCandidates}) => {
    const tool = TOOL.COUNT_REFERENCES;
    try {
      const audit = await auditSymbolAtPosition(file, root, line, column, {
        includeDeclaration,
        crossWorkspace,
        maxCandidates,
        includeDiagnostics: false,
        maxDiagnostics: undefined,
      });
      const summary = countSummary(audit);
      return toolResult(tool, {
        request: {
          file: path.resolve(file),
          line,
          column,
          searchScope: crossWorkspace ? "repository" : "workspace",
          candidateLimit: normalizedLimit(maxCandidates),
          includeDeclaration,
        },
        result: summary,
        collection: summary.collection,
        presentation: {mode: PRESENTATION_MODE.COUNT_ONLY},
        continueWith: [
          TOOL.AUDIT_SYMBOL,
          TOOL.REFERENCE_PAGE,
          ...(audit.referenceSummary.unresolvedCandidateCount > 0 ? [TOOL.UNRESOLVED_REFERENCE_PAGE] : []),
        ],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.AUDIT_NAMED_SYMBOL,
  {
    description: TOOL_DESCRIPTION[TOOL.AUDIT_NAMED_SYMBOL],
    inputSchema: {
      root: z.string().describe("Absolute workspace or repository root"),
      symbol: z
        .string()
        .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
        .describe("Exact JavaScript or TypeScript identifier"),
      fileHint: z.string().optional().describe("Optional path fragment used to select exact homonymous definitions"),
      maxDefinitions: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Optional number of exact homonymous definitions to analyze; omit to analyze all"),
      includeDeclaration: z.boolean().default(true),
      maxCandidates: z.number().int().min(1).optional().describe("Optional number of text matches to verify; omit to verify all"),
    },
    annotations: readOnly,
  },
  async (args) => {
    const tool = TOOL.AUDIT_NAMED_SYMBOL;
    try {
      const operation = await collectNamedSymbolAudits(args, {includeFileHintResolution: true});
      const selectionStatus = definitionSelectionStatus(operation.matchingDefinitions);
      return toolResult(tool, {
        request: {
          root: operation.resolvedRoot,
          symbol: args.symbol,
          fileHint: args.fileHint,
          searchScope: "repository",
          definitionLimit: normalizedLimit(args.maxDefinitions),
          candidateLimit: normalizedLimit(args.maxCandidates),
          includeDeclaration: args.includeDeclaration,
        },
        result: {
          requestedSymbol: args.symbol,
          exactDefinitionsFound: operation.exactDefinitions.length,
          definitionsMatchingFileFilter: operation.matchingDefinitions.length,
          definitionSelectionStatus: selectionStatus,
          semanticEvidence: namedSemanticEvidence(selectionStatus, operation.collection.status),
          fileHintResolution: operation.fileHintResolution,
          audits: operation.audits.map((audit, index) => auditSummary(audit, operation.selectedDefinitions[index])),
        },
        collection: operation.collection,
        presentation: {mode: PRESENTATION_MODE.COMPACT_SUMMARY},
        continueWith: namedSymbolContinuations(operation, false, Boolean(args.fileHint)),
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.AUDIT_SYMBOL,
  {
    description: TOOL_DESCRIPTION[TOOL.AUDIT_SYMBOL],
    inputSchema: {
      ...positionSchema,
      includeDeclaration: z.boolean().default(true),
      crossWorkspace: z.boolean().default(true).describe("Include text matches from other workspaces after definition verification"),
      maxCandidates: z.number().int().min(1).optional().describe("Optional number of text matches to verify; omit to verify all"),
    },
    annotations: readOnly,
  },
  async ({file, root, line, column, includeDeclaration, crossWorkspace, maxCandidates}) => {
    const tool = TOOL.AUDIT_SYMBOL;
    try {
      const audit = await auditSymbolAtPosition(file, root, line, column, {
        includeDeclaration,
        crossWorkspace,
        maxCandidates,
        includeDiagnostics: false,
        maxDiagnostics: undefined,
      });
      const summary = auditSummary(audit);
      return toolResult(tool, {
        request: {
          file: path.resolve(file),
          line,
          column,
          searchScope: crossWorkspace ? "repository" : "workspace",
          candidateLimit: normalizedLimit(maxCandidates),
          includeDeclaration,
        },
        result: summary,
        collection: summary.collection,
        presentation: {mode: PRESENTATION_MODE.COMPACT_SUMMARY},
        continueWith: [
          TOOL.REFERENCE_PAGE,
          TOOL.DEFINITION,
          ...(audit.referenceSummary.unresolvedCandidateCount > 0 ? [TOOL.UNRESOLVED_REFERENCE_PAGE] : []),
        ],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.REFERENCES,
  {
    description: TOOL_DESCRIPTION[TOOL.REFERENCES],
    inputSchema: {
      ...positionSchema,
      includeDeclaration: z.boolean().default(true),
      crossWorkspace: z.boolean().default(true).describe("Include text matches from other workspaces after definition verification"),
      maxCandidates: z.number().int().min(1).optional().describe("Optional number of text matches to verify; omit to verify all"),
      pageSize: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(`Number of reference locations to return in this page; default ${DEFAULT.REFERENCE_PAGE_SIZE}`),
    },
    annotations: readOnly,
  },
  async ({file, root, line, column, includeDeclaration, crossWorkspace, maxCandidates, pageSize}) => {
    const tool = TOOL.REFERENCES;
    try {
      const context = await clientForFile(file, root);
      const entry = await getReferenceSet(context, line, column, includeDeclaration, crossWorkspace, maxCandidates);
      const facts = factsForReferenceSet(entry, entry.reused);
      const page = presentReferenceSet(entry, 0, pageSize || DEFAULT_REFERENCE_PAGE_SIZE);
      return toolResult(tool, {
        request: {
          file: context.file,
          line,
          column,
          searchScope: crossWorkspace ? "repository" : "workspace",
          candidateLimit: normalizedLimit(maxCandidates),
          pageSize: pageSize || DEFAULT_REFERENCE_PAGE_SIZE,
          includeDeclaration,
        },
        result: {
          identifier: entry.analysis.identifier,
          references: facts.references,
          textSearch: facts.textSearch,
          unresolvedReferences: facts.unresolvedReferences,
          referenceFiles: facts.referenceFiles,
          referenceSetId: entry.id,
          referenceGroups: page.referenceGroups,
        },
        collection: facts.collection,
        presentation: page.presentation,
        continueWith: [
          ...(page.presentation.nextCursor ? [TOOL.REFERENCE_PAGE] : []),
          ...(entry.analysis.unresolvedCandidates.length > 0 ? [TOOL.UNRESOLVED_REFERENCE_PAGE] : []),
          TOOL.DEFINITION,
        ],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.REFERENCE_PAGE,
  {
    description: TOOL_DESCRIPTION[TOOL.REFERENCE_PAGE],
    inputSchema: {
      referenceSetId: z
        .string()
        .min(1)
        .describe("Reference-set identifier returned by lsp_references, lsp_count_references, or an audit tool"),
      cursor: z.string().regex(/^\d+$/).default("0").describe("Cursor returned by the previous reference page"),
      pageSize: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(`Number of reference locations to return; default ${DEFAULT.REFERENCE_PAGE_SIZE}`),
    },
    annotations: readOnly,
  },
  async ({referenceSetId, cursor, pageSize}) => {
    const tool = TOOL.REFERENCE_PAGE;
    try {
      const entry = await getReferenceSetById(referenceSetId);
      if (!entry) throw new ReferenceSetUnavailableError(referenceSetId);
      const facts = factsForReferenceSet(entry, true);
      const page = presentReferenceSet(entry, Number(cursor), pageSize || DEFAULT_REFERENCE_PAGE_SIZE);
      return toolResult(tool, {
        request: {referenceSetId, cursor, pageSize: pageSize || DEFAULT_REFERENCE_PAGE_SIZE},
        result: {
          identifier: entry.analysis.identifier,
          references: facts.references,
          referenceGroups: page.referenceGroups,
        },
        collection: facts.collection,
        presentation: page.presentation,
        continueWith: [
          ...(page.presentation.nextCursor ? [TOOL.REFERENCE_PAGE] : []),
          ...(entry.analysis.unresolvedCandidates.length > 0 ? [TOOL.UNRESOLVED_REFERENCE_PAGE] : []),
          TOOL.DEFINITION,
        ],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);

server.registerTool(
  TOOL.UNRESOLVED_REFERENCE_PAGE,
  {
    description: TOOL_DESCRIPTION[TOOL.UNRESOLVED_REFERENCE_PAGE],
    inputSchema: {
      referenceSetId: z.string().min(1).describe("Reference-set identifier returned by a count, audit, or reference tool"),
      cursor: z.string().regex(/^\d+$/).default("0").describe("Cursor returned by the previous unresolved-reference page"),
      pageSize: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(`Number of unresolved candidates to return; default ${DEFAULT.REFERENCE_PAGE_SIZE}`),
    },
    annotations: readOnly,
  },
  async ({referenceSetId, cursor, pageSize}) => {
    const tool = TOOL.UNRESOLVED_REFERENCE_PAGE;
    try {
      const entry = await getReferenceSetById(referenceSetId);
      if (!entry) throw new ReferenceSetUnavailableError(referenceSetId);
      const facts = factsForReferenceSet(entry, true);
      const page = presentUnresolvedReferenceSet(entry, Number(cursor), pageSize || DEFAULT_REFERENCE_PAGE_SIZE);
      return toolResult(tool, {
        request: {referenceSetId, cursor, pageSize: pageSize || DEFAULT_REFERENCE_PAGE_SIZE},
        result: {
          identifier: entry.analysis.identifier,
          unresolvedReferences: facts.unresolvedReferences,
          candidates: page.candidates,
        },
        collection: facts.collection,
        presentation: page.presentation,
        continueWith: page.presentation.nextCursor ? [TOOL.UNRESOLVED_REFERENCE_PAGE] : [TOOL.DEFINITION],
      });
    } catch (error) {
      return toolError(tool, error);
    }
  },
);
async function shutdown() {
  clearInterval(clientCleanupTimer);
  for (const entry of clients.values()) entry.client.close();
  clients.clear();
  referenceSetsById.clear();
  referenceSetIdByKey.clear();
  changedReferenceSetsById.clear();
  callHierarchySetsById.clear();
  callHierarchySetIdByKey.clear();
  pendingSessionRootAuthorizations.clear();
  sessionWorkspaceRoots = [];
  await server.close().catch(() => undefined);
  if (providerTemporaryDirectory) {
    await removeTemporaryDirectory(providerTemporaryDirectory).catch(() => undefined);
    providerTemporaryDirectory = undefined;
  }
}

process.on(PROCESS_SIGNAL.INTERRUPT, () => void shutdown().finally(() => process.exit(0)));
process.on(PROCESS_SIGNAL.TERMINATE, () => void shutdown().finally(() => process.exit(0)));

server.server.oninitialized = () => refreshClientWorkspaceRoots();
server.server.setNotificationHandler(RootsListChangedNotificationSchema, () => refreshClientWorkspaceRoots());

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`${PRODUCT.DISPLAY_NAME} server ready\n`);
