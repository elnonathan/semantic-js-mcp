#!/usr/bin/env node

import path from "node:path";
import {deepStrictEqual} from "node:assert";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {parse as parseYaml} from "yaml";
import {DEFINITION_RESOLUTION_METHOD, TOOL} from "../protocol.mjs";

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
  ['<script setup lang="ts">', "defineProps<{label: string}>();", "</script>", "<template><span>{{ label }}</span></template>"].join("\n"),
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
    arguments: {file: component, root: workspace, line: 10, column: 4},
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
  console.log(JSON.stringify({vueDocumentSymbols: "ok", vueTemplateComponentDefinition: "ok", yamlRepresentation: "ok"}, null, 2));
} finally {
  await client.close().catch(() => undefined);
  await rm(workspace, {recursive: true, force: true});
}
