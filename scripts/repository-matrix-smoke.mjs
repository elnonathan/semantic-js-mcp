#!/usr/bin/env node

import {strictEqual} from "node:assert";
import {spawn} from "node:child_process";
import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {CI_EXIT_CODE, CI_STATUS, CONFIGURATION_FILE, NODE_EVENT} from "../protocol.mjs";
import {REPOSITORY_MATRIX_PROBE_KIND, REPOSITORY_MATRIX_REASON} from "./repository-matrix-contract.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(scriptRoot, "repository-matrix.mjs");
const workspace = await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-repository-matrix-"));
const outsideFile = `${workspace}-outside.ts`;

function run(configurationFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runner, configurationFile], {stdio: ["ignore", "pipe", "pipe"]});
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on(NODE_EVENT.CLOSE, (exitCode) =>
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

try {
  const src = path.join(workspace, "src");
  await mkdir(src, {recursive: true});
  await writeFile(path.join(workspace, CONFIGURATION_FILE.PACKAGE), JSON.stringify({private: true, type: "module"}));
  await writeFile(
    path.join(workspace, CONFIGURATION_FILE.TYPESCRIPT),
    JSON.stringify({compilerOptions: {strict: true, target: "ES2022", module: "ESNext"}, include: ["src/**/*.ts"]}),
  );
  await writeFile(path.join(src, "target.ts"), "export function matrixTarget(value: number): number { return value + 1; }\n");
  await writeFile(path.join(src, "usage.ts"), 'import {matrixTarget} from "./target.js";\nexport const matrixValue = matrixTarget(1);\n');

  const availableConfiguration = path.join(workspace, "available.json");
  await writeFile(
    availableConfiguration,
    JSON.stringify({
      repositories: [
        {
          id: "fixture",
          root: workspace,
          probes: [
            {id: "named", kind: REPOSITORY_MATRIX_PROBE_KIND.NAMED_SYMBOL, symbol: "matrixTarget", fileHint: "target.ts"},
            {id: "diagnostics", kind: REPOSITORY_MATRIX_PROBE_KIND.DIAGNOSTICS, file: "src/target.ts"},
          ],
        },
      ],
    }),
  );
  const available = await run(availableConfiguration);
  const availableResult = JSON.parse(available.stdout);
  strictEqual(availableResult.repositories[0].probes[0].status, CI_STATUS.PASS, "Named repository probe did not pass");
  if (![CI_STATUS.PASS, CI_STATUS.UNTRUSTED].includes(availableResult.repositories[0].probes[1].status)) {
    throw new Error("Diagnostic repository probe returned an invalid trust status");
  }
  strictEqual(available.exitCode, availableResult.exitCode, "Repository matrix process and result exit codes differ");

  const unavailableConfiguration = path.join(workspace, "unavailable.json");
  await writeFile(
    unavailableConfiguration,
    JSON.stringify({
      repositories: [
        {
          id: "missing",
          root: path.join(workspace, "missing"),
          probes: [{id: "named", kind: REPOSITORY_MATRIX_PROBE_KIND.NAMED_SYMBOL, symbol: "matrixTarget"}],
        },
      ],
    }),
  );
  const unavailable = await run(unavailableConfiguration);
  const unavailableResult = JSON.parse(unavailable.stdout);
  strictEqual(unavailable.exitCode, CI_EXIT_CODE.BLOCKED, "Unavailable repository used the wrong process exit code");
  strictEqual(unavailableResult.status, CI_STATUS.BLOCKED, "Unavailable repository was not blocked");
  strictEqual(
    unavailableResult.repositories[0].reason,
    REPOSITORY_MATRIX_REASON.REPOSITORY_UNAVAILABLE,
    "Unavailable repository omitted its literal reason",
  );

  const invalidConfiguration = path.join(workspace, "invalid.json");
  await writeFile(
    invalidConfiguration,
    JSON.stringify({
      repositories: [
        {
          id: "duplicate-probe",
          root: workspace,
          probes: [
            {id: "same", kind: REPOSITORY_MATRIX_PROBE_KIND.NAMED_SYMBOL, symbol: "matrixTarget"},
            {id: "same", kind: REPOSITORY_MATRIX_PROBE_KIND.DIAGNOSTICS, file: "src/target.ts"},
          ],
        },
      ],
    }),
  );
  const invalid = await run(invalidConfiguration);
  const invalidResult = JSON.parse(invalid.stdout);
  strictEqual(invalid.exitCode, CI_EXIT_CODE.BLOCKED, "Invalid repository matrix used the wrong process exit code");
  strictEqual(invalidResult.reason, REPOSITORY_MATRIX_REASON.CONFIGURATION_INVALID, "Invalid configuration was not blocked");

  await writeFile(outsideFile, "export const outsideRepository = true;\n");
  await symlink(outsideFile, path.join(src, "outside-link.ts"));
  const symlinkConfiguration = path.join(workspace, "symlink.json");
  await writeFile(
    symlinkConfiguration,
    JSON.stringify({
      repositories: [
        {
          id: "symlink-escape",
          root: workspace,
          probes: [{id: "diagnostics", kind: REPOSITORY_MATRIX_PROBE_KIND.DIAGNOSTICS, file: "src/outside-link.ts"}],
        },
      ],
    }),
  );
  const symlinkEscape = await run(symlinkConfiguration);
  const symlinkEscapeResult = JSON.parse(symlinkEscape.stdout);
  strictEqual(symlinkEscape.exitCode, CI_EXIT_CODE.FAIL, "Escaping diagnostic symlink used the wrong process exit code");
  strictEqual(
    symlinkEscapeResult.repositories[0].probes[0].reason,
    REPOSITORY_MATRIX_REASON.TOOL_EXECUTION_FAILED,
    "Escaping diagnostic symlink was not rejected",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        namedRepositoryProbe: "pass",
        diagnosticTrustStatus: availableResult.repositories[0].probes[1].status,
        unavailableRepository: "blocked",
        duplicateProbeId: "blocked",
        diagnosticSymlinkEscape: "rejected",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(workspace, {recursive: true, force: true});
  await rm(outsideFile, {force: true});
}
