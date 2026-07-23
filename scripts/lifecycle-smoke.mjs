#!/usr/bin/env node

import path from "node:path";
import {mkdtemp, mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {PendingRequestRegistry} from "../lib/pending-requests.mjs";
import {removeTemporaryDirectory} from "../lib/temporary-directory.mjs";
import {ENVIRONMENT_VARIABLE, PRODUCT, TOOL} from "../protocol.mjs";

const CHECK_STATUS = Object.freeze({OK: "ok"});
const PROCESS_ERROR = Object.freeze({NOT_FOUND: "ESRCH"});
const PROCESS_EVENT = Object.freeze({DATA: "data"});
const PROCESS_SIGNAL = Object.freeze({EXISTS: 0, TERMINATE: "SIGTERM"});
const LIFECYCLE_PHASE = Object.freeze({
  CONNECT: "connect",
  IDLE_DISPOSAL: "idle-disposal",
  LRU_EVICTION: "lru-eviction",
  PROVIDER_RECOVERY: "provider-recovery",
  VUE_BRIDGE_RECOVERY: "vue-bridge-recovery",
});
const TIMING = Object.freeze({
  CLIENT_IDLE_TIMEOUT_MS: 300,
  CLIENT_MINIMUM_EVICTION_AGE_MS: 50,
  EVICTION_AGE_WAIT_MS: 75,
  MAXIMUM_ACTIVE_CLIENTS: 1,
  OBSERVATION_ATTEMPTS: 160,
  OBSERVATION_INTERVAL_MS: 50,
  PENDING_SETTLEMENT_TIMEOUT_MS: 1_000,
  REGISTRY_OBSERVATION_WAIT_MS: 75,
  REGISTRY_TIMEOUT_MS: 25,
  REQUEST_START_WAIT_MS: 25,
});
const PROVIDER_START_PATTERN = /starting provider (\d+)/;
const BRIDGE_START_PATTERN = /starting bridge (\d+)/;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < TIMING.OBSERVATION_ATTEMPTS; attempt += 1) {
    if (await predicate()) return;
    await delay(TIMING.OBSERVATION_INTERVAL_MS);
  }
  throw new Error(message);
}

function processExists(pid) {
  try {
    process.kill(pid, PROCESS_SIGNAL.EXISTS);
    return true;
  } catch (error) {
    if (error?.code === PROCESS_ERROR.NOT_FOUND) return false;
    throw error;
  }
}

async function createWorkspace(name, functionName) {
  const workspace = await mkdtemp(path.join(tmpdir(), `semantic-js-mcp-lifecycle-${name}-`));
  const sourceDirectory = path.join(workspace, "src");
  await mkdir(sourceDirectory, {recursive: true});
  await writeFile(path.join(workspace, "package.json"), JSON.stringify({private: true, type: "module"}));
  await writeFile(
    path.join(workspace, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler"},
      include: ["src/**/*.ts"],
    }),
  );
  const file = path.join(sourceDirectory, "target.ts");
  await writeFile(file, `export function ${functionName}(): string { return "${name}"; }\n`);
  return {file, functionName, workspace};
}

async function createVueWorkspace() {
  const fixture = await createWorkspace("vue", "bridgeLifecycleTarget");
  const vueFile = path.join(path.dirname(fixture.file), "target.vue");
  await writeFile(
    path.join(fixture.workspace, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler"},
      include: ["src/**/*.vue"],
    }),
  );
  await writeFile(
    vueFile,
    [
      '<script setup lang="ts">',
      "function bridgeLifecycleTarget(): number { return 1; }",
      'const unresolvedText = "bridgeLifecycleTarget";',
      "</script>",
      "<template>{{ bridgeLifecycleTarget() }} {{ unresolvedText }}</template>",
    ].join("\n"),
  );
  return {...fixture, file: vueFile};
}

async function assertDocumentSymbol(client, fixture) {
  const response = await client.callTool({
    name: TOOL.DOCUMENT_SYMBOLS,
    arguments: {file: fixture.file, root: fixture.workspace},
  });
  assert(!response.isError, response.content?.[0]?.text || `${TOOL.DOCUMENT_SYMBOLS} failed`);
  assert(
    response.structuredContent?.result?.symbols?.some((symbol) => symbol.name === fixture.functionName),
    `Document symbol missing: ${fixture.functionName}`,
  );
}

