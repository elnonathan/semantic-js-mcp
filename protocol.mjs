export const TOOL = Object.freeze({
  DOCUMENT_SYMBOLS: "lsp_document_symbols",
  WORKSPACE_SYMBOLS: "lsp_workspace_symbols",
  DEFINITION: "lsp_definition",
  HOVER: "lsp_hover",
  DIAGNOSTICS: "lsp_diagnostics",
  COUNT_TEXT_MATCHES: "lsp_count_text_matches",
  COUNT_NAMED_SYMBOL: "lsp_count_named_symbol",
  COUNT_REFERENCES: "lsp_count_references",
  AUDIT_NAMED_SYMBOL: "lsp_audit_named_symbol",
  AUDIT_SYMBOL: "lsp_audit_symbol",
  REFERENCES: "lsp_references",
  REFERENCE_PAGE: "lsp_reference_page",
  UNRESOLVED_REFERENCE_PAGE: "lsp_unresolved_reference_page",
});

export const TOOL_ORDER = Object.freeze(Object.values(TOOL));
export const PRODUCT = Object.freeze({
  NAME: "semantic-js-mcp",
  DISPLAY_NAME: "Semantic JS MCP",
});

export const CLI_COMMAND = Object.freeze({
  SERVE: "serve",
  DOCTOR: "doctor",
  HELP: "help",
  VERSION: "version",
});

export const CLI_ARGUMENT = Object.freeze({
  HELP: "--help",
  HELP_SHORT: "-h",
  VERSION: "--version",
  VERSION_SHORT: "-v",
  YAML: "--yaml",
});

export const CLI_MESSAGE = Object.freeze({
  UNKNOWN_COMMAND: "Unknown command",
  UNKNOWN_ARGUMENT: "Unknown argument",
  UNKNOWN_OPTION: "Unknown option",
});

export const DOCTOR_CHECK = Object.freeze({
  NODE_RUNTIME: "node-runtime",
  RUNTIME_COMPONENTS: "runtime-components",
  RIPGREP: "ripgrep",
  MCP_STARTUP: "mcp-startup",
  TOOL_DISCOVERY: "tool-discovery",
  TYPESCRIPT_SYMBOLS: "typescript-symbols",
  TYPESCRIPT_REFERENCES: "typescript-references",
  DIAGNOSTIC_FRESHNESS: "diagnostic-freshness",
  VUE_SYMBOLS: "vue-symbols",
  VUE_TEMPLATE_DEFINITION: "vue-template-definition",
});

export const DOCTOR_REASON = Object.freeze({
  CHECK_COMPLETED: "check-completed",
  UNSUPPORTED_NODE_RUNTIME: "unsupported-node-runtime",
  RUNTIME_COMPONENT_MISSING: "runtime-component-missing",
  RIPGREP_UNAVAILABLE: "ripgrep-unavailable",
  MCP_STARTUP_FAILED: "mcp-startup-failed",
  TOOL_SET_DIFFERENT: "tool-set-different-from-protocol",
  TYPESCRIPT_SYMBOL_NOT_FOUND: "typescript-symbol-not-found",
  TYPESCRIPT_REFERENCE_ACCOUNTING_INCOMPLETE: "typescript-reference-accounting-incomplete",
  DIAGNOSTICS_NOT_CONFIRMED: "diagnostics-not-confirmed-for-current-document",
  VUE_SYMBOL_NOT_FOUND: "vue-symbol-not-found",
  VUE_TEMPLATE_DEFINITION_UNRESOLVED: "vue-template-definition-unresolved",
  CHECK_FAILED: "check-failed",
});

export const RUNTIME_COMMAND = Object.freeze({
  RIPGREP: "rg",
});

export const RUNTIME_REQUIREMENT = Object.freeze({
  MINIMUM_NODE_MAJOR: 22,
});

export const PACKAGE_PATH = Object.freeze({
  SERVER: "server.mjs",
  CLI: "cli.mjs",
});

