#!/usr/bin/env node

import {ERROR_CODE, PROCESS_EXIT_CODE, RUNTIME_COMMAND, RUNTIME_REQUIREMENT_KIND, RUNTIME_STATUS, SERVER_VERSION} from "../protocol.mjs";
import {PACKAGE_ROOT, inspectExternalCommand, inspectNodeRuntime, inspectRuntimeComponents} from "../lib/runtime.mjs";

const node = inspectNodeRuntime();
const components = inspectRuntimeComponents();
const ripgrep = await inspectExternalCommand(RUNTIME_COMMAND.RIPGREP, ["--version"]);
const missingComponents = components.filter((component) => !component.available);
const blocked = !node.supported || missingComponents.length > 0 || !ripgrep.available;
const unmetRequirements = [
  ...(!node.supported ? [{requirement: RUNTIME_REQUIREMENT_KIND.NODE, details: node}] : []),
  ...missingComponents.map((component) => ({requirement: RUNTIME_REQUIREMENT_KIND.RUNTIME_COMPONENT, details: component})),
  ...(!ripgrep.available ? [{requirement: RUNTIME_COMMAND.RIPGREP, details: ripgrep}] : []),
];
const result = {
  serverVersion: SERVER_VERSION,
  installationRoot: PACKAGE_ROOT,
  status: blocked ? RUNTIME_STATUS.BLOCKED : RUNTIME_STATUS.READY,
  node,
  components,
  externalCommands: [ripgrep],
  error: blocked
    ? {
        code: ERROR_CODE.RUNTIME_REQUIREMENT_UNMET,
        unmetRequirements,
      }
    : undefined,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = blocked ? PROCESS_EXIT_CODE.FAILURE : PROCESS_EXIT_CODE.SUCCESS;
