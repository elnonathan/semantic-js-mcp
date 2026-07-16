#!/usr/bin/env node

import {spawn} from "node:child_process";
import {performance} from "node:perf_hooks";
import {CI_EXIT_CODE, CI_STATUS, NODE_EVENT, PRODUCT, SERVER_VERSION} from "../protocol.mjs";
import {RELEASE_LOCAL_CHECKS, RELEASE_MODE, RELEASE_REASON, releaseStatus} from "./release-contract.mjs";

const npmCli = process.env.npm_execpath;

function runNpmScript(npmScript) {
  const command = npmCli ? process.execPath : "npm";
  const args = npmCli ? [npmCli, "run", npmScript] : ["run", npmScript];
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(command, args, {cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"]});
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on(NODE_EVENT.ERROR, (error) =>
      resolve({
        exitCode: undefined,
        message: error.message,
        durationMilliseconds: Math.round(performance.now() - startedAt),
      }),
    );
    child.on(NODE_EVENT.CLOSE, (exitCode) =>
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMilliseconds: Math.round(performance.now() - startedAt),
      }),
    );
  });
}

const checks = [];
for (const configuredCheck of RELEASE_LOCAL_CHECKS) {
  process.stderr.write(`[${PRODUCT.NAME}:release] ${configuredCheck.name}\n`);
  const result = await runNpmScript(configuredCheck.npmScript);
  const passed = result.exitCode === CI_EXIT_CODE.PASS;
  checks.push({
    name: configuredCheck.name,
    npmScript: configuredCheck.npmScript,
    status: passed ? CI_STATUS.PASS : CI_STATUS.FAIL,
    reason: passed ? RELEASE_REASON.CHECK_COMPLETED : RELEASE_REASON.CHECK_FAILED,
    exitCode: result.exitCode,
    durationMilliseconds: result.durationMilliseconds,
    ...(passed ? {} : {message: result.message || result.stderr.trim() || result.stdout.trim()}),
  });
}

const status = releaseStatus(checks);
const output = {
  product: {name: PRODUCT.NAME, version: SERVER_VERSION},
  mode: RELEASE_MODE.LOCAL,
  status,
  exitCode: CI_EXIT_CODE[status.toUpperCase()],
  checks,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exitCode = output.exitCode;
