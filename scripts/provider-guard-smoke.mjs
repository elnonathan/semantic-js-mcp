#!/usr/bin/env node

// Adversarial verification of the provider filesystem guard (lib/provider-filesystem-guard.mjs).
// It preloads the guard into a child WITHOUT the Node permission model so the monkey-patch layer
// alone is exercised, then confirms reads/writes/globs/child processes outside the configured
// roots are denied while in-boundary access still works. Watch APIs are trapped before the guard
// loads. Windows must delegate in-root watches while every platform keeps outside and symlink-
// escape watches away from the underlying filesystem API. A symlink inside the root that points
// outside must be denied through canonical resolution.

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
const permissionMismatchFile = path.join(root, "src", "permission-mismatch.ts");
const insideWrite = path.join(root, "src", "written.txt");
const outsideFile = path.join(outside, "secret.ts");
const outsideWrite = path.join(outside, "should-not-write.txt");
const symlinkEscape = path.join(root, "src", "escape.ts");
const canonicalPermissionMismatchSymlink = path.join(root, "src", "permission-denied-escape.ts");
const providerChildEntry = path.join(root, "provider-child.mjs");
const watchTrap = path.join(root, "watch-trap.mjs");
await writeFile(insideFile, "export const inside = 1;\n");
await writeFile(permissionMismatchFile, "export const mismatch = 1;\n");
await writeFile(outsideFile, "export const secret = 'do-not-read';\n");
await symlink(outsideFile, symlinkEscape);
await symlink(outsideFile, canonicalPermissionMismatchSymlink);
await writeFile(
  providerChildEntry,
  `
import fs from "node:fs";
const report = {
  readRoots: process.env.SEMANTIC_JS_MCP_INTERNAL_PROVIDER_READ_ROOTS,
  writeRoots: process.env.SEMANTIC_JS_MCP_INTERNAL_PROVIDER_WRITE_ROOTS,
  childEntry: process.env.SEMANTIC_JS_MCP_INTERNAL_PROVIDER_CHILD_ENTRY,
  untrusted: process.env.PROBE_UNTRUSTED_ENV,
  outsideReadDenied: (() => {
    try {
      fs.readFileSync(process.env.PROBE_OUTSIDE_FILE, "utf8");
      return false;
    } catch (error) {
      return error?.code === "ERR_ACCESS_DENIED";
    }
  })(),
};
if (process.send) {
  process.send(report, () => process.disconnect());
} else {
  process.exitCode = 1;
}
`,
);
await writeFile(
  watchTrap,
  `
import fs from "node:fs";
import path from "node:path";
if (process.env.PROBE_FORCE_WINDOWS === "1") Object.defineProperty(process, "platform", {value: "win32"});
globalThis.__semanticJsMcpWatchCalls = [];
globalThis.__semanticJsMcpCanonicalPermissionMismatchWatchCalls = [];
const realpathSync = fs.realpathSync;
fs.realpathSync = function permissionMismatchRealpath(value, ...args) {
  if (path.resolve(value) === path.resolve(process.env.PROBE_CANONICAL_PERMISSION_MISMATCH_SYMLINK)) {
    const error = new Error("Synthetic canonical path permission mismatch");
    error.code = "ERR_ACCESS_DENIED";
    error.permission = "FileSystemRead";
    throw error;
  }
  return Reflect.apply(realpathSync, this, [value, ...args]);
};
const filesystemWatcher = () => {
  const watcher = {
    start() { return watcher; },
    stop() {},
    close() {},
    ref() { return watcher; },
    unref() { return watcher; },
  };
  return watcher;
};
const asyncFilesystemWatcher = () => {
  const completed = {done: true, value: undefined};
  const watcher = {
    async next() { return completed; },
    async return() { return completed; },
    async throw(error) { throw error; },
    [Symbol.asyncIterator]() { return watcher; },
  };
  return watcher;
};
const watchApi = (name, create) => (value) => {
  if (path.resolve(value) === path.resolve(process.env.PROBE_CANONICAL_PERMISSION_MISMATCH_SYMLINK)) {
    globalThis.__semanticJsMcpCanonicalPermissionMismatchWatchCalls.push(name);
    return create();
  }
  if (path.resolve(value) === path.resolve(process.env.PROBE_PERMISSION_MISMATCH_FILE)) {
    if (name === "promisesWatch") {
      const watcher = asyncFilesystemWatcher();
      watcher.next = async () => {
        const error = new Error("Synthetic Node filesystem permission mismatch");
        error.code = "ERR_ACCESS_DENIED";
        error.permission = "FileSystemRead";
        throw error;
      };
      return watcher;
    }
    const error = new Error("Synthetic Node filesystem permission mismatch");
    error.code = "ERR_ACCESS_DENIED";
    error.permission = "FileSystemRead";
    throw error;
  }
  if (path.resolve(value) !== path.resolve(process.env.PROBE_INSIDE_FILE)) {
    const error = new Error("Underlying provider filesystem watch API was reached outside the boundary");
    error.code = "WATCH_API_REACHED";
    throw error;
  }
  globalThis.__semanticJsMcpWatchCalls.push(name);
  return create();
};
fs.watch = watchApi("watch", filesystemWatcher);
fs.watchFile = watchApi("watchFile", filesystemWatcher);
fs.unwatchFile = watchApi("unwatchFile", () => undefined);
fs.promises.watch = watchApi("promisesWatch", asyncFilesystemWatcher);
`,
);

