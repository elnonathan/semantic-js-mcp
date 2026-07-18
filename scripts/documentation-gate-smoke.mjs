#!/usr/bin/env node

import {strictEqual} from "node:assert";
import {DOCUMENTATION_FILE, DOCUMENTATION_REASON, DOCUMENTATION_REQUIREMENT} from "./documentation-contract.mjs";
import {evaluateDocumentation} from "./documentation-gate.mjs";

const headingText = (headings) => headings.map((heading) => `## ${heading}`).join("\n");
const valid = {
  [DOCUMENTATION_FILE.README]: `${headingText(DOCUMENTATION_REQUIREMENT.README_HEADINGS)}\n${DOCUMENTATION_REQUIREMENT.README_LINKS.map((link) => `[doc](${link})`).join("\n")}\n${DOCUMENTATION_REQUIREMENT.README_SETUP_ENTRY_LITERALS.join("\n")}`,
  [DOCUMENTATION_FILE.SETUP]: `${headingText(DOCUMENTATION_REQUIREMENT.SETUP_HEADINGS)}\n${DOCUMENTATION_REQUIREMENT.SETUP_LITERALS.join("\n")}`,
  [DOCUMENTATION_FILE.DISTRIBUTION]: `${headingText(DOCUMENTATION_REQUIREMENT.DISTRIBUTION_HEADINGS)}\n${DOCUMENTATION_REQUIREMENT.DISTRIBUTION_LITERALS.join("\n")}`,
  [DOCUMENTATION_FILE.GETTING_STARTED]: `${headingText(DOCUMENTATION_REQUIREMENT.GETTING_STARTED_HEADINGS)}\n${DOCUMENTATION_REQUIREMENT.GETTING_STARTED_LITERALS.join("\n")}`,
  [DOCUMENTATION_FILE.SEMANTIC_NAVIGATION_SKILL]: `${headingText(DOCUMENTATION_REQUIREMENT.SEMANTIC_NAVIGATION_SKILL_HEADINGS)}\n${DOCUMENTATION_REQUIREMENT.SEMANTIC_NAVIGATION_SKILL_LITERALS.join("\n")}`,
  [DOCUMENTATION_FILE.CONTRIBUTING]: "# Contributing",
  [DOCUMENTATION_FILE.SECURITY]: "# Security",
};

strictEqual(evaluateDocumentation(valid).length, 0, "Valid public documentation failed the gate");

const lateSetupGuards = {
  ...valid,
  [DOCUMENTATION_FILE.SETUP]: valid[DOCUMENTATION_FILE.SETUP].replace("## Guards\n", "").concat("\n## Guards\n"),
};
strictEqual(
  evaluateDocumentation(lateSetupGuards).some((finding) => finding.reason === DOCUMENTATION_REASON.SETUP_GUARDS_NOT_FIRST),
  true,
  "Late setup guards were accepted",
);

const fencedSetupGuards = {
  ...valid,
  [DOCUMENTATION_FILE.SETUP]: valid[DOCUMENTATION_FILE.SETUP].replace("## Guards\n", "```md\n## Guards\n```\n"),
};
strictEqual(
  evaluateDocumentation(fencedSetupGuards).some(
    (finding) =>
      finding.reason === DOCUMENTATION_REASON.HEADING_MISSING &&
      finding.file === DOCUMENTATION_FILE.SETUP &&
      finding.heading === DOCUMENTATION_REQUIREMENT.SETUP_FIRST_SECTION,
  ),
  true,
  "Setup heading inside a fenced block was accepted",
);

const invalidSetupOrder = {
  ...valid,
  [DOCUMENTATION_FILE.SETUP]: valid[DOCUMENTATION_FILE.SETUP]
    .replace("## Prerequisites\n", "## Setup Order Placeholder\n")
    .replace("## Choose A Version\n", "## Prerequisites\n")
    .replace("## Setup Order Placeholder\n", "## Choose A Version\n"),
};
strictEqual(
  evaluateDocumentation(invalidSetupOrder).some((finding) => finding.reason === DOCUMENTATION_REASON.SETUP_SECTION_ORDER_INVALID),
  true,
  "Invalid setup section order was accepted",
);

