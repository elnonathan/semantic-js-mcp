#!/usr/bin/env node

import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  ERROR_CODE,
  PROCESS_EXIT_CODE,
  REQUIRED_RUNTIME_COMPONENT,
  RUNTIME_STATUS,
  SERVER_VERSION,
} from "../protocol.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const components = Object.entries(REQUIRED_RUNTIME_COMPONENT).map(([component, relativePath]) => ({
  component,
  file: path.join(pluginRoot, relativePath),
  available: existsSync(path.join(pluginRoot, relativePath)),
}));
const missingComponents = components.filter((component) => !component.available);
const result = {
  serverVersion: SERVER_VERSION,
  status: missingComponents.length === 0 ? RUNTIME_STATUS.READY : RUNTIME_STATUS.BLOCKED,
  components,
  error: missingComponents.length === 0 ? undefined : {
    code: ERROR_CODE.RUNTIME_DEPENDENCY_MISSING,
    missingComponents,
  },
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = missingComponents.length === 0 ? PROCESS_EXIT_CODE.SUCCESS : PROCESS_EXIT_CODE.FAILURE;
