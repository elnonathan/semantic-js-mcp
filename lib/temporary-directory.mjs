import {rm} from "node:fs/promises";

const CLEANUP = Object.freeze({
  MAXIMUM_RETRIES: 10,
  RETRY_DELAY_MILLISECONDS: 100,
});

export async function removeTemporaryDirectory(directory) {
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: CLEANUP.MAXIMUM_RETRIES,
    retryDelay: CLEANUP.RETRY_DELAY_MILLISECONDS,
  });
}
