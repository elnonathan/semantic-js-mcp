import path from "node:path";
import {OPERATING_SYSTEM} from "../protocol.mjs";

export function fileIdentity(file, operatingSystem = process.platform) {
  const pathImplementation = operatingSystem === OPERATING_SYSTEM.WINDOWS ? path.win32 : path;
  const resolved = pathImplementation.resolve(file);
  return operatingSystem === OPERATING_SYSTEM.WINDOWS ? resolved.toLowerCase() : resolved;
}

export function locationKey(location, operatingSystem = process.platform) {
  return `${fileIdentity(location.file, operatingSystem)}:${location.range.start.line}:${location.range.start.column}`;
}
