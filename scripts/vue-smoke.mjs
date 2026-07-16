#!/usr/bin/env node

import path from "node:path";
import {deepStrictEqual} from "node:assert";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {parse as parseYaml} from "yaml";
import {DEFINITION_RESOLUTION_METHOD, DEFINITION_SELECTION_STATUS, TOOL} from "../protocol.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-vue-smoke-"));
const src = path.join(workspace, "src");
const component = path.join(src, "CounterPanel.vue");
const childComponent = path.join(src, "ChildPanel.vue");
await mkdir(src, {recursive: true});
await writeFile(path.join(workspace, "package.json"), JSON.stringify({private: true, type: "module"}));
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
  component,
  [
    '<script setup lang="ts">',
    'import ChildPanel from "./ChildPanel.vue";',
    "const count = 0;",
    "function increment(value: number): number {",
    "  return value + 1;",
    "}",
    "function sharedAction(): string { return 'parent'; }",
    "const nextCount = increment(count);",
    "</script>",
    "<template>",
    '  <ChildPanel label="Count" />',
    "  <button>{{ nextCount }}</button>",
    "</template>",
  ].join("\n"),
);

const client = new Client({name: "semantic-js-mcp-vue-smoke", version: "1.0.0"});
const transport = new StdioClientTransport({command: process.execPath, args: [path.join(pluginRoot, "server.mjs")], cwd: pluginRoot});

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
  const definition = await client.callTool({
    name: TOOL.DEFINITION,
    arguments: {file: component, root: workspace, line: 11, column: 4},
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

  const ambiguousCount = await client.callTool({
    name: TOOL.COUNT_NAMED_SYMBOL,
    arguments: {root: workspace, symbol: "sharedAction"},
  });
  if (ambiguousCount.isError) throw new Error(ambiguousCount.content?.[0]?.text || "Vue ambiguous named count failed");
  if (ambiguousCount.structuredContent?.result?.definitionSelectionStatus !== DEFINITION_SELECTION_STATUS.MULTIPLE) {
    throw new Error("Vue named count did not report multiple selected definitions");
  }
  if (!ambiguousCount.structuredContent?.continueWith?.includes(TOOL.AUDIT_SYMBOL)) {
    throw new Error("Ambiguous Vue named count did not recommend position-based audit");
  }

  const filteredCount = await client.callTool({
    name: TOOL.COUNT_NAMED_SYMBOL,
    arguments: {root: workspace, symbol: "sharedAction", fileHint: "ChildPanel.vue"},
  });
  if (filteredCount.isError) throw new Error(filteredCount.content?.[0]?.text || "Vue filtered named count failed");
  if (filteredCount.structuredContent?.result?.definitionSelectionStatus !== DEFINITION_SELECTION_STATUS.ONE) {
    throw new Error("Vue file hint did not select one exact definition");
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
  if (filenameOnlyCount.structuredContent?.continueWith?.includes(TOOL.REFERENCE_PAGE)) {
    throw new Error("Vue named count recommended a reference page without a reusable reference set");
  }
  if (!filenameOnlyCount.structuredContent?.continueWith?.includes(TOOL.DOCUMENT_SYMBOLS)) {
    throw new Error("Vue named count did not recommend structural navigation after an empty file filter");
  }

  const filenameOnlyAudit = await client.callTool({
    name: TOOL.AUDIT_NAMED_SYMBOL,
    arguments: {root: workspace, symbol: "ChildPanel", fileHint: "ChildPanel.vue"},
  });
  if (filenameOnlyAudit.isError) throw new Error(filenameOnlyAudit.content?.[0]?.text || "Vue component-name audit failed");
  if (filenameOnlyAudit.structuredContent?.result?.definitionSelectionStatus !== DEFINITION_SELECTION_STATUS.NONE) {
    throw new Error("Vue named audit did not preserve the empty definition selection");
  }
  if (filenameOnlyAudit.structuredContent?.continueWith?.includes(TOOL.REFERENCE_PAGE)) {
    throw new Error("Vue named audit recommended a reference page without a reusable reference set");
  }
  if (!filenameOnlyAudit.structuredContent?.continueWith?.includes(TOOL.AUDIT_SYMBOL)) {
    throw new Error("Vue named audit did not recommend position-based audit after an empty file filter");
  }

  console.log(
    JSON.stringify(
      {
        vueDocumentSymbols: "ok",
        vueTemplateComponentDefinition: "ok",
        vueNamedDefinitionSelection: "ok",
        yamlRepresentation: "ok",
      },
      null,
      2,
    ),
  );
} finally {
  await client.close().catch(() => undefined);
  await rm(workspace, {recursive: true, force: true});
}
