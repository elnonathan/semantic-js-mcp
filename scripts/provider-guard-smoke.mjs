#!/usr/bin/env node

// Adversarial verification of the provider filesystem guard (lib/provider-filesystem-guard.mjs).
// It preloads the guard into a child WITHOUT the Node permission model so the monkey-patch layer
// alone is exercised, then confirms reads/writes/globs/child processes outside the configured
// roots are denied while in-boundary access still works. Watch APIs are trapped before the guard
// loads so the fixture also proves inert watchers never reach the underlying filesystem API. A
// symlink inside the root that points outside must be denied through canonical resolution.

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
const watchTrap = path.join(root, "watch-trap.mjs");
await writeFile(insideFile, "export const inside = 1;\n");
await writeFile(outsideFile, "export const secret = 'do-not-read';\n");
await symlink(outsideFile, symlinkEscape);
await writeFile(
  watchTrap,
  `
import fs from "node:fs";
const watchApiReached = () => {
  const error = new Error("Underlying provider filesystem watch API was reached");
  error.code = "WATCH_API_REACHED";
  throw error;
};
fs.watch = watchApiReached;
fs.watchFile = watchApiReached;
fs.unwatchFile = watchApiReached;
fs.promises.watch = watchApiReached;
`,
);

const probe = `
const fs = require("node:fs");
const cp = require("node:child_process");
const denied = (fn) => {
  try { fn(); return false; }
  catch (error) { return Boolean(error) && error.code === "ERR_ACCESS_DENIED"; }
};
const inertWatcher = (create) => {
  try {
    const watcher = create();
    if (!watcher || typeof watcher.start !== "function" || typeof watcher.stop !== "function") return false;
    if (typeof watcher.close !== "function" || typeof watcher.ref !== "function" || typeof watcher.unref !== "function") return false;
    if (watcher.start() !== watcher || watcher.ref() !== watcher || watcher.unref() !== watcher) return false;
    watcher.stop();
    watcher.close();
    return true;
  } catch {
    return false;
  }
};
const inertAsyncWatcher = async (create) => {
  try {
    const watcher = create();
    if (!watcher || typeof watcher.next !== "function" || typeof watcher.return !== "function") return false;
    if (typeof watcher[Symbol.asyncIterator] !== "function" || watcher[Symbol.asyncIterator]() !== watcher) return false;
    const next = await watcher.next();
    const returned = await watcher.return();
    return next?.done === true && returned?.done === true;
  } catch {
    return false;
  }
};
(async () => {
  const esmFs = await import("node:fs");
  const esmFsPromises = await import("node:fs/promises");
  let watchCallbackCalled = false;
  let watchFileCallbackCalled = false;
  const results = {
    insideReadAllowed: (() => { try { fs.readFileSync(process.env.PROBE_INSIDE_FILE, "utf8"); return true; } catch { return false; } })(),
    insideWriteAllowed: (() => { try { fs.writeFileSync(process.env.PROBE_INSIDE_WRITE, "ok"); return true; } catch { return false; } })(),
    outsideReadDenied: denied(() => fs.readFileSync(process.env.PROBE_OUTSIDE_FILE, "utf8")),
    outsideOpenAsBlobDenied: denied(() => fs.openAsBlob(process.env.PROBE_OUTSIDE_FILE)),
    symlinkEscapeDenied: denied(() => fs.readFileSync(process.env.PROBE_SYMLINK, "utf8")),
    outsideWriteDenied: denied(() => fs.writeFileSync(process.env.PROBE_OUTSIDE_WRITE, "x")),
    globDenied: typeof fs.globSync === "function" ? denied(() => fs.globSync("**/*")) : true,
    childProcessDenied: denied(() => cp.execSync("id")),
    watchBenign:
      inertWatcher(() => fs.watch(process.env.PROBE_OUTSIDE_FILE, () => { watchCallbackCalled = true; })) &&
      !watchCallbackCalled,
    watchFileBenign:
      inertWatcher(() => fs.watchFile(process.env.PROBE_OUTSIDE_FILE, () => { watchFileCallbackCalled = true; })) &&
      !watchFileCallbackCalled,
    unwatchFileBenign: (() => { try { fs.unwatchFile(process.env.PROBE_OUTSIDE_FILE); return true; } catch { return false; } })(),
    promisesWatchBenign: await inertAsyncWatcher(() => fs.promises.watch(process.env.PROBE_OUTSIDE_FILE)),
    esmWatchBenign: inertWatcher(() => esmFs.watch(process.env.PROBE_OUTSIDE_FILE, () => {})),
    esmWatchFileBenign: inertWatcher(() => esmFs.watchFile(process.env.PROBE_OUTSIDE_FILE, () => {})),
    esmUnwatchFileBenign: (() => { try { esmFs.unwatchFile(process.env.PROBE_OUTSIDE_FILE); return true; } catch { return false; } })(),
    esmPromisesWatchBenign: await inertAsyncWatcher(() => esmFsPromises.watch(process.env.PROBE_OUTSIDE_FILE)),
  };
  process.stdout.write(JSON.stringify(results));
})().catch((error) => {
  process.stderr.write(error?.stack || String(error));
  process.exitCode = 1;
});
`;

const child = spawnSync(process.execPath, [`--import=${pathToFileURL(watchTrap).href}`, `--import=${guard}`, "-e", probe], {
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
  watchBenign: true,
  watchFileBenign: true,
  unwatchFileBenign: true,
  promisesWatchBenign: true,
  esmWatchBenign: true,
  esmWatchFileBenign: true,
  esmUnwatchFileBenign: true,
  esmPromisesWatchBenign: true,
};
const ok = Object.entries(expected).every(([key, value]) => results[key] === value);
process.exit(ok ? 0 : 1);
