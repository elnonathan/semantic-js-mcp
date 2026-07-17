import {mkdir} from "node:fs/promises";
import path from "node:path";
import {CI_EXIT_CODE, CI_STATUS, NODE_EVENT, PRODUCT} from "../protocol.mjs";
import {CODEX_DISTRIBUTION} from "./distribution-policy.mjs";
import {RELEASE_CHECK, RELEASE_REASON} from "./release-contract.mjs";

function check(name, status, reason, details) {
  return {name, status, reason, ...(details ? {details} : {})};
}

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = options.spawn(command, args, {cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"]});
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

function failureMessage(result) {
  return result.stderr.trim() || result.stdout.trim();
}

function networkUnavailable(result) {
  const message = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return CODEX_DISTRIBUTION.NETWORK_UNAVAILABLE_TEXT.some((text) => message.includes(text.toLowerCase()));
}

export async function verifyCodexPlugin({version, workspace, spawn, runCommand}) {
  const codexHome = path.join(workspace, CODEX_DISTRIBUTION.HOME_DIRECTORY);
  await mkdir(codexHome, {recursive: true});
  const environment = {...process.env, [CODEX_DISTRIBUTION.HOME_ENVIRONMENT_VARIABLE]: codexHome};
  const execute = runCommand
    ? (command, args) => runCommand(command, args, {cwd: workspace, env: environment})
    : (command, args) => run(command, args, {cwd: workspace, env: environment, spawn});
  const marketplaceRef = `${CODEX_DISTRIBUTION.VERSION_REF_PREFIX}${version}`;

  const marketplace = await execute(CODEX_DISTRIBUTION.EXECUTABLE, [
    CODEX_DISTRIBUTION.PLUGIN_COMMAND,
    CODEX_DISTRIBUTION.MARKETPLACE_COMMAND,
    CODEX_DISTRIBUTION.ADD_COMMAND,
    CODEX_DISTRIBUTION.MARKETPLACE_SOURCE,
    CODEX_DISTRIBUTION.REF_ARGUMENT,
    marketplaceRef,
    CODEX_DISTRIBUTION.JSON_ARGUMENT,
  ]);
  if (marketplace.exitCode === undefined) {
    return [
      check(RELEASE_CHECK.CODEX_MARKETPLACE, CI_STATUS.BLOCKED, RELEASE_REASON.CODEX_CLI_UNAVAILABLE, {
        message: failureMessage(marketplace),
      }),
    ];
  }
  if (marketplace.exitCode !== CI_EXIT_CODE.PASS) {
    const unavailable = networkUnavailable(marketplace);
    return [
      check(
        RELEASE_CHECK.CODEX_MARKETPLACE,
        unavailable ? CI_STATUS.BLOCKED : CI_STATUS.FAIL,
        unavailable ? RELEASE_REASON.CODEX_MARKETPLACE_UNAVAILABLE : RELEASE_REASON.CODEX_MARKETPLACE_FAILED,
        {
          marketplaceRef,
          message: failureMessage(marketplace),
        },
      ),
    ];
  }

  const upgrade = await execute(CODEX_DISTRIBUTION.EXECUTABLE, [
    CODEX_DISTRIBUTION.PLUGIN_COMMAND,
    CODEX_DISTRIBUTION.MARKETPLACE_COMMAND,
    CODEX_DISTRIBUTION.UPGRADE_COMMAND,
    CODEX_DISTRIBUTION.MARKETPLACE_NAME,
    CODEX_DISTRIBUTION.JSON_ARGUMENT,
  ]);
  if (upgrade.exitCode !== CI_EXIT_CODE.PASS) {
    const unavailable = upgrade.exitCode === undefined || networkUnavailable(upgrade);
    return [
      check(
        RELEASE_CHECK.CODEX_MARKETPLACE,
        unavailable ? CI_STATUS.BLOCKED : CI_STATUS.FAIL,
        unavailable ? RELEASE_REASON.CODEX_MARKETPLACE_UNAVAILABLE : RELEASE_REASON.CODEX_MARKETPLACE_FAILED,
        {marketplaceRef, message: failureMessage(upgrade)},
      ),
    ];
  }

  const checks = [check(RELEASE_CHECK.CODEX_MARKETPLACE, CI_STATUS.PASS, RELEASE_REASON.CHECK_COMPLETED, {marketplaceRef})];
  const installation = await execute(CODEX_DISTRIBUTION.EXECUTABLE, [
    CODEX_DISTRIBUTION.PLUGIN_COMMAND,
    CODEX_DISTRIBUTION.ADD_COMMAND,
    CODEX_DISTRIBUTION.PLUGIN_SELECTOR,
    CODEX_DISTRIBUTION.JSON_ARGUMENT,
  ]);
  if (installation.exitCode !== CI_EXIT_CODE.PASS) {
    const unavailable = installation.exitCode === undefined || networkUnavailable(installation);
    checks.push(
      check(
        RELEASE_CHECK.CODEX_PLUGIN_INSTALLATION,
        unavailable ? CI_STATUS.BLOCKED : CI_STATUS.FAIL,
        unavailable ? RELEASE_REASON.CODEX_PLUGIN_SOURCE_UNAVAILABLE : RELEASE_REASON.CODEX_PLUGIN_INSTALLATION_FAILED,
        {message: failureMessage(installation)},
      ),
    );
    return checks;
  }

  const listed = await execute(CODEX_DISTRIBUTION.EXECUTABLE, [
    CODEX_DISTRIBUTION.PLUGIN_COMMAND,
    CODEX_DISTRIBUTION.LIST_COMMAND,
    CODEX_DISTRIBUTION.JSON_ARGUMENT,
  ]);
  let listResult;
  try {
    listResult = JSON.parse(listed.stdout);
  } catch {
    listResult = undefined;
  }
  const installedPlugin = listResult?.installed?.find(
    (plugin) => plugin.name === PRODUCT.NAME && plugin.marketplaceName === CODEX_DISTRIBUTION.MARKETPLACE_NAME,
  );
  if (listed.exitCode === undefined || networkUnavailable(listed)) {
    checks.push(
      check(RELEASE_CHECK.CODEX_PLUGIN_INSTALLATION, CI_STATUS.BLOCKED, RELEASE_REASON.CODEX_PLUGIN_SOURCE_UNAVAILABLE, {
        message: failureMessage(listed),
      }),
    );
    return checks;
  }
  const installedVersionMatches =
    listed.exitCode === CI_EXIT_CODE.PASS && installedPlugin?.version === version && installedPlugin?.enabled === true;
  checks.push(
    check(
      RELEASE_CHECK.CODEX_PLUGIN_INSTALLATION,
      installedVersionMatches ? CI_STATUS.PASS : CI_STATUS.FAIL,
      installedVersionMatches ? RELEASE_REASON.CHECK_COMPLETED : RELEASE_REASON.CODEX_PLUGIN_VERSION_DIFFERENT,
      installedVersionMatches
        ? {version}
        : {expectedVersion: version, installedVersion: installedPlugin?.version, message: failureMessage(listed)},
    ),
  );
  return checks;
}
