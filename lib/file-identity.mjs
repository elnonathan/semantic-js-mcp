import {realpath} from "node:fs/promises";
import path from "node:path";
import {OPERATING_SYSTEM} from "../protocol.mjs";

export function fileIdentity(file, operatingSystem = process.platform) {
  const pathImplementation = operatingSystem === OPERATING_SYSTEM.WINDOWS ? path.win32 : path;
  const resolved = pathImplementation.resolve(file);
  return operatingSystem === OPERATING_SYSTEM.WINDOWS ? resolved.toLowerCase() : resolved;
}

export function fileIdentityContains(root, candidate, operatingSystem = process.platform) {
  const separator = operatingSystem === OPERATING_SYSTEM.WINDOWS ? path.win32.sep : path.sep;
  const normalizedRoot = fileIdentity(root, operatingSystem);
  const normalizedCandidate = fileIdentity(candidate, operatingSystem);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${separator}`);
}

export async function canonicalPathInsideBoundary(candidate, boundaryFor) {
  try {
    const canonicalPath = await realpath(path.resolve(candidate));
    return boundaryFor(canonicalPath) ? canonicalPath : undefined;
  } catch {
    return undefined;
  }
}

export function filesystemPermissionPaths(root, {operatingSystem = process.platform, includeMacOSCaseVariants = false} = {}) {
  const requiresCaseVariants =
    operatingSystem === OPERATING_SYSTEM.WINDOWS || (operatingSystem === OPERATING_SYSTEM.MACOS && includeMacOSCaseVariants);
  if (!requiresCaseVariants) return [root];
  return [...new Set([root, root.toLowerCase(), root.toUpperCase()])];
}

export function locationKeyAt(file, line, column, operatingSystem = process.platform) {
  return `${fileIdentity(file, operatingSystem)}:${line}:${column}`;
}

export function locationKeyForOperatingSystem(operatingSystem) {
  return (location) => locationKeyAt(location.file, location.range.start.line, location.range.start.column, operatingSystem);
}

export const locationKey = locationKeyForOperatingSystem(process.platform);
