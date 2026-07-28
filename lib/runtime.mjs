import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {CONFIGURATION_FILE, NODE_EVENT, PROCESS_EXIT_CODE, REQUIRED_RUNTIME_COMPONENT, RUNTIME_REQUIREMENT} from "../protocol.mjs";
import {sanitizedChildEnvironment} from "./child-process-environment.mjs";

const STREAM_EVENT = Object.freeze({DATA: "data"});

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function inspectNodeRuntime() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  return {
    version: process.versions.node,
    major,
    minimumMajor: RUNTIME_REQUIREMENT.MINIMUM_NODE_MAJOR,
    supported: Number.isInteger(major) && major >= RUNTIME_REQUIREMENT.MINIMUM_NODE_MAJOR,
  };
}

export function inspectRuntimeComponents(packageRoot = PACKAGE_ROOT) {
  const resolveFromPackage = createRequire(path.join(packageRoot, CONFIGURATION_FILE.PACKAGE));
  return Object.entries(REQUIRED_RUNTIME_COMPONENT).map(([component, moduleSpecifier]) => {
    let file;
    let resolutionError;
    try {
      file = resolveFromPackage.resolve(moduleSpecifier);
    } catch (error) {
      resolutionError = error.message;
    }
    return {component, moduleSpecifier, file, available: Boolean(file && existsSync(file)), ...(resolutionError ? {resolutionError} : {})};
  });
}

export function resolveRuntimeComponent(moduleSpecifier, packageRoot = PACKAGE_ROOT) {
  return createRequire(path.join(packageRoot, CONFIGURATION_FILE.PACKAGE)).resolve(moduleSpecifier);
}

export function runtimeDependencyRoot(moduleSpecifier, packageRoot = PACKAGE_ROOT) {
  let current = path.dirname(resolveRuntimeComponent(moduleSpecifier, packageRoot));
  while (path.basename(current) !== "node_modules") {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Resolved runtime component is outside a node_modules tree: ${moduleSpecifier}`);
    current = parent;
  }
  return current;
}

export function inspectExternalCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: sanitizedChildEnvironment(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on(STREAM_EVENT.DATA, (chunk) => {
      stdout += chunk;
    });
    child.stderr.on(STREAM_EVENT.DATA, (chunk) => {
      stderr += chunk;
    });
    child.on(NODE_EVENT.ERROR, (error) => resolve({command, available: false, error: error.message}));
    child.on(NODE_EVENT.CLOSE, (exitCode) =>
      resolve({
        command,
        available: exitCode === PROCESS_EXIT_CODE.SUCCESS,
        exitCode,
        versionOutput: (stdout || stderr).trim().split("\n")[0] || undefined,
      }),
    );
  });
}