const probe = `
const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
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
const watcherCallCount = (name) => globalThis.__semanticJsMcpWatchCalls.filter((call) => call === name).length;
const forkEnvironment = {
  SEMANTIC_JS_MCP_INTERNAL_PROVIDER_READ_ROOTS: '["/"]',
  SEMANTIC_JS_MCP_INTERNAL_PROVIDER_WRITE_ROOTS: '["/"]',
  SEMANTIC_JS_MCP_INTERNAL_PROVIDER_CHILD_ENTRY: process.env.PROBE_OUTSIDE_FILE,
  PROBE_UNTRUSTED_ENV: "injected",
};
const collectForkEnvironment = () => new Promise((resolve) => {
  let settled = false;
  let timer;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(value);
  };
  let child;
  const originalExecPath = process.execPath;
  const originalMap = Array.prototype.map;
  const originalStringify = JSON.stringify;
  try {
    process.execPath = process.env.PROBE_OUTSIDE_FILE;
    Array.prototype.map = () => [];
    JSON.stringify = () => '["/"]';
    child = cp.fork(process.env.PROBE_PROVIDER_CHILD_ENTRY, [], {
      env: forkEnvironment,
      silent: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
  } catch {
    finish(undefined);
    return;
  } finally {
    process.execPath = originalExecPath;
    Array.prototype.map = originalMap;
    JSON.stringify = originalStringify;
  }
  timer = setTimeout(() => {
    child.kill();
    finish(undefined);
  }, 3000);
  child.once("message", finish);
  child.once("error", () => finish(undefined));
  child.once("exit", () => finish(undefined));
});
(async () => {
  const esmFs = await import("node:fs");
  const esmFsPromises = await import("node:fs/promises");
  const esmChildProcess = await import("node:child_process");
  let watchCallbackCalled = false;
  let watchFileCallbackCalled = false;
  const insideWatchCallsSucceeded =
    inertWatcher(() => fs.watch(process.env.PROBE_INSIDE_FILE, () => {})) &&
    inertWatcher(() => fs.watchFile(process.env.PROBE_INSIDE_FILE, () => {})) &&
    (() => { try { fs.unwatchFile(process.env.PROBE_INSIDE_FILE); return true; } catch { return false; } })() &&
    await inertAsyncWatcher(() => fs.promises.watch(process.env.PROBE_INSIDE_FILE)) &&
    inertWatcher(() => esmFs.watch(process.env.PROBE_INSIDE_FILE, () => {})) &&
    inertWatcher(() => esmFs.watchFile(process.env.PROBE_INSIDE_FILE, () => {})) &&
    (() => { try { esmFs.unwatchFile(process.env.PROBE_INSIDE_FILE); return true; } catch { return false; } })() &&
    await inertAsyncWatcher(() => esmFsPromises.watch(process.env.PROBE_INSIDE_FILE));
  const permissionMismatchWatchesBenign =
    inertWatcher(() => fs.watch(process.env.PROBE_PERMISSION_MISMATCH_FILE, () => {})) &&
    inertWatcher(() => fs.watchFile(process.env.PROBE_PERMISSION_MISMATCH_FILE, () => {})) &&
    (() => { try { fs.unwatchFile(process.env.PROBE_PERMISSION_MISMATCH_FILE); return true; } catch { return false; } })() &&
    await inertAsyncWatcher(() => fs.promises.watch(process.env.PROBE_PERMISSION_MISMATCH_FILE));
  const canonicalPermissionMismatchWatchesBenign =
    inertWatcher(() => fs.watch(process.env.PROBE_CANONICAL_PERMISSION_MISMATCH_SYMLINK, () => {})) &&
    inertWatcher(() => fs.watchFile(process.env.PROBE_CANONICAL_PERMISSION_MISMATCH_SYMLINK, () => {})) &&
    (() => {
      try {
        fs.unwatchFile(process.env.PROBE_CANONICAL_PERMISSION_MISMATCH_SYMLINK);
        return true;
      } catch {
        return false;
      }
    })() &&
    await inertAsyncWatcher(() => fs.promises.watch(process.env.PROBE_CANONICAL_PERMISSION_MISMATCH_SYMLINK)) &&
    globalThis.__semanticJsMcpCanonicalPermissionMismatchWatchCalls.length === 0;
  const childProcessClassDenied = denied(() => {
    const child = new cp.ChildProcess();
    child.once("error", () => {});
    child.spawn({file: process.execPath, args: [process.execPath, "-e", ""]});
    child.kill();
  });
  const esmChildProcessClassDenied = denied(() => {
    const child = new esmChildProcess.ChildProcess();
    child.once("error", () => {});
    child.spawn({file: process.execPath, args: [process.execPath, "-e", ""]});
    child.kill();
  });
  const alternateExecPath =
    path.dirname(process.execPath) + path.sep + "." + path.sep + path.basename(process.execPath);
  const forkExecPathOverrideDenied = denied(() => {
    const child = cp.fork(process.env.PROBE_PROVIDER_CHILD_ENTRY, [], {
      execPath: alternateExecPath,
      silent: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.once("error", () => {});
    child.kill();
  });
  const providerForkEnvironment = process.env.PROBE_EXPECT_PROVIDER_FORK === "1" ? await collectForkEnvironment() : undefined;
  const providerForkPolicyCorrect =
    process.env.PROBE_EXPECT_PROVIDER_FORK === "1"
      ? Boolean(providerForkEnvironment)
      : denied(() => cp.fork(process.env.PROBE_PROVIDER_CHILD_ENTRY, [], {env: forkEnvironment, silent: true}));
  const providerForkEnvironmentSealed =
    process.env.PROBE_EXPECT_PROVIDER_FORK !== "1" ||
    (providerForkEnvironment?.readRoots === process.env.SEMANTIC_JS_MCP_INTERNAL_PROVIDER_READ_ROOTS &&
      providerForkEnvironment?.writeRoots === process.env.SEMANTIC_JS_MCP_INTERNAL_PROVIDER_WRITE_ROOTS &&
      providerForkEnvironment?.childEntry === undefined &&
      providerForkEnvironment?.untrusted === undefined &&
      providerForkEnvironment?.outsideReadDenied === true);
  const expectedDelegations = process.platform === "win32" ? 2 : 0;
  const results = {
    insideReadAllowed: (() => { try { fs.readFileSync(process.env.PROBE_INSIDE_FILE, "utf8"); return true; } catch { return false; } })(),
    insideWriteAllowed: (() => { try { fs.writeFileSync(process.env.PROBE_INSIDE_WRITE, "ok"); return true; } catch { return false; } })(),
    outsideReadDenied: denied(() => fs.readFileSync(process.env.PROBE_OUTSIDE_FILE, "utf8")),
    outsideOpenAsBlobDenied: denied(() => fs.openAsBlob(process.env.PROBE_OUTSIDE_FILE)),
    symlinkEscapeDenied: denied(() => fs.readFileSync(process.env.PROBE_SYMLINK, "utf8")),
    outsideWriteDenied: denied(() => fs.writeFileSync(process.env.PROBE_OUTSIDE_WRITE, "x")),
    globDenied: typeof fs.globSync === "function" ? denied(() => fs.globSync("**/*")) : true,
    childProcessDenied: denied(() => cp.execSync("id")),
    processExecveDenied:
      typeof process.execve !== "function" ||
      denied(() => process.execve(process.execPath, [process.execPath, "-e", ""], {...process.env})),
    childProcessClassDenied,
    esmChildProcessClassDenied,
    forkExecPathOverrideDenied,
    providerForkPolicyCorrect,
    providerForkEnvironmentSealed,
    insideWatchCallsSucceeded,
    insideWatchDelegationCorrect:
      watcherCallCount("watch") === expectedDelegations &&
      watcherCallCount("watchFile") === expectedDelegations &&
      watcherCallCount("unwatchFile") === expectedDelegations &&
      watcherCallCount("promisesWatch") === expectedDelegations,
    permissionMismatchWatchesBenign,
    canonicalPermissionMismatchWatchesBenign,
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
    watchSymlinkEscapeBenign: inertWatcher(() => fs.watch(process.env.PROBE_SYMLINK, () => {})),
    promisesWatchSymlinkEscapeBenign: await inertAsyncWatcher(() => fs.promises.watch(process.env.PROBE_SYMLINK)),
  };
  process.stdout.write(JSON.stringify(results));
})().catch((error) => {
  process.stderr.write(error?.stack || String(error));
  process.exitCode = 1;
});
`;

