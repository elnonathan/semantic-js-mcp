#!/usr/bin/env node

import {spawn} from "node:child_process";
import path from "node:path";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {ENVIRONMENT_VARIABLE, NODE_EVENT, PRODUCT, TOOL} from "../protocol.mjs";
import {
  LIFECYCLE_MEMORY_BENCHMARK as BENCHMARK,
  LIFECYCLE_MEMORY_EXIT_CODE,
  LIFECYCLE_MEMORY_FIELD,
  LIFECYCLE_MEMORY_METHOD,
  LIFECYCLE_MEMORY_OBSERVER,
  LIFECYCLE_MEMORY_REASON,
  LIFECYCLE_MEMORY_STATUS,
  LIFECYCLE_MEMORY_SUPPORTED_PLATFORMS,
} from "./lifecycle-memory-contract.mjs";

const PROCESS_ERROR = Object.freeze({COMMAND_NOT_FOUND: "ENOENT", NOT_FOUND: "ESRCH"});
const PROCESS_EVENT = Object.freeze({DATA: "data"});
const PROCESS_SIGNAL = Object.freeze({EXISTS: 0});
const SUPPORTED_PLATFORM = new Set(LIFECYCLE_MEMORY_SUPPORTED_PLATFORMS);
const PROVIDER_START_PATTERN = /starting provider (\d+)/;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < BENCHMARK.OBSERVATION_ATTEMPTS; attempt += 1) {
    const value = await predicate();
    if (value) return value;
    await delay(BENCHMARK.OBSERVATION_INTERVAL_MS);
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

function readResidentSetBytes(pid) {
  return new Promise((resolve, reject) => {
    const child = spawn("ps", ["-o", "rss=", "-p", String(pid)], {stdio: ["ignore", "pipe", "pipe"]});
    const stdout = [];
    const stderr = [];
    child.stdout.on(PROCESS_EVENT.DATA, (chunk) => stdout.push(chunk));
    child.stderr.on(PROCESS_EVENT.DATA, (chunk) => stderr.push(chunk));
    child.on(NODE_EVENT.ERROR, reject);
    child.on(NODE_EVENT.CLOSE, (exitCode) => {
      const kibibytes = Number(Buffer.concat(stdout).toString("utf8").trim());
      if (exitCode === 0 && Number.isFinite(kibibytes)) {
        resolve(kibibytes * 1024);
        return;
      }
      const message = Buffer.concat(stderr).toString("utf8").trim() || `ps exited ${exitCode}`;
      reject(new Error(`Could not read provider RSS: ${message}`));
    });
  });
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function linearSlope(values) {
  const center = (values.length - 1) / 2;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const distance = index - center;
    numerator += distance * values[index];
    denominator += distance * distance;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function summarize(values) {
  return {
    minimumBytes: Math.min(...values),
    medianBytes: Math.round(median(values)),
    maximumBytes: Math.max(...values),
  };
}

function assessTrend(samples, field, {medianMinimumBytes, medianRatio, slopeMinimumBytes, slopeRatio}) {
  const values = samples.map((sample) => sample[field]);
  const firstMedian = median(values.slice(0, BENCHMARK.COMPARISON_WINDOW));
  const lastMedian = median(values.slice(-BENCHMARK.COMPARISON_WINDOW));
  const medianGrowthBytes = lastMedian - firstMedian;
  const slopeBytesPerCycle = linearSlope(values);
  const maximumMedianGrowthBytes = Math.max(medianMinimumBytes, firstMedian * medianRatio);
  const maximumSlopeBytesPerCycle = Math.max(slopeMinimumBytes, firstMedian * slopeRatio);
  return {
    status:
      medianGrowthBytes <= maximumMedianGrowthBytes && slopeBytesPerCycle <= maximumSlopeBytesPerCycle
        ? LIFECYCLE_MEMORY_STATUS.PASS
        : LIFECYCLE_MEMORY_STATUS.FAIL,
    firstWindowMedianBytes: Math.round(firstMedian),
    lastWindowMedianBytes: Math.round(lastMedian),
    medianGrowthBytes: Math.round(medianGrowthBytes),
    maximumMedianGrowthBytes: Math.round(maximumMedianGrowthBytes),
    slopeBytesPerCycle: Math.round(slopeBytesPerCycle),
    maximumSlopeBytesPerCycle: Math.round(maximumSlopeBytesPerCycle),
  };
}

function assertAssessmentContract() {
  const limits = {
    medianMinimumBytes: BENCHMARK.SYNTHETIC_MEDIAN_LIMIT_BYTES,
    medianRatio: 0,
    slopeMinimumBytes: BENCHMARK.SYNTHETIC_SLOPE_LIMIT_BYTES,
    slopeRatio: 0,
  };
  const stable = Array.from({length: BENCHMARK.SYNTHETIC_SAMPLE_COUNT}, (_, index) => ({
    [LIFECYCLE_MEMORY_FIELD.SYNTHETIC_VALUE]: BENCHMARK.SYNTHETIC_BASE_BYTES + (index % BENCHMARK.SYNTHETIC_STABLE_VARIATION_BYTES),
  }));
  const growing = Array.from({length: BENCHMARK.SYNTHETIC_SAMPLE_COUNT}, (_, index) => ({
    [LIFECYCLE_MEMORY_FIELD.SYNTHETIC_VALUE]: BENCHMARK.SYNTHETIC_BASE_BYTES + index * BENCHMARK.SYNTHETIC_GROWTH_BYTES_PER_CYCLE,
  }));
  assert(
    assessTrend(stable, LIFECYCLE_MEMORY_FIELD.SYNTHETIC_VALUE, limits).status === LIFECYCLE_MEMORY_STATUS.PASS,
    "Stable trend failed assessment",
  );
  assert(
    assessTrend(growing, LIFECYCLE_MEMORY_FIELD.SYNTHETIC_VALUE, limits).status === LIFECYCLE_MEMORY_STATUS.FAIL,
    "Growing trend passed assessment",
  );
}

async function createWorkspace() {
  const workspace = await mkdtemp(path.join(tmpdir(), `${PRODUCT.NAME}-lifecycle-memory-`));
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
  await writeFile(file, 'export function lifecycleMemoryTarget(): string { return "memory"; }\n');
  return {file, workspace};
}

function blockedOutput(reason) {
  return {
    product: PRODUCT.NAME,
    status: LIFECYCLE_MEMORY_STATUS.BLOCKED,
    reason,
    platform: {current: process.platform, supported: [...SUPPORTED_PLATFORM]},
  };
}

async function runBenchmark() {
  const fixture = await createWorkspace();
  const providerPids = [];
  const memorySnapshots = [];
  let stderrBuffer = "";
  const client = new Client({name: `${PRODUCT.NAME}-lifecycle-memory`, version: "1.0.0"});
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--expose-gc", path.join(pluginRoot, "scripts", "lifecycle-memory-observer.mjs")],
    cwd: pluginRoot,
    stderr: "pipe",
    env: {
      ...process.env,
      [ENVIRONMENT_VARIABLE.WORKSPACE_ROOTS]: tmpdir(),
      [ENVIRONMENT_VARIABLE.CLIENT_IDLE_TIMEOUT_MS]: String(BENCHMARK.CLIENT_IDLE_TIMEOUT_MS),
    },
  });

  transport.stderr?.on(PROCESS_EVENT.DATA, (chunk) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() || "";
    for (const line of lines) {
      const providerMatch = PROVIDER_START_PATTERN.exec(line);
      if (providerMatch) providerPids.push(Number(providerMatch[1]));
      const memoryOffset = line.indexOf(LIFECYCLE_MEMORY_OBSERVER.PREFIX);
      if (memoryOffset < 0) continue;
      try {
        memorySnapshots.push(JSON.parse(line.slice(memoryOffset + LIFECYCLE_MEMORY_OBSERVER.PREFIX.length)));
      } catch {
        // A malformed observer line cannot establish memory evidence.
      }
    }
  });

  const cycles = [];
  try {
    await client.connect(transport);
    await waitUntil(() => memorySnapshots.at(-1), "Initial MCP memory snapshot was not observed");

    for (let cycle = 0; cycle < BENCHMARK.CYCLES; cycle += 1) {
      const response = await client.callTool({
        name: TOOL.DOCUMENT_SYMBOLS,
        arguments: {file: fixture.file, root: fixture.workspace},
      });
      assert(!response.isError, response.content?.[0]?.text || `${TOOL.DOCUMENT_SYMBOLS} failed`);
      const providerPid = await waitUntil(() => providerPids[cycle], `Provider was not observed for cycle ${cycle + 1}`);
      const providerResidentSetBytes = await readResidentSetBytes(providerPid);
      await waitUntil(() => !processExists(providerPid), `Provider was not disposed for cycle ${cycle + 1}`);
      const disposedAt = Date.now();
      const memory = await waitUntil(
        () => memorySnapshots.findLast((snapshot) => snapshot.recordedAtEpochMilliseconds > disposedAt),
        `Post-disposal MCP memory was not observed for cycle ${cycle + 1}`,
      );
      cycles.push({cycle: cycle + 1, providerResidentSetBytes, providerDisposed: true, mcp: memory});
    }

    const measured = cycles.slice(BENCHMARK.WARMUP_CYCLES).map((cycle) => cycle.mcp);
    const heap = assessTrend(measured, LIFECYCLE_MEMORY_FIELD.HEAP_USED_BYTES, {
      medianMinimumBytes: BENCHMARK.HEAP_MEDIAN_GROWTH_MINIMUM_BYTES,
      medianRatio: BENCHMARK.HEAP_MEDIAN_GROWTH_RATIO,
      slopeMinimumBytes: BENCHMARK.HEAP_SLOPE_MINIMUM_BYTES_PER_CYCLE,
      slopeRatio: BENCHMARK.HEAP_SLOPE_RATIO_PER_CYCLE,
    });
    const residentSet = assessTrend(measured, LIFECYCLE_MEMORY_FIELD.RESIDENT_SET_BYTES, {
      medianMinimumBytes: BENCHMARK.RSS_MEDIAN_GROWTH_MINIMUM_BYTES,
      medianRatio: BENCHMARK.RSS_MEDIAN_GROWTH_RATIO,
      slopeMinimumBytes: BENCHMARK.RSS_SLOPE_MINIMUM_BYTES_PER_CYCLE,
      slopeRatio: BENCHMARK.RSS_SLOPE_RATIO_PER_CYCLE,
    });
    const status =
      heap.status === LIFECYCLE_MEMORY_STATUS.PASS && residentSet.status === LIFECYCLE_MEMORY_STATUS.PASS
        ? LIFECYCLE_MEMORY_STATUS.PASS
        : LIFECYCLE_MEMORY_STATUS.FAIL;
    return {
      product: PRODUCT.NAME,
      status,
      method: {
        cycles: BENCHMARK.CYCLES,
        warmupCyclesExcluded: BENCHMARK.WARMUP_CYCLES,
        comparisonWindowCycles: BENCHMARK.COMPARISON_WINDOW,
        garbageCollection: LIFECYCLE_MEMORY_METHOD.GARBAGE_COLLECTION,
        providerMemory: LIFECYCLE_MEMORY_METHOD.PROVIDER_MEMORY,
        allocatorRetention: LIFECYCLE_MEMORY_METHOD.ALLOCATOR_RETENTION,
        platform: {current: process.platform, supported: [...SUPPORTED_PLATFORM]},
      },
      assessment: {heap, residentSet},
      summaries: {
        mcpHeapUsed: summarize(measured.map((sample) => sample.heapUsedBytes)),
        mcpResidentSet: summarize(measured.map((sample) => sample.residentSetBytes)),
        mcpAllocatorAndNativeResidentProxy: summarize(measured.map((sample) => sample.allocatorAndNativeResidentProxyBytes)),
        childProviderResidentSet: summarize(cycles.map((cycle) => cycle.providerResidentSetBytes)),
      },
      samples: cycles.map((cycle) => ({
        cycle: cycle.cycle,
        providerResidentSetBytes: cycle.providerResidentSetBytes,
        providerDisposed: cycle.providerDisposed,
        mcpHeapUsedBytes: cycle.mcp.heapUsedBytes,
        mcpResidentSetBytes: cycle.mcp.residentSetBytes,
        mcpAllocatorAndNativeResidentProxyBytes: cycle.mcp.allocatorAndNativeResidentProxyBytes,
      })),
    };
  } finally {
    await client.close().catch(() => undefined);
    await rm(fixture.workspace, {recursive: true, force: true});
  }
}

assertAssessmentContract();
let output;
if (!SUPPORTED_PLATFORM.has(process.platform)) {
  output = blockedOutput(LIFECYCLE_MEMORY_REASON.PLATFORM_UNSUPPORTED);
} else {
  try {
    await readResidentSetBytes(process.pid);
  } catch (error) {
    output = blockedOutput(
      error?.code === PROCESS_ERROR.COMMAND_NOT_FOUND
        ? LIFECYCLE_MEMORY_REASON.PROCESS_COMMAND_UNAVAILABLE
        : LIFECYCLE_MEMORY_REASON.PROCESS_OBSERVATION_UNAVAILABLE,
    );
  }
  if (!output) output = await runBenchmark();
}
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exitCode =
  output.status === LIFECYCLE_MEMORY_STATUS.PASS
    ? LIFECYCLE_MEMORY_EXIT_CODE.PASS
    : output.status === LIFECYCLE_MEMORY_STATUS.BLOCKED
      ? LIFECYCLE_MEMORY_EXIT_CODE.BLOCKED
      : LIFECYCLE_MEMORY_EXIT_CODE.FAIL;
