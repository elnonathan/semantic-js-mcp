#!/usr/bin/env node

import path from "node:path";
import {deepStrictEqual} from "node:assert";
import {mkdtemp, mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {parse as parseYaml} from "yaml";
import {removeTemporaryDirectory} from "../lib/temporary-directory.mjs";
import {
  ACCOUNTING_STATUS,
  COLLECTION_STATUS,
  ENVIRONMENT_VARIABLE,
  DEFINITION_RESOLUTION_METHOD,
  DEFINITION_SELECTION_STATUS,
  DIAGNOSTIC_EVIDENCE_REASON,
  DIAGNOSTIC_GUIDANCE,
  DIAGNOSTIC_LANGUAGE,
  DIAGNOSTIC_PROVIDER,
  DIAGNOSTIC_REGION,
  EVIDENCE_STATUS,
  SEMANTIC_EVIDENCE_FOLLOW_UP_REASON,
  SEMANTIC_EVIDENCE_STATUS,
  TOOL,
} from "../protocol.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_VUE_PACKAGE_NAME = "vue";
const FIXTURE_VUE_VERSION = "3.5.0";
const FIXTURE_ALIASED_COMPONENT_FILE_NAME = "AliasedPanel.vue";
const FIXTURE_ALIASED_COMPONENT_LOCAL_NAME = "RenamedPanel";
const COMPONENT_POSITION = Object.freeze({
  CHILD_TEMPLATE: Object.freeze({line: 12, column: 4}),
  ALIASED_IMPORT: Object.freeze({line: 3, column: 8}),
  ALIASED_TEMPLATE: Object.freeze({line: 13, column: 4}),
});
const workspace = await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-vue-smoke-"));
const src = path.join(workspace, "src");
const vuePackage = path.join(workspace, "node_modules", FIXTURE_VUE_PACKAGE_NAME);
const component = path.join(src, "CounterPanel.vue");
const diagnosticComponent = path.join(src, "DiagnosticPanel.vue");
const childComponent = path.join(src, "ChildPanel.vue");
const aliasedComponent = path.join(src, FIXTURE_ALIASED_COMPONENT_FILE_NAME);
const unrelatedComponent = path.join(src, "UnrelatedPanel.vue");
await mkdir(src, {recursive: true});
await mkdir(vuePackage, {recursive: true});
await writeFile(
  path.join(workspace, "package.json"),
  JSON.stringify({private: true, type: "module", dependencies: {[FIXTURE_VUE_PACKAGE_NAME]: FIXTURE_VUE_VERSION}}),
);
await writeFile(
  path.join(vuePackage, "package.json"),
  JSON.stringify({
    name: FIXTURE_VUE_PACKAGE_NAME,
    version: FIXTURE_VUE_VERSION,
    types: "index.d.ts",
    exports: {".": {types: "./index.d.ts"}},
  }),
);
await writeFile(
  path.join(vuePackage, "index.d.ts"),
  [
    "export type DefineComponent<Props = {}, RawBindings = {}, Data = {}> = unknown;",
    "export declare function defineComponent<T>(component: T): T;",
  ].join("\n"),
);
await writeFile(
  path.join(workspace, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler"},
    include: ["src/**/*.vue"],
  }),
);
await writeFile(
  childComponent,
  [
    '<script setup lang="ts">',
    "defineProps<{label: string}>();",
    "function sharedAction(): string { return 'child'; }",
    "</script>",
    "<template><span>{{ label }}</span></template>",
  ].join("\n"),
);
await writeFile(
  aliasedComponent,
  ['<script setup lang="ts">', "defineProps<{message: string}>();", "</script>", "<template><span>{{ message }}</span></template>"].join(
    "\n",
  ),
);
await writeFile(unrelatedComponent, '<script setup lang="ts">\nconst unrelated = true;\n</script>\n<template>{{ unrelated }}</template>');
await writeFile(
  component,
  [
    '<script setup lang="ts">',
    'import ChildPanel from "./ChildPanel.vue";',
    `import ${FIXTURE_ALIASED_COMPONENT_LOCAL_NAME} from "./${FIXTURE_ALIASED_COMPONENT_FILE_NAME}";`,
    "const count = 0;",
    "function increment(value: number): number {",
    "  return value + 1;",
    "}",
    "function sharedAction(): string { return 'parent'; }",
    "const nextCount = increment(count);",
    "</script>",
    "<template>",
    '  <ChildPanel label="Count" />',
    `  <${FIXTURE_ALIASED_COMPONENT_LOCAL_NAME} message="Aliased" />`,
    "  <button>{{ nextCount }}</button>",
    "</template>",
  ].join("\n"),
);

