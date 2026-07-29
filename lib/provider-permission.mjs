import {OPERATING_SYSTEM} from "../protocol.mjs";
import {filesystemPermissionPaths} from "./file-identity.mjs";

// The Node.js permission model is enforced for providers on every platform
// except Windows, where it rejects some tsserver reads whose Windows path form
// differs from the granted roots and breaks navigation. On Windows it is off by
// default and the in-process filesystem guard is the sole enforcement layer;
// setting `windowsPermissionForced` turns it back on for diagnosis on a Windows
// host. Restoring it on Windows is the priority follow-up. The in-process guard
// preload is always applied, independent of this decision.
export function providerPermissionModelActive({operatingSystem = process.platform, windowsPermissionForced = false} = {}) {
  return operatingSystem !== OPERATING_SYSTEM.WINDOWS || windowsPermissionForced === true;
}

// Build the `--permission --allow-fs-*` arguments for a provider process, or an
// empty array when the permission model is inactive for the platform. Read roots
// receive macOS case variants only when they are also a write root (the
// server-owned temporary directory), matching the language server's
// case-sensitivity probe without widening the workspace read surface.
export function providerPermissionArguments({
  operatingSystem = process.platform,
  windowsPermissionForced = false,
  readRoots = [],
  writeRoots = [],
} = {}) {
  if (!providerPermissionModelActive({operatingSystem, windowsPermissionForced})) return [];
  const writableRootSet = new Set(writeRoots);
  const readablePaths = readRoots.flatMap((root) =>
    filesystemPermissionPaths(root, {operatingSystem, includeMacOSCaseVariants: writableRootSet.has(root)}),
  );
  const writablePaths = writeRoots.flatMap((root) => filesystemPermissionPaths(root, {operatingSystem}));
  return [
    "--permission",
    ...readablePaths.map((root) => `--allow-fs-read=${root}`),
    ...writablePaths.map((root) => `--allow-fs-write=${root}`),
  ];
}
