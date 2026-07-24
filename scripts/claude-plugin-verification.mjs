#!/usr/bin/env node

import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PRODUCT, SERVER_VERSION} from "../protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function json(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

const [manifest, marketplace, packageManifest, setup] = await Promise.all([
  json(".claude-plugin/plugin.json"),
  json(".claude-plugin/marketplace.json"),
  json("package.json"),
  readFile(path.join(root, "SETUP.md"), "utf8"),
]);

const plugin = marketplace.plugins?.find((entry) => entry.name === PRODUCT.NAME);
const findings = [];

function requireCondition(condition, reason) {
  if (!condition) findings.push(reason);
}

requireCondition(manifest.name === PRODUCT.NAME, "plugin manifest name differs from the package");
requireCondition(manifest.version === SERVER_VERSION, "plugin manifest version differs from the runtime");
requireCondition(packageManifest.version === SERVER_VERSION, "package version differs from the runtime");
requireCondition(Boolean(marketplace.description), "marketplace description is missing");
requireCondition(Boolean(plugin), "marketplace plugin entry is missing");
requireCondition(!Object.hasOwn(plugin || {}, "version"), "marketplace entry duplicates the plugin manifest version");
requireCondition(plugin?.source?.source === "npm", "marketplace source is not npm");
requireCondition(plugin?.source?.package === PRODUCT.NAME, "marketplace npm package differs from the product");
requireCondition(plugin?.source?.version === SERVER_VERSION, "marketplace npm source is not pinned to the release version");
requireCondition(
  manifest.mcpServers?.[PRODUCT.NAME]?.command === "node" &&
    manifest.mcpServers?.[PRODUCT.NAME]?.args?.length === 1 &&
    manifest.mcpServers?.[PRODUCT.NAME]?.args?.[0] === "${CLAUDE_PLUGIN_ROOT}/server.mjs",
  "plugin MCP server does not launch the bundled server",
);
requireCondition(manifest.skills === "./skills/", "plugin skill directory differs from the bundled skill");
requireCondition(packageManifest.files?.includes(".claude-plugin/"), "npm package allowlist omits the Claude plugin");
requireCondition(setup.includes("version 2.1.203 or newer"), "setup omits the minimum Claude Code roots version");
requireCondition(setup.includes("/plugin marketplace update elnonathan"), "setup omits the Claude marketplace update path");
requireCondition(setup.includes("/plugin update semantic-js-mcp@elnonathan"), "setup omits the Claude plugin update path");
requireCondition(setup.includes("/plugin uninstall semantic-js-mcp@elnonathan"), "setup omits the Claude plugin removal path");
requireCondition(setup.includes("#### 7.2 Verify Claude Code"), "setup omits the Claude verification path");

process.stdout.write(
  `${JSON.stringify(
    {
      status: findings.length === 0 ? "pass" : "fail",
      version: SERVER_VERSION,
      findings,
    },
    null,
    2,
  )}\n`,
);
if (findings.length > 0) process.exitCode = 1;