async function callUntilRecovered(client, fixture) {
  let lastError;
  for (let attempt = 0; attempt < TIMING.OBSERVATION_ATTEMPTS; attempt += 1) {
    try {
      await assertDocumentSymbol(client, fixture);
      return;
    } catch (error) {
      lastError = error;
      await delay(TIMING.OBSERVATION_INTERVAL_MS);
    }
  }
  throw lastError || new Error("Provider did not recover");
}

async function auditUntilBridgeRecovered(client, fixture) {
  let lastError;
  for (let attempt = 0; attempt < TIMING.OBSERVATION_ATTEMPTS; attempt += 1) {
    try {
      const response = await client.callTool({
        name: TOOL.AUDIT_NAMED_SYMBOL,
        arguments: {root: fixture.workspace, symbol: fixture.functionName},
      });
      if (!response.isError) return;
      lastError = new Error(response.content?.[0]?.text || `${TOOL.AUDIT_NAMED_SYMBOL} failed after bridge exit`);
    } catch (error) {
      lastError = error;
    }
    await delay(TIMING.OBSERVATION_INTERVAL_MS);
  }
  throw lastError || new Error("Vue tsserver bridge did not recover");
}

async function settlesWithin(promise, milliseconds) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), milliseconds);
  });
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function assertPendingRequestRegistry() {
  const registry = new PendingRequestRegistry({
    timeoutMilliseconds: TIMING.REGISTRY_TIMEOUT_MS,
    timeoutMessage: (operation) => `timed out: ${operation}`,
  });
  const timeoutResult = await registry.create("timeout", "timeout-operation").then(
    () => undefined,
    (error) => error,
  );
  assert(timeoutResult?.message === "timed out: timeout-operation", "Pending request timeout used the wrong error");
  assert(registry.size === 0, "Timed-out request remained registered");

  const resolved = registry.create("resolved", "resolved-operation");
  registry.take("resolved")?.resolve("resolved-value");
  assert((await resolved) === "resolved-value", "Taken request did not resolve");
  await delay(TIMING.REGISTRY_OBSERVATION_WAIT_MS);
  assert(registry.size === 0, "Resolved request retained its timeout");

  const rejected = registry.create("rejected", "rejected-operation").then(
    () => undefined,
    (error) => error,
  );
  const rejection = new Error("provider exited");
  registry.rejectAll(rejection);
  assert((await rejected) === rejection, "Bulk rejection did not preserve the provider error");
  await delay(TIMING.REGISTRY_OBSERVATION_WAIT_MS);
  assert(registry.size === 0, "Bulk rejection retained pending requests or timers");
}

const fixtureA = await createWorkspace("a", "lifecycleTargetA");
const fixtureB = await createWorkspace("b", "lifecycleTargetB");
const vueFixture = await createVueWorkspace();
const providerPids = [];
const bridgePids = [];
let lifecyclePhase = LIFECYCLE_PHASE.CONNECT;
let serverStderr = "";
let stderrLineBuffer = "";
const client = new Client({name: "semantic-js-mcp-lifecycle-smoke", version: "1.0.0"});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(pluginRoot, "server.mjs")],
  cwd: pluginRoot,
  stderr: "pipe",
  env: {
    ...process.env,
    [ENVIRONMENT_VARIABLE.WORKSPACE_ROOTS]: tmpdir(),
    [ENVIRONMENT_VARIABLE.CLIENT_IDLE_TIMEOUT_MS]: String(TIMING.CLIENT_IDLE_TIMEOUT_MS),
    [ENVIRONMENT_VARIABLE.CLIENT_MINIMUM_EVICTION_AGE_MS]: String(TIMING.CLIENT_MINIMUM_EVICTION_AGE_MS),
    [ENVIRONMENT_VARIABLE.MAXIMUM_ACTIVE_CLIENTS]: String(TIMING.MAXIMUM_ACTIVE_CLIENTS),
  },
});

transport.stderr?.on(PROCESS_EVENT.DATA, (chunk) => {
  const text = chunk.toString();
  serverStderr += text;
  stderrLineBuffer += text;
  const lines = stderrLineBuffer.split("\n");
  stderrLineBuffer = lines.pop() || "";
  for (const line of lines) {
    const match = PROVIDER_START_PATTERN.exec(line);
    if (match) providerPids.push(Number(match[1]));
    const bridgeMatch = BRIDGE_START_PATTERN.exec(line);
    if (bridgeMatch) bridgePids.push(Number(bridgeMatch[1]));
  }
});

