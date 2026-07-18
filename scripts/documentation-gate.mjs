#!/usr/bin/env node

import {readdir, readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  DOCUMENTATION_FILE,
  DOCUMENTATION_REASON,
  DOCUMENTATION_REQUIREMENT,
  LOCAL_ABSOLUTE_PATH_PATTERN,
  PRIVATE_COORDINATION_PATTERN,
  PUBLIC_DOCUMENT_DIRECTORY,
  PUBLIC_ROOT_DOCUMENT,
} from "./documentation-contract.mjs";

function markdownStructuralLines(source) {
  const lines = [];
  let fence;
  for (const line of source.split("\n")) {
    const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (match && fence === undefined) {
      fence = {marker: match[1][0], length: match[1].length};
      continue;
    }
    if (match && match[1][0] === fence?.marker && match[1].length >= fence.length && match[2].trim() === "") {
      fence = undefined;
      continue;
    }
    if (fence === undefined) lines.push(line);
  }
  return lines;
}

function markdownHeadings(source) {
  return new Set(
    markdownStructuralLines(source)
      .map((line) => /^#{1,6}\s+(.+?)\s*$/.exec(line)?.[1])
      .filter(Boolean),
  );
}

function levelTwoHeadings(source) {
  return markdownStructuralLines(source)
    .map((line) => /^##\s+(.+?)\s*$/.exec(line)?.[1])
    .filter(Boolean);
}

function requiredHeadingsAreOrdered(source, requiredHeadings) {
  const headings = levelTwoHeadings(source);
  let nextIndex = 0;
  for (const requiredHeading of requiredHeadings) {
    const index = headings.indexOf(requiredHeading, nextIndex);
    if (index === -1) return false;
    nextIndex = index + 1;
  }
  return true;
}

function repositoryPath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

export function evaluateDocumentation(documents) {
  const findings = [];
  for (const file of Object.values(DOCUMENTATION_FILE)) {
    if (documents[file] !== undefined) continue;
    findings.push({file, reason: DOCUMENTATION_REASON.FILE_MISSING});
  }

  const headingRequirements = [
    [DOCUMENTATION_FILE.README, DOCUMENTATION_REQUIREMENT.README_HEADINGS],
    [DOCUMENTATION_FILE.SETUP, DOCUMENTATION_REQUIREMENT.SETUP_HEADINGS],
    [DOCUMENTATION_FILE.DISTRIBUTION, DOCUMENTATION_REQUIREMENT.DISTRIBUTION_HEADINGS],
    [DOCUMENTATION_FILE.GETTING_STARTED, DOCUMENTATION_REQUIREMENT.GETTING_STARTED_HEADINGS],
    [DOCUMENTATION_FILE.SEMANTIC_NAVIGATION_SKILL, DOCUMENTATION_REQUIREMENT.SEMANTIC_NAVIGATION_SKILL_HEADINGS],
  ];
  for (const [file, requiredHeadings] of headingRequirements) {
    if (documents[file] === undefined) continue;
    const headings = markdownHeadings(documents[file]);
    for (const heading of requiredHeadings) {
      if (headings.has(heading)) continue;
      findings.push({file, reason: DOCUMENTATION_REASON.HEADING_MISSING, heading});
    }
  }

  const readme = documents[DOCUMENTATION_FILE.README];
  if (readme !== undefined) {
    if (levelTwoHeadings(readme)[0] !== DOCUMENTATION_REQUIREMENT.README_FIRST_SECTION) {
      findings.push({
        file: DOCUMENTATION_FILE.README,
        reason: DOCUMENTATION_REASON.SETUP_ENTRY_POINT_NOT_FIRST,
        expectedHeading: DOCUMENTATION_REQUIREMENT.README_FIRST_SECTION,
      });
    }
    for (const link of DOCUMENTATION_REQUIREMENT.README_LINKS) {
      if (readme.includes(`](${link})`)) continue;
      findings.push({file: DOCUMENTATION_FILE.README, reason: DOCUMENTATION_REASON.LINK_MISSING, link});
    }
    for (const literal of DOCUMENTATION_REQUIREMENT.README_SETUP_ENTRY_LITERALS) {
      if (readme.includes(literal)) continue;
      findings.push({file: DOCUMENTATION_FILE.README, reason: DOCUMENTATION_REASON.LITERAL_MISSING, literal});
    }
    const readmeHeadings = markdownHeadings(readme);
    for (const heading of DOCUMENTATION_REQUIREMENT.README_FORBIDDEN_SETUP_HEADINGS) {
      if (!readmeHeadings.has(heading)) continue;
      findings.push({file: DOCUMENTATION_FILE.README, reason: DOCUMENTATION_REASON.DUPLICATE_SETUP_SECTION, heading});
    }
    for (const literal of DOCUMENTATION_REQUIREMENT.README_FORBIDDEN_SETUP_LITERALS) {
      if (!readme.includes(literal)) continue;
      findings.push({file: DOCUMENTATION_FILE.README, reason: DOCUMENTATION_REASON.DUPLICATE_SETUP_COMMAND, literal});
    }
  }

  const gettingStarted = documents[DOCUMENTATION_FILE.GETTING_STARTED];
  if (gettingStarted !== undefined) {
    for (const literal of DOCUMENTATION_REQUIREMENT.GETTING_STARTED_LITERALS) {
      if (gettingStarted.includes(literal)) continue;
      findings.push({file: DOCUMENTATION_FILE.GETTING_STARTED, reason: DOCUMENTATION_REASON.LITERAL_MISSING, literal});
    }
  }

  const setup = documents[DOCUMENTATION_FILE.SETUP];
  if (setup !== undefined) {
    const setupHeadings = levelTwoHeadings(setup);
    if (setupHeadings[0] !== DOCUMENTATION_REQUIREMENT.SETUP_FIRST_SECTION) {
      findings.push({
        file: DOCUMENTATION_FILE.SETUP,
        reason: DOCUMENTATION_REASON.SETUP_GUARDS_NOT_FIRST,
        expectedHeading: DOCUMENTATION_REQUIREMENT.SETUP_FIRST_SECTION,
      });
    }
    if (!requiredHeadingsAreOrdered(setup, DOCUMENTATION_REQUIREMENT.SETUP_HEADINGS)) {
      findings.push({
        file: DOCUMENTATION_FILE.SETUP,
        reason: DOCUMENTATION_REASON.SETUP_SECTION_ORDER_INVALID,
      });
    }
    if (setupHeadings.at(-1) !== DOCUMENTATION_REQUIREMENT.SETUP_LAST_SECTION) {
      findings.push({
        file: DOCUMENTATION_FILE.SETUP,
        reason: DOCUMENTATION_REASON.SETUP_BACKGROUND_NOT_LAST,
        expectedHeading: DOCUMENTATION_REQUIREMENT.SETUP_LAST_SECTION,
      });
    }
    for (const literal of DOCUMENTATION_REQUIREMENT.SETUP_LITERALS) {
      if (setup.includes(literal)) continue;
      findings.push({file: DOCUMENTATION_FILE.SETUP, reason: DOCUMENTATION_REASON.LITERAL_MISSING, literal});
    }
  }

  const semanticNavigationSkill = documents[DOCUMENTATION_FILE.SEMANTIC_NAVIGATION_SKILL];
  if (semanticNavigationSkill !== undefined) {
    for (const literal of DOCUMENTATION_REQUIREMENT.SEMANTIC_NAVIGATION_SKILL_LITERALS) {
      if (semanticNavigationSkill.includes(literal)) continue;
      findings.push({
        file: DOCUMENTATION_FILE.SEMANTIC_NAVIGATION_SKILL,
        reason: DOCUMENTATION_REASON.LITERAL_MISSING,
        literal,
      });
    }
  }

  const distribution = documents[DOCUMENTATION_FILE.DISTRIBUTION];
  if (distribution !== undefined) {
    for (const literal of DOCUMENTATION_REQUIREMENT.DISTRIBUTION_LITERALS) {
      if (distribution.includes(literal)) continue;
      findings.push({file: DOCUMENTATION_FILE.DISTRIBUTION, reason: DOCUMENTATION_REASON.LITERAL_MISSING, literal});
    }
    for (const literal of DOCUMENTATION_REQUIREMENT.DISTRIBUTION_FORBIDDEN_SETUP_LITERALS) {
      if (!distribution.includes(literal)) continue;
      findings.push({file: DOCUMENTATION_FILE.DISTRIBUTION, reason: DOCUMENTATION_REASON.DUPLICATE_SETUP_COMMAND, literal});
    }
  }

  for (const [file, source] of Object.entries(documents)) {
    if (PRIVATE_COORDINATION_PATTERN.test(source)) {
      findings.push({file, reason: DOCUMENTATION_REASON.PRIVATE_COORDINATION});
    }
    if (LOCAL_ABSOLUTE_PATH_PATTERN.test(source)) {
      findings.push({file, reason: DOCUMENTATION_REASON.LOCAL_PATH});
    }
  }
  return findings;
}

async function markdownFiles(directory, root) {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(absolute, root)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(repositoryPath(root, absolute));
  }
  return files;
}

async function publicDocumentationFiles(root) {
  const nested = await Promise.all(PUBLIC_DOCUMENT_DIRECTORY.map((directory) => markdownFiles(path.join(root, directory), root)));
  return [...new Set([...PUBLIC_ROOT_DOCUMENT, ...nested.flat()])].sort();
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const documents = {};
  for (const file of await publicDocumentationFiles(root)) {
    try {
      documents[file] = await readFile(path.join(root, file), "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const findings = evaluateDocumentation(documents);
  process.stdout.write(`${JSON.stringify({status: findings.length === 0 ? "pass" : "fail", findings}, null, 2)}\n`);
  if (findings.length > 0) process.exitCode = 1;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) await main();
