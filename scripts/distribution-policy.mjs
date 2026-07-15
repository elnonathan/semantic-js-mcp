export const REQUIRED_PACKAGE_FILE = Object.freeze({
  PACKAGE_MANIFEST: "package.json",
  PRETTIER_CONFIGURATION: ".prettierrc.json",
  README: "README.md",
  LICENSE: "LICENSE",
  CLI: "cli.mjs",
  SERVER: "server.mjs",
  PROTOCOL: "protocol.mjs",
  RUNTIME: "lib/runtime.mjs",
  DOCTOR: "lib/doctor.mjs",
  MCP_CONFIGURATION: ".mcp.json",
  CODEX_PLUGIN_MANIFEST: ".codex-plugin/plugin.json",
  SEMANTIC_NAVIGATION_SKILL: "skills/semantic-navigation/SKILL.md",
});

export const NPM_AUTOMATIC_PACKAGE_FILE = Object.freeze([
  REQUIRED_PACKAGE_FILE.PACKAGE_MANIFEST,
  REQUIRED_PACKAGE_FILE.README,
  REQUIRED_PACKAGE_FILE.LICENSE,
]);

const WINDOWS_PLATFORM = "win32";
const WINDOWS_COMMAND_SUFFIX = ".cmd";
const DEPENDENCY_DIRECTORY_PREFIX = "node_modules/";

export function npmExecutableName(name, platform = process.platform) {
  if (platform === WINDOWS_PLATFORM) return `${name}${WINDOWS_COMMAND_SUFFIX}`;
  return name;
}

export function allProductionDependenciesAreBundled(manifest) {
  const dependencies = Object.keys(manifest.dependencies || {}).sort();
  const bundledDependencies = [...(manifest.bundleDependencies || [])].sort();
  return (
    dependencies.length === bundledDependencies.length &&
    dependencies.every((dependency, index) => dependency === bundledDependencies[index])
  );
}

export function packagePathIsAllowed(file, declaredFiles, bundledDependenciesAllowed = false) {
  if (NPM_AUTOMATIC_PACKAGE_FILE.includes(file)) return true;
  if (bundledDependenciesAllowed && file.startsWith(DEPENDENCY_DIRECTORY_PREFIX)) return true;
  return declaredFiles.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}