export const ENVIRONMENT_VARIABLE = Object.freeze({
  PROCESS_CWD: "SEMANTIC_JS_MCP_PROCESS_CWD",
  CLIENT_IDLE_TIMEOUT_MS: "SEMANTIC_JS_MCP_CLIENT_IDLE_TIMEOUT_MS",
  CLIENT_MINIMUM_EVICTION_AGE_MS: "SEMANTIC_JS_MCP_CLIENT_MINIMUM_EVICTION_AGE_MS",
  MAXIMUM_ACTIVE_CLIENTS: "SEMANTIC_JS_MCP_MAXIMUM_ACTIVE_CLIENTS",
  REFERENCE_SET_TTL_MS: "SEMANTIC_JS_MCP_REFERENCE_SET_TTL_MS",
  MAXIMUM_REFERENCE_SETS: "SEMANTIC_JS_MCP_MAXIMUM_REFERENCE_SETS",
  MAXIMUM_CHANGED_REFERENCE_SET_MARKERS: "SEMANTIC_JS_MCP_MAXIMUM_CHANGED_REFERENCE_SET_MARKERS",
  MAXIMUM_CACHED_REFERENCE_LOCATIONS: "SEMANTIC_JS_MCP_MAXIMUM_CACHED_REFERENCE_LOCATIONS",
  DEFAULT_REFERENCE_PAGE_SIZE: "SEMANTIC_JS_MCP_DEFAULT_REFERENCE_PAGE_SIZE",
  CROSS_WORKSPACE_CONCURRENCY: "SEMANTIC_JS_MCP_CROSS_WORKSPACE_CONCURRENCY",
  BENCHMARK_COUNTS: "SEMANTIC_JS_MCP_BENCHMARK_COUNTS",
});

export const CONFIGURATION_FILE = Object.freeze({
  PACKAGE: "package.json",
  TYPESCRIPT: "tsconfig.json",
  JAVASCRIPT: "jsconfig.json",
});
export const WORKSPACE_CONFIGURATION_FILE_NAMES = Object.freeze(Object.values(CONFIGURATION_FILE));
export const WORKSPACE_ROOT_MARKER_FILE_NAMES = Object.freeze([CONFIGURATION_FILE.PACKAGE, CONFIGURATION_FILE.TYPESCRIPT]);
export const SOURCE_EXTENSION = Object.freeze({
  TYPESCRIPT: ".ts",
  TYPESCRIPT_REACT: ".tsx",
  TYPESCRIPT_MODULE: ".mts",
  TYPESCRIPT_COMMONJS: ".cts",
  JAVASCRIPT: ".js",
  JAVASCRIPT_REACT: ".jsx",
  JAVASCRIPT_MODULE: ".mjs",
  JAVASCRIPT_COMMONJS: ".cjs",
  VUE: ".vue",
});
export const SOURCE_FILE_GLOBS = Object.freeze(Object.values(SOURCE_EXTENSION).map((extension) => `*${extension}`));
export const SOURCE_EXCLUDED_GLOBS = Object.freeze(["!**/node_modules/**", "!**/dist/**", "!**/coverage/**"]);

export const LANGUAGE_ID = Object.freeze({
  TYPESCRIPT: "typescript",
  TYPESCRIPT_REACT: "typescriptreact",
  JAVASCRIPT: "javascript",
  JAVASCRIPT_REACT: "javascriptreact",
  VUE: "vue",
});

export const COMMON_VALUE = Object.freeze({
  UNKNOWN: "unknown",
});

export const SEARCH_SCOPE = Object.freeze({
  DOCUMENT: "document",
});

export const RUNTIME_PACKAGE = Object.freeze({
  TYPESCRIPT: "typescript",
});

export const VUE_SCRIPT_LANGUAGE = Object.freeze({
  JAVASCRIPT: "js",
  JAVASCRIPT_REACT: "jsx",
  TYPESCRIPT: "ts",
  TYPESCRIPT_REACT: "tsx",
});

export const DIAGNOSTIC_PROVIDER = Object.freeze({
  TYPESCRIPT_LANGUAGE_SERVER: "typescript-language-server",
  VUE_LANGUAGE_SERVER: "vue-language-server",
  UNKNOWN: COMMON_VALUE.UNKNOWN,
});