try {
  await assertPendingRequestRegistry();
  await client.connect(transport);

  lifecyclePhase = LIFECYCLE_PHASE.IDLE_DISPOSAL;
  await assertDocumentSymbol(client, fixtureA);
  await waitUntil(() => providerPids.length >= 1, "Cold-start provider was not observed");
  const initialProvider = providerPids[0];
  await waitUntil(() => !processExists(initialProvider), "Idle provider was not disposed after its TTL");

  await assertDocumentSymbol(client, fixtureA);
  await waitUntil(() => providerPids.length >= 2, "Provider was not restarted after idle disposal");
  const replacementAfterIdle = providerPids[1];
  assert(replacementAfterIdle !== initialProvider, "Idle disposal reused the exited provider process");

  lifecyclePhase = LIFECYCLE_PHASE.LRU_EVICTION;
  await delay(TIMING.EVICTION_AGE_WAIT_MS);
  await assertDocumentSymbol(client, fixtureB);
  await waitUntil(() => providerPids.length >= 3, "Second workspace provider was not observed");
  await waitUntil(() => !processExists(replacementAfterIdle), "Least-recently-used provider was not evicted at capacity");
  const providerBeforeExit = providerPids[2];

  lifecyclePhase = LIFECYCLE_PHASE.PROVIDER_RECOVERY;
  const pendingDiagnostics = client.callTool({
    name: TOOL.DIAGNOSTICS,
    arguments: {file: fixtureB.file, root: fixtureB.workspace},
  });
  await delay(TIMING.REQUEST_START_WAIT_MS);
  process.kill(providerBeforeExit, PROCESS_SIGNAL.TERMINATE);
  await waitUntil(() => !processExists(providerBeforeExit), "Provider did not exit after the test signal");
  assert(
    await settlesWithin(pendingDiagnostics, TIMING.PENDING_SETTLEMENT_TIMEOUT_MS),
    "Pending diagnostics did not settle promptly after provider exit",
  );
  await callUntilRecovered(client, fixtureB);
  await waitUntil(() => providerPids.length >= 4, "Unexpected provider exit did not create a replacement");
  assert(providerPids[3] !== providerBeforeExit, "Provider recovery reused the exited process");

  lifecyclePhase = LIFECYCLE_PHASE.VUE_BRIDGE_RECOVERY;
  await delay(TIMING.EVICTION_AGE_WAIT_MS);
  await assertDocumentSymbol(client, vueFixture);
  await waitUntil(() => bridgePids.length >= 1, "Vue tsserver bridge was not observed");
  const bridgeBeforeExit = bridgePids[0];
  process.kill(bridgeBeforeExit, PROCESS_SIGNAL.TERMINATE);
  await waitUntil(() => !processExists(bridgeBeforeExit), "Vue tsserver bridge did not exit after the test signal");
  await auditUntilBridgeRecovered(client, vueFixture);
  await waitUntil(() => bridgePids.length >= 2, "Vue tsserver bridge exit did not create a replacement");
  assert(bridgePids[1] !== bridgeBeforeExit, "Vue tsserver bridge recovery reused the exited process");

  process.stdout.write(
    `${JSON.stringify(
      {
        product: PRODUCT.NAME,
        deterministicRequestTimeout: CHECK_STATUS.OK,
        coldStart: CHECK_STATUS.OK,
        idleClientDisposal: CHECK_STATUS.OK,
        leastRecentlyUsedClientEviction: CHECK_STATUS.OK,
        pendingWorkSettlement: CHECK_STATUS.OK,
        providerExitRecovery: CHECK_STATUS.OK,
        vueTsserverBridgeRecovery: CHECK_STATUS.OK,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const recentServerStderr = serverStderr.trim().split("\n").slice(-40).join("\n");
  throw new Error(
    `${error instanceof Error ? error.message : String(error)}\nLifecycle phase: ${lifecyclePhase}\nServer stderr:\n${recentServerStderr || "(empty)"}`,
    {cause: error},
  );
} finally {
  await client.close().catch(() => undefined);
  await Promise.all([
    removeTemporaryDirectory(fixtureA.workspace),
    removeTemporaryDirectory(fixtureB.workspace),
    removeTemporaryDirectory(vueFixture.workspace),
  ]);
}
