#!/usr/bin/env node

import path from "node:path";
import {deepStrictEqual} from "node:assert";
import {mkdtemp, mkdir, readFile, realpath, symlink, unlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {parse as parseYaml} from "yaml";
import {
  canonicalPathInsideBoundary,
  fileIdentity,
  fileIdentityContains,
  filesystemPermissionPaths,
  locationKey,
  locationKeyAt,
  locationKeyForOperatingSystem,
} from "../lib/file-identity.mjs";
import {BLOCKED_CHILD_PROCESS_ENVIRONMENT_VARIABLES, sanitizedChildEnvironment} from "../lib/child-process-environment.mjs";
import {diagnosticUseSummary} from "../lib/diagnostic-evidence.mjs";
import {removeTemporaryDirectory} from "../lib/temporary-directory.mjs";
import {
  ACCOUNTING_STATUS,
  COLLECTION_STATUS,
  CONTENT_FRESHNESS,
  DEFINITION_MATCH,
  DEFINITION_SELECTION_STATUS,
  DIAGNOSTIC_EVIDENCE_REASON,
  DIAGNOSTIC_LANGUAGE,
  DIAGNOSTIC_PROVIDER,
  DIAGNOSTIC_REGION,
  EVIDENCE_STATUS,
  DIAGNOSTIC_FRESHNESS,
  DIAGNOSTIC_GUIDANCE,
  ENVIRONMENT_VARIABLE,
  ERROR_CODE,
  FINGERPRINT_FORMAT,
  FORBIDDEN_PUBLIC_FIELD,
  OPERATING_SYSTEM,
  PRESENTATION_MODE,
  PRODUCT,
  REFERENCE_SET_CHANGE_TYPE,
  RESULT_SCHEMA,
  SEMANTIC_EVIDENCE_FOLLOW_UP_REASON,
  SEMANTIC_EVIDENCE_STATUS,
  SERVER_VERSION,
  SIGNATURE_SOURCE,
  TOOL,
  TOOL_DESCRIPTION,
  TOOL_ORDER,
  UNRESOLVED_REFERENCE_REASON,
} from "../protocol.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedTools = [...TOOL_ORDER];
const forbiddenPublicKeys = new Set(FORBIDDEN_PUBLIC_FIELD);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const inheritedChildEnvironment = Object.fromEntries(
  BLOCKED_CHILD_PROCESS_ENVIRONMENT_VARIABLES.map((name) => [name, "attacker-controlled"]),
);
inheritedChildEnvironment.SEMANTIC_JS_MCP_SAFE_ENVIRONMENT_PROBE = "preserved";
const safeChildEnvironment = sanitizedChildEnvironment(inheritedChildEnvironment);
assert(
  BLOCKED_CHILD_PROCESS_ENVIRONMENT_VARIABLES.every((name) => !(name in safeChildEnvironment)),
  "A blocked child-process environment variable survived sanitization",
);
assert(
  safeChildEnvironment.SEMANTIC_JS_MCP_SAFE_ENVIRONMENT_PROBE === "preserved",
  "Child-process environment sanitization removed an unrelated variable",
);

const unversionedDiagnosticUse = diagnosticUseSummary({versionConfirmed: false, reportReceived: true});
deepStrictEqual(
  unversionedDiagnosticUse,
  {
    currentDocumentDiagnosticsAvailable: false,
    unconfirmedDiagnosticReportAvailable: true,
    usableAsCurrentDocumentDiagnosticEvidence: false,
    guidance: DIAGNOSTIC_GUIDANCE.UNCONFIRMED_DIAGNOSTIC_REPORT_AVAILABLE,
  },
  "Unversioned diagnostic reports did not remain context-only",
);
const unavailableDiagnosticUse = diagnosticUseSummary({versionConfirmed: false, reportReceived: false});
deepStrictEqual(
  unavailableDiagnosticUse,
  {
    currentDocumentDiagnosticsAvailable: false,
    unconfirmedDiagnosticReportAvailable: false,
    usableAsCurrentDocumentDiagnosticEvidence: false,
    guidance: DIAGNOSTIC_GUIDANCE.CURRENT_DOCUMENT_DIAGNOSTICS_UNAVAILABLE,
  },
  "Missing current-document reports did not remain unavailable as validation",
);

function assertDiagnosticUse(result, message) {
  const versionConfirmed = result.evidence.status === EVIDENCE_STATUS.VERIFIED;
  const reportReceived = versionConfirmed || result.unconfirmedDiagnosticReport?.reportReceived === true;
  deepStrictEqual(result.diagnosticUse, diagnosticUseSummary({versionConfirmed, reportReceived}), message);
}

const windowsLocation = {
  file: "C:\\Repository\\src\\Example.ts",
  range: {start: {line: 2, column: 17}},
};
const differentlyCasedWindowsLocation = {
  file: "c:/repository/src/example.ts",
  range: {start: {line: 2, column: 17}},
};
const windowsLocationKey = locationKeyForOperatingSystem(OPERATING_SYSTEM.WINDOWS);
assert(
  fileIdentity(windowsLocation.file, OPERATING_SYSTEM.WINDOWS) ===
    fileIdentity(differentlyCasedWindowsLocation.file, OPERATING_SYSTEM.WINDOWS),
  "Windows file identity retained path casing or separator differences",
);
assert(
  new Set([windowsLocation, differentlyCasedWindowsLocation].map(windowsLocationKey)).size === 1,
  "Windows location identity retained path casing or separator differences",
);
assert(
  locationKeyAt(windowsLocation.file, 2, 17, OPERATING_SYSTEM.WINDOWS) === windowsLocationKey(differentlyCasedWindowsLocation),
  "Windows source-position identity bypassed canonical location identity",
);
assert(
  fileIdentityContains("C:\\Repository", "c:/repository/src/example.ts", OPERATING_SYSTEM.WINDOWS),
  "Windows workspace containment retained path casing or separator differences",
);
assert(
  !fileIdentityContains("C:\\Repository", "C:\\Repository-sibling\\src\\example.ts", OPERATING_SYSTEM.WINDOWS),
  "Windows workspace containment accepted a sibling path prefix",
);
assert(
  [windowsLocation].map(locationKey)[0] === locationKey(windowsLocation),
  "The host location key consumed the Array.map callback index",
);
for (const operatingSystem of [OPERATING_SYSTEM.LINUX, OPERATING_SYSTEM.MACOS]) {
  assert(
    fileIdentity("/Repository/src/Example.ts", operatingSystem) !== fileIdentity("/repository/src/example.ts", operatingSystem),
    `${operatingSystem} file identity discarded path casing`,
  );
  deepStrictEqual(
    filesystemPermissionPaths("/Repository/MixedCase", {operatingSystem}),
    ["/Repository/MixedCase"],
    `${operatingSystem} filesystem permissions included unnecessary case variants`,
  );
}
deepStrictEqual(
  filesystemPermissionPaths("C:\\Repository\\MixedCase", {operatingSystem: OPERATING_SYSTEM.WINDOWS}),
  ["C:\\Repository\\MixedCase", "c:\\repository\\mixedcase", "C:\\REPOSITORY\\MIXEDCASE"],
  "Windows filesystem permissions omitted required case variants",
);
deepStrictEqual(
  filesystemPermissionPaths("/Temporary/MixedCase", {
    operatingSystem: OPERATING_SYSTEM.MACOS,
    includeMacOSCaseVariants: true,
  }),
  ["/Temporary/MixedCase", "/temporary/mixedcase", "/TEMPORARY/MIXEDCASE"],
  "macOS temporary filesystem permissions omitted the language-server case probe variants",
);

function assertNoAmbiguousKeys(value, location = "structuredContent") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAmbiguousKeys(item, `${location}.${index}`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert(!forbiddenPublicKeys.has(key), `Ambiguous public key ${location}.${key}`);
    assertNoAmbiguousKeys(item, `${location}.${key}`);
  }
}

