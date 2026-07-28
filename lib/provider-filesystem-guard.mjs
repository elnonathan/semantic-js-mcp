import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {syncBuiltinESMExports} from "node:module";
import {OPERATING_SYSTEM} from "../protocol.mjs";
import {sanitizedChildEnvironment} from "./child-process-environment.mjs";
import {fileIdentityContains, filesystemPermissionPaths} from "./file-identity.mjs";

const ENVIRONMENT = Object.freeze({
  READ_ROOTS: "SEMANTIC_JS_MCP_INTERNAL_PROVIDER_READ_ROOTS",
  WRITE_ROOTS: "SEMANTIC_JS_MCP_INTERNAL_PROVIDER_WRITE_ROOTS",
  CHILD_ENTRY: "SEMANTIC_JS_MCP_INTERNAL_PROVIDER_CHILD_ENTRY",
});

const original = Object.freeze({
  realpathSync: fs.realpathSync.bind(fs),
  lstatSync: fs.lstatSync.bind(fs),
  fork: childProcess.fork.bind(childProcess),
  childProcessSpawn: childProcess.ChildProcess.prototype.spawn,
});
const providerExecutable = process.execPath;
const providerOperatingSystem = process.platform;
const providerWorkingDirectory = process.cwd();

function rootsFromEnvironment(name) {
  try {
    const roots = JSON.parse(process.env[name] || "[]");
    if (!Array.isArray(roots)) return [];
    return roots
      .map((root) => {
        try {
          return original.realpathSync(path.resolve(root));
        } catch {
          return undefined;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const readRoots = rootsFromEnvironment(ENVIRONMENT.READ_ROOTS);
const writeRoots = rootsFromEnvironment(ENVIRONMENT.WRITE_ROOTS);
const readRootsEnvironmentValue = JSON.stringify(readRoots);
const writeRootsEnvironmentValue = JSON.stringify(writeRoots);
const isArray = Array.isArray;

function filesystemPath(value) {
  if (typeof value === "number") return undefined;
  if (value instanceof URL) return value.protocol === "file:" ? fileURLToPath(value) : undefined;
  if (Buffer.isBuffer(value)) return value.toString();
  return typeof value === "string" ? value : undefined;
}

function canonicalPath(value) {
  const candidate = filesystemPath(value);
  if (candidate === undefined) return undefined;
  const resolved = path.resolve(candidate);
  try {
    return original.realpathSync(resolved);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const missingSegments = [];
  let current = resolved;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Unable to resolve provider filesystem path: ${candidate}`);
    missingSegments.unshift(path.basename(current));
    current = parent;
    try {
      return path.join(original.realpathSync(current), ...missingSegments);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function rootContains(root, candidate) {
  return filesystemPermissionPaths(root, {
    operatingSystem: providerOperatingSystem,
    includeMacOSCaseVariants: writeRoots.includes(root),
  }).some((permissionRoot) => fileIdentityContains(permissionRoot, candidate, providerOperatingSystem));
}

function assertAllowed(value, roots, operation) {
  const candidate = canonicalPath(value);
  if (candidate === undefined) return value;
  if (roots.some((root) => rootContains(root, candidate))) return value;
  const error = new Error(`Provider filesystem ${operation} denied outside the workspace boundary: ${candidate}`);
  error.code = "ERR_ACCESS_DENIED";
  error.permission = operation;
  error.resource = candidate;
  error.allowedRoots = roots;
  throw error;
}

function replaceSinglePathMethod(target, name, roots, operation) {
  const method = target[name];
  if (typeof method !== "function") return;
  const guarded = function guardedSinglePathMethod(value, ...args) {
    assertAllowed(value, roots, operation);
    return Reflect.apply(method, this, [value, ...args]);
  };
  if (typeof method.native === "function") {
    guarded.native = function guardedNativePathMethod(value, ...args) {
      assertAllowed(value, roots, operation);
      return Reflect.apply(method.native, this, [value, ...args]);
    };
  }
  target[name] = guarded;
}

function replaceTwoPathMethod(target, name, firstRoots, secondRoots, operation) {
  const method = target[name];
  if (typeof method !== "function") return;
  target[name] = function guardedTwoPathMethod(first, second, ...args) {
    assertAllowed(first, firstRoots, operation);
    assertAllowed(second, secondRoots, operation);
    return Reflect.apply(method, this, [first, second, ...args]);
  };
}

function createInertFilesystemWatcher() {
  const watcher = {
    start() {
      return watcher;
    },
    stop() {},
    close() {},
    ref() {
      return watcher;
    },
    unref() {
      return watcher;
    },
    [Symbol.dispose]() {},
  };
  return watcher;
}

function createInertAsyncFilesystemWatcher() {
  const completed = Object.freeze({done: true, value: undefined});
  const watcher = {
    async next() {
      return completed;
    },
    async return() {
      return completed;
    },
    async throw(error) {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return watcher;
    },
  };
  return watcher;
}

function isNodeFilesystemReadDenied(error) {
  return error?.code === "ERR_ACCESS_DENIED" && error?.permission === "FileSystemRead";
}

function watchPathInsideReadRoots(value) {
  const candidate = filesystemPath(value);
  if (candidate === undefined) return false;
  const resolved = path.resolve(candidate);
  if (!readRoots.some((root) => rootContains(root, resolved))) return false;
  try {
    const canonical = canonicalPath(value);
    return readRoots.some((root) => rootContains(root, canonical));
  } catch (error) {
    // A canonicalization denial can hide a junction or symlink escape. Degrade
    // to an inert watcher instead of relying on the permission layer alone.
    if (isNodeFilesystemReadDenied(error)) return false;
    throw error;
  }
}

function createPermissionTolerantAsyncFilesystemWatcher(watcher) {
  const completed = Object.freeze({done: true, value: undefined});
  let restricted = false;
  const guarded = {
    async next(...args) {
      if (restricted) return completed;
      try {
        return await Reflect.apply(watcher.next, watcher, args);
      } catch (error) {
        if (!isNodeFilesystemReadDenied(error)) throw error;
        restricted = true;
        return completed;
      }
    },
    async return(...args) {
      if (restricted || typeof watcher.return !== "function") return completed;
      try {
        return await Reflect.apply(watcher.return, watcher, args);
      } catch (error) {
        if (!isNodeFilesystemReadDenied(error)) throw error;
        restricted = true;
        return completed;
      }
    },
    async throw(error) {
      if (restricted || typeof watcher.throw !== "function") throw error;
      try {
        return await Reflect.apply(watcher.throw, watcher, [error]);
      } catch (caught) {
        if (!isNodeFilesystemReadDenied(caught)) throw caught;
        restricted = true;
        return completed;
      }
    },
    [Symbol.asyncIterator]() {
      return guarded;
    },
  };
  return guarded;
}

function createWindowsBoundaryAwareWatcher(method, createInert, {asyncIterator = false} = {}) {
  return function windowsBoundaryAwareWatcher(value, ...args) {
    if (!watchPathInsideReadRoots(value)) return createInert();
    try {
      const watcher = Reflect.apply(method, this, [value, ...args]);
      return asyncIterator ? createPermissionTolerantAsyncFilesystemWatcher(watcher) : watcher;
    } catch (error) {
      if (isNodeFilesystemReadDenied(error)) return createInert();
      throw error;
    }
  };
}

function installWindowsBoundaryAwareFilesystemWatchers() {
  fs.watch = createWindowsBoundaryAwareWatcher(fs.watch, createInertFilesystemWatcher);
  fs.watchFile = createWindowsBoundaryAwareWatcher(fs.watchFile, createInertFilesystemWatcher);
  const unwatchFile = fs.unwatchFile;
  fs.unwatchFile = function windowsBoundaryAwareUnwatchFile(value, ...args) {
    if (!watchPathInsideReadRoots(value)) return;
    try {
      return Reflect.apply(unwatchFile, this, [value, ...args]);
    } catch (error) {
      if (isNodeFilesystemReadDenied(error)) return;
      throw error;
    }
  };
  if (typeof fs.promises.watch === "function") {
    fs.promises.watch = createWindowsBoundaryAwareWatcher(fs.promises.watch, createInertAsyncFilesystemWatcher, {
      asyncIterator: true,
    });
  }
}

function installInertFilesystemWatchers() {
  // Provider documents are synchronized explicitly. Inert watchers avoid
  // platform-dependent permission checks without expanding filesystem roots.
  fs.watch = createInertFilesystemWatcher;
  fs.watchFile = createInertFilesystemWatcher;
  fs.unwatchFile = function inertUnwatchFile() {};
  if (typeof fs.promises.watch === "function") fs.promises.watch = createInertAsyncFilesystemWatcher;
}

function installFilesystemWatchers() {
  if (providerOperatingSystem === OPERATING_SYSTEM.WINDOWS) {
    installWindowsBoundaryAwareFilesystemWatchers();
    return;
  }
  installInertFilesystemWatchers();
}

const readMethods = [
  "access",
  "accessSync",
  "createReadStream",
  "exists",
  "existsSync",
  "lstat",
  "lstatSync",
  "open",
  "openSync",
  "openAsBlob",
  "opendir",
  "opendirSync",
  "readFile",
  "readFileSync",
  "readdir",
  "readdirSync",
  "readlink",
  "readlinkSync",
  "realpath",
  "realpathSync",
  "stat",
  "statSync",
  "statfs",
  "statfsSync",
];
const writeMethods = [
  "appendFile",
  "appendFileSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "createWriteStream",
  "lchmod",
  "lchmodSync",
  "lchown",
  "lchownSync",
  "lutimes",
  "lutimesSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "truncate",
  "truncateSync",
  "unlink",
  "unlinkSync",
  "utimes",
  "utimesSync",
  "writeFile",
  "writeFileSync",
];

for (const name of readMethods) replaceSinglePathMethod(fs, name, readRoots, "read");
for (const name of writeMethods) replaceSinglePathMethod(fs, name, writeRoots, "write");
replaceTwoPathMethod(fs, "copyFile", readRoots, writeRoots, "copy");
replaceTwoPathMethod(fs, "copyFileSync", readRoots, writeRoots, "copy");
replaceTwoPathMethod(fs, "cp", readRoots, writeRoots, "copy");
replaceTwoPathMethod(fs, "cpSync", readRoots, writeRoots, "copy");
replaceTwoPathMethod(fs, "rename", writeRoots, writeRoots, "write");
replaceTwoPathMethod(fs, "renameSync", writeRoots, writeRoots, "write");
fs.link = denyFilesystemLink;
fs.linkSync = denyFilesystemLink;
fs.symlink = denyFilesystemLink;
fs.symlinkSync = denyFilesystemLink;
if (typeof fs.glob === "function") fs.glob = denyFilesystemGlob;
if (typeof fs.globSync === "function") fs.globSync = denyFilesystemGlob;

for (const name of readMethods) replaceSinglePathMethod(fs.promises, name, readRoots, "read");
for (const name of writeMethods) replaceSinglePathMethod(fs.promises, name, writeRoots, "write");
replaceTwoPathMethod(fs.promises, "copyFile", readRoots, writeRoots, "copy");
replaceTwoPathMethod(fs.promises, "cp", readRoots, writeRoots, "copy");
replaceTwoPathMethod(fs.promises, "rename", writeRoots, writeRoots, "write");
fs.promises.link = denyFilesystemLink;
fs.promises.symlink = denyFilesystemLink;
if (typeof fs.promises.glob === "function") fs.promises.glob = denyFilesystemGlob;
installFilesystemWatchers();

function providerExecArgv() {
  const writableRootSet = new Set(writeRoots);
  const readablePaths = readRoots.flatMap((root) =>
    filesystemPermissionPaths(root, {
      operatingSystem: providerOperatingSystem,
      includeMacOSCaseVariants: writableRootSet.has(root),
    }),
  );
  const writablePaths = writeRoots.flatMap((root) => filesystemPermissionPaths(root, {operatingSystem: providerOperatingSystem}));
  return [
    "--permission",
    ...readablePaths.map((root) => `--allow-fs-read=${root}`),
    ...writablePaths.map((root) => `--allow-fs-write=${root}`),
    `--import=${import.meta.url}`,
  ];
}
const providerChildExecArgv = Object.freeze(providerExecArgv());

function denyChildProcess() {
  const error = new Error("Provider child processes are disabled");
  error.code = "ERR_ACCESS_DENIED";
  error.permission = "ChildProcess";
  throw error;
}

function denyFilesystemLink() {
  const error = new Error("Provider filesystem links are disabled");
  error.code = "ERR_ACCESS_DENIED";
  error.permission = "FileSystemLink";
  throw error;
}

function denyFilesystemGlob() {
  const error = new Error("Provider filesystem globbing is disabled");
  error.code = "ERR_ACCESS_DENIED";
  error.permission = "FileSystemGlob";
  throw error;
}

const expectedChildEntry = process.env[ENVIRONMENT.CHILD_ENTRY] ? canonicalPath(process.env[ENVIRONMENT.CHILD_ENTRY]) : undefined;
const providerChildEnvironmentSnapshot = Object.freeze(sanitizedChildEnvironment(process.env));
let expectedForkSpawn = false;

function providerChildEnvironment() {
  const environment = {
    __proto__: null,
    ...providerChildEnvironmentSnapshot,
    [ENVIRONMENT.READ_ROOTS]: readRootsEnvironmentValue,
    [ENVIRONMENT.WRITE_ROOTS]: writeRootsEnvironmentValue,
  };
  delete environment[ENVIRONMENT.CHILD_ENTRY];
  return environment;
}

function forkStdio(value) {
  if (value === undefined) return undefined;
  if (!isArray(value)) denyChildProcess();
  const stdio = [];
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    if (entry !== "ignore" && entry !== "inherit" && entry !== "ipc" && entry !== "pipe") denyChildProcess();
    stdio[index] = entry;
  }
  return stdio;
}

function forkArguments(value) {
  if (!isArray(value)) denyChildProcess();
  const childArguments = [];
  for (let index = 0; index < value.length; index++) {
    const argument = value[index];
    if (typeof argument !== "string") denyChildProcess();
    childArguments[index] = argument;
  }
  return childArguments;
}

for (const name of ["exec", "execFile", "spawn", "execSync", "execFileSync", "spawnSync"]) {
  if (typeof childProcess[name] === "function") childProcess[name] = denyChildProcess;
}
if (typeof process.execve === "function") process.execve = denyChildProcess;

function guardedChildProcessSpawn(options) {
  if (!expectedForkSpawn) denyChildProcess();
  expectedForkSpawn = false;
  return Reflect.apply(original.childProcessSpawn, this, [options]);
}

childProcess.ChildProcess.prototype.spawn = guardedChildProcessSpawn;
childProcess.fork = function guardedFork(modulePath, args, options) {
  const resolvedModule = canonicalPath(modulePath);
  if (!expectedChildEntry || resolvedModule !== expectedChildEntry) denyChildProcess();
  const childArguments = forkArguments(args);
  const childOptions = options || {};
  if (typeof childOptions !== "object" || childOptions.execPath !== undefined) denyChildProcess();
  const safeOptions = {
    __proto__: null,
    cwd: providerWorkingDirectory,
    detached: false,
    env: providerChildEnvironment(),
    execPath: providerExecutable,
    execArgv: providerChildExecArgv,
    serialization: "json",
    silent: childOptions.silent === true,
    stdio: forkStdio(childOptions.stdio),
    windowsHide: true,
  };
  expectedForkSpawn = true;
  let child;
  try {
    child = original.fork(resolvedModule, childArguments, safeOptions);
  } finally {
    expectedForkSpawn = false;
  }
  const stderr = [];
  let stderrBytes = 0;
  child.stderr?.on("data", (chunk) => {
    if (stderrBytes >= 8192) return;
    const remaining = 8192 - stderrBytes;
    stderr.push(chunk.subarray(0, remaining));
    stderrBytes += Math.min(chunk.length, remaining);
  });
  child.once("exit", (code) => {
    if (code === 0 || stderr.length === 0) return;
    process.stderr.write(`[semantic-js-mcp:provider-child] ${Buffer.concat(stderr).toString("utf8").trim()}\n`);
  });
  return child;
};

syncBuiltinESMExports();
