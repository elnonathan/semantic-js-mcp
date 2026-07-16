import {DOCTOR_REASON, SEMANTIC_EVIDENCE_FOLLOW_UP_REASON} from "../protocol.mjs";

export const DOCUMENTATION_FILE = Object.freeze({
  README: "README.md",
  GETTING_STARTED: "docs/getting-started.md",
  CONTRIBUTING: "CONTRIBUTING.md",
  SECURITY: "SECURITY.md",
});

export const PUBLIC_ROOT_DOCUMENT = Object.freeze(["CHANGELOG.md", "CONTRIBUTING.md", "README.md", "ROADMAP.md", "SECURITY.md"]);

export const PUBLIC_DOCUMENT_DIRECTORY = Object.freeze(["docs", "skills"]);

export const DOCUMENTATION_REQUIREMENT = Object.freeze({
  README_HEADINGS: Object.freeze(["Installation", "Runtime", "Verification", "Current Limitations", "Reporting Problems"]),
  GETTING_STARTED_HEADINGS: Object.freeze([
    "Trace A Symbol",
    "Review A Security-Sensitive Change",
    "Check Current Diagnostics",
    "Complete Evidence",
    "Partial Evidence",
    "Untrusted Diagnostics",
    "Startup Failure",
  ]),
  README_LINKS: Object.freeze(["docs/getting-started.md", "CONTRIBUTING.md", "SECURITY.md"]),
  GETTING_STARTED_LITERALS: Object.freeze([SEMANTIC_EVIDENCE_FOLLOW_UP_REASON.COLLECTION_PARTIAL, DOCTOR_REASON.RUNTIME_COMPONENT_MISSING]),
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
