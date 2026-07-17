import path from "node:path";
import {OPERATING_SYSTEM} from "../protocol.mjs";

export function fileIdentity(file, operatingSystem = process.platform) {
  const pathImplementation = operatingSystem === OPERATING_SYSTEM.WINDOWS ? path.win32 : path;
  const resolved = pathImplementation.resolve(file);
  return operatingSystem === OPERATING_SYSTEM.WINDOWS ? resolved.toLowerCase() : resolved;
}

export function locationKeyAt(file, line, column, operatingSystem = process.platform) {
  return `${fileIdentity(file, operatingSystem)}:${line}:${column}`;
}

export function locationKeyForOperatingSystem(operatingSystem) {
  return (location) => locationKeyAt(location.file, location.range.start.line, location.range.start.column, operatingSystem);
}

export const locationKey = locationKeyForOperatingSystem(process.platform);