function runProbe({forceWindows = false, permissionMode = "none"} = {}) {
  const permissionArguments =
    permissionMode === "none"
      ? []
      : [
          "--permission",
          `--allow-fs-read=${root}`,
          `--allow-fs-read=${pluginRoot}`,
          `--allow-fs-write=${root}`,
          ...(permissionMode === "allow-child-process" ? ["--allow-child-process", "--disable-warning=SecurityWarning"] : []),
        ];
  const child = spawnSync(
    process.execPath,
    [...permissionArguments, `--import=${pathToFileURL(watchTrap).href}`, `--import=${guard}`, "-e", probe],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SEMANTIC_JS_MCP_INTERNAL_PROVIDER_READ_ROOTS: JSON.stringify([root, pluginRoot]),
        SEMANTIC_JS_MCP_INTERNAL_PROVIDER_WRITE_ROOTS: JSON.stringify([root]),
        SEMANTIC_JS_MCP_INTERNAL_PROVIDER_CHILD_ENTRY: providerChildEntry,
        PROBE_FORCE_WINDOWS: forceWindows ? "1" : "0",
        PROBE_EXPECT_PROVIDER_FORK: permissionMode === "deny-child-process" ? "0" : "1",
        PROBE_INSIDE_FILE: insideFile,
        PROBE_PERMISSION_MISMATCH_FILE: permissionMismatchFile,
        PROBE_CANONICAL_PERMISSION_MISMATCH_SYMLINK: canonicalPermissionMismatchSymlink,
        PROBE_INSIDE_WRITE: insideWrite,
        PROBE_OUTSIDE_FILE: outsideFile,
        PROBE_OUTSIDE_WRITE: outsideWrite,
        PROBE_SYMLINK: symlinkEscape,
        PROBE_PROVIDER_CHILD_ENTRY: providerChildEntry,
      },
    },
  );
  if (child.status !== 0 || !child.stdout) {
    throw new Error(`provider guard probe failed: ${child.stderr || child.error?.message || "no output"}`);
  }
  return JSON.parse(child.stdout);
}

