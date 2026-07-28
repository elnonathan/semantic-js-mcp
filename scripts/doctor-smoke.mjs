#!/usr/bin/env node

import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {DOCTOR_DISTRIBUTION_ACCEPTED_STATUS, NODE_EVENT, PRODUCT} from "../protocol.mjs";
import {removeTemporaryDirectory} from "../lib/temporary-directory.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const probeDirectory = await mkdtemp(path.join(tmpdir(), `${PRODUCT.NAME}-doctor-environment-`));
const probeFile = path.join(probeDirectory, "probe.mjs");
const probeMarker = path.join(probeDirectory, "server-environment-injection");
await writeFile(
  probeFile,
  [
    'import {writeFileSync} from "node:fs";',
    'import path from "node:path";',
    'if (path.basename(process.argv[1] || "") === "server.mjs") {',
    '  writeFileSync(process.env.SEMANTIC_JS_MCP_DOCTOR_ENV_PROBE_MARKER, "injected\\n");',
    "}",
  ].join("\n"),
);

let execution;
let childEnvironmentSanitized;
try {
  execution = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "cli.mjs"), "doctor"], {
      cwd: root,
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(probeFile).href}`,
        SEMANTIC_JS_MCP_DOCTOR_ENV_PROBE_MARKER: probeMarker,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on(NODE_EVENT.ERROR, reject);
    child.on(NODE_EVENT.CLOSE, (exitCode) =>
      resolve({exitCode, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8")}),
    );
  });
  childEnvironmentSanitized = !existsSync(probeMarker);
} finally {
  await removeTemporaryDirectory(probeDirectory);
}

if (!childEnvironmentSanitized) {
  throw new Error("Doctor passed NODE_OPTIONS from its caller to the diagnostic server");
}

let report;
try {
  report = JSON.parse(execution.stdout);
} catch {
  throw new Error(`Doctor did not return JSON: ${execution.stderr || execution.stdout}`);
}
if (!DOCTOR_DISTRIBUTION_ACCEPTED_STATUS.includes(report.status)) {
  throw new Error(`Doctor returned ${report.status}: ${JSON.stringify(report, null, 2)}\n${execution.stderr}`);
}
if (report.exitCode !== execution.exitCode) {
  throw new Error(`Doctor process exit ${execution.exitCode} differs from reported exit ${report.exitCode}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      product: PRODUCT.NAME,
      status: report.status,
      exitCode: execution.exitCode,
      checks: report.checks.length,
      childEnvironmentSanitized,
    },
    null,
    2,
  )}\n`,
);
