#!/usr/bin/env node

import {strictEqual} from "node:assert";
import {DOCUMENTATION_FILE, DOCUMENTATION_REASON, DOCUMENTATION_REQUIREMENT} from "./documentation-contract.mjs";
import {evaluateDocumentation} from "./documentation-gate.mjs";

const headingText = (headings) => headings.map((heading) => `## ${heading}`).join("\n");
const valid = {
  [DOCUMENTATION_FILE.README]: `${headingText(DOCUMENTATION_REQUIREMENT.README_HEADINGS)}\n${DOCUMENTATION_REQUIREMENT.README_LINKS.map((link) => `[doc](${link})`).join("\n")}`,
  [DOCUMENTATION_FILE.GETTING_STARTED]: `${headingText(DOCUMENTATION_REQUIREMENT.GETTING_STARTED_HEADINGS)}\n${DOCUMENTATION_REQUIREMENT.GETTING_STARTED_LITERALS.join("\n")}`,
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

process.stdout.write(
  `${JSON.stringify(
    {validDocumentation: "pass", missingHeading: "rejected", missingLiteral: "rejected", privateCoordination: "rejected"},
    null,
    2,
  )}\n`,
);