const probes = {
  layer2Native: runProbe(),
  ...(process.platform === "win32" ? {} : {layer2SimulatedWindows: runProbe({forceWindows: true})}),
  permissionWithoutChildProcess: runProbe({permissionMode: "deny-child-process"}),
  permissionWithChildProcess: runProbe({permissionMode: "allow-child-process"}),
};
console.log(JSON.stringify(probes, null, 2));

const expected = {
  insideReadAllowed: true,
  insideWriteAllowed: true,
  outsideReadDenied: true,
  outsideOpenAsBlobDenied: true,
  symlinkEscapeDenied: true,
  outsideWriteDenied: true,
  globDenied: true,
  childProcessDenied: true,
  processExecveDenied: true,
  childProcessClassDenied: true,
  esmChildProcessClassDenied: true,
  forkExecPathOverrideDenied: true,
  providerForkPolicyCorrect: true,
  providerForkEnvironmentSealed: true,
  insideWatchCallsSucceeded: true,
  insideWatchDelegationCorrect: true,
  permissionMismatchWatchesBenign: true,
  canonicalPermissionMismatchWatchesBenign: true,
  watchBenign: true,
  watchFileBenign: true,
  unwatchFileBenign: true,
  promisesWatchBenign: true,
  esmWatchBenign: true,
  esmWatchFileBenign: true,
  esmUnwatchFileBenign: true,
  esmPromisesWatchBenign: true,
  watchSymlinkEscapeBenign: true,
  promisesWatchSymlinkEscapeBenign: true,
};
const ok = Object.values(probes).every((results) => Object.entries(expected).every(([key, value]) => results[key] === value));
process.exit(ok ? 0 : 1);