export const DIAGNOSTIC_REGION = Object.freeze({
  DOCUMENT: SEARCH_SCOPE.DOCUMENT,
  SCRIPT: "script",
  SCRIPT_SETUP: "script-setup",
  TEMPLATE: "template",
  STYLE: "style",
  CUSTOM_BLOCK: "custom-block",
  UNKNOWN: COMMON_VALUE.UNKNOWN,
});

export const DIAGNOSTIC_LANGUAGE = Object.freeze({
  TYPESCRIPT: LANGUAGE_ID.TYPESCRIPT,
  TYPESCRIPT_REACT: LANGUAGE_ID.TYPESCRIPT_REACT,
  JAVASCRIPT: LANGUAGE_ID.JAVASCRIPT,
  JAVASCRIPT_REACT: LANGUAGE_ID.JAVASCRIPT_REACT,
  VUE: LANGUAGE_ID.VUE,
  HTML: "html",
  PUG: "pug",
  CSS: "css",
  SCSS: "scss",
  LESS: "less",
  UNKNOWN: COMMON_VALUE.UNKNOWN,
});

export const FORBIDDEN_PUBLIC_FIELD = Object.freeze([
  "confidence",
  "exhaustive",
  "rejectedCandidateCount",
  "rejectedCandidates",
  "rejectedCandidatesByReason",
  "semanticIdentity",
  "truncated",
]);

export const COLLECTION_STATUS = Object.freeze({
  COMPLETE: "complete",
  LIMITED: "limited",
  PARTIAL: "partial",
  FAILED: "failed",
});

export const PRESENTATION_MODE = Object.freeze({
  ALL_ITEMS: "all-items",
  SUBSET: "subset",
  COUNT_ONLY: "count-only",
  COMPACT_SUMMARY: "compact-summary",
  PAGE: "page",
});

export const TOOL_DESCRIPTION = Object.freeze({
  [TOOL.DOCUMENT_SYMBOLS]: `Returns declarations and nested members for one file. Use ${TOOL.DEFINITION} or ${TOOL.AUDIT_SYMBOL} with an exact position for semantic identity.`,
  [TOOL.WORKSPACE_SYMBOLS]: `Returns declaration-shaped symbols whose names contain a query. Use ${TOOL.COUNT_NAMED_SYMBOL} or ${TOOL.AUDIT_NAMED_SYMBOL} with an exact name.`,
  [TOOL.DEFINITION]: `Resolves definitions for one source position. Use ${TOOL.HOVER} for type information or ${TOOL.COUNT_REFERENCES} for impact scope.`,
  [TOOL.HOVER]: `Returns inferred type information and documentation for one source position. Use ${TOOL.DEFINITION} for declaration identity.`,
  [TOOL.DIAGNOSTICS]:
    "Returns diagnostics for one file and marks evidence untrusted when the current document snapshot cannot be confirmed.",
  [TOOL.COUNT_TEXT_MATCHES]: `Counts exact identifier text matches without semantic verification. Use ${TOOL.COUNT_NAMED_SYMBOL} or ${TOOL.AUDIT_NAMED_SYMBOL} to verify identity.`,
  [TOOL.COUNT_NAMED_SYMBOL]: `Returns exact-definition and verified-reference counts plus explicit semantic follow-up status for a symbol name. Use ${TOOL.AUDIT_NAMED_SYMBOL} for identity, signature, or file-hint binding verification and ${TOOL.REFERENCE_PAGE} with a returned referenceSetId for locations.`,
  [TOOL.COUNT_REFERENCES]: `Returns verified-reference counts for the symbol at one source position. Use ${TOOL.AUDIT_SYMBOL} for identity and signature or ${TOOL.REFERENCE_PAGE} with the returned referenceSetId for locations.`,
  [TOOL.AUDIT_NAMED_SYMBOL]: `Returns a compact exact-name audit with explicit semantic follow-up status and verifies source bindings to fileHint when no declaration is selected. Use ${TOOL.REFERENCE_PAGE} with a returned referenceSetId for locations.`,
  [TOOL.AUDIT_SYMBOL]: `Returns a compact definition, signature, coverage, and freshness summary for one source position. Use ${TOOL.REFERENCE_PAGE} with the returned referenceSetId for locations.`,
  [TOOL.REFERENCES]: `Returns the first page of verified source locations and detailed collection evidence. Use ${TOOL.REFERENCE_PAGE} for later pages.`,
  [TOOL.REFERENCE_PAGE]: `Returns a page from a freshness-checked reference set created by a count, audit, or ${TOOL.REFERENCES} call.`,
  [TOOL.UNRESOLVED_REFERENCE_PAGE]:
    "Returns freshness-checked text-match candidates whose definitions could not be resolved, including literal failure reasons.",
});

