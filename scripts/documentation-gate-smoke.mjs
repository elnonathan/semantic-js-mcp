#!/usr/bin/env node

import {strictEqual} from "node:assert";
import {DOCUMENTATION_FILE, DOCUMENTATION_REASON, DOCUMENTATION_REQUIREMENT} from "./documentation-contract.mjs";
import {evaluateDocumentation} from "./documentation-gate.mjs";

const headingText = (headings) => headings.map((heading) => `## ${heading}`).join("\n");
const valid = {
  [DOCUMENTATION_FILE.README]: `${headingText(DOCUMENTATION_REQUIREMENT.README_HEADINGS)}\n${DOCUMENTATION_REQUIREMENT.README_LINKS.map((link) => `[doc](${link})`).join("\n")}\n${DOCUMENTATION_REQUIREMENT.README_LITERALS.join("\n")}`,
  [DOCUMENTATION_FILE.AGENT_SETUP]: `${headingText(DOCUMENTATION_REQUIREMENT.AGENT_SETUP_HEADINGS)}\n${DOCUMENTATION_REQUIREMENT.AGENT_SETUP_LITERALS.join("\n")}`,
  [DOCUMENTATION_FILE.GETTING_STARTED]: `${headingText(DOCUMENTATION_REQUIREMENT.GETTING_STARTED_HEADINGS)}\n${DOCUMENTATION_REQUIREMENT.GETTING_STARTED_LITERALS.join("\n")}`,
  [DOCUMENTATION_FILE.SEMANTIC_NAVIGATION_SKILL]: `${headingText(DOCUMENTATION_REQUIREMENT.SEMANTIC_NAVIGATION_SKILL_HEADINGS)}\n${DOCUMENTATION_REQUIREMENT.SEMANTIC_NAVIGATION_SKILL_LITERALS.join("\n")}`,
  [DOCUMENTATION_FILE.CONTRIBUTING]: "# Contributing",
  [DOCUMENTATION_FILE.SECURITY]: "# Security",
};

strictEqual(evaluateDocumentation(valid).length, 0, "Valid public documentation failed the gate");

const missingHeading = {...valid, [DOCUMENTATION_FILE.README]: valid[DOCUMENTATION_FILE.README].replace("## Verification", "")};
strictEqual(
  evaluateDocumentation(missingHeading).some((finding) => finding.reason === DOCUMENTATION_REASON.HEADING_MISSING),
  true,
  "Missing README heading was accepted",
);

const coordinationCode = ["WORK", "123"].join("-");
const coordinationPhrase = ["private", "handoff"].join(" ");
const internalLanguage = {
  ...valid,
  [DOCUMENTATION_FILE.CONTRIBUTING]: `Complete ${coordinationCode} from the ${coordinationPhrase}`,
};
strictEqual(
  evaluateDocumentation(internalLanguage).some((finding) => finding.reason === DOCUMENTATION_REASON.PRIVATE_COORDINATION),
  true,
  "Private coordination language was accepted",
);

const missingLiteral = {
  ...valid,
  [DOCUMENTATION_FILE.GETTING_STARTED]: valid[DOCUMENTATION_FILE.GETTING_STARTED].replace(
    DOCUMENTATION_REQUIREMENT.GETTING_STARTED_LITERALS[0],
    "",
  ),
};
strictEqual(
  evaluateDocumentation(missingLiteral).some((finding) => finding.reason === DOCUMENTATION_REASON.LITERAL_MISSING),
  true,
  "Missing canonical example literal was accepted",
);

const missingMarketplaceUpgrade = {
  ...valid,
  [DOCUMENTATION_FILE.README]: valid[DOCUMENTATION_FILE.README].replace(DOCUMENTATION_REQUIREMENT.README_LITERALS[0], ""),
};
strictEqual(
  evaluateDocumentation(missingMarketplaceUpgrade).some(
    (finding) =>
      finding.reason === DOCUMENTATION_REASON.LITERAL_MISSING && finding.literal === DOCUMENTATION_REQUIREMENT.README_LITERALS[0],
  ),
  true,
  "Missing marketplace upgrade guidance was accepted",
);