function referenceLocations(result) {
  return result.referenceGroups.flatMap((group) => group.locations.map((location) => ({file: group.file, ...location})));
}

function countObjectKey(value, requestedKey) {
  if (Array.isArray(value)) return value.reduce((total, item) => total + countObjectKey(item, requestedKey), 0);
  if (!value || typeof value !== "object") return 0;
  return Object.entries(value).reduce(
    (total, [key, item]) => total + (key === requestedKey ? 1 : 0) + countObjectKey(item, requestedKey),
    0,
  );
}

function assertResult(response, tool) {
  assert(!response.isError, response.content?.[0]?.text || `${tool} failed`);
  assert(response.structuredContent?.tool === tool, `${tool} omitted its canonical tool name`);
  assert(response.structuredContent?.producer?.name === PRODUCT.NAME, `${tool} omitted its canonical producer name`);
  assert(response.structuredContent?.producer?.version === SERVER_VERSION, `${tool} omitted its canonical producer version`);
  assert(!("server" in response.structuredContent), `${tool} returned the schema-5 server envelope`);
  assert(!("resultSchema" in response.structuredContent), `${tool} returned the schema-5 result-schema envelope`);
  assert(
    response.structuredContent?.producer?.resultSchemaVersion === RESULT_SCHEMA.VERSION,
    `${tool} omitted its canonical result schema version`,
  );
  assert(response._meta?.resultSchema === RESULT_SCHEMA.NAME, `${tool} omitted result schema metadata`);
  assert(response._meta?.resultSchemaVersion === RESULT_SCHEMA.VERSION, `${tool} returned the wrong result schema version`);
  const yaml = response.content?.find((item) => item.type === "text")?.text || "";
  assert(yaml.includes(`tool: ${tool}`), `${tool} did not provide YAML model text`);
  assert(!yaml.trimStart().startsWith("{"), `${tool} rendered JSON instead of YAML model text`);
  deepStrictEqual(parseYaml(yaml), response.structuredContent, `${tool} YAML and structured JSON differ`);
  assert(
    response.structuredContent.continueWith.every((continuation) => expectedTools.includes(continuation)),
    `${tool} returned a non-canonical continuation tool`,
  );
  assert(
    response.structuredContent.continueWith.every((continuation) => typeof continuation === "string"),
    `${tool} returned a schema-5 continuation object`,
  );
  assertNoAmbiguousKeys(response.structuredContent);
  return response.structuredContent;
}