const client = new Client({name: "semantic-js-mcp-vue-smoke", version: "1.0.0"});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(pluginRoot, "server.mjs")],
  cwd: pluginRoot,
  env: {...process.env, [ENVIRONMENT_VARIABLE.WORKSPACE_ROOTS]: tmpdir()},
});

try {
  await client.connect(transport);
  const response = await client.callTool({name: "lsp_document_symbols", arguments: {file: component}});
  if (response.isError) throw new Error(response.content?.[0]?.text || "Vue document symbols failed");
  const yaml = response.content?.find((item) => item.type === "text")?.text || "";
  deepStrictEqual(parseYaml(yaml), response.structuredContent, "Vue YAML and structured JSON differ");
  const names = response.structuredContent?.result?.symbols?.map((symbol) => symbol.name) || [];
  if (!names.includes("increment") || !names.includes("nextCount")) {
    throw new Error(`Expected Vue script symbols were not returned: ${names.join(", ")}`);
  }
  const [vueDiagnosticsResponse, concurrentVueDiagnosticsResponse] = await Promise.all([
    client.callTool({name: TOOL.DIAGNOSTICS, arguments: {file: component, root: workspace}}),
    client.callTool({name: TOOL.DIAGNOSTICS, arguments: {file: component, root: workspace}}),
  ]);
  if (vueDiagnosticsResponse.isError || concurrentVueDiagnosticsResponse.isError) {
    throw new Error("Concurrent Vue diagnostics failed");
  }
  deepStrictEqual(
    concurrentVueDiagnosticsResponse.structuredContent?.result?.document,
    vueDiagnosticsResponse.structuredContent?.result?.document,
    "Concurrent Vue diagnostics did not use the same document snapshot",
  );
  await writeFile(
    diagnosticComponent,
    [
      '<script setup lang="ts">',
      "const typedValue: string = 1;",
      "</script>",
      "<template>{{ missingTemplateValue }}</template>",
      '<style lang="scss">',
      ".panel { unknown-property: 1; }",
      "</style>",
    ].join("\n"),
  );
  deepStrictEqual(
    concurrentVueDiagnosticsResponse.structuredContent?.result?.evidence,
    vueDiagnosticsResponse.structuredContent?.result?.evidence,
    "Concurrent Vue diagnostics disagreed about snapshot evidence",
  );
  if (vueDiagnosticsResponse.structuredContent?.result?.evidence?.status !== EVIDENCE_STATUS.VERIFIED) {
    throw new Error("Vue diagnostic pull did not verify the current document snapshot");
  }
  if (
    vueDiagnosticsResponse.structuredContent?.result?.evidence?.reason !== DIAGNOSTIC_EVIDENCE_REASON.CURRENT_DOCUMENT_SNAPSHOT_CONFIRMED
  ) {
    throw new Error("Vue diagnostic pull omitted its snapshot-confirmation reason");
  }
  deepStrictEqual(
    vueDiagnosticsResponse.structuredContent?.result?.diagnosticUse,
    {
      currentDocumentDiagnosticsAvailable: true,
      unconfirmedDiagnosticReportAvailable: false,
      usableAsCurrentDocumentDiagnosticEvidence: true,
      guidance: DIAGNOSTIC_GUIDANCE.CURRENT_DOCUMENT_DIAGNOSTICS_AVAILABLE,
    },
    "Vue diagnostic pull returned inconsistent usage guidance",
  );
  const provenanceDiagnostics = await client.callTool({
    name: TOOL.DIAGNOSTICS,
    arguments: {file: diagnosticComponent, root: workspace},
  });
  if (provenanceDiagnostics.isError) {
    throw new Error(provenanceDiagnostics.content?.[0]?.text || "Vue diagnostic provenance failed");
  }
  const provenanceResult = provenanceDiagnostics.structuredContent?.result;
  if (
    provenanceResult?.provenance?.provider !== DIAGNOSTIC_PROVIDER.VUE_LANGUAGE_SERVER ||
    provenanceResult?.provenance?.documentLanguage !== DIAGNOSTIC_LANGUAGE.VUE
  ) {
    throw new Error("Vue diagnostics omitted provider or document-language provenance");
  }
  const diagnosticItems = provenanceResult?.diagnosticsForCurrentDocument?.items || [];
  if (
    !diagnosticItems.some((item) => item.embeddedRegion === DIAGNOSTIC_REGION.STYLE && item.embeddedLanguage === DIAGNOSTIC_LANGUAGE.SCSS)
  ) {
    throw new Error(`Vue diagnostics omitted style/SCSS provenance: ${JSON.stringify(diagnosticItems, null, 2)}`);
  }
  const definition = await client.callTool({
    name: TOOL.DEFINITION,
    arguments: {file: component, root: workspace, ...COMPONENT_POSITION.CHILD_TEMPLATE},
  });
  if (definition.isError) throw new Error(definition.content?.[0]?.text || "Vue template component definition failed");
  const supportedMethods = new Set([
    DEFINITION_RESOLUTION_METHOD.LANGUAGE_SERVER,
    DEFINITION_RESOLUTION_METHOD.TYPESCRIPT_SERVER,
    DEFINITION_RESOLUTION_METHOD.VUE_TEMPLATE_IMPORT_BINDING,
  ]);
  if (!supportedMethods.has(definition.structuredContent?.result?.resolutionMethod)) {
    throw new Error(`Vue template component used the wrong resolution method: ${definition.structuredContent?.result?.resolutionMethod}`);
  }
  if (!definition.structuredContent?.result?.definitions?.some((item) => path.basename(item.file) === path.basename(childComponent))) {
    throw new Error("Vue template component did not resolve to the imported SFC");
  }

  const aliasedImportDefinition = await client.callTool({
    name: TOOL.DEFINITION,
    arguments: {file: component, root: workspace, ...COMPONENT_POSITION.ALIASED_IMPORT},
  });
  if (aliasedImportDefinition.isError) {
    throw new Error(aliasedImportDefinition.content?.[0]?.text || "Vue aliased import definition failed");
  }
  if (
    !aliasedImportDefinition.structuredContent?.result?.definitions?.some(
      (item) => path.basename(item.file) === path.basename(aliasedComponent),
    )
  ) {
    throw new Error("Vue aliased import did not resolve to its SFC");
  }

  const aliasedTemplateDefinition = await client.callTool({
    name: TOOL.DEFINITION,
    arguments: {file: component, root: workspace, ...COMPONENT_POSITION.ALIASED_TEMPLATE},
  });
  if (aliasedTemplateDefinition.isError) {
    throw new Error(aliasedTemplateDefinition.content?.[0]?.text || "Vue aliased template definition failed");
  }
  if (
    !aliasedTemplateDefinition.structuredContent?.result?.definitions?.some(
      (item) => path.basename(item.file) === path.basename(aliasedComponent),
    )
  ) {
    throw new Error("Vue aliased template component did not resolve to its SFC");
  }

  const aliasedNamedAudit = await client.callTool({
    name: TOOL.AUDIT_NAMED_SYMBOL,
    arguments: {
      root: workspace,
      symbol: FIXTURE_ALIASED_COMPONENT_LOCAL_NAME,
      fileHint: FIXTURE_ALIASED_COMPONENT_FILE_NAME,
    },
  });
  if (aliasedNamedAudit.isError) {
    throw new Error(aliasedNamedAudit.content?.[0]?.text || "Vue aliased named audit failed");
  }
  const aliasedFileHintResolution = aliasedNamedAudit.structuredContent?.result?.fileHintResolution;
  if (!aliasedFileHintResolution || aliasedFileHintResolution.textMatchesResolvingToFileFilter < 1) {
    throw new Error("Vue aliased named audit did not verify the local binding to its SFC");
  }
  if (aliasedFileHintResolution.accountingStatus !== ACCOUNTING_STATUS.COMPLETE) {
    throw new Error("Vue aliased named audit did not account for every local-name occurrence");
  }
  if (
    !aliasedFileHintResolution.sourcePositionForAudit?.definitions?.some(
      (item) => path.basename(item.file) === path.basename(aliasedComponent),
    )
  ) {
    throw new Error("Vue aliased named audit did not return a reusable binding position");
  }

  const ambiguousCount = await client.callTool({
    name: TOOL.COUNT_NAMED_SYMBOL,
    arguments: {root: workspace, symbol: "sharedAction"},
  });
  if (ambiguousCount.isError) throw new Error(ambiguousCount.content?.[0]?.text || "Vue ambiguous named count failed");
  if (ambiguousCount.structuredContent?.result?.definitionSelectionStatus !== DEFINITION_SELECTION_STATUS.MULTIPLE) {
    throw new Error("Vue named count did not report multiple selected definitions");
  }
  if (ambiguousCount.structuredContent?.result?.semanticEvidence?.status !== SEMANTIC_EVIDENCE_STATUS.FOLLOW_UP_REQUIRED) {
    throw new Error("Ambiguous Vue named count did not require semantic follow-up");
  }
  if (
    !ambiguousCount.structuredContent?.result?.semanticEvidence?.followUpReasons?.includes(
      SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.MULTIPLE_DEFINITIONS_SELECTED,
    )
  ) {
    throw new Error("Ambiguous Vue named count omitted its semantic follow-up reason");
  }
  if (!ambiguousCount.structuredContent?.continueWith?.includes(TOOL.AUDIT_SYMBOL)) {
    throw new Error("Ambiguous Vue named count did not recommend position-based audit");
  }
  if (ambiguousCount.structuredContent.continueWith[0] !== TOOL.AUDIT_SYMBOL) {
    throw new Error("Ambiguous Vue named count did not prioritize position-based audit");
  }

  const filteredCount = await client.callTool({
    name: TOOL.COUNT_NAMED_SYMBOL,
    arguments: {root: workspace, symbol: "sharedAction", fileHint: "ChildPanel.vue"},
  });
  if (filteredCount.isError) throw new Error(filteredCount.content?.[0]?.text || "Vue filtered named count failed");
  if (filteredCount.structuredContent?.result?.definitionSelectionStatus !== DEFINITION_SELECTION_STATUS.ONE) {
    throw new Error("Vue file hint did not select one exact definition");
  }
  if (filteredCount.structuredContent?.result?.semanticEvidence?.status !== SEMANTIC_EVIDENCE_STATUS.USABLE) {
    throw new Error("Complete filtered Vue named count was not marked usable as requested");
  }
  if (!filteredCount.structuredContent?.continueWith?.includes(TOOL.REFERENCE_PAGE)) {
    throw new Error("Filtered Vue named count omitted its reusable reference set");
  }

  const filenameOnlyCount = await client.callTool({
    name: TOOL.COUNT_NAMED_SYMBOL,
    arguments: {root: workspace, symbol: "ChildPanel", fileHint: "ChildPanel.vue"},
  });
  if (filenameOnlyCount.isError) throw new Error(filenameOnlyCount.content?.[0]?.text || "Vue component-name count failed");
  if (filenameOnlyCount.structuredContent?.result?.definitionSelectionStatus !== DEFINITION_SELECTION_STATUS.NONE) {
    throw new Error("Vue filename was incorrectly treated as an exact named declaration");
  }
  if (
    !filenameOnlyCount.structuredContent?.result?.semanticEvidence?.followUpReasons?.includes(
      SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.NO_DEFINITION_SELECTED,
    )
  ) {
    throw new Error("Vue component-name count omitted its semantic follow-up reason");
  }
  if (filenameOnlyCount.structuredContent?.continueWith?.includes(TOOL.REFERENCE_PAGE)) {
    throw new Error("Vue named count recommended a reference page without a reusable reference set");
  }
  if (!filenameOnlyCount.structuredContent?.continueWith?.includes(TOOL.AUDIT_NAMED_SYMBOL)) {
    throw new Error("Vue named count did not recommend binding-aware named audit after an empty file filter");
  }
  if (filenameOnlyCount.structuredContent?.result?.fileHintResolution) {
    throw new Error("Vue named count performed deep file-hint binding resolution");
  }

  const filenameOnlyAudit = await client.callTool({
    name: TOOL.AUDIT_NAMED_SYMBOL,
    arguments: {root: workspace, symbol: "ChildPanel", fileHint: "ChildPanel.vue"},
  });
  if (filenameOnlyAudit.isError) throw new Error(filenameOnlyAudit.content?.[0]?.text || "Vue component-name audit failed");
  if (filenameOnlyAudit.structuredContent?.result?.definitionSelectionStatus !== DEFINITION_SELECTION_STATUS.NONE) {
    throw new Error("Vue named audit did not preserve the empty definition selection");
  }
  const fileHintResolution = filenameOnlyAudit.structuredContent?.result?.fileHintResolution;
  if (!fileHintResolution || fileHintResolution.textMatchesResolvingToFileFilter < 1) {
    throw new Error("Vue named audit did not verify a binding to the hinted SFC");
  }
  if (fileHintResolution.accountingStatus !== ACCOUNTING_STATUS.COMPLETE) {
    throw new Error("Vue named audit did not account for every file-hint binding candidate");
  }
  if (path.basename(fileHintResolution.sourcePositionForAudit?.file || "") !== path.basename(component)) {
    throw new Error("Vue named audit did not return a verified source position for follow-up");
  }
  if (
    !fileHintResolution.sourcePositionForAudit?.definitions?.some(
      (definition) => path.basename(definition.file) === path.basename(childComponent),
    )
  ) {
    throw new Error("Vue named audit source position did not resolve to the hinted SFC");
  }
  if (filenameOnlyAudit.structuredContent?.continueWith?.includes(TOOL.REFERENCE_PAGE)) {
    throw new Error("Vue named audit recommended a reference page without a reusable reference set");
  }
  if (!filenameOnlyAudit.structuredContent?.continueWith?.includes(TOOL.AUDIT_SYMBOL)) {
    throw new Error("Vue named audit did not recommend position-based audit after an empty file filter");
  }
  if (filenameOnlyAudit.structuredContent?.continueWith?.includes(TOOL.DOCUMENT_SYMBOLS)) {
    throw new Error("Vue named audit recommended structural discovery after verifying a binding position");
  }

  const verifiedBindingAudit = await client.callTool({
    name: TOOL.AUDIT_SYMBOL,
    arguments: {
      root: workspace,
      file: fileHintResolution.sourcePositionForAudit.file,
      line: fileHintResolution.sourcePositionForAudit.range.start.line,
      column: fileHintResolution.sourcePositionForAudit.range.start.column,
    },
  });
  if (verifiedBindingAudit.isError) {
    throw new Error(verifiedBindingAudit.content?.[0]?.text || "Vue verified binding position audit failed");
  }
  if (
    !verifiedBindingAudit.structuredContent?.result?.definition?.locations?.some(
      (definition) => path.basename(definition.file) === path.basename(childComponent),
    )
  ) {
    throw new Error("Vue verified binding position was not reusable by the position-based audit");
  }

  const limitedBindingAudit = await client.callTool({
    name: TOOL.AUDIT_NAMED_SYMBOL,
    arguments: {root: workspace, symbol: "ChildPanel", fileHint: "ChildPanel.vue", maxCandidates: 1},
  });
  if (limitedBindingAudit.isError) throw new Error(limitedBindingAudit.content?.[0]?.text || "Vue limited binding audit failed");
  if (limitedBindingAudit.structuredContent?.collection?.status !== COLLECTION_STATUS.LIMITED) {
    throw new Error("Vue limited binding audit did not report limited collection");
  }
  if (
    !limitedBindingAudit.structuredContent?.result?.semanticEvidence?.followUpReasons?.includes(
      SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.COLLECTION_LIMITED,
    )
  ) {
    throw new Error("Vue limited binding audit omitted its collection follow-up reason");
  }
  if (limitedBindingAudit.structuredContent?.result?.fileHintResolution?.accountingStatus !== ACCOUNTING_STATUS.INCOMPLETE) {
    throw new Error("Vue limited binding audit claimed complete text-match accounting");
  }

  const unrelatedFileAudit = await client.callTool({
    name: TOOL.AUDIT_NAMED_SYMBOL,
    arguments: {root: workspace, symbol: "ChildPanel", fileHint: "UnrelatedPanel.vue"},
  });
  if (unrelatedFileAudit.isError) throw new Error(unrelatedFileAudit.content?.[0]?.text || "Vue unrelated-file audit failed");
  if (unrelatedFileAudit.structuredContent?.result?.fileHintResolution?.textMatchesResolvingToFileFilter !== 0) {
    throw new Error("Vue named audit fabricated a binding to an unrelated SFC");
  }
  if (!unrelatedFileAudit.structuredContent?.continueWith?.includes(TOOL.DOCUMENT_SYMBOLS)) {
    throw new Error("Vue named audit did not recommend structural navigation when no binding matched the hinted SFC");
  }

  console.log(
    JSON.stringify(
      {
        vueDocumentSymbols: "ok",
        vueTemplateComponentDefinition: "ok",
        vueAliasedComponentDefinition: "ok",
        vueAliasedNamedBindingResolution: "ok",
        vueNamedDefinitionSelection: "ok",
        vueFileHintBindingResolution: "ok",
        vueSharedDiagnosticAcquisition: "ok",
        vueDiagnosticPull: "ok",
        vueDiagnosticProvenance: "ok",
        yamlRepresentation: "ok",
      },
      null,
      2,
    ),
  );
} finally {
  await client.close().catch(() => undefined);
  await removeTemporaryDirectory(workspace);
}