export const LSP_METHOD = Object.freeze({
  DOCUMENT_DIAGNOSTIC: "textDocument/diagnostic",
  EXECUTE_COMMAND: "workspace/executeCommand",
  PUBLISH_DIAGNOSTICS: "textDocument/publishDiagnostics",
  WORKSPACE_DIAGNOSTIC_REFRESH: "workspace/diagnostic/refresh",
});

export const LSP_COMMAND = Object.freeze({
  GO_TO_SOURCE_DEFINITION: "_typescript.goToSourceDefinition",
});

export const TYPESCRIPT_SERVER_COMMAND = Object.freeze({
  DEFINITION_AND_BOUND_SPAN: "definitionAndBoundSpan",
});

export const LIMIT_MODE = Object.freeze({
  UNLIMITED: "unlimited",
  MAXIMUM: "maximum",
});

export const ACCOUNTING_STATUS = Object.freeze({
  COMPLETE: "complete",
  INCOMPLETE: "incomplete",
});

export const DEFINITION_MATCH = Object.freeze({
  RESOLVED: "resolved",
  UNRESOLVED: "unresolved",
});

export const DEFINITION_SELECTION_STATUS = Object.freeze({
  NONE: "no-definition-selected",
  ONE: "one-definition-selected",
  MULTIPLE: "multiple-definitions-selected",
});

export const SEMANTIC_EVIDENCE_STATUS = Object.freeze({
  USABLE: "usable-as-requested",
  FOLLOW_UP_REQUIRED: "follow-up-required",
});

export const SEMANTIC_EVIDENCE_FOLLOW_UP_REASON = Object.freeze({
  COLLECTION_LIMITED: "collection-is-limited",
  COLLECTION_PARTIAL: "collection-is-partial",
  NO_DEFINITION_SELECTED: DEFINITION_SELECTION_STATUS.NONE,
  MULTIPLE_DEFINITIONS_SELECTED: DEFINITION_SELECTION_STATUS.MULTIPLE,
});

export const SIGNATURE_SOURCE = Object.freeze({
  QUERY_POSITION_HOVER: "query-position-hover",
  RESOLVED_DEFINITION_HOVER: "resolved-definition-hover",
  NOT_REPORTED: "not-reported",
});

export const DIAGNOSTIC_FRESHNESS = Object.freeze({
  CURRENT: "current-document-version",
  DIFFERENT_CONTENT: "different-document-content",
  VERSION_NOT_REPORTED: "version-not-reported-by-language-server",
  DIFFERENT_VERSION: "different-document-version",
  NOT_REPORTED_FOR_CURRENT_DOCUMENT: "not-reported-for-current-document",
});

export const DIAGNOSTIC_SEVERITY = Object.freeze({
  ERROR: "error",
  WARNING: "warning",
  INFORMATION: "information",
  HINT: "hint",
  NOT_REPORTED: "not-reported",
});

export const EVIDENCE_STATUS = Object.freeze({
  VERIFIED: "verified",
  UNTRUSTED: "untrusted",
});

export const DIAGNOSTIC_EVIDENCE_REASON = Object.freeze({
  CURRENT_DOCUMENT_VERSION_CONFIRMED: "current-document-version-confirmed",
  CURRENT_DOCUMENT_SNAPSHOT_CONFIRMED: "current-document-snapshot-confirmed",
  DOCUMENT_CONTENT_CHANGED_DURING_ACQUISITION: "document-content-changed-during-diagnostic-acquisition",
  LANGUAGE_SERVER_VERSION_NOT_REPORTED: "language-server-version-not-reported",
  LANGUAGE_SERVER_REPORTED_DIFFERENT_VERSION: "language-server-reported-different-version",
  LANGUAGE_SERVER_DID_NOT_REPORT_CURRENT_DOCUMENT: "language-server-did-not-report-current-document",
});

