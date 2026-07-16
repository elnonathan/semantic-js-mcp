#!/usr/bin/env node

import {spawn} from "node:child_process";
import {mkdtemp, mkdir, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  CLI_ARGUMENT,
  CLI_MESSAGE,
  PROCESS_EXIT_CODE,
  DOCTOR_DISTRIBUTION_ACCEPTED_STATUS,
  PRODUCT,
  SERVER_VERSION,
  NODE_EVENT,
} from "../protocol.mjs";
import {
  REQUIRED_PACKAGE_FILE,
  NPM_DISTRIBUTION,
  allProductionDependenciesAreBundled,
  npmExecutableName,
  packagePathIsAllowed,
} from "./distribution-policy.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await mkdtemp(path.join(tmpdir(), `${PRODUCT.NAME}-distribution-smoke-`));
const packageOutput = path.join(workspace, "package");
const consumer = path.join(workspace, "consumer");
const npmCache = path.join(workspace, "npm-cache");
const npmCli = process.env.npm_execpath;
const npmEnvironment = {...process.env, [NPM_DISTRIBUTION.CACHE_ENVIRONMENT_VARIABLE]: npmCache};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ["ignore", "pipe", "pipe"], ...options});
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on(NODE_EVENT.CLOSE, (exitCode) => resolve({exitCode, stdout, stderr}));
  });
}

function runNpm(args, cwd) {
  if (npmCli) return run(process.execPath, [npmCli, ...args], {cwd, env: npmEnvironment});
  return run("npm", args, {cwd, env: npmEnvironment});
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await mkdir(packageOutput, {recursive: true});
  await mkdir(consumer, {recursive: true});
  await mkdir(npmCache, {recursive: true});
  const packed = await runNpm(["pack", "--json", "--pack-destination", packageOutput], sourceRoot);
  assert(packed.exitCode === 0, `npm pack failed: ${packed.stderr}`);
  const packResult = JSON.parse(packed.stdout)[0];
  const packedPaths = packResult.files.map((item) => item.path);
  const sourceManifest = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  assert(allProductionDependenciesAreBundled(sourceManifest), "Every production dependency must be bundled");
  for (const requiredFile of Object.values(REQUIRED_PACKAGE_FILE)) {
    assert(packedPaths.includes(requiredFile), `Tarball omitted required file: ${requiredFile}`);
  }
  for (const packedPath of packedPaths) {
    assert(
      packagePathIsAllowed(packedPath, sourceManifest.files, true),
      `Tarball included a file outside the public allowlist: ${packedPath}`,
    );
  }

  const tarball = path.join(packageOutput, packResult.filename);
  await writeFile(path.join(consumer, "package.json"), JSON.stringify({private: true}));
  const installed = await runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--offline", tarball], consumer);
  assert(installed.exitCode === 0, `Tarball installation failed: ${installed.stderr}`);

  const installedRoot = await realpath(path.join(consumer, "node_modules", PRODUCT.NAME));
  const binaryName = npmExecutableName(PRODUCT.NAME);
  const binary = path.join(consumer, "node_modules", ".bin", binaryName);
  const isolatedPath = (process.env.PATH || "")
    .split(path.delimiter)
    .filter((entry) => entry && !path.resolve(entry).startsWith(sourceRoot))
    .join(path.delimiter);
  const doctor = await run(binary, ["doctor"], {cwd: consumer, env: {...process.env, PATH: isolatedPath}});
  const version = await run(binary, [CLI_ARGUMENT.VERSION], {cwd: consumer, env: {...process.env, PATH: isolatedPath}});
  assert(
    version.exitCode === PROCESS_EXIT_CODE.SUCCESS && version.stdout.trim() === SERVER_VERSION,
    "Installed executable returned the wrong version",
  );
  const help = await run(binary, [CLI_ARGUMENT.HELP], {cwd: consumer, env: {...process.env, PATH: isolatedPath}});
  assert(help.exitCode === PROCESS_EXIT_CODE.SUCCESS && help.stdout.includes(PRODUCT.NAME), "Installed executable did not return help");
  const invalid = await run(binary, ["unknown-command"], {cwd: consumer, env: {...process.env, PATH: isolatedPath}});
  assert(
    invalid.exitCode === PROCESS_EXIT_CODE.FAILURE && invalid.stderr.includes(CLI_MESSAGE.UNKNOWN_COMMAND),
    "Installed executable accepted an unknown command",
  );
  const doctorResult = JSON.parse(doctor.stdout);
  assert(
    DOCTOR_DISTRIBUTION_ACCEPTED_STATUS.includes(doctorResult.status),
    `Installed doctor returned ${doctorResult.status}: ${JSON.stringify(doctorResult, null, 2)}\n${doctor.stderr}`,
  );
  assert((await realpath(doctorResult.installationRoot)) === installedRoot, "Doctor resolved runtime files outside the installed package");
  const installedDependencyRoot = await realpath(path.join(consumer, "node_modules"));
  for (const component of doctorResult.runtime.components) {
    const componentFile = await realpath(component.file);
    assert(
      componentFile.startsWith(`${installedDependencyRoot}${path.sep}`),
      `Runtime component resolved outside the installed dependency tree: ${component.file}`,
    );
    assert(!componentFile.startsWith(`${sourceRoot}${path.sep}`), `Runtime component reused the source checkout: ${component.file}`);
  }
  assert(!doctorResult.installationRoot.startsWith(sourceRoot), "Installed doctor reused the source checkout");

  const installedManifest = JSON.parse(await readFile(path.join(installedRoot, "package.json"), "utf8"));
  process.stdout.write(
    `${JSON.stringify(
      {
        package: {name: installedManifest.name, version: installedManifest.version, filename: packResult.filename},
        packedFiles: packedPaths.length,
        unpackedBytes: packResult.unpackedSize,
        bundledDependencies: sourceManifest.bundleDependencies.length,
        offlineInstallation: true,
        installedRoot,
        executable: {version: version.stdout.trim(), help: "ok", invalidCommand: "rejected"},
        doctor: {status: doctorResult.status, exitCode: doctorResult.exitCode, checks: doctorResult.checks.length},
        sourceCheckoutReused: false,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(workspace, {recursive: true, force: true});
}
