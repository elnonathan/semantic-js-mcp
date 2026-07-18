import {DOCTOR_REASON, SEMANTIC_EVIDENCE_FOLLOW_UP_REASON} from "../protocol.mjs";

export const DOCUMENTATION_FILE = Object.freeze({
  README: "README.md",
  SETUP: "SETUP.md",
  DISTRIBUTION: "docs/distribution.md",
  GETTING_STARTED: "docs/getting-started.md",
  SEMANTIC_NAVIGATION_SKILL: "skills/semantic-navigation/SKILL.md",
  CONTRIBUTING: "CONTRIBUTING.md",
  SECURITY: "SECURITY.md",
});

export const PUBLIC_ROOT_DOCUMENT = Object.freeze([
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "README.md",
  "ROADMAP.md",
  "SECURITY.md",
  "SETUP.md",
]);

export const PUBLIC_DOCUMENT_DIRECTORY = Object.freeze(["docs", "skills"]);

export const DOCUMENTATION_REQUIREMENT = Object.freeze({
  README_HEADINGS: Object.freeze(["Setup", "Runtime", "Development Setup", "Verification", "Current Limitations", "Reporting Problems"]),
  README_FIRST_SECTION: "Setup",
  README_SETUP_ENTRY_LITERALS: Object.freeze([
    "Before running an installation command, follow [SETUP.md](SETUP.md).",
    "single source of truth",
    "Package installation alone does not configure an MCP host.",
  ]),
  README_FORBIDDEN_SETUP_HEADINGS: Object.freeze(["Agent Installation", "Installation", "Updating the Codex plugin"]),
  README_FORBIDDEN_SETUP_LITERALS: Object.freeze([
    "codex plugin marketplace add elnonathan/semantic-js-mcp",
    "codex plugin add semantic-js-mcp@elnonathan",
    "npm install --global semantic-js-mcp",
    "npm ci",
  ]),
  DISTRIBUTION_FORBIDDEN_SETUP_LITERALS: Object.freeze([
    "codex plugin marketplace add elnonathan/semantic-js-mcp",
    "codex plugin marketplace upgrade elnonathan",
    "codex plugin add semantic-js-mcp@elnonathan",
  ]),
  GETTING_STARTED_HEADINGS: Object.freeze([
    "Trace A Symbol",
    "Review A Security-Sensitive Change",
    "Review Combination Logic",
    "Check Current Diagnostics",
    "Complete Evidence",
    "Partial Evidence",
    "Untrusted Diagnostics",
    "Startup Failure",
  ]),
  SETUP_HEADINGS: Object.freeze([
    "Guards",
    "Prerequisites",
    "Choose A Version",
    "Install With Codex",
    "Install With Another MCP Host",
    "Verify The Installation",
    "Troubleshooting",
    "Update",
    "Rollback",
    "Removal",
    "Source Checkout",
    "Background",
  ]),
  SETUP_FIRST_SECTION: "Guards",
  SETUP_LAST_SECTION: "Background",
  DISTRIBUTION_HEADINGS: Object.freeze(["Release Verification", "npm Trusted Publishing"]),
  SEMANTIC_NAVIGATION_SKILL_HEADINGS: Object.freeze(["Preserve Combination Invariants"]),
  README_LINKS: Object.freeze(["SETUP.md", "docs/getting-started.md", "CONTRIBUTING.md", "SECURITY.md"]),
  GETTING_STARTED_LITERALS: Object.freeze([SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.COLLECTION_PARTIAL, DOCTOR_REASON.RUNTIME_COMPONENT_MISSING]),
  SETUP_LITERALS: Object.freeze([
    "semantic-js-mcp doctor",
    "semantic-js-mcp serve",
    "does not override system, developer, organization, repository",
    "npm uninstall --global semantic-js-mcp",
    "server name: `semanticjsmcp`",
    "codex plugin marketplace upgrade elnonathan",
    "Do not run `npm install semantic-js-mcp` without `--global`.",
    "Treat `EPERM`, `EACCES`, `TAR_ENTRY_ERROR`, or a missing-file error as a partial installation.",
    "Do not start `semantic-js-mcp serve` manually.",
    "Choose exactly one installation route.",
    "pending-restart",
    "No source-code call is required",
    "Do not run the global executable checks",
  ]),
  DISTRIBUTION_LITERALS: Object.freeze([
    "npm run release:verify",
    "npm run verify:published -- <version>",
    "The `publish.yml` workflow publishes tags matching `v*`",
    "protected `npm-publish` environment",
    "No long-lived npm token is used.",
    "Verify the published package before creating the matching GitHub release.",
  ]),
  SEMANTIC_NAVIGATION_SKILL_LITERALS: Object.freeze([
    "Identify every producer of the value",
    "boundary case that could disprove",
    "conceptual relationships that an LSP cannot establish",
  ]),
});

export const DOCUMENTATION_REASON = Object.freeze({
  FILE_MISSING: "required-document-missing",
  HEADING_MISSING: "required-heading-missing",
  LINK_MISSING: "required-link-missing",
  LITERAL_MISSING: "required-literal-missing",
  SETUP_ENTRY_POINT_NOT_FIRST: "setup-entry-point-not-first",
  DUPLICATE_SETUP_SECTION: "duplicate-setup-section",
  DUPLICATE_SETUP_COMMAND: "duplicate-setup-command",
  SETUP_GUARDS_NOT_FIRST: "setup-guards-not-first",
  SETUP_SECTION_ORDER_INVALID: "setup-section-order-invalid",
  SETUP_BACKGROUND_NOT_LAST: "setup-background-not-last",
  PRIVATE_COORDINATION: "private-coordination-language-found",
  LOCAL_PATH: "local-absolute-path-found",
});

export const PRIVATE_COORDINATION_PATTERN = /\b(?:private (?:ticket|handoff)|internal (?:id|priority|status)|workstream|depends on)\b/i;
export const LOCAL_ABSOLUTE_PATH_PATTERN = /\/(?:Users|home)\/[^/\s]+\//;