function assertErrorResult(response, tool) {
  assert(response.isError === true, `${tool} was expected to fail`);
  const data = response.structuredContent;
  assert(data?.tool === tool, `${tool} error omitted its canonical tool name`);
  assert(data?.collection?.status === COLLECTION_STATUS.FAILED, `${tool} error omitted collection.status=failed`);
  const yaml = response.content?.find((item) => item.type === "text")?.text || "";
  deepStrictEqual(parseYaml(yaml), data, `${tool} error YAML and structured JSON differ`);
  assertNoAmbiguousKeys(data);
  return data;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const workspace = await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-generic-smoke-"));
const src = path.join(workspace, "src");
await mkdir(src, {recursive: true});
await writeFile(path.join(workspace, "package.json"), JSON.stringify({private: true, type: "module"}));
await writeFile(
  path.join(workspace, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", experimentalDecorators: true},
    include: ["src/**/*.ts"],
  }),
);
const targetFile = path.join(src, "target.ts");
const usageFile = path.join(src, "usage.ts");
const unrelatedFile = path.join(src, "unrelated.ts");
const unresolvedFile = path.join(src, "unresolved.ts");
const futureReferenceFile = path.join(src, "future-reference.ts");
const decoratedFile = path.join(src, "decorated.ts");
const consumer = path.join(workspace, "packages", "consumer");
const consumerSrc = path.join(consumer, "src");
const consumerAliasFile = path.join(consumerSrc, "alias-usage.ts");
const moduleFile = path.join(src, "module.mjs");
const rootModuleFile = path.join(workspace, "root-module.mjs");
const nestedModuleDirectory = path.join(workspace, "scripts");
const nestedModuleFile = path.join(nestedModuleDirectory, "module-helper.mjs");
await mkdir(consumerSrc, {recursive: true});
await mkdir(nestedModuleDirectory, {recursive: true});
await writeFile(path.join(consumer, "package.json"), JSON.stringify({private: true, type: "module"}));
await writeFile(
  path.join(consumer, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      experimentalDecorators: true,
      baseUrl: ".",
      paths: {"@root/*": ["../../src/*"]},
    },
    include: ["src/**/*.ts", "../../src/**/*.ts"],
  }),
);
await writeFile(
  targetFile,
  ["/** Returns the next integer. */", "export function repeatedTarget(value: number): number {", "  return value + 1;", "}"].join("\n"),
);
const outsideBoundary = await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-boundary-filter-smoke-"));
const outsideBoundaryFile = path.join(outsideBoundary, "outside.ts");
const boundaryEscapingLink = path.join(src, "outside-link.ts");
try {
  await writeFile(outsideBoundaryFile, "export const outsideBoundaryValue = 1;\n");
  await symlink(outsideBoundaryFile, boundaryEscapingLink);
  const canonicalWorkspace = await realpath(workspace);
  const insideBoundary = (candidate) => fileIdentityContains(canonicalWorkspace, candidate);
  assert(
    (await canonicalPathInsideBoundary(targetFile, insideBoundary)) === (await realpath(targetFile)),
    "Workspace candidate canonicalization rejected an in-boundary file",
  );
  assert(
    (await canonicalPathInsideBoundary(boundaryEscapingLink, insideBoundary)) === undefined,
    "Workspace candidate canonicalization accepted a symlink escape",
  );
} finally {
  await unlink(boundaryEscapingLink).catch(() => undefined);
  await removeTemporaryDirectory(outsideBoundary);
}
const calls = Array.from({length: 250}, (_, index) => `  repeatedTarget(${index}),`).join("\n");
await writeFile(usageFile, ['import {repeatedTarget} from "./target.js";', "export const values = [", calls, "];"].join("\n"));
await writeFile(
  unrelatedFile,
  [
    "export function repeatedTarget(value: string): string { return value; }",
    'export const unrelatedValue = repeatedTarget("separate symbol");',
  ].join("\n"),
);
await writeFile(unresolvedFile, 'export const unresolvedText = "repeatedTarget";\n');
await writeFile(futureReferenceFile, "export const futureValue = 1;\n");
await writeFile(
  decoratedFile,
  [
    "export function registered<T extends new (...args: any[]) => object>(target: T): T { return target; }",
    "@registered",
    "export class DecoratedService { run(): number { return 1; } }",
  ].join("\n"),
);
await writeFile(
  consumerAliasFile,
  [
    'import {repeatedTarget} from "@root/target";',
    'import {DecoratedService} from "@root/decorated";',
    "export const aliasValue = repeatedTarget(new DecoratedService().run());",
  ].join("\n"),
);
await writeFile(moduleFile, "export function moduleFunction(value) { return value; }\n");
await writeFile(rootModuleFile, "export function rootModuleFunction(value) { return value; }\n");
await writeFile(nestedModuleFile, "export function nestedModuleFunction(value) { return value; }\n");

const client = new Client({name: "semantic-js-mcp-generic-smoke", version: "1.0.0"});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(pluginRoot, "server.mjs")],
  cwd: pluginRoot,
  env: {
    ...process.env,
    [ENVIRONMENT_VARIABLE.WORKSPACE_ROOTS]: tmpdir(),
    [ENVIRONMENT_VARIABLE.CLIENT_IDLE_TIMEOUT_MS]: "10000",
    [ENVIRONMENT_VARIABLE.REFERENCE_SET_TTL_MS]: "2000",
    [ENVIRONMENT_VARIABLE.MAXIMUM_CACHED_REFERENCE_LOCATIONS]: "300",
  },
});

