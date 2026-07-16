#!/usr/bin/env node

import {LIFECYCLE_MEMORY_OBSERVER} from "./lifecycle-memory-contract.mjs";

if (typeof global.gc !== "function") {
  throw new Error("Lifecycle memory observation requires Node.js --expose-gc");
}

function reportMemory() {
  global.gc();
  const usage = process.memoryUsage();
  process.stderr.write(
    `${LIFECYCLE_MEMORY_OBSERVER.PREFIX}${JSON.stringify({
      recordedAtEpochMilliseconds: Date.now(),
      heapUsedBytes: usage.heapUsed,
      heapTotalBytes: usage.heapTotal,
      residentSetBytes: usage.rss,
      externalBytes: usage.external,
      arrayBufferBytes: usage.arrayBuffers,
      allocatorAndNativeResidentProxyBytes: Math.max(0, usage.rss - usage.heapTotal),
    })}\n`,
  );
}

const observationTimer = setInterval(reportMemory, LIFECYCLE_MEMORY_OBSERVER.INTERVAL_MILLISECONDS);
observationTimer.unref();
reportMemory();

await import("../server.mjs");
