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

function markdownHeadings(source) {
  return new Set(
    source
      .split("\n")
      .map((line) => /^#{1,6}\s+(.+?)\s*$/.exec(line)?.[1])
      .filter(Boolean),
  );
}

export function evaluateDocumentation(documents) {
  const findings = [];
  for (const file of Object.values(DOCUMENTATION_FILE)) {
    if (documents[file] !== undefined) continue;
    findings.push({file, reason: DOCUMENTATION_REASON.FILE_MISSING});
  }

  const headingRequirements = [
    [DOCUMENTATION_FILE.README, DOCUMENTATION_REQUIREMENT.README_HEADINGS],
    [DOCUMENTATION_FILE.GETTING_STARTED, DOCUMENTATION_REQUIREMENT.GETTING_STARTED_HEADINGS],
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
    for (const link of DOCUMENTATION_REQUIREMENT.README_LINKS) {
      if (readme.includes(`](${link})`)) continue;
      findings.push({file: DOCUMENTATION_FILE.README, reason: DOCUMENTATION_REASON.LINK_MISSING, link});
    }
  }

  const gettingStarted = documents[DOCUMENTATION_FILE.GETTING_STARTED];
  if (gettingStarted !== undefined) {
    for (const literal of DOCUMENTATION_REQUIREMENT.GETTING_STARTED_LITERALS) {
      if (gettingStarted.includes(literal)) continue;
      findings.push({file: DOCUMENTATION_FILE.GETTING_STARTED, reason: DOCUMENTATION_REASON.LITERAL_MISSING, literal});
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
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(path.relative(root, absolute));
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