try {
  await client.connect(transport);
  assert(client.getInstructions() === undefined, "Server instructions would be repeated in every Codex tool description");
  const listed = await client.listTools();
  assert(JSON.stringify(listed.tools.map((tool) => tool.name)) === JSON.stringify(expectedTools), "Tool order or tool set changed");
  assert(
    listed.tools.every((tool) => tool.description === TOOL_DESCRIPTION[tool.name]),
    "A registered tool description differs from the canonical protocol description",
  );
  assert(
    new Set(listed.tools.map((tool) => tool.description)).size === listed.tools.length,
    "Tool descriptions repeat shared guidance instead of describing unique behavior",
  );

  const symbols = assertResult(
    await client.callTool({
      name: "lsp_document_symbols",
      arguments: {file: targetFile},
    }),
    "lsp_document_symbols",
  );
  assert(
    symbols.result.symbols.some((symbol) => symbol.name === "repeatedTarget"),
    "Document symbol missing",
  );
  assert(symbols.request.resultLimit.mode === "unlimited", "Omitted result limit must be represented as unlimited");

  const standaloneModules = [
    {file: rootModuleFile, symbol: "rootModuleFunction"},
    {file: moduleFile, symbol: "moduleFunction"},
    {file: nestedModuleFile, symbol: "nestedModuleFunction"},
  ];
  for (const standaloneModule of standaloneModules) {
    const moduleSymbols = assertResult(
      await client.callTool({
        name: TOOL.DOCUMENT_SYMBOLS,
        arguments: {file: standaloneModule.file, root: workspace},
      }),
      TOOL.DOCUMENT_SYMBOLS,
    );
    assert(
      moduleSymbols.result.symbols.some((symbol) => symbol.name === standaloneModule.symbol),
      `MJS document symbol missing: ${standaloneModule.symbol}`,
    );

    const moduleCount = assertResult(
      await client.callTool({
        name: TOOL.COUNT_NAMED_SYMBOL,
        arguments: {root: workspace, symbol: standaloneModule.symbol},
      }),
      TOOL.COUNT_NAMED_SYMBOL,
    );
    assert(
      moduleCount.result.definitionSelectionStatus === DEFINITION_SELECTION_STATUS.ONE,
      `MJS named count did not select ${standaloneModule.symbol}`,
    );
    assert(moduleCount.collection.status === COLLECTION_STATUS.COMPLETE, `MJS named count was not complete: ${standaloneModule.symbol}`);

    const moduleAudit = assertResult(
      await client.callTool({
        name: TOOL.AUDIT_NAMED_SYMBOL,
        arguments: {root: workspace, symbol: standaloneModule.symbol},
      }),
      TOOL.AUDIT_NAMED_SYMBOL,
    );
    assert(
      moduleAudit.result.definitionSelectionStatus === DEFINITION_SELECTION_STATUS.ONE,
      `MJS named audit did not preserve ${standaloneModule.symbol}`,
    );
    assert(moduleAudit.result.audits[0]?.signature.length > 0, `MJS named audit omitted its signature: ${standaloneModule.symbol}`);
    assert(moduleAudit.collection.status === COLLECTION_STATUS.COMPLETE, `MJS named audit was not complete: ${standaloneModule.symbol}`);
  }

  const workspaceSymbols = assertResult(
    await client.callTool({
      name: "lsp_workspace_symbols",
      arguments: {root: workspace, query: "repeatedTarget"},
    }),
    "lsp_workspace_symbols",
  );
  assert(workspaceSymbols.result.symbolsFound >= 2, "Expected both homonymous definitions");

  const definition = assertResult(
    await client.callTool({
      name: "lsp_definition",
      arguments: {file: usageFile, line: 3, column: 3},
    }),
    "lsp_definition",
  );
  assert(definition.result.definitionMatch === DEFINITION_MATCH.RESOLVED, "Definition was not resolved");
  assert(
    definition.result.definitions.some((item) => path.basename(item.file) === "target.ts"),
    "Definition resolved to the wrong symbol",
  );

  const aliasDefinition = assertResult(
    await client.callTool({
      name: TOOL.DEFINITION,
      arguments: {file: consumerAliasFile, root: workspace, line: 3, column: 27},
    }),
    TOOL.DEFINITION,
  );
  assert(
    aliasDefinition.result.definitions.some((item) => path.basename(item.file) === "target.ts"),
    "Cross-project path alias did not resolve to its definition",
  );

  const sameFileDefinition = assertResult(
    await client.callTool({
      name: TOOL.DEFINITION,
      arguments: {file: unrelatedFile, root: workspace, line: 2, column: 31},
    }),
    TOOL.DEFINITION,
  );
  assert(
    sameFileDefinition.result.definitions.some((item) => path.basename(item.file) === "unrelated.ts"),
    "A same-file definition was replaced while following a local binding",
  );

  const decoratedDefinition = assertResult(
    await client.callTool({
      name: TOOL.DEFINITION,
      arguments: {file: consumerAliasFile, root: workspace, line: 2, column: 9},
    }),
    TOOL.DEFINITION,
  );
  assert(
    decoratedDefinition.result.definitions.some((item) => path.basename(item.file) === "decorated.ts"),
    "Decorated class imported through a path alias did not resolve",
  );

  const hover = assertResult(
    await client.callTool({
      name: "lsp_hover",
      arguments: {file: targetFile, line: 2, column: 17},
    }),
    "lsp_hover",
  );
  assert(hover.result.typeAndDocumentation.includes("repeatedTarget"), "Hover omitted the function signature");

  const [initialDiagnosticsResponse, concurrentInitialDiagnosticsResponse] = await Promise.all([
    client.callTool({name: TOOL.DIAGNOSTICS, arguments: {file: targetFile}}),
    client.callTool({name: TOOL.DIAGNOSTICS, arguments: {file: targetFile}}),
  ]);
  const initialDiagnostics = assertResult(initialDiagnosticsResponse, TOOL.DIAGNOSTICS);
  const concurrentInitialDiagnostics = assertResult(concurrentInitialDiagnosticsResponse, TOOL.DIAGNOSTICS);
  deepStrictEqual(
    concurrentInitialDiagnostics.result.document,
    initialDiagnostics.result.document,
    "Concurrent diagnostics did not use the same document snapshot",
  );
  deepStrictEqual(
    concurrentInitialDiagnostics.result.evidence,
    initialDiagnostics.result.evidence,
    "Concurrent diagnostics disagreed about snapshot evidence",
  );
  const initialDiagnosticsVerified = initialDiagnostics.result.evidence.status === EVIDENCE_STATUS.VERIFIED;
  assertDiagnosticUse(initialDiagnostics.result, "Initial diagnostics returned inconsistent usage guidance");
  assert(
    initialDiagnostics.collection.status === (initialDiagnosticsVerified ? COLLECTION_STATUS.COMPLETE : COLLECTION_STATUS.PARTIAL),
    "Diagnostics evidence status and collection status disagree",
  );
  assert(
    initialDiagnostics.result.document.contentFingerprint.startsWith(FINGERPRINT_FORMAT.SHA_256_PREFIX) &&
      initialDiagnostics.result.document.contentFingerprint.length === FINGERPRINT_FORMAT.SHA_256_PREFIX.length + 64,
    "Diagnostics omitted the canonical analyzed-document fingerprint",
  );
  assert(
    initialDiagnosticsVerified === (initialDiagnostics.result.diagnosticsForCurrentDocument !== null),
    "Untrusted diagnostics appeared in the verified diagnostics field",
  );
  if (!initialDiagnosticsVerified) {
    assert(initialDiagnostics.result.unconfirmedDiagnosticReport, "Untrusted diagnostics omitted their separated report");
    if (initialDiagnostics.result.evidence.reason === DIAGNOSTIC_EVIDENCE_REASON.LANGUAGE_SERVER_VERSION_NOT_REPORTED) {
      assert(
        initialDiagnostics.result.diagnosticUse.unconfirmedDiagnosticReportAvailable === true,
        "Unversioned diagnostics did not expose their unconfirmed report",
      );
    }
    if (initialDiagnostics.result.evidence.reason === DIAGNOSTIC_EVIDENCE_REASON.LANGUAGE_SERVER_DID_NOT_REPORT_CURRENT_DOCUMENT) {
      assert(
        initialDiagnostics.result.diagnosticUse.unconfirmedDiagnosticReportAvailable === false,
        "Missing diagnostics claimed that an unconfirmed report was available",
      );
    }
  }

  const textCount = assertResult(
    await client.callTool({
      name: "lsp_count_text_matches",
      arguments: {root: workspace, symbol: "repeatedTarget"},
    }),
    "lsp_count_text_matches",
  );
  assert(textCount.result.matchesFound >= 256, "Text count missed exact identifier matches");
  assert(textCount.result.filesContainingMatches === 5, "Text count returned the wrong file count");
  assert(textCount.result.semanticVerificationPerformed === false, "Text count claimed semantic verification");

  const count = assertResult(
    await client.callTool({
      name: "lsp_count_named_symbol",
      arguments: {root: workspace, symbol: "repeatedTarget", fileHint: "target.ts"},
    }),
    "lsp_count_named_symbol",
  );
  assert(count.presentation.mode === PRESENTATION_MODE.COUNT_ONLY, "Count tool returned locations");
  assert(!("referenceLocationsReturned" in count.presentation), "Count presentation repeated its implied location count");
  assert(count.collection.status === COLLECTION_STATUS.PARTIAL, "Unresolved text match was not reported as partial");
  assert(count.request.definitionLimit.mode === "unlimited", "Omitted definition limit was not represented as unlimited");
  assert(count.request.candidateLimit.mode === "unlimited", "Omitted candidate limit was not represented as unlimited");
  assert(count.result.definitions.length === 1, "fileHint did not select one homonymous definition");
  assert(count.result.definitionSelectionStatus === DEFINITION_SELECTION_STATUS.ONE, "Named count did not report one selected definition");
  assert(
    count.result.semanticEvidence.status === SEMANTIC_EVIDENCE_STATUS.FOLLOW_UP_REQUIRED,
    "Partial named count did not require semantic follow-up",
  );
  assert(
    count.result.semanticEvidence.followUpReasons.includes(SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.COLLECTION_PARTIAL),
    "Partial named count omitted its semantic follow-up reason",
  );
  const countedDefinition = count.result.definitions[0];
  assert(count.continueWith.includes(TOOL.REFERENCE_PAGE), "Named count did not expose its reusable reference set");
  assert(!count.continueWith.includes(TOOL.REFERENCES), "Named count recommended recollecting an existing reference set");
  assert(!("referenceFiles" in countedDefinition), "Named count returned the per-file reference list");
  assert(!("performance" in countedDefinition.collection), "Named count returned detailed collection performance");
  assert(countObjectKey(countedDefinition, "referenceSetId") === 1, "Named count repeated its reference-set identifier");
  assert(countedDefinition.references.verifiedTotal >= 252, "Named count missed references");
  assert(countedDefinition.textSearch.accountingStatus === ACCOUNTING_STATUS.COMPLETE, "Named count did not account for every text match");
  assert(
    countedDefinition.textSearch.matchesWhoseDefinitionCouldNotBeResolved >= 1,
    "Unresolvable text match was incorrectly classified as a different symbol",
  );
  const countedReferencePage = assertResult(
    await client.callTool({
      name: TOOL.REFERENCE_PAGE,
      arguments: {referenceSetId: countedDefinition.referenceSetId, cursor: "0", pageSize: 300},
    }),
    TOOL.REFERENCE_PAGE,
  );
  assert(
    referenceLocations(countedReferencePage.result).some((location) => path.basename(location.file) === path.basename(consumerAliasFile)),
    `Cross-project alias reference was absent from the verified set: ${JSON.stringify({references: countedDefinition.references, textSearch: countedDefinition.textSearch})}`,
  );
  assert(
    count.continueWith.indexOf(TOOL.UNRESOLVED_REFERENCE_PAGE) < count.continueWith.indexOf(TOOL.REFERENCE_PAGE),
    "Named count did not prioritize unresolved evidence before reference locations",
  );

  const missingNamedCount = assertResult(
    await client.callTool({
      name: TOOL.COUNT_NAMED_SYMBOL,
      arguments: {root: workspace, symbol: "symbolThatDoesNotExist"},
    }),
    TOOL.COUNT_NAMED_SYMBOL,
  );
  assert(
    missingNamedCount.result.definitionSelectionStatus === DEFINITION_SELECTION_STATUS.NONE,
    "Missing named count did not report an empty definition selection",
  );
  assert(
    missingNamedCount.result.semanticEvidence.followUpReasons.includes(SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.NO_DEFINITION_SELECTED),
    "Missing named count omitted its semantic disambiguation reason",
  );
  assert(
    missingNamedCount.continueWith.includes(TOOL.WORKSPACE_SYMBOLS),
    "Missing named count did not recommend repository symbol discovery",
  );
  assert(
    !missingNamedCount.continueWith.includes(TOOL.REFERENCE_PAGE),
    "Missing named count recommended a reference page without a reusable reference set",
  );

  const unresolvedPage = assertResult(
    await client.callTool({
      name: TOOL.UNRESOLVED_REFERENCE_PAGE,
      arguments: {referenceSetId: countedDefinition.referenceSetId, pageSize: 10},
    }),
    TOOL.UNRESOLVED_REFERENCE_PAGE,
  );
  assert(unresolvedPage.result.candidates.length >= 1, "Unresolved-reference page omitted unresolved candidates");
  assert(
    unresolvedPage.result.candidates.some((candidate) => path.basename(candidate.file) === "unresolved.ts"),
    "Unresolved-reference page omitted the source location",
  );
  assert(
    unresolvedPage.result.candidates.every((candidate) => Object.values(UNRESOLVED_REFERENCE_REASON).includes(candidate.reason)),
    "Unresolved-reference page returned an unknown reason",
  );
  assert(
    unresolvedPage.result.candidates.every((candidate) => candidate.identifier === "repeatedTarget"),
    "Unresolved-reference page omitted the textual identifier",
  );
  assert(!("offset" in unresolvedPage.presentation), "Unresolved page repeated its cursor as an offset");
  assert(!("pageSize" in unresolvedPage.presentation), "Unresolved page repeated its requested page size");
  assert(!("candidatesReturnedAreSubset" in unresolvedPage.presentation), "Unresolved page returned a derivable subset flag");
  assert(countObjectKey(unresolvedPage, "referenceSetId") === 1, "Unresolved page repeated its reference-set identifier");

  const audit = assertResult(
    await client.callTool({
      name: "lsp_audit_named_symbol",
      arguments: {root: workspace, symbol: "repeatedTarget", fileHint: "target.ts"},
    }),
    "lsp_audit_named_symbol",
  );
  assert(audit.result.audits[0].collection.reusedPreviousCollection === true, "Audit did not reuse the compatible count collection");
  assert(audit.result.definitionSelectionStatus === DEFINITION_SELECTION_STATUS.ONE, "Named audit did not report one selected definition");
  assert(
    audit.result.semanticEvidence.status === SEMANTIC_EVIDENCE_STATUS.FOLLOW_UP_REQUIRED,
    "Partial named audit did not require semantic follow-up",
  );
  assert(audit.continueWith.includes(TOOL.REFERENCE_PAGE), "Named audit did not expose its reusable reference set");
  assert(!audit.continueWith.includes(TOOL.REFERENCES), "Named audit recommended recollecting an existing reference set");
  assert(
    audit.continueWith.indexOf(TOOL.UNRESOLVED_REFERENCE_PAGE) < audit.continueWith.indexOf(TOOL.REFERENCE_PAGE),
    "Named audit did not prioritize unresolved evidence before reference locations",
  );
  assert(audit.presentation.mode === PRESENTATION_MODE.COMPACT_SUMMARY, "Named audit did not use compact presentation");
  assert(!("referenceFiles" in audit.result.audits[0]), "Named audit returned the per-file reference list");
  assert(audit.result.audits[0].filesContainingReferences > 0, "Named audit omitted the reference file count");
  assert(!("performance" in audit.result.audits[0].collection), "Named audit returned detailed collection performance");
  assert(
    audit.result.audits[0].referenceSetId === countedDefinition.referenceSetId,
    "Audit changed the compatible reference-set identifier",
  );

  const positionCount = assertResult(
    await client.callTool({
      name: "lsp_count_references",
      arguments: {file: targetFile, root: workspace, line: 2, column: 17},
    }),
    "lsp_count_references",
  );
  assert(positionCount.result.collection.reusedPreviousCollection === true, "Position count did not reuse the named collection");
  assert(positionCount.continueWith.includes(TOOL.REFERENCE_PAGE), "Position count did not expose its reusable reference set");
  assert(!("referenceFiles" in positionCount.result), "Position count returned the per-file reference list");
  assert(!("performance" in positionCount.result.collection), "Position count returned detailed collection performance");

  const positionAudit = assertResult(
    await client.callTool({
      name: "lsp_audit_symbol",
      arguments: {file: targetFile, root: workspace, line: 2, column: 17},
    }),
    "lsp_audit_symbol",
  );
  assert(positionAudit.result.collection.reusedPreviousCollection === true, "Position audit did not reuse the count collection");
  assert(positionAudit.continueWith.includes(TOOL.REFERENCE_PAGE), "Position audit did not expose its reusable reference set");
  assert(positionAudit.presentation.mode === PRESENTATION_MODE.COMPACT_SUMMARY, "Position audit did not use compact presentation");
  assert(!("referenceFiles" in positionAudit.result), "Position audit returned the per-file reference list");
  assert(positionAudit.result.signature.length > 0, "Position audit omitted the resolved signature");
  assert(
    Object.values(SIGNATURE_SOURCE).includes(positionAudit.result.signatureSource),
    "Position audit returned an unknown signature source",
  );

  const firstPage = assertResult(
    await client.callTool({
      name: "lsp_references",
      arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
    }),
    "lsp_references",
  );
  assert(firstPage.collection.status === COLLECTION_STATUS.PARTIAL, "Reference collection did not preserve unresolved-match uncertainty");
  assert(firstPage.result.referenceFiles.length > 0, "Reference page omitted detailed file evidence");
  assert(firstPage.collection.performance.semanticRequests >= 0, "Reference page omitted collection performance");
  assert(firstPage.presentation.mode === PRESENTATION_MODE.PAGE, "Reference response is not a page");
  assert(firstPage.presentation.locationsReturned === 25, "Reference page size was not applied");
  assert(firstPage.presentation.nextCursor === "25", "Reference page omitted its next cursor");
  const firstPageLocations = referenceLocations(firstPage.result);
  assert(firstPageLocations.length === 25, "Grouped reference page changed its location count");
  assert(
    firstPageLocations.every((item) => item.discoveryMethod),
    "Reference locations omitted literal discovery methods",
  );
  assert(
    firstPage.result.referenceGroups.every((group) => group.file),
    "Reference group omitted its source file",
  );
  assert(countObjectKey(firstPage, "referenceSetId") === 1, "First reference page repeated its reference-set identifier");

  const secondPage = assertResult(
    await client.callTool({
      name: "lsp_reference_page",
      arguments: {referenceSetId: firstPage.result.referenceSetId, cursor: firstPage.presentation.nextCursor, pageSize: 25},
    }),
    "lsp_reference_page",
  );
  assert(!("offset" in secondPage.presentation), "Reference page repeated its cursor as an offset");
  assert(!("pageSize" in secondPage.presentation), "Reference page repeated its requested page size");
  assert(!("locationsReturnedAreSubset" in secondPage.presentation), "Reference page returned a derivable subset flag");
  assert(referenceLocations(secondPage.result).length === 25, "Second page used the wrong size");
  assert(countObjectKey(secondPage, "referenceSetId") === 1, "Later reference page repeated its reference-set identifier");

  await writeFile(usageFile, `${await readFile(usageFile, "utf8")}\nexport const changedAfterCollection = true;\n`);
  assertResult(
    await client.callTool({
      name: "lsp_document_symbols",
      arguments: {file: usageFile},
    }),
    "lsp_document_symbols",
  );
  const stalePage = assertErrorResult(
    await client.callTool({
      name: "lsp_reference_page",
      arguments: {referenceSetId: firstPage.result.referenceSetId, cursor: "0", pageSize: 1},
    }),
    "lsp_reference_page",
  );
  assert(
    stalePage.error.code === ERROR_CODE.REFERENCE_SET_CONTENT_CHANGED,
    "Changed reference set did not report a literal freshness failure",
  );
  assert(
    stalePage.error.details.changedFiles.some((file) => path.basename(file) === path.basename(usageFile)),
    `Freshness failure omitted the changed file: ${JSON.stringify(stalePage.error.details)}`,
  );

  const withoutDeclaration = assertResult(
    await client.callTool({
      name: TOOL.REFERENCES,
      arguments: {file: usageFile, root: workspace, line: 3, column: 3, includeDeclaration: false, pageSize: 300},
    }),
    TOOL.REFERENCES,
  );
  assert(
    withoutDeclaration.result.references.verifiedTotal ===
      withoutDeclaration.result.references.foundByOwningWorkspaceLanguageServer +
        withoutDeclaration.result.references.verifiedFromOtherWorkspaces,
    "Reference source counts do not reconcile with the verified total",
  );
  assert(
    referenceLocations(withoutDeclaration.result).some(
      (location) =>
        path.basename(location.file) === path.basename(usageFile) && location.range.start.line === 3 && location.range.start.column === 3,
    ),
    "includeDeclaration=false removed the originating usage",
  );
  const retainedDeclarations = referenceLocations(withoutDeclaration.result).filter(
    (location) =>
      path.basename(location.file) === path.basename(targetFile) && location.range.start.line === 2 && location.range.start.column === 17,
  );
  assert(retainedDeclarations.length === 0, `includeDeclaration=false retained the declaration: ${JSON.stringify(retainedDeclarations)}`);

  const refreshedPage = assertResult(
    await client.callTool({
      name: "lsp_references",
      arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
    }),
    "lsp_references",
  );
  assert(
    refreshedPage.result.referenceSetId !== firstPage.result.referenceSetId,
    "Fresh collection reused an obsolete reference-set identifier",
  );
  assert(
    refreshedPage.collection.contentFreshness === CONTENT_FRESHNESS.VERIFIED_CURRENT,
    "Fresh collection omitted content freshness evidence",
  );

  await writeFile(path.join(workspace, "jsconfig.json"), JSON.stringify({compilerOptions: {checkJs: true}}));
  const staleAfterConfigurationCreation = assertErrorResult(
    await client.callTool({
      name: "lsp_reference_page",
      arguments: {referenceSetId: refreshedPage.result.referenceSetId, cursor: "0", pageSize: 1},
    }),
    "lsp_reference_page",
  );
  assert(
    staleAfterConfigurationCreation.error.code === ERROR_CODE.REFERENCE_SET_CONTENT_CHANGED,
    "New workspace configuration did not invalidate semantic evidence",
  );

  const afterCreatedConfigurationPage = assertResult(
    await client.callTool({
      name: "lsp_references",
      arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
    }),
    "lsp_references",
  );

  await writeFile(
    path.join(workspace, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler"},
      include: ["src/**/*.ts"],
    }),
  );
  const staleAfterConfigurationChange = assertErrorResult(
    await client.callTool({
      name: "lsp_reference_page",
      arguments: {referenceSetId: afterCreatedConfigurationPage.result.referenceSetId, cursor: "0", pageSize: 1},
    }),
    "lsp_reference_page",
  );
  assert(
    staleAfterConfigurationChange.error.code === ERROR_CODE.REFERENCE_SET_CONTENT_CHANGED,
    "Workspace configuration change did not invalidate semantic evidence",
  );

  const configurationRefreshedPage = assertResult(
    await client.callTool({
      name: "lsp_references",
      arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
    }),
    "lsp_references",
  );

  await writeFile(
    futureReferenceFile,
    ['import {repeatedTarget} from "./target.js";', "export const futureValue = repeatedTarget(998);"].join("\n"),
  );
  const staleAfterPreviouslyUnrelatedFileChanged = assertErrorResult(
    await client.callTool({
      name: "lsp_reference_page",
      arguments: {referenceSetId: configurationRefreshedPage.result.referenceSetId, cursor: "0", pageSize: 1},
    }),
    "lsp_reference_page",
  );
  assert(
    staleAfterPreviouslyUnrelatedFileChanged.error.details.changeType === REFERENCE_SET_CHANGE_TYPE.REPOSITORY_SOURCE_INVENTORY_CHANGED,
    "Previously unrelated source edit reported the wrong freshness reason",
  );
  assert(
    staleAfterPreviouslyUnrelatedFileChanged.error.details.currentSourceFileCount ===
      staleAfterPreviouslyUnrelatedFileChanged.error.details.previousSourceFileCount,
    "Existing source edit unexpectedly changed inventory size",
  );

  const existingSourceRefreshedPage = assertResult(
    await client.callTool({
      name: "lsp_references",
      arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
    }),
    "lsp_references",
  );
  assert(
    existingSourceRefreshedPage.result.references.verifiedTotal > configurationRefreshedPage.result.references.verifiedTotal,
    "Fresh collection did not include the reference added to an existing file",
  );

  await writeFile(
    path.join(src, "new-reference.ts"),
    ['import {repeatedTarget} from "./target.js";', "export const newReference = repeatedTarget(999);"].join("\n"),
  );
  const staleAfterNewSourceFile = assertErrorResult(
    await client.callTool({
      name: "lsp_reference_page",
      arguments: {referenceSetId: existingSourceRefreshedPage.result.referenceSetId, cursor: "0", pageSize: 1},
    }),
    "lsp_reference_page",
  );
  assert(
    staleAfterNewSourceFile.error.code === ERROR_CODE.REFERENCE_SET_CONTENT_CHANGED,
    "New source file did not invalidate semantic evidence",
  );
  assert(
    staleAfterNewSourceFile.error.details.changeType === REFERENCE_SET_CHANGE_TYPE.REPOSITORY_SOURCE_INVENTORY_CHANGED,
    "New source file reported the wrong freshness reason",
  );
  assert(
    staleAfterNewSourceFile.error.details.currentSourceFileCount > staleAfterNewSourceFile.error.details.previousSourceFileCount,
    "New source file did not change the reported inventory size",
  );

  const sourceInventoryRefreshedPage = assertResult(
    await client.callTool({
      name: "lsp_references",
      arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
    }),
    "lsp_references",
  );
  assert(
    sourceInventoryRefreshedPage.result.references.verifiedTotal > configurationRefreshedPage.result.references.verifiedTotal,
    "Fresh collection did not include the new source reference",
  );

  const limited = assertResult(
    await client.callTool({
      name: "lsp_count_references",
      arguments: {file: targetFile, root: workspace, line: 2, column: 17, maxCandidates: 50},
    }),
    "lsp_count_references",
  );
  assert(limited.collection.status === COLLECTION_STATUS.LIMITED, "Explicit candidate limit was not reported as limited");
  assert(limited.collection.stoppedByLimit === true, "Explicit candidate limit was not reported literally");
  assert(
    limited.result.textSearch.matchesFound > limited.result.textSearch.matchesChecked,
    "Limited collection did not preserve the full text-match count",
  );
  assert(
    limited.result.textSearch.accountingStatus === ACCOUNTING_STATUS.INCOMPLETE,
    "Limited collection claimed to account for every match",
  );

  const evictedPage = assertErrorResult(
    await client.callTool({
      name: "lsp_reference_page",
      arguments: {referenceSetId: sourceInventoryRefreshedPage.result.referenceSetId, cursor: "0", pageSize: 1},
    }),
    "lsp_reference_page",
  );
  assert(evictedPage.error.code === ERROR_CODE.REFERENCE_SET_NOT_FOUND_OR_EXPIRED, "Evicted reference set omitted its literal error code");

  await delay(2200);
  const expiredPage = assertErrorResult(
    await client.callTool({
      name: "lsp_reference_page",
      arguments: {referenceSetId: limited.result.referenceSetId, cursor: "0", pageSize: 1},
    }),
    "lsp_reference_page",
  );
  assert(expiredPage.error.code === ERROR_CODE.REFERENCE_SET_NOT_FOUND_OR_EXPIRED, "Expired reference set omitted its literal error code");

  const supersededDiagnosticsPromise = client.callTool({name: TOOL.DIAGNOSTICS, arguments: {file: targetFile}});
  await delay(500);
  await writeFile(
    targetFile,
    [
      "/** Returns the next integer. */",
      "export function repeatedTarget(value: number): number {",
      "  return value + missingAfterDiagnosticChange;",
      "}",
    ].join("\n"),
  );
  const supersededDiagnostics = assertResult(await supersededDiagnosticsPromise, TOOL.DIAGNOSTICS);
  assertDiagnosticUse(supersededDiagnostics.result, "Superseded diagnostics returned inconsistent usage guidance");
  assert(
    supersededDiagnostics.result.evidence.status === EVIDENCE_STATUS.UNTRUSTED,
    "Diagnostics trusted content that changed during acquisition",
  );
  assert(
    supersededDiagnostics.result.evidence.reason === DIAGNOSTIC_EVIDENCE_REASON.DOCUMENT_CONTENT_CHANGED_DURING_ACQUISITION,
    "Diagnostics omitted the content-change evidence reason",
  );
  const [changedDiagnosticsResponse, concurrentChangedDiagnosticsResponse] = await Promise.all([
    client.callTool({name: TOOL.DIAGNOSTICS, arguments: {file: targetFile}}),
    client.callTool({name: TOOL.DIAGNOSTICS, arguments: {file: targetFile}}),
  ]);
  const changedDiagnostics = assertResult(changedDiagnosticsResponse, TOOL.DIAGNOSTICS);
  const concurrentChangedDiagnostics = assertResult(concurrentChangedDiagnosticsResponse, TOOL.DIAGNOSTICS);
  assertDiagnosticUse(changedDiagnostics.result, "Changed diagnostics returned inconsistent usage guidance");
  deepStrictEqual(
    concurrentChangedDiagnostics.result.document,
    changedDiagnostics.result.document,
    "Concurrent changed diagnostics did not use the same document snapshot",
  );
  deepStrictEqual(
    concurrentChangedDiagnostics.result.evidence,
    changedDiagnostics.result.evidence,
    "Concurrent changed diagnostics disagreed about snapshot evidence",
  );
  assert(
    changedDiagnostics.result.document.version > initialDiagnostics.result.document.version,
    "Changed diagnostics did not advance the open document version",
  );
  const changedReport = changedDiagnostics.result.diagnosticsForCurrentDocument || changedDiagnostics.result.unconfirmedDiagnosticReport;
  assert(
    changedDiagnostics.result.provenance.provider === DIAGNOSTIC_PROVIDER.TYPESCRIPT_LANGUAGE_SERVER &&
      changedDiagnostics.result.provenance.documentLanguage === DIAGNOSTIC_LANGUAGE.TYPESCRIPT,
    "TypeScript diagnostics omitted provider or document-language provenance",
  );
  if (changedDiagnostics.result.evidence.status === EVIDENCE_STATUS.VERIFIED) {
    assert(
      changedReport.items.some((item) => item.message.includes("missingAfterDiagnosticChange")),
      "Verified changed diagnostics did not report the introduced error",
    );
  }
  assert(
    changedReport.items.every(
      (item) => item.embeddedRegion === DIAGNOSTIC_REGION.DOCUMENT && item.embeddedLanguage === DIAGNOSTIC_LANGUAGE.TYPESCRIPT,
    ),
    "TypeScript diagnostics did not identify the containing document language",
  );
  if (changedDiagnostics.result.evidence.status === EVIDENCE_STATUS.UNTRUSTED) {
    assert(changedDiagnostics.result.diagnosticsForCurrentDocument === null, "Untrusted changed diagnostics appeared as verified evidence");
    assert(changedDiagnostics.collection.status === COLLECTION_STATUS.PARTIAL, "Untrusted changed diagnostics did not remain partial");
  }

  assertResult(
    await client.callTool({
      name: "lsp_document_symbols",
      arguments: {file: targetFile},
    }),
    "lsp_document_symbols",
  );

  console.log(
    JSON.stringify(
      {
        tools: expectedTools,
        yamlRepresentation: "ok",
        structuredJsonContract: "ok",
        visibleProducerAndSchemaVersion: "ok",
        positionSignatureEvidence: "ok",
        unlimitedCollection: "ok",
        explicitLimitReporting: "ok",
        countReuse: "ok",
        cheapTextCount: "ok",
        referencePagination: "ok",
        referenceContentFreshness: "ok",
        repositorySourceInventoryFreshness: "ok",
        unresolvedClassification: "ok",
        unresolvedCandidateEvidence: "ok",
        crossProjectAliasAndDecorator: "ok",
        declarationExclusionAccounting: "ok",
        nodeModuleExtensions: "ok",
        diagnosticVersionReporting: "ok",
        actionableDiagnosticUse: "ok",
        sharedDiagnosticAcquisition: "ok",
        diagnosticContentFreshness: "ok",
        diagnosticProvenance: "ok",
        automaticMemoryCleanup: "ok",
        candidateBoundaryFilter: "ok",
        ambiguousPublicFields: "absent",
      },
      null,
      2,
    ),
  );
} finally {
  await client.close().catch(() => undefined);
  await removeTemporaryDirectory(workspace);
}