const missingAgentSetupLink = {
  ...valid,
  [DOCUMENTATION_FILE.README]: valid[DOCUMENTATION_FILE.README].replace(`[doc](${DOCUMENTATION_REQUIREMENT.README_LINKS[0]})`, ""),
};
strictEqual(
  evaluateDocumentation(missingAgentSetupLink).some(
    (finding) => finding.reason === DOCUMENTATION_REASON.LINK_MISSING && finding.link === DOCUMENTATION_REQUIREMENT.README_LINKS[0],
  ),
  true,
  "Missing agent setup README link was accepted",
);

const missingAgentSetup = {...valid};
delete missingAgentSetup[DOCUMENTATION_FILE.AGENT_SETUP];
strictEqual(
  evaluateDocumentation(missingAgentSetup).some(
    (finding) => finding.reason === DOCUMENTATION_REASON.FILE_MISSING && finding.file === DOCUMENTATION_FILE.AGENT_SETUP,
  ),
  true,
  "Missing agent setup guide was accepted",
);

const missingAgentSafetyBoundary = {
  ...valid,
  [DOCUMENTATION_FILE.AGENT_SETUP]: valid[DOCUMENTATION_FILE.AGENT_SETUP].replace(DOCUMENTATION_REQUIREMENT.AGENT_SETUP_LITERALS[2], ""),
};
strictEqual(
  evaluateDocumentation(missingAgentSafetyBoundary).some(
    (finding) =>
      finding.reason === DOCUMENTATION_REASON.LITERAL_MISSING && finding.literal === DOCUMENTATION_REQUIREMENT.AGENT_SETUP_LITERALS[2],
  ),
  true,
  "Missing agent setup safety boundary was accepted",
);

const missingGenericServerName = {
  ...valid,
  [DOCUMENTATION_FILE.AGENT_SETUP]: valid[DOCUMENTATION_FILE.AGENT_SETUP].replace(DOCUMENTATION_REQUIREMENT.AGENT_SETUP_LITERALS[4], ""),
};
strictEqual(
  evaluateDocumentation(missingGenericServerName).some(
    (finding) =>
      finding.reason === DOCUMENTATION_REASON.LITERAL_MISSING && finding.literal === DOCUMENTATION_REQUIREMENT.AGENT_SETUP_LITERALS[4],
  ),
  true,
  "Missing generic MCP server name was accepted",
);

const missingCombinationInvariant = {
  ...valid,
  [DOCUMENTATION_FILE.SEMANTIC_NAVIGATION_SKILL]: valid[DOCUMENTATION_FILE.SEMANTIC_NAVIGATION_SKILL].replace(
    DOCUMENTATION_REQUIREMENT.SEMANTIC_NAVIGATION_SKILL_LITERALS[1],
    "",
  ),
};
strictEqual(
  evaluateDocumentation(missingCombinationInvariant).some(
    (finding) =>
      finding.reason === DOCUMENTATION_REASON.LITERAL_MISSING &&
      finding.literal === DOCUMENTATION_REQUIREMENT.SEMANTIC_NAVIGATION_SKILL_LITERALS[1],
  ),
  true,
  "Missing combination-invariant guidance was accepted",
);

process.stdout.write(
  `${JSON.stringify(
    {
      validDocumentation: "pass",
      missingHeading: "rejected",
      missingLiteral: "rejected",
      missingMarketplaceUpgrade: "rejected",
      missingAgentSetupLink: "rejected",
      missingAgentSetup: "rejected",
      missingAgentSafetyBoundary: "rejected",
      missingGenericServerName: "rejected",
      missingCombinationInvariant: "rejected",
      privateCoordination: "rejected",
    },
    null,
    2,
  )}\n`,
);
