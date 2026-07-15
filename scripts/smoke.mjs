#!/usr/bin/env node

import path from "node:path";
import {deepStrictEqual} from "node:assert";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {parse as parseYaml} from "yaml";
import {
  ACCOUNTING_STATUS,
  COLLECTION_STATUS,
  CONTENT_FRESHNESS,
  DEFINITION_MATCH,
  EVIDENCE_STATUS,
  DIAGNOSTIC_FRESHNESS,
  ENVIRONMENT_VARIABLE,
  ERROR_CODE,
  FORBIDDEN_PUBLIC_FIELD,
  PRESENTATION_MODE,
  PRODUCT,
  REFERENCE_SET_CHANGE_TYPE,
  RESULT_SCHEMA,
  SERVER_VERSION,
  SIGNATURE_SOURCE,
  TOOL,
  TOOL_ORDER,
  UNRESOLVED_REFERENCE_REASON,
} from "../protocol.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedTools = [...TOOL_ORDER];
const forbiddenPublicKeys = new Set(FORBIDDEN_PUBLIC_FIELD);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

function assertResult(response, tool) {
  assert(!response.isError, response.content?.[0]?.text || `${tool} failed`);
  assert(response.structuredContent?.tool === tool, `${tool} omitted its canonical tool name`);
  assert(response.structuredContent?.server?.name === PRODUCT.NAME, `${tool} omitted its canonical server name`);
  assert(response.structuredContent?.server?.version === SERVER_VERSION, `${tool} omitted its canonical server version`);
  assert(response.structuredContent?.resultSchema?.name === RESULT_SCHEMA.NAME, `${tool} omitted its canonical result schema name`);
  assert(response.structuredContent?.resultSchema?.version === RESULT_SCHEMA.VERSION, `${tool} omitted its canonical result schema version`);
  assert(response._meta?.resultSchema === RESULT_SCHEMA.NAME, `${tool} omitted result schema metadata`);
  assert(response._meta?.resultSchemaVersion === RESULT_SCHEMA.VERSION, `${tool} returned the wrong result schema version`);
  const yaml = response.content?.find((item) => item.type === "text")?.text || "";
  assert(yaml.includes(`tool: ${tool}`), `${tool} did not provide YAML model text`);
  assert(!yaml.trimStart().startsWith("{"), `${tool} rendered JSON instead of YAML model text`);
  deepStrictEqual(parseYaml(yaml), response.structuredContent, `${tool} YAML and structured JSON differ`);
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
await writeFile(path.join(workspace, "tsconfig.json"), JSON.stringify({
  compilerOptions: {strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", experimentalDecorators: true},
  include: ["src/**/*.ts"],
}));
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
await mkdir(consumerSrc, {recursive: true});
await writeFile(path.join(consumer, "package.json"), JSON.stringify({private: true, type: "module"}));
await writeFile(path.join(consumer, "tsconfig.json"), JSON.stringify({
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
}));
await writeFile(targetFile, [
  "/** Returns the next integer. */",
  "export function repeatedTarget(value: number): number {",
  "  return value + 1;",
  "}",
].join("\n"));
const calls = Array.from({length: 250}, (_, index) => `  repeatedTarget(${index}),`).join("\n");
await writeFile(usageFile, [
  'import {repeatedTarget} from "./target.js";',
  "export const values = [",
  calls,
  "];",
].join("\n"));
await writeFile(unrelatedFile, [
  "export function repeatedTarget(value: string): string { return value; }",
  'export const unrelatedValue = repeatedTarget("separate symbol");',
].join("\n"));
await writeFile(unresolvedFile, 'export const unresolvedText = "repeatedTarget";\n');
await writeFile(futureReferenceFile, "export const futureValue = 1;\n");
await writeFile(decoratedFile, [
  "export function registered<T extends new (...args: any[]) => object>(target: T): T { return target; }",
  "@registered",
  "export class DecoratedService { run(): number { return 1; } }",
].join("\n"));
await writeFile(consumerAliasFile, [
  'import {repeatedTarget} from "@root/target";',
  'import {DecoratedService} from "@root/decorated";',
  "export const aliasValue = repeatedTarget(new DecoratedService().run());",
].join("\n"));
await writeFile(moduleFile, "export function moduleFunction(value) { return value; }\n");

const client = new Client({name: "semantic-js-mcp-generic-smoke", version: "1.0.0"});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(pluginRoot, "server.mjs")],
  cwd: pluginRoot,
  env: {
    ...process.env,
    [ENVIRONMENT_VARIABLE.CLIENT_IDLE_TIMEOUT_MS]: "10000",
    [ENVIRONMENT_VARIABLE.REFERENCE_SET_TTL_MS]: "2000",
    [ENVIRONMENT_VARIABLE.MAXIMUM_CACHED_REFERENCE_LOCATIONS]: "300",
  },
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  assert(JSON.stringify(listed.tools.map((tool) => tool.name)) === JSON.stringify(expectedTools), "Tool order or tool set changed");

  const symbols = assertResult(await client.callTool({
    name: "lsp_document_symbols",
    arguments: {file: targetFile},
  }), "lsp_document_symbols");
  assert(symbols.result.symbols.some((symbol) => symbol.name === "repeatedTarget"), "Document symbol missing");
  assert(symbols.request.resultLimit.mode === "unlimited", "Omitted result limit must be represented as unlimited");

  const moduleSymbols = assertResult(await client.callTool({
    name: TOOL.DOCUMENT_SYMBOLS,
    arguments: {file: moduleFile, root: workspace},
  }), TOOL.DOCUMENT_SYMBOLS);
  assert(moduleSymbols.result.symbols.some((symbol) => symbol.name === "moduleFunction"), "MJS document symbol missing");

  const workspaceSymbols = assertResult(await client.callTool({
    name: "lsp_workspace_symbols",
    arguments: {root: workspace, query: "repeatedTarget"},
  }), "lsp_workspace_symbols");
  assert(workspaceSymbols.result.symbolsFound >= 2, "Expected both homonymous definitions");

  const definition = assertResult(await client.callTool({
    name: "lsp_definition",
    arguments: {file: usageFile, line: 3, column: 3},
  }), "lsp_definition");
  assert(definition.result.definitionMatch === DEFINITION_MATCH.RESOLVED, "Definition was not resolved");
  assert(definition.result.definitions.some((item) => path.basename(item.file) === "target.ts"), "Definition resolved to the wrong symbol");

  const aliasDefinition = assertResult(await client.callTool({
    name: TOOL.DEFINITION,
    arguments: {file: consumerAliasFile, root: workspace, line: 3, column: 27},
  }), TOOL.DEFINITION);
  assert(aliasDefinition.result.definitions.some((item) => path.basename(item.file) === "target.ts"), "Cross-project path alias did not resolve to its definition");

  const decoratedDefinition = assertResult(await client.callTool({
    name: TOOL.DEFINITION,
    arguments: {file: consumerAliasFile, root: workspace, line: 2, column: 9},
  }), TOOL.DEFINITION);
  assert(decoratedDefinition.result.definitions.some((item) => path.basename(item.file) === "decorated.ts"), "Decorated class imported through a path alias did not resolve");

  const hover = assertResult(await client.callTool({
    name: "lsp_hover",
    arguments: {file: targetFile, line: 2, column: 17},
  }), "lsp_hover");
  assert(hover.result.typeAndDocumentation.includes("repeatedTarget"), "Hover omitted the function signature");

  const initialDiagnostics = assertResult(await client.callTool({
    name: "lsp_diagnostics",
    arguments: {file: targetFile},
  }), "lsp_diagnostics");
  const initialDiagnosticsVerified = initialDiagnostics.result.evidence.status === EVIDENCE_STATUS.VERIFIED;
  assert(initialDiagnostics.collection.status === (initialDiagnosticsVerified ? COLLECTION_STATUS.COMPLETE : COLLECTION_STATUS.PARTIAL), "Diagnostics evidence status and collection status disagree");
  assert(initialDiagnostics.result.document.contentFingerprint.length === 64, "Diagnostics omitted the analyzed document fingerprint");
  assert(initialDiagnosticsVerified === (initialDiagnostics.result.diagnosticsForCurrentDocument !== null), "Untrusted diagnostics appeared in the verified diagnostics field");
  if (!initialDiagnosticsVerified) {
    assert(initialDiagnostics.result.unconfirmedDiagnosticReport, "Untrusted diagnostics omitted their separated report");
  }

  const textCount = assertResult(await client.callTool({
    name: "lsp_count_text_matches",
    arguments: {root: workspace, symbol: "repeatedTarget"},
  }), "lsp_count_text_matches");
  assert(textCount.result.matchesFound >= 256, "Text count missed exact identifier matches");
  assert(textCount.result.filesContainingMatches === 5, "Text count returned the wrong file count");
  assert(textCount.result.semanticVerificationPerformed === false, "Text count claimed semantic verification");

  const count = assertResult(await client.callTool({
    name: "lsp_count_named_symbol",
    arguments: {root: workspace, symbol: "repeatedTarget", fileHint: "target.ts"},
  }), "lsp_count_named_symbol");
  assert(count.presentation.mode === PRESENTATION_MODE.COUNT_ONLY, "Count tool returned locations");
  assert(count.presentation.referenceLocationsReturned === 0, "Count tool returned reference locations");
  assert(count.collection.status === COLLECTION_STATUS.PARTIAL, "Unresolved text match was not reported as partial");
  assert(count.request.definitionLimit.mode === "unlimited", "Omitted definition limit was not represented as unlimited");
  assert(count.request.candidateLimit.mode === "unlimited", "Omitted candidate limit was not represented as unlimited");
  assert(count.result.definitions.length === 1, "fileHint did not select one homonymous definition");
  const countedDefinition = count.result.definitions[0];
  assert(countedDefinition.references.verifiedTotal >= 252, "Named count missed references");
  assert(countedDefinition.textSearch.accountingStatus === ACCOUNTING_STATUS.COMPLETE, "Named count did not account for every text match");
  assert(countedDefinition.textSearch.matchesWhoseDefinitionCouldNotBeResolved >= 1, "Unresolvable text match was incorrectly classified as a different symbol");
  assert(countedDefinition.references.verifiedFromOtherWorkspaces >= 1, "Cross-project alias reference was not verified from its owning workspace");

  const unresolvedPage = assertResult(await client.callTool({
    name: TOOL.UNRESOLVED_REFERENCE_PAGE,
    arguments: {referenceSetId: countedDefinition.referenceSetId, pageSize: 10},
  }), TOOL.UNRESOLVED_REFERENCE_PAGE);
  assert(unresolvedPage.result.candidates.length >= 1, "Unresolved-reference page omitted unresolved candidates");
  assert(unresolvedPage.result.candidates.some((candidate) => path.basename(candidate.file) === "unresolved.ts"), "Unresolved-reference page omitted the source location");
  assert(unresolvedPage.result.candidates.every((candidate) => Object.values(UNRESOLVED_REFERENCE_REASON).includes(candidate.reason)), "Unresolved-reference page returned an unknown reason");
  assert(unresolvedPage.result.candidates.every((candidate) => candidate.identifier === "repeatedTarget"), "Unresolved-reference page omitted the textual identifier");

  const audit = assertResult(await client.callTool({
    name: "lsp_audit_named_symbol",
    arguments: {root: workspace, symbol: "repeatedTarget", fileHint: "target.ts"},
  }), "lsp_audit_named_symbol");
  assert(audit.result.audits[0].collection.reusedPreviousCollection === true, "Audit did not reuse the compatible count collection");
  assert(audit.result.audits[0].referenceSetId === countedDefinition.referenceSetId, "Audit changed the compatible reference-set identifier");

  const positionCount = assertResult(await client.callTool({
    name: "lsp_count_references",
    arguments: {file: targetFile, root: workspace, line: 2, column: 17},
  }), "lsp_count_references");
  assert(positionCount.result.collection.reusedPreviousCollection === true, "Position count did not reuse the named collection");

  const positionAudit = assertResult(await client.callTool({
    name: "lsp_audit_symbol",
    arguments: {file: targetFile, root: workspace, line: 2, column: 17},
  }), "lsp_audit_symbol");
  assert(positionAudit.result.collection.reusedPreviousCollection === true, "Position audit did not reuse the count collection");
  assert(positionAudit.result.signature.length > 0, "Position audit omitted the resolved signature");
  assert(Object.values(SIGNATURE_SOURCE).includes(positionAudit.result.signatureSource), "Position audit returned an unknown signature source");

  const firstPage = assertResult(await client.callTool({
    name: "lsp_references",
    arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
  }), "lsp_references");
  assert(firstPage.collection.status === COLLECTION_STATUS.PARTIAL, "Reference collection did not preserve unresolved-match uncertainty");
  assert(firstPage.presentation.mode === PRESENTATION_MODE.PAGE, "Reference response is not a page");
  assert(firstPage.presentation.locationsReturned === 25, "Reference page size was not applied");
  assert(firstPage.presentation.nextCursor === "25", "Reference page omitted its next cursor");
  assert(firstPage.result.locations.every((item) => item.discoveryMethod), "Reference locations omitted literal discovery methods");

  const secondPage = assertResult(await client.callTool({
    name: "lsp_reference_page",
    arguments: {referenceSetId: firstPage.result.referenceSetId, cursor: firstPage.presentation.nextCursor, pageSize: 25},
  }), "lsp_reference_page");
  assert(secondPage.presentation.offset === 25, "Second page used the wrong offset");
  assert(secondPage.result.locations.length === 25, "Second page used the wrong size");
  assert(secondPage.result.referenceSetId === firstPage.result.referenceSetId, "Pagination changed the reference set");

  await writeFile(usageFile, `${await readFile(usageFile, "utf8")}\nexport const changedAfterCollection = true;\n`);
  assertResult(await client.callTool({
    name: "lsp_document_symbols",
    arguments: {file: usageFile},
  }), "lsp_document_symbols");
  const stalePage = assertErrorResult(await client.callTool({
    name: "lsp_reference_page",
    arguments: {referenceSetId: firstPage.result.referenceSetId, cursor: "0", pageSize: 1},
  }), "lsp_reference_page");
  assert(stalePage.error.code === ERROR_CODE.REFERENCE_SET_CONTENT_CHANGED, "Changed reference set did not report a literal freshness failure");
  assert(stalePage.error.details.changedFiles.some((file) => path.basename(file) === path.basename(usageFile)), `Freshness failure omitted the changed file: ${JSON.stringify(stalePage.error.details)}`);

  const withoutDeclaration = assertResult(await client.callTool({
    name: TOOL.REFERENCES,
    arguments: {file: usageFile, root: workspace, line: 3, column: 3, includeDeclaration: false, pageSize: 300},
  }), TOOL.REFERENCES);
  assert(
    withoutDeclaration.result.references.verifiedTotal ===
      withoutDeclaration.result.references.foundByOwningWorkspaceLanguageServer +
      withoutDeclaration.result.references.verifiedFromOtherWorkspaces,
    "Reference source counts do not reconcile with the verified total",
  );
  assert(withoutDeclaration.result.locations.some((location) =>
    path.basename(location.file) === path.basename(usageFile) &&
    location.range.start.line === 3 &&
    location.range.start.column === 3,
  ), "includeDeclaration=false removed the originating usage");
  assert(!withoutDeclaration.result.locations.some((location) =>
    path.basename(location.file) === path.basename(targetFile) &&
    location.range.start.line === 2 &&
    location.range.start.column === 17,
  ), "includeDeclaration=false retained the declaration");

  const refreshedPage = assertResult(await client.callTool({
    name: "lsp_references",
    arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
  }), "lsp_references");
  assert(refreshedPage.result.referenceSetId !== firstPage.result.referenceSetId, "Fresh collection reused an obsolete reference-set identifier");
  assert(refreshedPage.collection.contentFreshness === CONTENT_FRESHNESS.VERIFIED_CURRENT, "Fresh collection omitted content freshness evidence");

  await writeFile(path.join(workspace, "jsconfig.json"), JSON.stringify({compilerOptions: {checkJs: true}}));
  const staleAfterConfigurationCreation = assertErrorResult(await client.callTool({
    name: "lsp_reference_page",
    arguments: {referenceSetId: refreshedPage.result.referenceSetId, cursor: "0", pageSize: 1},
  }), "lsp_reference_page");
  assert(staleAfterConfigurationCreation.error.code === ERROR_CODE.REFERENCE_SET_CONTENT_CHANGED, "New workspace configuration did not invalidate semantic evidence");

  const afterCreatedConfigurationPage = assertResult(await client.callTool({
    name: "lsp_references",
    arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
  }), "lsp_references");

  await writeFile(path.join(workspace, "tsconfig.json"), JSON.stringify({
    compilerOptions: {strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler"},
    include: ["src/**/*.ts"],
  }));
  const staleAfterConfigurationChange = assertErrorResult(await client.callTool({
    name: "lsp_reference_page",
    arguments: {referenceSetId: afterCreatedConfigurationPage.result.referenceSetId, cursor: "0", pageSize: 1},
  }), "lsp_reference_page");
  assert(staleAfterConfigurationChange.error.code === ERROR_CODE.REFERENCE_SET_CONTENT_CHANGED, "Workspace configuration change did not invalidate semantic evidence");

  const configurationRefreshedPage = assertResult(await client.callTool({
    name: "lsp_references",
    arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
  }), "lsp_references");

  await writeFile(futureReferenceFile, [
    'import {repeatedTarget} from "./target.js";',
    "export const futureValue = repeatedTarget(998);",
  ].join("\n"));
  const staleAfterPreviouslyUnrelatedFileChanged = assertErrorResult(await client.callTool({
    name: "lsp_reference_page",
    arguments: {referenceSetId: configurationRefreshedPage.result.referenceSetId, cursor: "0", pageSize: 1},
  }), "lsp_reference_page");
  assert(staleAfterPreviouslyUnrelatedFileChanged.error.details.changeType === REFERENCE_SET_CHANGE_TYPE.REPOSITORY_SOURCE_INVENTORY_CHANGED, "Previously unrelated source edit reported the wrong freshness reason");
  assert(staleAfterPreviouslyUnrelatedFileChanged.error.details.currentSourceFileCount === staleAfterPreviouslyUnrelatedFileChanged.error.details.previousSourceFileCount, "Existing source edit unexpectedly changed inventory size");

  const existingSourceRefreshedPage = assertResult(await client.callTool({
    name: "lsp_references",
    arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
  }), "lsp_references");
  assert(existingSourceRefreshedPage.result.references.verifiedTotal > configurationRefreshedPage.result.references.verifiedTotal, "Fresh collection did not include the reference added to an existing file");

  await writeFile(path.join(src, "new-reference.ts"), [
    'import {repeatedTarget} from "./target.js";',
    "export const newReference = repeatedTarget(999);",
  ].join("\n"));
  const staleAfterNewSourceFile = assertErrorResult(await client.callTool({
    name: "lsp_reference_page",
    arguments: {referenceSetId: existingSourceRefreshedPage.result.referenceSetId, cursor: "0", pageSize: 1},
  }), "lsp_reference_page");
  assert(staleAfterNewSourceFile.error.code === ERROR_CODE.REFERENCE_SET_CONTENT_CHANGED, "New source file did not invalidate semantic evidence");
  assert(staleAfterNewSourceFile.error.details.changeType === REFERENCE_SET_CHANGE_TYPE.REPOSITORY_SOURCE_INVENTORY_CHANGED, "New source file reported the wrong freshness reason");
  assert(staleAfterNewSourceFile.error.details.currentSourceFileCount > staleAfterNewSourceFile.error.details.previousSourceFileCount, "New source file did not change the reported inventory size");

  const sourceInventoryRefreshedPage = assertResult(await client.callTool({
    name: "lsp_references",
    arguments: {file: targetFile, root: workspace, line: 2, column: 17, pageSize: 25},
  }), "lsp_references");
  assert(sourceInventoryRefreshedPage.result.references.verifiedTotal > configurationRefreshedPage.result.references.verifiedTotal, "Fresh collection did not include the new source reference");

  const limited = assertResult(await client.callTool({
    name: "lsp_count_references",
    arguments: {file: targetFile, root: workspace, line: 2, column: 17, maxCandidates: 50},
  }), "lsp_count_references");
  assert(limited.collection.status === COLLECTION_STATUS.LIMITED, "Explicit candidate limit was not reported as limited");
  assert(limited.collection.stoppedByLimit === true, "Explicit candidate limit was not reported literally");
  assert(limited.result.textSearch.matchesFound > limited.result.textSearch.matchesChecked, "Limited collection did not preserve the full text-match count");
  assert(limited.result.textSearch.accountingStatus === ACCOUNTING_STATUS.INCOMPLETE, "Limited collection claimed to account for every match");

  const evictedPage = assertErrorResult(await client.callTool({
    name: "lsp_reference_page",
    arguments: {referenceSetId: sourceInventoryRefreshedPage.result.referenceSetId, cursor: "0", pageSize: 1},
  }), "lsp_reference_page");
  assert(evictedPage.error.code === ERROR_CODE.REFERENCE_SET_NOT_FOUND_OR_EXPIRED, "Evicted reference set omitted its literal error code");

  await delay(2200);
  const expiredPage = assertErrorResult(await client.callTool({
    name: "lsp_reference_page",
    arguments: {referenceSetId: limited.result.referenceSetId, cursor: "0", pageSize: 1},
  }), "lsp_reference_page");
  assert(expiredPage.error.code === ERROR_CODE.REFERENCE_SET_NOT_FOUND_OR_EXPIRED, "Expired reference set omitted its literal error code");

  await writeFile(targetFile, [
    "/** Returns the next integer. */",
    "export function repeatedTarget(value: number): number {",
    "  return value + missingAfterDiagnosticChange;",
    "}",
  ].join("\n"));
  const changedDiagnostics = assertResult(await client.callTool({
    name: "lsp_diagnostics",
    arguments: {file: targetFile},
  }), "lsp_diagnostics");
  assert(changedDiagnostics.result.document.version > initialDiagnostics.result.document.version, "Changed diagnostics did not advance the open document version");
  const changedReport = changedDiagnostics.result.diagnosticsForCurrentDocument || changedDiagnostics.result.unconfirmedDiagnosticReport;
  assert(changedReport.items.some((item) => item.message.includes("missingAfterDiagnosticChange")), "Changed diagnostics did not report the introduced error");
  if (changedDiagnostics.result.evidence.status === EVIDENCE_STATUS.UNTRUSTED) {
    assert(changedDiagnostics.result.diagnosticsForCurrentDocument === null, "Untrusted changed diagnostics appeared as verified evidence");
    assert(changedDiagnostics.collection.status === COLLECTION_STATUS.PARTIAL, "Untrusted changed diagnostics did not remain partial");
  }

  assertResult(await client.callTool({
    name: "lsp_document_symbols",
    arguments: {file: targetFile},
  }), "lsp_document_symbols");

  console.log(JSON.stringify({
    tools: expectedTools,
    yamlRepresentation: "ok",
    structuredJsonContract: "ok",
    visibleServerAndSchemaVersion: "ok",
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
    automaticMemoryCleanup: "ok",
    ambiguousPublicFields: "absent",
  }, null, 2));
} finally {
  await client.close().catch(() => undefined);
  await rm(workspace, {recursive: true, force: true});
}
