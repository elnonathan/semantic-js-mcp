#!/usr/bin/env node

import {spawn} from "node:child_process";
import {mkdtemp, mkdir, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {
  CI_EXIT_CODE,
  CI_STATUS,
  CLI_ARGUMENT,
  CLI_COMMAND,
  CONFIGURATION_FILE,
  DOCTOR_CHECK,
  DOCTOR_DISTRIBUTION_ACCEPTED_STATUS,
  NODE_EVENT,
  PRODUCT,
} from "../protocol.mjs";
import {verifyCodexPlugin} from "./codex-plugin-verification.mjs";
import {NPM_DISTRIBUTION, npmExecutableName} from "./distribution-policy.mjs";
import {RELEASE_ARGUMENT, RELEASE_CHECK, RELEASE_MODE, RELEASE_REASON, releaseStatus} from "./release-contract.mjs";

const POSTPUBLICATION_PATH = Object.freeze({
  NPM_CACHE: "npm-cache",
  CONSUMER: "consumer",
  DEPENDENCY_DIRECTORY: "node_modules",
  BINARY_DIRECTORY: ".bin",
});

const NPM_COMMAND = Object.freeze({
  VIEW: "view",
  INSTALL: "install",
  VERSION: "version",
});

const NPM_ARGUMENT = Object.freeze({
  JSON: "--json",
  IGNORE_SCRIPTS: "--ignore-scripts",
  NO_AUDIT: "--no-audit",
  NO_FUND: "--no-fund",
  SAVE_EXACT: "--save-exact",
});

const requestedVersion = process.argv[RELEASE_ARGUMENT.PACKAGE_VERSION_OFFSET];
const npmCli = process.env.npm_execpath;
const checks = [];
let workspace;

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

function runNpm(args, cwd, environment) {
  if (npmCli) return run(process.execPath, [npmCli, ...args], {cwd, env: environment});
  return run("npm", args, {cwd, env: environment});
}

function check(name, status, reason, details) {
  return {name, status, reason, ...(details ? {details} : {})};
}

function resultMessage(result) {
  return result.stderr.trim() || result.stdout.trim();
}

function registryFailure(result) {
  const message = `${result.stdout}\n${result.stderr}`;
  if (message.includes("E404")) {
    return check(RELEASE_CHECK.REGISTRY, CI_STATUS.FAIL, RELEASE_REASON.VERSION_NOT_PUBLISHED, {
      packageVersion: requestedVersion,
    });
  }
  return check(RELEASE_CHECK.REGISTRY, CI_STATUS.BLOCKED, RELEASE_REASON.REGISTRY_UNAVAILABLE, {
    packageVersion: requestedVersion,
    message: resultMessage(result),
  });
}

async function verifyRegistry(context) {
  const registry = await runNpm(
    [NPM_COMMAND.VIEW, context.packageVersion, NPM_COMMAND.VERSION, NPM_ARGUMENT.JSON],
    context.consumer,
    context.environment,
  );
  if (registry.exitCode !== CI_EXIT_CODE.PASS) return registryFailure(registry);
  let publishedVersion;
  try {
    publishedVersion = JSON.parse(registry.stdout);
  } catch {
    return check(RELEASE_CHECK.REGISTRY, CI_STATUS.FAIL, RELEASE_REASON.REGISTRY_RESPONSE_INVALID, {
      packageVersion: requestedVersion,
      message: resultMessage(registry),
    });
  }
  const matches = publishedVersion === requestedVersion;
  return check(
    RELEASE_CHECK.REGISTRY,
    matches ? CI_STATUS.PASS : CI_STATUS.FAIL,
    matches ? RELEASE_REASON.CHECK_COMPLETED : RELEASE_REASON.VERSION_NOT_PUBLISHED,
    {packageVersion: requestedVersion},
  );
}

async function verifyInstallation(context) {
  const installed = await runNpm(
    [
      NPM_COMMAND.INSTALL,
      NPM_ARGUMENT.IGNORE_SCRIPTS,
      NPM_ARGUMENT.NO_AUDIT,
      NPM_ARGUMENT.NO_FUND,
      NPM_ARGUMENT.SAVE_EXACT,
      context.packageVersion,
    ],
    context.consumer,
    context.environment,
  );
  const passed = installed.exitCode === CI_EXIT_CODE.PASS;
  return check(
    RELEASE_CHECK.INSTALLATION,
    passed ? CI_STATUS.PASS : CI_STATUS.FAIL,
    passed ? RELEASE_REASON.CHECK_COMPLETED : RELEASE_REASON.INSTALLATION_FAILED,
    passed ? undefined : {message: resultMessage(installed)},
  );
}

async function verifyInstalledVersion(context) {
  const installedRoot = await realpath(path.join(context.consumer, POSTPUBLICATION_PATH.DEPENDENCY_DIRECTORY, PRODUCT.NAME));
  const installedManifest = JSON.parse(await readFile(path.join(installedRoot, CONFIGURATION_FILE.PACKAGE), "utf8"));
  const binary = path.join(
    context.consumer,
    POSTPUBLICATION_PATH.DEPENDENCY_DIRECTORY,
    POSTPUBLICATION_PATH.BINARY_DIRECTORY,
    npmExecutableName(PRODUCT.NAME),
  );
  const version = await run(binary, [CLI_ARGUMENT.VERSION], {cwd: context.consumer, env: context.environment});
  const passed =
    version.exitCode === CI_EXIT_CODE.PASS && version.stdout.trim() === requestedVersion && installedManifest.version === requestedVersion;
  return {
    binary,
    result: check(
      RELEASE_CHECK.INSTALLED_VERSION,
      passed ? CI_STATUS.PASS : CI_STATUS.FAIL,
      passed ? RELEASE_REASON.CHECK_COMPLETED : RELEASE_REASON.INSTALLED_VERSION_DIFFERENT,
      {packageVersion: requestedVersion},
    ),
  };
}

async function verifyInstalledDoctor(context, binary) {
  const doctor = await run(binary, [CLI_COMMAND.DOCTOR], {cwd: context.consumer, env: context.environment});
  let doctorResult;
  try {
    doctorResult = JSON.parse(doctor.stdout);
  } catch {
    doctorResult = undefined;
  }
  const requiredDoctorChecks = new Set([
    DOCTOR_CHECK.MCP_STARTUP,
    DOCTOR_CHECK.TOOL_DISCOVERY,
    DOCTOR_CHECK.TYPESCRIPT_SYMBOLS,
    DOCTOR_CHECK.TYPESCRIPT_REFERENCES,
    DOCTOR_CHECK.VUE_SYMBOLS,
    DOCTOR_CHECK.VUE_TEMPLATE_DEFINITION,
  ]);
  const completedDoctorChecks = new Set(
    (doctorResult?.checks || []).filter((item) => item.status === CI_STATUS.PASS).map((item) => item.name),
  );
  const passed =
    DOCTOR_DISTRIBUTION_ACCEPTED_STATUS.includes(doctorResult?.status) &&
    [...requiredDoctorChecks].every((name) => completedDoctorChecks.has(name));
  return check(
    RELEASE_CHECK.INSTALLED_DOCTOR,
    passed ? CI_STATUS.PASS : CI_STATUS.FAIL,
    passed ? RELEASE_REASON.CHECK_COMPLETED : RELEASE_REASON.DOCTOR_REJECTED_INSTALLATION,
    passed
      ? {doctorStatus: doctorResult.status, semanticChecks: requiredDoctorChecks.size}
      : {doctorStatus: doctorResult?.status, message: resultMessage(doctor)},
  );
}

async function runVerification() {
  if (!requestedVersion) {
    checks.push(check(RELEASE_CHECK.REGISTRY, CI_STATUS.BLOCKED, RELEASE_REASON.VERSION_REQUIRED));
    return;
  }

  workspace = await mkdtemp(path.join(tmpdir(), `${PRODUCT.NAME}-postpublication-`));
  const npmCache = path.join(workspace, POSTPUBLICATION_PATH.NPM_CACHE);
  const consumer = path.join(workspace, POSTPUBLICATION_PATH.CONSUMER);
  await mkdir(npmCache, {recursive: true});
  await mkdir(consumer, {recursive: true});
  await writeFile(path.join(consumer, CONFIGURATION_FILE.PACKAGE), JSON.stringify({private: true}));
  const context = {
    consumer,
    environment: {...process.env, [NPM_DISTRIBUTION.CACHE_ENVIRONMENT_VARIABLE]: npmCache},
    packageVersion: `${PRODUCT.NAME}@${requestedVersion}`,
  };

  const registry = await verifyRegistry(context);
  checks.push(registry);
  if (registry.status !== CI_STATUS.PASS) return;

  const installation = await verifyInstallation(context);
  checks.push(installation);
  if (installation.status !== CI_STATUS.PASS) return;

  const installedVersion = await verifyInstalledVersion(context);
  checks.push(installedVersion.result);
  if (installedVersion.result.status !== CI_STATUS.PASS) return;

  checks.push(await verifyInstalledDoctor(context, installedVersion.binary));
  checks.push(...(await verifyCodexPlugin({version: requestedVersion, workspace, spawn})));
}

try {
  await runVerification();
} catch (error) {
  checks.push(
    check(RELEASE_CHECK.POSTPUBLICATION_ENVIRONMENT, CI_STATUS.BLOCKED, RELEASE_REASON.VERIFICATION_ENVIRONMENT_UNAVAILABLE, {
      message: error instanceof Error ? error.message : String(error),
    }),
  );
} finally {
  if (workspace) await rm(workspace, {recursive: true, force: true});
}

const status = releaseStatus(checks);
const output = {
  product: {name: PRODUCT.NAME, version: requestedVersion},
  mode: RELEASE_MODE.PUBLISHED,
  status,
  exitCode: CI_EXIT_CODE[status.toUpperCase()],
  checks,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exitCode = output.exitCode;
