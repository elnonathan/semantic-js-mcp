#!/usr/bin/env node

import {spawn} from "node:child_process";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {CI_EXIT_CODE, CI_STATUS, NODE_EVENT, PRODUCT} from "../protocol.mjs";
import {verifyCodexPlugin} from "./codex-plugin-verification.mjs";
import {CODEX_DISTRIBUTION} from "./distribution-policy.mjs";
import {RELEASE_MODE, RELEASE_REASON, releaseStatus} from "./release-contract.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {stdio: ["ignore", "pipe", "pipe"], ...options});
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on(NODE_EVENT.ERROR, (error) => resolve({exitCode: undefined, stdout: "", stderr: error.message}));
    child.on(NODE_EVENT.CLOSE, (exitCode) =>
      resolve({exitCode, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8")}),
    );
  });
}

assert(releaseStatus([]) === CI_STATUS.BLOCKED, "Empty release check set was not blocked");
assert(releaseStatus([{status: CI_STATUS.UNTRUSTED}]) === CI_STATUS.UNTRUSTED, "Untrusted release state was not preserved");
assert(
  releaseStatus([{status: CI_STATUS.UNTRUSTED}, {status: CI_STATUS.FAIL}]) === CI_STATUS.FAIL,
  "Release failure did not outrank untrusted evidence",
);
assert(
  releaseStatus([{status: CI_STATUS.FAIL}, {status: CI_STATUS.BLOCKED}]) === CI_STATUS.BLOCKED,
  "Release blocker did not outrank a failed check",
);

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const postpublication = await run(process.execPath, [path.join(scriptRoot, "postpublication-smoke.mjs")]);
assert(postpublication.exitCode === CI_EXIT_CODE.BLOCKED, "Postpublication verification without a version used the wrong exit code");
const postpublicationResult = JSON.parse(postpublication.stdout);
assert(postpublicationResult.mode === RELEASE_MODE.PUBLISHED, "Postpublication result omitted its mode");
assert(postpublicationResult.status === CI_STATUS.BLOCKED, "Missing version was not blocked");
assert(postpublicationResult.checks[0]?.reason === RELEASE_REASON.VERSION_REQUIRED, "Missing version omitted its literal reason");

const codexWorkspace = await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-codex-release-smoke-"));
try {
  const version = "1.2.3";
  const calls = [];
  const runCommand = async (command, args, options) => {
    calls.push({command, args, options});
    if (args.includes(CODEX_DISTRIBUTION.LIST_COMMAND)) {
      return {
        exitCode: CI_EXIT_CODE.PASS,
        stdout: JSON.stringify({
          installed: [
            {
              name: PRODUCT.NAME,
              marketplaceName: CODEX_DISTRIBUTION.MARKETPLACE_NAME,
              version,
              enabled: true,
            },
          ],
        }),
        stderr: "",
      };
    }
    return {exitCode: CI_EXIT_CODE.PASS, stdout: "{}", stderr: ""};
  };
  const codexChecks = await verifyCodexPlugin({version, workspace: codexWorkspace, runCommand});
  assert(codexChecks.length === 2, "Codex verification omitted a dependent check");
  assert(
    codexChecks.every((item) => item.status === CI_STATUS.PASS),
    "Codex verification rejected valid installation evidence",
  );
  assert(
    calls[0].args.includes(`${CODEX_DISTRIBUTION.VERSION_REF_PREFIX}${version}`),
    "Codex marketplace verification did not use an immutable version ref",
  );
  assert(
    calls[1].args.includes(CODEX_DISTRIBUTION.UPGRADE_COMMAND) && calls[1].args.includes(CODEX_DISTRIBUTION.MARKETPLACE_NAME),
    "Codex marketplace verification omitted the configured snapshot refresh",
  );
  assert(calls[2].args.includes(CODEX_DISTRIBUTION.PLUGIN_SELECTOR), "Codex verification used the wrong plugin selector");
  assert(
    calls.every((call) => call.options.env[CODEX_DISTRIBUTION.HOME_ENVIRONMENT_VARIABLE].startsWith(codexWorkspace)),
    "Codex verification did not isolate its state under the temporary workspace",
  );

  const unavailableChecks = await verifyCodexPlugin({
    version,
    workspace: codexWorkspace,
    runCommand: async () => ({exitCode: undefined, stdout: "", stderr: "missing codex"}),
  });
  assert(unavailableChecks[0].status === CI_STATUS.BLOCKED, "Missing Codex CLI was not blocked");
  assert(unavailableChecks[0].reason === RELEASE_REASON.CODEX_CLI_UNAVAILABLE, "Missing Codex CLI used the wrong reason");

  const networkChecks = await verifyCodexPlugin({
    version,
    workspace: codexWorkspace,
    runCommand: async () => ({exitCode: CI_EXIT_CODE.FAIL, stdout: "", stderr: "Could not resolve host"}),
  });
  assert(networkChecks[0].status === CI_STATUS.BLOCKED, "Unavailable Codex marketplace network was not blocked");
  assert(
    networkChecks[0].reason === RELEASE_REASON.CODEX_MARKETPLACE_UNAVAILABLE,
    "Unavailable Codex marketplace network used the wrong reason",
  );

  let upgradeCall = 0;
  const upgradeNetworkChecks = await verifyCodexPlugin({
    version,
    workspace: codexWorkspace,
    runCommand: async () => {
      upgradeCall++;
      if (upgradeCall === 1) return {exitCode: CI_EXIT_CODE.PASS, stdout: "{}", stderr: ""};
      return {exitCode: CI_EXIT_CODE.FAIL, stdout: "", stderr: "network is unreachable"};
    },
  });
  assert(upgradeNetworkChecks[0].status === CI_STATUS.BLOCKED, "Unavailable marketplace upgrade was not blocked");
  assert(
    upgradeNetworkChecks[0].reason === RELEASE_REASON.CODEX_MARKETPLACE_UNAVAILABLE,
    "Unavailable marketplace upgrade used the wrong reason",
  );
} finally {
  await rm(codexWorkspace, {recursive: true, force: true});
}

process.stdout.write(
  `${JSON.stringify(
    {
      releaseStatusPriority: "ok",
      missingPublishedVersion: "blocked",
      isolatedCodexPluginInstallation: "ok",
      unavailableCodexMarketplace: "blocked",
      unavailableCodexMarketplaceUpgrade: "blocked",
    },
    null,
    2,
  )}\n`,
);
