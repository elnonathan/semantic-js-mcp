#!/usr/bin/env node

import path from "node:path";
import {mkdtemp, mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {fileURLToPath, pathToFileURL} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {ListRootsRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {removeTemporaryDirectory} from "../lib/temporary-directory.mjs";
import {ERROR_CODE, TOOL} from "../protocol.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const workspace = await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-roots-smoke-"));
await mkdir(path.join(workspace, "src"), {recursive: true});
const file = path.join(workspace, "src", "target.ts");
await writeFile(file, "export function rootsTarget(value: number): number {\n  return value + 1;\n}\n");
await writeFile(path.join(workspace, "package.json"), JSON.stringify({name: "roots-fixture", version: "1.0.0"}));

const outsideFile = path.join(workspace, "..", `${path.basename(workspace)}-outside.ts`);
await writeFile(outsideFile, "export const outside = 1;\n");

// The client advertises the MCP roots capability and reports the fixture workspace.
const client = new Client({name: "semantic-js-mcp-roots-smoke", version: "1.0.0"}, {capabilities: {roots: {listChanged: true}}});
client.setRequestHandler(ListRootsRequestSchema, () => ({roots: [{uri: pathToFileURL(workspace).href, name: "workspace"}]}));

// Started WITHOUT SEMANTIC_JS_MCP_WORKSPACE_ROOTS: only the client-provided root should authorize the fixture.
const transport = new StdioClientTransport({command: process.execPath, args: [path.join(pluginRoot, "server.mjs")], cwd: pluginRoot});
await client.connect(transport);

async function documentSymbols(target) {
  return client.callTool({name: TOOL.DOCUMENT_SYMBOLS, arguments: {file: target}});
}

// The initial roots fetch completes shortly after `initialized`; tolerate that startup window.
let inside;
for (let attempt = 0; attempt < 20; attempt++) {
  inside = await documentSymbols(file);
  if (inside.isError !== true) break;
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const outside = await documentSymbols(outsideFile);

const results = {
  clientRootAuthorizesWorkspace: inside.isError !== true && (inside.structuredContent?.result?.symbolsFound ?? 0) > 0,
  outsideRootStillRejected:
    outside.isError === true && outside.structuredContent?.error?.code === ERROR_CODE.PATH_OUTSIDE_WORKSPACE_BOUNDARY,
};

console.log(JSON.stringify(results, null, 2));

await client.close();
await removeTemporaryDirectory(workspace);
await removeTemporaryDirectory(outsideFile).catch(() => undefined);

process.exit(Object.values(results).every(Boolean) ? 0 : 1);