const earlySetupBackground = {
  ...valid,
  [DOCUMENTATION_FILE.SETUP]: valid[DOCUMENTATION_FILE.SETUP]
    .replace("## Background\n", "")
    .replace("## Troubleshooting\n", "## Background\n## Troubleshooting\n"),
};
strictEqual(
  evaluateDocumentation(earlySetupBackground).some((finding) => finding.reason === DOCUMENTATION_REASON.SETUP_BACKGROUND_NOT_LAST),
  true,
  "Setup background outside the final section was accepted",
);

const lateSetupEntryPoint = {
  ...valid,
  [DOCUMENTATION_FILE.README]: valid[DOCUMENTATION_FILE.README].replace("## Setup\n", "").concat("\n## Setup\n"),
};
strictEqual(
  evaluateDocumentation(lateSetupEntryPoint).some((finding) => finding.reason === DOCUMENTATION_REASON.SETUP_ENTRY_POINT_NOT_FIRST),
  true,
  "Late setup entry point was accepted",
);

const duplicateSetupSection = {
  ...valid,
  [DOCUMENTATION_FILE.README]: `${valid[DOCUMENTATION_FILE.README]}\n## ${DOCUMENTATION_REQUIREMENT.README_FORBIDDEN_SETUP_HEADINGS[1]}`,
};
strictEqual(
  evaluateDocumentation(duplicateSetupSection).some((finding) => finding.reason === DOCUMENTATION_REASON.DUPLICATE_SETUP_SECTION),
  true,
  "Duplicate README setup section was accepted",
);

for (const literal of DOCUMENTATION_REQUIREMENT.README_FORBIDDEN_SETUP_LITERALS) {
  const duplicateSetupCommand = {
    ...valid,
    [DOCUMENTATION_FILE.README]: `${valid[DOCUMENTATION_FILE.README]}\n${literal}`,
  };
  strictEqual(
    evaluateDocumentation(duplicateSetupCommand).some(
      (finding) => finding.reason === DOCUMENTATION_REASON.DUPLICATE_SETUP_COMMAND && finding.literal === literal,
    ),
    true,
    `Duplicate README setup command was accepted: ${literal}`,
  );
}

const duplicateDistributionSetupCommand = {
  ...valid,
  [DOCUMENTATION_FILE.DISTRIBUTION]: `${valid[DOCUMENTATION_FILE.DISTRIBUTION]}\n${DOCUMENTATION_REQUIREMENT.DISTRIBUTION_FORBIDDEN_SETUP_LITERALS[0]}`,
};
strictEqual(
  evaluateDocumentation(duplicateDistributionSetupCommand).some(
    (finding) =>
      finding.file === DOCUMENTATION_FILE.DISTRIBUTION &&
      finding.reason === DOCUMENTATION_REASON.DUPLICATE_SETUP_COMMAND &&
      finding.literal === DOCUMENTATION_REQUIREMENT.DISTRIBUTION_FORBIDDEN_SETUP_LITERALS[0],
  ),
  true,
  "Duplicate distribution setup command was accepted",
);

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

const missingSetupLink = {
  ...valid,
  [DOCUMENTATION_FILE.README]: valid[DOCUMENTATION_FILE.README].replaceAll(
    `](${DOCUMENTATION_REQUIREMENT.README_LINKS[0]})`,
    "](missing-setup.md)",
  ),
};
strictEqual(
  evaluateDocumentation(missingSetupLink).some(
    (finding) => finding.reason === DOCUMENTATION_REASON.LINK_MISSING && finding.link === DOCUMENTATION_REQUIREMENT.README_LINKS[0],
  ),
  true,
  "Missing setup README link was accepted",
);

const missingSetupEntryInstruction = {
  ...valid,
  [DOCUMENTATION_FILE.README]: valid[DOCUMENTATION_FILE.README].replace(DOCUMENTATION_REQUIREMENT.README_SETUP_ENTRY_LITERALS[0], ""),
};
strictEqual(
  evaluateDocumentation(missingSetupEntryInstruction).some(
    (finding) =>
      finding.reason === DOCUMENTATION_REASON.LITERAL_MISSING &&
      finding.literal === DOCUMENTATION_REQUIREMENT.README_SETUP_ENTRY_LITERALS[0],
  ),
  true,
  "Missing README setup instruction was accepted",
);

