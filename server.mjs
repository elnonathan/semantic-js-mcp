#!/usr/bin/env node

import {spawn} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {createReadStream, existsSync} from "node:fs";
import {readFile, realpath, stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {stringify as stringifyYaml} from "yaml";
import {PACKAGE_ROOT, inspectRuntimeComponents, resolveRuntimeComponent, runtimeDependencyRoot} from "./lib/runtime.mjs";
import {
  ACCOUNTING_STATUS,
  COLLECTION_STATUS,
  CONTENT_FRESHNESS,
  DEFAULT,
  DEFINITION_MATCH,
  DEFINITION_RESOLUTION_METHOD,
  DEFINITION_SELECTION_STATUS,
  DIAGNOSTIC_EVIDENCE_REASON,
  DIAGNOSTIC_FRESHNESS,
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
  NODE_EVENT,
  INTERNAL_RESOLUTION_SOURCE,
  PRESENTATION_MODE,
  PROCESS_EXIT_CODE,
  PRODUCT,
  REFERENCE_DISCOVERY_METHOD,
  REFERENCE_SET_CHANGE_TYPE,
  REQUIRED_RUNTIME_COMPONENT,
  RUNTIME_COMMAND,
  RESULT_SCHEMA,
  SERVER_VERSION,
  SIGNATURE_SOURCE,
  TOOL,
  TOOL_DESCRIPTION,
  TOOL_ORDER,
  TYPESCRIPT_PROJECT_KIND,
  WORKSPACE_CONFIGURATION_FILE_NAMES,
  WORKSPACE_ROOT_MARKER_FILE_NAMES,
  SOURCE_EXCLUDED_GLOBS,
  SOURCE_EXTENSION,
  SOURCE_FILE_GLOBS,
  UNRESOLVED_REFERENCE_REASON,
  VUE_SCRIPT_LANGUAGE,
} from "./protocol.mjs";

const PLUGIN_ROOT = PACKAGE_ROOT;
const CONFIGURED_PROCESS_CWD = process.env[ENVIRONMENT_VARIABLE.PROCESS_CWD]
  ? path.resolve(process.env[ENVIRONMENT_VARIABLE.PROCESS_CWD])
  : undefined;
const REQUEST_TIMEOUT_MS = DEFAULT.REQUEST_TIMEOUT_MS;
const DIAGNOSTIC_WAIT_MS = DEFAULT.DIAGNOSTIC_WAIT_MS;
let vueParsingDependenciesPromise;

function vueParsingDependencies() {
  if (!vueParsingDependenciesPromise) {
    vueParsingDependenciesPromise = Promise.all([import("@vue/compiler-sfc"), import("typescript")]).then(([compiler, typescript]) => ({
      parseVueSfc: compiler.parse,
      ts: typescript.default,
    }));
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
  if (CONFIGURED_PROCESS_CWD && existsSync(CONFIGURED_PROCESS_CWD)) return CONFIGURED_PROCESS_CWD;
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

function limit(items, maxResults) {
  if (maxResults === undefined) return items.slice();
  return items.slice(0, maxResults);
}

function normalizedLimit(value) {
  return value === undefined ? {mode: LIMIT_MODE.UNLIMITED} : {mode: LIMIT_MODE.MAXIMUM, maximum: value};
}

function diagnosticEvidenceReason(freshness) {
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
  const resolved = await realpath(path.resolve(candidate));
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error(`Not a directory: ${candidate}`);
  }
  return resolved;
}

async function existingFile(candidate) {
  const resolved = await realpath(path.resolve(candidate));
  if (!(await stat(resolved)).isFile()) {
    throw new Error(`Not a file: ${candidate}`);
  }
  return resolved;
}

async function discoverRoots(file, requestedRoot) {
  let boundaryRoot;
  if (requestedRoot) {
    boundaryRoot = await existingDirectory(requestedRoot);
    if (file !== boundaryRoot && !file.startsWith(`${boundaryRoot}${path.sep}`)) {
      throw new Error(`File is outside requested workspace root: ${boundaryRoot}`);
    }
  }

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
    if (parent === current) {
      repositoryRoot = nearestProject || path.dirname(file);
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

function locationKey(location) {
  return `${location.file}:${location.range.start.line}:${location.range.start.column}`;
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
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on(NODE_EVENT.ERROR, reject);
    child.on("exit", (code) => {
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
      identifier,
      root,
    ],
    root,
  );
  const candidates = [];
  const candidateFiles = new Set();
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
    const file = path.isAbsolute(record.data.path.text) ? record.data.path.text : path.resolve(root, record.data.path.text);
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
  let current = root;
  while (true) {
    const workspaceTsdk = path.join(current, "node_modules", "typescript", "lib");
    if (existsSync(path.join(workspaceTsdk, "tsserver.js"))) return workspaceTsdk;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.dirname(resolveRuntimeComponent(REQUIRED_RUNTIME_COMPONENT.TYPESCRIPT_SERVER, PLUGIN_ROOT));
}

function languageServerEntry(kind) {
  return kind === LANGUAGE_ID.VUE
    ? resolveRuntimeComponent(REQUIRED_RUNTIME_COMPONENT.VUE_LANGUAGE_SERVER, PLUGIN_ROOT)
    : resolveRuntimeComponent(REQUIRED_RUNTIME_COMPONENT.TYPESCRIPT_LANGUAGE_SERVER, PLUGIN_ROOT);
}

class TsserverBridge {
  constructor(root, tsdk, enableVuePlugin = false) {
    this.root = root;
    this.nextId = 1;
    this.pending = new Map();
    this.openFiles = new Set();
    this.buffer = Buffer.alloc(0);
    const args = [path.join(tsdk, "tsserver.js"), "--useInferredProjectPerProjectRoot", "--disableAutomaticTypingAcquisition"];
    if (enableVuePlugin) {
      args.push("--globalPlugins", "@vue/typescript-plugin", "--pluginProbeLocations", runtimeNodeModules(), "--allowLocalPluginLoads");
    }
    this.process = spawn(process.execPath, args, {
      cwd: processCwd(root),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.stdout.on("data", (chunk) => this.onData(chunk));
    this.process.stderr.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) process.stderr.write(`[${PRODUCT.NAME}:vue-tsserver] ${message}\n`);
    });
    this.process.on("exit", (code, signal) => {
      const error = new Error(`Vue tsserver bridge exited (${code ?? signal ?? "unknown"})`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
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
          const pending = this.pending.get(message.request_seq);
          if (!pending) continue;
          clearTimeout(pending.timer);
          this.pending.delete(message.request_seq);
          if (message.success === false) pending.reject(new Error(message.message || "tsserver request failed"));
          else pending.resolve(message.body);
        }
      } catch (error) {
        process.stderr.write(`[${PRODUCT.NAME}:vue-tsserver] Invalid message: ${error.message}\n`);
      }
    }
  }

  send(command, args, expectResponse = true) {
    const seq = this.nextId++;
    const message = JSON.stringify({seq, type: "request", command, arguments: args});
    this.process.stdin.write(`${message}\n`);
    if (!expectResponse) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`tsserver request timed out: ${command}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(seq, {resolve, reject, timer});
    });
  }

  async request(command, args) {
    const file = args?.file;
    if (file && !this.openFiles.has(file)) {
      this.openFiles.add(file);
      await this.send("open", {file, projectRootPath: this.root}, false);
    }
    return this.send(command, args);
  }

  close() {
    if (!this.process.killed) this.process.kill("SIGTERM");
  }
}

class LspClient {
  constructor(root, kind) {
    this.root = root;
    this.kind = kind;
    this.process = undefined;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.documents = new Map();
    this.diagnosticsCache = new Map();
    this.diagnosticWaiters = new Map();
    this.tsserverBridge = undefined;
    this.ready = this.start();
  }

  async start() {
    const entry = languageServerEntry(this.kind);
    if (!existsSync(entry)) {
      throw new Error(`Language server is not installed: ${entry}`);
    }

    this.process = spawn(process.execPath, [entry, "--stdio"], {
      cwd: processCwd(this.root),
      env: {...process.env, PATH: `${path.join(runtimeNodeModules(), ".bin")}${path.delimiter}${process.env.PATH || ""}`},
      stdio: ["pipe", "pipe", "pipe"],
    });
    process.stderr.write(`[${PRODUCT.NAME}:${this.kind}] starting in ${this.root}\n`);
    this.process.stdout.on("data", (chunk) => this.onData(chunk));
    this.process.stderr.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) process.stderr.write(`[${PRODUCT.NAME}:${this.kind}] ${message}\n`);
    });
    this.process.on("exit", (code, signal) => {
      process.stderr.write(`[${PRODUCT.NAME}:${this.kind}] exited (${code ?? signal ?? "unknown"})\n`);
      const error = new Error(`${this.kind} language server exited (${code ?? signal ?? "unknown"})`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });

    const tsdk = findTsdk(this.root);
    if (this.kind === LANGUAGE_ID.VUE) this.tsserverBridge = new TsserverBridge(this.root, tsdk, true);
    await this.request(
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
            documentSymbol: {hierarchicalDocumentSymbolSupport: true},
            publishDiagnostics: {relatedInformation: true},
          },
          workspace: {symbol: {}},
        },
        initializationOptions:
          this.kind === LANGUAGE_ID.VUE
            ? {typescript: {tsdk}, vue: {hybridMode: false}}
            : {tsserver: {path: path.join(tsdk, "tsserver.js")}},
      },
      true,
    );
    process.stderr.write(`[${PRODUCT.NAME}:${this.kind}] initialized\n`);
    this.notify("initialized", {});
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
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      const openDocument = this.documents.get(message.params.uri);
      const entry = {
        items: message.params.diagnostics || [],
        reportedDocumentVersion: message.params.version,
        openDocumentVersionAtReceipt: openDocument?.version,
        receivedAt: Date.now(),
      };
      this.diagnosticsCache.set(message.params.uri, entry);
      const waiters = this.diagnosticWaiters.get(message.params.uri) || [];
      this.diagnosticWaiters.delete(message.params.uri);
      for (const resolve of waiters) resolve(entry);
      return;
    }

    if (message.method === "tsserver/request") {
      const params = Array.isArray(message.params?.[0]) ? message.params[0] : message.params;
      const [requestId, command, args] = params || [];
      void this.tsserverBridge
        ?.request(command, args)
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

  request(method, params, duringInitialization = false) {
    if (!duringInitialization && !this.process) throw new Error("Language server has not started");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {resolve, reject, timer});
      this.send({id, method, params});
    });
  }

  notify(method, params) {
    this.send({method, params});
  }

  respond(id, result) {
    this.send({id, result});
  }

  async syncDocument(file) {
    await this.ready;
    const uri = toUri(file);
    const text = await readFile(file, "utf8");
    const current = this.documents.get(uri);
    if (!current) {
      this.documents.set(uri, {text, version: 1});
      this.notify("textDocument/didOpen", {textDocument: {uri, languageId: languageId(file), version: 1, text}});
    } else if (current.text !== text) {
      invalidateReferenceSetsForFile(file);
      this.diagnosticsCache.delete(uri);
      const version = current.version + 1;
      this.documents.set(uri, {text, version});
      this.notify("textDocument/didChange", {textDocument: {uri, version}, contentChanges: [{text}]});
    }
    return uri;
  }

  async textRequest(method, file, extra = {}) {
    const uri = await this.syncDocument(file);
    return this.request(method, {textDocument: {uri}, ...extra});
  }

  rawTsserver() {
    if (!this.tsserverBridge) {
      this.tsserverBridge = new TsserverBridge(this.root, findTsdk(this.root), this.kind === LANGUAGE_ID.VUE);
    }
    return this.tsserverBridge;
  }

  async diagnostics(file) {
    const uri = await this.syncDocument(file);
    const document = this.documents.get(uri);
    const documentVersion = document?.version;
    const startedAt = Date.now();
    const published = await new Promise((resolve) => {
      const cached = this.diagnosticsCache.get(uri);
      if (cached?.reportedDocumentVersion === documentVersion) {
        resolve(cached);
        return;
      }
      const wrapped = (entry) => {
        clearTimeout(timer);
        resolve(entry);
      };
      const timer = setTimeout(() => {
        const waiters = this.diagnosticWaiters.get(uri) || [];
        this.diagnosticWaiters.set(
          uri,
          waiters.filter((waiter) => waiter !== wrapped),
        );
        resolve(this.diagnosticsCache.get(uri));
      }, DIAGNOSTIC_WAIT_MS);
      this.diagnosticWaiters.set(uri, [...(this.diagnosticWaiters.get(uri) || []), wrapped]);
    });
    const reportedDocumentVersion = published?.reportedDocumentVersion;
    const freshness = !published
      ? DIAGNOSTIC_FRESHNESS.NOT_REPORTED_FOR_CURRENT_DOCUMENT
      : reportedDocumentVersion === undefined
        ? DIAGNOSTIC_FRESHNESS.VERSION_NOT_REPORTED
        : reportedDocumentVersion === documentVersion
          ? DIAGNOSTIC_FRESHNESS.CURRENT
          : DIAGNOSTIC_FRESHNESS.DIFFERENT_VERSION;
    return {
      items: published?.items || [],
      documentVersion,
      reportedDocumentVersion,
      freshness,
      documentContentFingerprint: textFingerprint(document?.text || ""),
      waitedMilliseconds: Date.now() - startedAt,
    };
  }

  close() {
    this.documents.clear();
    this.diagnosticsCache.clear();
    this.diagnosticWaiters.clear();
    this.tsserverBridge?.close();
    if (this.process && !this.process.killed) this.process.kill("SIGTERM");
  }
}

const clients = new Map();

function clientIsBusy(client) {
  return client.pending.size > 0 || client.diagnosticWaiters.size > 0 || (client.tsserverBridge?.pending.size || 0) > 0;
}

function closeClientEntry(key, entry) {
  entry.client.close();
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
    entry = {client: new LspClient(root, kind), lastUsedAt: now};
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
    if (!rootInput) throw error;
    const root = await existingDirectory(rootInput);
    const basename = path.basename(fileInput);
    const matches = (await runProcess(RUNTIME_COMMAND.RIPGREP, ["--files", "--glob", `**/${basename}`, root], root))
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

async function clientForRoot(rootInput) {
  const root = await existingDirectory(rootInput || process.cwd());
  const key = `typescript:${root}`;
  const client = getOrCreateClient(key, root, LANGUAGE_ID.TYPESCRIPT);
  await waitForReadyClient(key, client);
  return {client, root};
}

function normalizeLocation(location) {
  const uri = location.uri || location.targetUri;
  const range = location.range || location.targetSelectionRange || location.targetRange;
  if (!uri || !range) return undefined;
  return {file: fromUri(uri), range: displayRange(range)};
}

function normalizeLocations(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map(normalizeLocation).filter(Boolean);
}

function normalizeTsserverDefinitions(value) {
  return (value?.definitions || []).map((definition) => ({
    file: path.resolve(definition.file),
    range: {
      start: {line: definition.start.line, column: definition.start.offset},
      end: {line: definition.end.line, column: definition.end.offset},
    },
  }));
}

async function definitionsAtWithoutVueTemplateFallback(file, root, line, column) {
  const context = await clientForFile(file, root);
  const raw = await context.client.textRequest("textDocument/definition", context.file, {position: lspPosition(line, column)});
  const lspDefinitions = normalizeLocations(raw);
  if (lspDefinitions.length > 0) {
    return {context, definitions: lspDefinitions, via: INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP};
  }
  try {
    const tsserverResult = await context.client.rawTsserver().request("definitionAndBoundSpan", {
      file: context.file,
      line,
      offset: column,
    });
    const definitions = normalizeTsserverDefinitions(tsserverResult);
    const project = await typescriptProjectEvidence(context);
    return {
      context,
      definitions,
      via: definitions.length > 0 ? INTERNAL_RESOLUTION_SOURCE.TYPESCRIPT_SERVER_FALLBACK : INTERNAL_RESOLUTION_SOURCE.UNRESOLVED,
      attempts: [INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP, INTERNAL_RESOLUTION_SOURCE.TYPESCRIPT_SERVER_FALLBACK],
      project,
    };
  } catch (error) {
    const project = await typescriptProjectEvidence(context);
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

function unresolvedReference(candidateLocation, identifier, result, reason, failure) {
  return {
    file: candidateLocation.file,
    range: candidateLocation.range,
    identifier,
    owningWorkspace: result?.context?.workspaceRoot,
    typescriptProject: result?.project,
    reason,
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
    targetKeys.add(`${context.file}:${token.line}:${token.column}`);
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
          unresolvedReference(
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
        unresolvedReference(
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
  const nativeResult = await context.client.textRequest("textDocument/references", context.file, {
    position: lspPosition(line, column),
    context: {includeDeclaration},
  });
  const nativeReferences = normalizeLocations(nativeResult).map((location) => ({...location, via: INTERNAL_RESOLUTION_SOURCE.NATIVE_LSP}));
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
  const declarationKeys = new Set(cross.targetDefinitions.map(locationKey));
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
    stream.on("data", (chunk) => hash.update(chunk));
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

  let stableCollection;
  for (let attempt = 1; attempt <= DEFAULT.COLLECTION_STABILITY_ATTEMPTS; attempt++) {
    const inventoryBefore = await repositorySourceInventory(context.repositoryRoot);
    const analysis = await collectReferences(context, line, column, includeDeclaration, crossWorkspace, maxCandidates);
    const [fileFingerprints, inventoryAfter] = await Promise.all([
      fingerprintFiles(analysis.evidenceFiles),
      repositorySourceInventory(context.repositoryRoot),
    ]);
    if (sameRepositoryInventory(inventoryBefore, inventoryAfter)) {
      stableCollection = {analysis, fileFingerprints, repositorySourceInventory: inventoryAfter, attempt};
      break;
    }
  }
  if (!stableCollection) {
    throw new RepositoryChangedDuringCollectionError(context.repositoryRoot, DEFAULT.COLLECTION_STABILITY_ATTEMPTS);
  }
  const completedAt = Date.now();
  const id = `references-${randomUUID()}`;
  const entry = {
    id,
    key,
    analysis: stableCollection.analysis,
    workspaceRoot: context.workspaceRoot,
    repositoryRoot: context.repositoryRoot,
    source: {file: context.file, line, column},
    createdAt: completedAt,
    lastUsedAt: completedAt,
    expiresAt: completedAt + REFERENCE_SET_TTL_MS,
    fileFingerprints: stableCollection.fileFingerprints,
    repositorySourceInventory: stableCollection.repositorySourceInventory,
    collectionStabilityAttempts: stableCollection.attempt,
  };
  referenceSetsById.set(id, entry);
  referenceSetIdByKey.set(key, id);
  pruneReferenceSets(now);
  return {
    ...entry,
    reused: false,
    freshnessCheckedAt: completedAt,
    freshnessCheckMilliseconds: stableCollection.repositorySourceInventory.elapsedMilliseconds,
  };
}

async function getReferenceSetById(id) {
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
    const group = referenceGroupsByFile.get(reference.file) || {file: reference.file, locations: []};
    group.locations.push({range: reference.range, discoveryMethod: publicReferenceMethod(reference.via)});
    referenceGroupsByFile.set(reference.file, group);
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

async function semanticWorkspaceSymbols(root, query, maxCandidates) {
  const search = await rgIdentifierCandidates(root, query, maxCandidates, false);
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

function flattenDocumentSymbols(symbols, file, parent = [], output = []) {
  for (const symbol of symbols || []) {
    if (symbol.location) {
      const normalized = normalizeLocation(symbol.location);
      output.push({name: symbol.name, kind: symbolKinds[symbol.kind - 1] || symbol.kind, container: symbol.containerName, ...normalized});
    } else {
      output.push({
        name: symbol.name,
        kind: symbolKinds[symbol.kind - 1] || symbol.kind,
        container: parent.join("."),
        file,
        range: displayRange(symbol.selectionRange || symbol.range),
      });
      flattenDocumentSymbols(symbol.children, file, [...parent, symbol.name], output);
    }
  }
  return output;
}

function normalizeDiagnostics(raw, maxResults) {
  return limit(raw, maxResults).map((item) => ({
    severity: diagnosticSeverities[item.severity - 1] || DIAGNOSTIC_SEVERITY.NOT_REPORTED,
    code: item.code,
    source: item.source,
    message: item.message,
    range: displayRange(item.range),
    relatedInformation: item.relatedInformation?.map((related) => ({
      message: related.message,
      ...normalizeLocation(related.location),
    })),
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
  const diagnostics = options.includeDiagnostics ? normalizeDiagnostics(rawDiagnostics.items, options.maxDiagnostics) : [];
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
    const current = groups.get(reference.file) || {file: reference.file, count: 0, via: new Set()};
    current.count++;
    if (reference.via) current.via.add(reference.via);
    groups.set(reference.file, current);
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

function namedSymbolContinuations(operation, includeNamedAudit, hasFileHint) {
  const continuations = [];
  const selectionStatus = definitionSelectionStatus(operation.matchingDefinitions);
  const hasSelectedDefinitions = selectionStatus !== DEFINITION_SELECTION_STATUS.NONE;
  const hasOneSelectedDefinition = selectionStatus === DEFINITION_SELECTION_STATUS.ONE;

  if (includeNamedAudit && hasSelectedDefinitions) continuations.push(TOOL.AUDIT_NAMED_SYMBOL);
  if (!hasSelectedDefinitions) continuations.push(hasFileHint ? TOOL.DOCUMENT_SYMBOLS : TOOL.WORKSPACE_SYMBOLS);
  if (!hasOneSelectedDefinition) continuations.push(TOOL.AUDIT_SYMBOL);
  if (operation.audits.length > 0) continuations.push(TOOL.REFERENCE_PAGE);
  if (operation.audits.some((audit) => audit.referenceSummary.unresolvedCandidateCount > 0)) {
    continuations.push(TOOL.UNRESOLVED_REFERENCE_PAGE);
  }
  return continuations;
}

async function collectNamedSymbolAudits({root, symbol, fileHint, maxDefinitions, includeDeclaration, maxCandidates}) {
  const resolvedRoot = await existingDirectory(root);
  const discovery = await semanticWorkspaceSymbols(resolvedRoot, symbol, maxCandidates);
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
  const stoppedByDefinitionLimit = selectedDefinitions.length < matchingDefinitions.length;
  const stoppedByCandidateLimit = discovery.candidateScanTruncated || audits.some((audit) => audit.referenceSummary.collectionTruncated);
  const unresolvedCount =
    discovery.unresolvedFileCount + audits.reduce((total, audit) => total + audit.referenceSummary.unresolvedCandidateCount, 0);
  return {
    resolvedRoot,
    discovery,
    exactDefinitions,
    matchingDefinitions,
    selectedDefinitions,
    audits,
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
  const data = {
    producer: {name: PRODUCT.NAME, version: SERVER_VERSION, resultSchemaVersion: RESULT_SCHEMA.VERSION},
    tool,
    request: {},
    result: {},
    collection: {status: COLLECTION_STATUS.FAILED, stoppedByLimit: false},
    presentation: {mode: PRESENTATION_MODE.ALL_ITEMS, itemsAvailable: 0, itemsReturned: 0, itemsReturnedAreSubset: false},
    continueWith: [],
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

try {
  verifyBundledRuntime();
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
        request: {file: context.file, searchScope: "document", resultLimit: normalizedLimit(maxResults)},
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
      const diagnostics = normalizeDiagnostics(report.items, maxResults);
      const versionConfirmed = report.freshness === DIAGNOSTIC_FRESHNESS.CURRENT;
      const diagnosticReport = {
        items: diagnostics,
        itemsReported: report.items.length,
        itemsReturnedAreSubset: diagnostics.length < report.items.length,
      };
      return toolResult(tool, {
        request: {file: context.file, searchScope: "document", resultLimit: normalizedLimit(maxResults)},
        result: {
          evidence: {
            status: versionConfirmed ? EVIDENCE_STATUS.VERIFIED : EVIDENCE_STATUS.UNTRUSTED,
            reason: diagnosticEvidenceReason(report.freshness),
          },
          document: {
            version: report.documentVersion,
            contentFingerprint: publicContentFingerprint(report.documentContentFingerprint),
          },
          diagnosticsForCurrentDocument: versionConfirmed ? diagnosticReport : null,
          unconfirmedDiagnosticReport: versionConfirmed
            ? undefined
            : {
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
          definitionSelectionStatus: definitionSelectionStatus(operation.matchingDefinitions),
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
      const operation = await collectNamedSymbolAudits(args);
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
          definitionSelectionStatus: definitionSelectionStatus(operation.matchingDefinitions),
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
  await server.close().catch(() => undefined);
}

process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`${PRODUCT.DISPLAY_NAME} server ready\n`);
