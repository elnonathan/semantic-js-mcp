#!/usr/bin/env node

import {spawn} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {DOCTOR_DISTRIBUTION_ACCEPTED_STATUS, NODE_EVENT, PRODUCT} from "../protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const execution = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, "cli.mjs"), "doctor"], {
    cwd: root,
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
  `${JSON.stringify({product: PRODUCT.NAME, status: report.status, exitCode: execution.exitCode, checks: report.checks.length}, null, 2)}\n`,
);
