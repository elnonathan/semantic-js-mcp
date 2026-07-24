export const REQUIRED_PACKAGE_FILE = Object.freeze({
  PACKAGE_MANIFEST: "package.json",
  PRETTIER_CONFIGURATION: ".prettierrc.json",
  README: "README.md",
  SETUP: "SETUP.md",
  LICENSE: "LICENSE",
  CLI: "cli.mjs",
  SERVER: "server.mjs",
  PROTOCOL: "protocol.mjs",
  RUNTIME: "lib/runtime.mjs",
  DOCTOR: "lib/doctor.mjs",
  CODEX_SESSION_ROOT_AUTHORIZATION: "lib/codex-session-root-authorization.mjs",
  PROVIDER_FILESYSTEM_GUARD: "lib/provider-filesystem-guard.mjs",
  MCP_CONFIGURATION: ".mcp.json",
  CODEX_PLUGIN_MANIFEST: ".codex-plugin/plugin.json",
  CLAUDE_PLUGIN_MANIFEST: ".claude-plugin/plugin.json",
  CLAUDE_MARKETPLACE_MANIFEST: ".claude-plugin/marketplace.json",
  SEMANTIC_NAVIGATION_SKILL: "skills/semantic-navigation/SKILL.md",
});

export const NPM_AUTOMATIC_PACKAGE_FILE = Object.freeze([
  REQUIRED_PACKAGE_FILE.PACKAGE_MANIFEST,
  REQUIRED_PACKAGE_FILE.README,
  REQUIRED_PACKAGE_FILE.LICENSE,
]);

export const CODEX_DISTRIBUTION = Object.freeze({
  EXECUTABLE: "codex",
  HOME_ENVIRONMENT_VARIABLE: "CODEX_HOME",
  MARKETPLACE_NAME: "elnonathan",
  MARKETPLACE_SOURCE: "elnonathan/semantic-js-mcp",
  PLUGIN_SELECTOR: "semantic-js-mcp@elnonathan",
  VERSION_REF_PREFIX: "v",
  HOME_DIRECTORY: "codex-home",
  PLUGIN_COMMAND: "plugin",
  MARKETPLACE_COMMAND: "marketplace",
  ADD_COMMAND: "add",
  UPGRADE_COMMAND: "upgrade",
  LIST_COMMAND: "list",
  REF_ARGUMENT: "--ref",
  JSON_ARGUMENT: "--json",
  NETWORK_UNAVAILABLE_TEXT: Object.freeze([
    "Could not resolve host",
    "failed to lookup address information",
    "network is unreachable",
    "network timeout",
    "timed out",
    "unable to access",
  ]),
});

export const NPM_DISTRIBUTION = Object.freeze({
  CACHE_ENVIRONMENT_VARIABLE: "npm_config_cache",
});

const DEPENDENCY_DIRECTORY_PREFIX = "node_modules/";

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
