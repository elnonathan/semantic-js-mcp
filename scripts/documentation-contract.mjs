import {DOCTOR_REASON, SEMANTIC_EVIDENCE_FOLLOW_UP_REASON} from "../protocol.mjs";

export const DOCUMENTATION_FILE = Object.freeze({
  README: "README.md",
  AGENT_SETUP: "AGENT_SETUP.md",
  GETTING_STARTED: "docs/getting-started.md",
  SEMANTIC_NAVIGATION_SKILL: "skills/semantic-navigation/SKILL.md",
  CONTRIBUTING: "CONTRIBUTING.md",
  SECURITY: "SECURITY.md",
});

export const PUBLIC_ROOT_DOCUMENT = Object.freeze([
  "AGENT_SETUP.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "README.md",
  "ROADMAP.md",
  "SECURITY.md",
]);

export const PUBLIC_DOCUMENT_DIRECTORY = Object.freeze(["docs", "skills"]);

export const DOCUMENTATION_REQUIREMENT = Object.freeze({
  README_HEADINGS: Object.freeze([
    "Installation",
    "Updating the Codex plugin",
    "Runtime",
    "Verification",
    "Current Limitations",
    "Reporting Problems",
  ]),
  README_LITERALS: Object.freeze(["codex plugin marketplace upgrade elnonathan", "codex plugin add semantic-js-mcp@elnonathan"]),
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
  AGENT_SETUP_HEADINGS: Object.freeze([
    "Scope",
    "Safety Boundaries",
    "Installation Procedure",
    "Verification",
    "Update And Rollback",
    "Removal",
    "Completion Report",
  ]),
  SEMANTIC_NAVIGATION_SKILL_HEADINGS: Object.freeze(["Preserve Combination Invariants"]),
  README_LINKS: Object.freeze(["AGENT_SETUP.md", "docs/getting-started.md", "CONTRIBUTING.md", "SECURITY.md"]),
  GETTING_STARTED_LITERALS: Object.freeze([SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.COLLECTION_PARTIAL, DOCTOR_REASON.RUNTIME_COMPONENT_MISSING]),
  AGENT_SETUP_LITERALS: Object.freeze([
    "semantic-js-mcp doctor",
    "semantic-js-mcp serve",
    "does not override system, developer, organization, repository",
    "npm uninstall --global semantic-js-mcp",
    "server name: `semanticjsmcp`",
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
  PRIVATE_COORDINATION: "private-coordination-language-found",
  LOCAL_PATH: "local-absolute-path-found",
});

export const PRIVATE_COORDINATION_PATTERN = /\b(?:private (?:ticket|handoff)|internal (?:id|priority|status)|workstream|depends on)\b/i;
export const LOCAL_ABSOLUTE_PATH_PATTERN = /\/(?:Users|home)\/[^/\s]+\//;