export const CONTENT_FRESHNESS = Object.freeze({
  VERIFIED_CURRENT: "verified-current-file-content",
  VERIFIED_REPOSITORY_SOURCE_INVENTORY: "verified-current-repository-source-inventory",
});

export const REFERENCE_SET_CHANGE_TYPE = Object.freeze({
  EVIDENCE_FILE_CONTENT_CHANGED: "evidence-file-content-changed",
  REPOSITORY_SOURCE_INVENTORY_CHANGED: "repository-source-inventory-changed",
});

export const ERROR_CODE = Object.freeze({
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
  REFERENCE_SET_CONTENT_CHANGED: "REFERENCE_SET_CONTENT_CHANGED",
  REFERENCE_SET_NOT_FOUND_OR_EXPIRED: "REFERENCE_SET_NOT_FOUND_OR_EXPIRED",
  REPOSITORY_CHANGED_DURING_COLLECTION: "REPOSITORY_CHANGED_DURING_COLLECTION",
  RUNTIME_DEPENDENCY_MISSING: "RUNTIME_DEPENDENCY_MISSING",
  RUNTIME_REQUIREMENT_UNMET: "RUNTIME_REQUIREMENT_UNMET",
});

export const EVIDENCE_TYPE = Object.freeze({
  EXACT_IDENTIFIER_TEXT_MATCH: "exact-identifier-text-match",
});

export const FINGERPRINT_ALGORITHM = Object.freeze({
  SHA_256: "sha256",
});

export const FINGERPRINT_FORMAT = Object.freeze({
  SHA_256_PREFIX: `${FINGERPRINT_ALGORITHM.SHA_256}:`,
});

export const REFERENCE_DISCOVERY_METHOD = Object.freeze({
  OWNING_WORKSPACE_LANGUAGE_SERVER: "owning-workspace-language-server",
  DEFINITION_MATCH_FROM_ANOTHER_WORKSPACE: "definition-match-from-another-workspace",
});

export const DEFINITION_RESOLUTION_METHOD = Object.freeze({
  LANGUAGE_SERVER: "language-server-definition",
  TYPESCRIPT_SERVER: "typescript-server-definition",
  VUE_TEMPLATE_IMPORT_BINDING: "vue-template-import-binding-definition",
  UNRESOLVED: "unresolved",
});

export const UNRESOLVED_REFERENCE_REASON = Object.freeze({
  DEFINITION_TOOLS_RETURNED_NO_LOCATION: "definition-tools-returned-no-location",
  TYPESCRIPT_SERVER_REQUEST_FAILED: "typescript-server-request-failed-after-language-server-returned-no-location",
  CANDIDATE_ANALYSIS_FAILED: "candidate-analysis-failed",
  CANDIDATE_OPENED_IN_INFERRED_TYPESCRIPT_PROJECT: "candidate-opened-in-inferred-typescript-project",
});

export const TYPESCRIPT_PROJECT_KIND = Object.freeze({
  CONFIGURED: "configured-typescript-project",
  INFERRED: "inferred-typescript-project",
  UNKNOWN: "typescript-project-kind-not-reported",
});

export const CI_STATUS = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  UNTRUSTED: "untrusted",
  BLOCKED: "blocked",
});

export const CI_EXIT_CODE = Object.freeze({
  PASS: 0,
  FAIL: 1,
  UNTRUSTED: 2,
  BLOCKED: 3,
});

export const DOCTOR_DISTRIBUTION_ACCEPTED_STATUS = Object.freeze([CI_STATUS.PASS, CI_STATUS.UNTRUSTED]);

export const DOCTOR_STATUS_PRIORITY = Object.freeze({
  [CI_STATUS.PASS]: 0,
  [CI_STATUS.UNTRUSTED]: 1,
  [CI_STATUS.FAIL]: 2,
  [CI_STATUS.BLOCKED]: 3,
});