const missingSetup = {...valid};
delete missingSetup[DOCUMENTATION_FILE.SETUP];
strictEqual(
  evaluateDocumentation(missingSetup).some(
    (finding) => finding.reason === DOCUMENTATION_REASON.FILE_MISSING && finding.file === DOCUMENTATION_FILE.SETUP,
  ),
  true,
  "Missing setup guide was accepted",
);

for (const [literal, message] of [
  ["does not override system, developer, organization, repository", "Missing setup safety boundary was accepted"],
  ["server name: `semanticjsmcp`", "Missing generic MCP server name was accepted"],
  ["codex plugin marketplace upgrade elnonathan", "Missing Codex marketplace refresh was accepted"],
  ["Do not run `npm install semantic-js-mcp` without `--global`.", "Missing local npm installation prohibition was accepted"],
  [
    "Treat `EPERM`, `EACCES`, `TAR_ENTRY_ERROR`, or a missing-file error as a partial installation.",
    "Missing partial-installation warning was accepted",
  ],
  ["Do not start `semantic-js-mcp serve` manually.", "Missing manual stdio startup prohibition was accepted"],
  ["Choose exactly one installation route.", "Missing single-route boundary was accepted"],
  ["No source-code call is required", "Missing installation authority boundary was accepted"],
]) {
  const missingInstruction = {
    ...valid,
    [DOCUMENTATION_FILE.SETUP]: valid[DOCUMENTATION_FILE.SETUP].replace(literal, ""),
  };
  strictEqual(
    evaluateDocumentation(missingInstruction).some(
      (finding) => finding.reason === DOCUMENTATION_REASON.LITERAL_MISSING && finding.literal === literal,
    ),
    true,
    message,
  );
}

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

const missingTrustedPublishingPolicy = {
  ...valid,
  [DOCUMENTATION_FILE.DISTRIBUTION]: valid[DOCUMENTATION_FILE.DISTRIBUTION].replace(DOCUMENTATION_REQUIREMENT.DISTRIBUTION_LITERALS[2], ""),
};
strictEqual(
  evaluateDocumentation(missingTrustedPublishingPolicy).some(
    (finding) =>
      finding.reason === DOCUMENTATION_REASON.LITERAL_MISSING && finding.literal === DOCUMENTATION_REQUIREMENT.DISTRIBUTION_LITERALS[2],
  ),
  true,
  "Missing trusted-publishing policy was accepted",
);

const missingPostpublicationOrder = {
  ...valid,
  [DOCUMENTATION_FILE.DISTRIBUTION]: valid[DOCUMENTATION_FILE.DISTRIBUTION].replace(DOCUMENTATION_REQUIREMENT.DISTRIBUTION_LITERALS[5], ""),
};
strictEqual(
  evaluateDocumentation(missingPostpublicationOrder).some(
    (finding) =>
      finding.reason === DOCUMENTATION_REASON.LITERAL_MISSING && finding.literal === DOCUMENTATION_REQUIREMENT.DISTRIBUTION_LITERALS[5],
  ),
  true,
  "Missing postpublication order was accepted",
);

process.stdout.write(
  `${JSON.stringify(
    {
      validDocumentation: "pass",
      lateSetupGuards: "rejected",
      fencedSetupGuards: "rejected",
      invalidSetupOrder: "rejected",
      earlySetupBackground: "rejected",
      lateSetupEntryPoint: "rejected",
      duplicateSetupSection: "rejected",
      duplicateSetupCommand: "rejected",
      duplicateDistributionSetupCommand: "rejected",
      missingHeading: "rejected",
      missingLiteral: "rejected",
      missingSetupLink: "rejected",
      missingSetupEntryInstruction: "rejected",
      missingSetup: "rejected",
      missingSetupSafetyBoundary: "rejected",
      missingGenericServerName: "rejected",
      missingCodexMarketplaceRefresh: "rejected",
      missingCombinationInvariant: "rejected",
      missingTrustedPublishingPolicy: "rejected",
      missingPostpublicationOrder: "rejected",
      privateCoordination: "rejected",
    },
    null,
    2,
  )}\n`,
);
