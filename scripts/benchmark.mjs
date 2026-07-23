#!/usr/bin/env node

import path from "node:path";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {DEFAULT, ENVIRONMENT_VARIABLE, PRODUCT, TOOL} from "../protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const counts = (process.env[ENVIRONMENT_VARIABLE.BENCHMARK_COUNTS] || DEFAULT.BENCHMARK_COUNTS.join(","))
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

if (counts.length === 0) throw new Error(`${ENVIRONMENT_VARIABLE.BENCHMARK_COUNTS} must contain positive integers`);

async function timedCall(client, name, argumentsValue) {
  const startedAt = performance.now();
  const response = await client.callTool({name, arguments: argumentsValue});
  if (response.isError) throw new Error(response.content?.[0]?.text || `${name} failed`);
  return {milliseconds: Math.round(performance.now() - startedAt), data: response.structuredContent};
}

const results = [];
for (const count of counts) {
  const workspace = await mkdtemp(path.join(tmpdir(), `${PRODUCT.NAME}-benchmark-${count}-`));
  const src = path.join(workspace, "src");
  await mkdir(src, {recursive: true});
  await writeFile(path.join(workspace, "package.json"), JSON.stringify({private: true, type: "module"}));
  await writeFile(
    path.join(workspace, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler"},
      include: ["src/**/*.ts"],
    }),
  );
  const symbol = `benchmarkTarget${count}`;
  const target = path.join(src, "target.ts");
  await writeFile(target, `export function ${symbol}(value: number): number { return value + 1; }\n`);
  await writeFile(
    path.join(src, "usage.ts"),
    [
      `import {${symbol}} from "./target.js";`,
      "export const values = [",
      ...Array.from({length: count}, (_, index) => `  ${symbol}(${index}),`),
      "];",
    ].join("\n"),
  );

  const client = new Client({name: `${PRODUCT.NAME}-benchmark`, version: "1.0.0"});
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "server.mjs")],
    cwd: root,
    env: {...process.env, [ENVIRONMENT_VARIABLE.WORKSPACE_ROOTS]: tmpdir()},
  });
  try {
    await client.connect(transport);
    const text = await timedCall(client, TOOL.COUNT_TEXT_MATCHES, {root: workspace, symbol});
    const verified = await timedCall(client, TOOL.COUNT_REFERENCES, {
      file: target,
      root: workspace,
      line: 1,
      column: 17,
    });
    const freshness = await timedCall(client, TOOL.REFERENCE_PAGE, {
      referenceSetId: verified.data.result.referenceSetId,
      cursor: "0",
      pageSize: 1,
    });
    results.push({
      requestedCalls: count,
      exactTextMatches: text.data.result.matchesFound,
      textCountWallMilliseconds: text.milliseconds,
      verifiedCollectionWallMilliseconds: verified.milliseconds,
      freshnessValidationWallMilliseconds: freshness.milliseconds,
      verifiedReferences: verified.data.result.references.verifiedTotal,
      collectionStatus: verified.data.collection.status,
      performance: verified.data.collection.performance,
      freshness: {
        repositorySourceFilesChecked: freshness.data.collection.repositorySourceFilesChecked,
        freshnessCheckMilliseconds: freshness.data.collection.freshnessCheckMilliseconds,
      },
    });
  } finally {
    await client.close().catch(() => undefined);
    await rm(workspace, {recursive: true, force: true});
  }
}

console.log(JSON.stringify({counts, results}, null, 2));