export const RUNTIME_REQUIREMENT_KIND = Object.freeze({
  NODE: "node",
  RUNTIME_COMPONENT: "runtime-component",
});

export const CI_REASON = Object.freeze({
  COMPLETE_EVIDENCE: "complete-evidence",
  VERIFIED_DIAGNOSTIC_ERRORS: "verified-current-document-has-error-diagnostics",
  INCOMPLETE_EVIDENCE: "collection-is-limited-or-partial",
  UNTRUSTED_DIAGNOSTICS: "diagnostics-for-current-document-are-untrusted",
  SEMANTIC_FOLLOW_UP_REQUIRED: "semantic-evidence-requires-follow-up",
  TOOL_EXECUTION_FAILED: "tool-execution-failed",
  INVALID_INPUT: "input-is-not-a-semantic-js-mcp-result",
});

export const INTERNAL_RESOLUTION_SOURCE = Object.freeze({
  NATIVE_LSP: "native-lsp",
  TYPESCRIPT_SERVER_FALLBACK: "tsserver-fallback",
  CROSS_WORKSPACE_DEFINITION: "cross-workspace-definition",
  VUE_TEMPLATE_IMPORT_BINDING: "vue-template-import-binding",
  UNRESOLVED: "unresolved",
});

export const RESULT_SCHEMA = Object.freeze({
  NAME: PRODUCT.NAME,
  VERSION: 7,
});

export const SERVER_VERSION = "0.10.2";

export const REQUIRED_RUNTIME_COMPONENT = Object.freeze({
  TYPESCRIPT_LANGUAGE_SERVER: "typescript-language-server/lib/cli.mjs",
  VUE_LANGUAGE_SERVER: "@vue/language-server/bin/vue-language-server.js",
  TYPESCRIPT_SERVER: "typescript/lib/tsserver.js",
  VUE_SFC_COMPILER: "@vue/compiler-sfc/dist/compiler-sfc.cjs.js",
  VUE_TYPESCRIPT_PLUGIN: "@vue/typescript-plugin/package.json",
});

export const RUNTIME_STATUS = Object.freeze({
  READY: "ready",
  BLOCKED: "blocked",
});

export const PROCESS_EXIT_CODE = Object.freeze({
  SUCCESS: 0,
  FAILURE: 1,
});

export const NODE_EVENT = Object.freeze({
  ERROR: "error",
  CLOSE: "close",
});

export const OPERATING_SYSTEM = Object.freeze({
  LINUX: "linux",
  MACOS: "darwin",
  WINDOWS: "win32",
});

export const DEFAULT = Object.freeze({
  REQUEST_TIMEOUT_MS: 30_000,
  DIAGNOSTIC_WAIT_MS: 2_000,
  CLIENT_IDLE_TIMEOUT_MS: 60_000,
  CLIENT_MINIMUM_EVICTION_AGE_MS: 15_000,
  MAXIMUM_ACTIVE_CLIENTS: 4,
  REFERENCE_SET_TTL_MS: 300_000,
  MAXIMUM_REFERENCE_SETS: 12,
  MAXIMUM_CHANGED_REFERENCE_SET_MARKERS: 24,
  MAXIMUM_CACHED_REFERENCE_LOCATIONS: 50_000,
  REFERENCE_PAGE_SIZE: 100,
  CROSS_WORKSPACE_CONCURRENCY: 6,
  FILE_FINGERPRINT_CONCURRENCY: 8,
  NAMED_DEFINITION_CONCURRENCY: 2,
  WORKSPACE_FILE_CONCURRENCY: 5,
  FILE_SUGGESTION_COUNT: 8,
  MILLISECONDS_PER_SECOND: 1_000,
  BENCHMARK_COUNTS: Object.freeze([10, 100, 1_000]),
  MCP_STARTUP_TIMEOUT_SECONDS: 30,
  MCP_TOOL_TIMEOUT_SECONDS: 300,
  INVENTORY_STAT_CONCURRENCY: 32,
  COLLECTION_STABILITY_ATTEMPTS: 2,
  PROCESS_ARGUMENT_OFFSET: 2,
});
