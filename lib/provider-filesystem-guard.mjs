import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {syncBuiltinESMExports} from "node:module";
import {OPERATING_SYSTEM} from "../protocol.mjs";

const ENVIRONMENT = Object.freeze({
  READ_ROOTS: "SEMANTIC_JS_MCP_INTERNAL_PROVIDER_READ_ROOTS",
  WRITE_ROOTS: "SEMANTIC_JS_MCP_INTERNAL_PROVIDER_WRITE_ROOTS",
  CHILD_ENTRY: "SEMANTIC_JS_MCP_INTERNAL_PROVIDER_CHILD_ENTRY",
});

const original = Object.freeze({
  realpathSync: fs.realpathSync.bind(fs),
  lstatSync: fs.lstatSync.bind(fs),
  fork: childProcess.fork.bind(childProcess),
});

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
const caseInsensitiveFilesystem = process.platform === OPERATING_SYSTEM.MACOS || process.platform === OPERATING_SYSTEM.WINDOWS;

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
  const normalizedRoot = caseInsensitiveFilesystem ? root.toLowerCase() : root;
  const normalizedCandidate = caseInsensitiveFilesystem ? candidate.toLowerCase() : candidate;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
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
  "watch",
  "watchFile",
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

function providerExecArgv() {
  return [
    "--permission",
    ...readRoots.map((root) => `--allow-fs-read=${root}`),
    ...writeRoots.map((root) => `--allow-fs-write=${root}`),
    `--import=${import.meta.url}`,
  ];
}

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
for (const name of ["exec", "execFile", "spawn", "execSync", "execFileSync", "spawnSync"]) {
  if (typeof childProcess[name] === "function") childProcess[name] = denyChildProcess;
}
childProcess.fork = function guardedFork(modulePath, args, options) {
  const resolvedModule = canonicalPath(modulePath);
  if (!expectedChildEntry || resolvedModule !== expectedChildEntry) denyChildProcess();
  const childArguments = Array.isArray(args) ? args : [];
  const childOptions = (Array.isArray(args) ? options : args) || {};
  const child = original.fork(modulePath, childArguments, {
    ...childOptions,
    env: {
      ...childOptions.env,
      NODE_OPTIONS: undefined,
      NODE_PATH: undefined,
      NODE_REPL_EXTERNAL_MODULE: undefined,
      [ENVIRONMENT.CHILD_ENTRY]: undefined,
    },
    execArgv: providerExecArgv(),
  });
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
