#!/usr/bin/env node

// Adversarial verification of the provider filesystem guard (lib/provider-filesystem-guard.mjs).
// It preloads the guard into a child WITHOUT the Node permission model so the monkey-patch layer
// alone is exercised, then confirms reads/writes/globs/child processes outside the configured
// roots are denied while in-boundary access still works. A symlink inside the root that points
// outside must also be denied through canonical resolution.

import {spawnSync} from "node:child_process";
import {mkdtemp, mkdir, writeFile, symlink, realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guard = pathToFileURL(path.join(pluginRoot, "lib", "provider-filesystem-guard.mjs")).href;

const root = await realpath(await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-guard-root-")));
const outside = await realpath(await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-guard-outside-")));
await mkdir(path.join(root, "src"), {recursive: true});
const insideFile = path.join(root, "src", "inside.ts");
const insideWrite = path.join(root, "src", "written.txt");
const outsideFile = path.join(outside, "secret.ts");
const outsideWrite = path.join(outside, "should-not-write.txt");
const symlinkEscape = path.join(root, "src", "escape.ts");
await writeFile(insideFile, "export const inside = 1;\n");
await writeFile(outsideFile, "export const secret = 'do-not-read';\n");
await symlink(outsideFile, symlinkEscape);

const probe = `
const fs = require("node:fs");
const cp = require("node:child_process");
const denied = (fn) => {
  try { fn(); return false; }
  catch (error) { return Boolean(error) && error.code === "ERR_ACCESS_DENIED"; }
};
const results = {
  insideReadAllowed: (() => { try { fs.readFileSync(process.env.PROBE_INSIDE_FILE, "utf8"); return true; } catch { return false; } })(),
  insideWriteAllowed: (() => { try { fs.writeFileSync(process.env.PROBE_INSIDE_WRITE, "ok"); return true; } catch { return false; } })(),
  outsideReadDenied: denied(() => fs.readFileSync(process.env.PROBE_OUTSIDE_FILE, "utf8")),
  outsideOpenAsBlobDenied: denied(() => fs.openAsBlob(process.env.PROBE_OUTSIDE_FILE)),
  symlinkEscapeDenied: denied(() => fs.readFileSync(process.env.PROBE_SYMLINK, "utf8")),
  outsideWriteDenied: denied(() => fs.writeFileSync(process.env.PROBE_OUTSIDE_WRITE, "x")),
  globDenied: typeof fs.globSync === "function" ? denied(() => fs.globSync("**/*")) : true,
  childProcessDenied: denied(() => cp.execSync("id")),
};
process.stdout.write(JSON.stringify(results));
`;

const child = spawnSync(process.execPath, [`--import=${guard}`, "-e", probe], {
  encoding: "utf8",
  env: {
    ...process.env,
    SEMANTIC_JS_MCP_INTERNAL_PROVIDER_READ_ROOTS: JSON.stringify([root]),
    SEMANTIC_JS_MCP_INTERNAL_PROVIDER_WRITE_ROOTS: JSON.stringify([root]),
    PROBE_INSIDE_FILE: insideFile,
    PROBE_INSIDE_WRITE: insideWrite,
    PROBE_OUTSIDE_FILE: outsideFile,
    PROBE_OUTSIDE_WRITE: outsideWrite,
    PROBE_SYMLINK: symlinkEscape,
  },
});

if (child.status !== 0 || !child.stdout) {
  process.stderr.write(`provider guard probe failed: ${child.stderr || child.error?.message || "no output"}\n`);
  process.exit(1);
}

const results = JSON.parse(child.stdout);
console.log(JSON.stringify(results, null, 2));

const expected = {
  insideReadAllowed: true,
  insideWriteAllowed: true,
  outsideReadDenied: true,
  outsideOpenAsBlobDenied: true,
  symlinkEscapeDenied: true,
  outsideWriteDenied: true,
  globDenied: true,
  childProcessDenied: true,
};
const ok = Object.entries(expected).every(([key, value]) => results[key] === value);
process.exit(ok ? 0 : 1);
