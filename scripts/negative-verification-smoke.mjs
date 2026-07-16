#!/usr/bin/env node

import {strictEqual} from "node:assert";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  COLLECTION_STATUS,
  CI_STATUS,
  DIAGNOSTIC_EVIDENCE_REASON,
  DOCTOR_CHECK,
  DOCTOR_REASON,
  ENVIRONMENT_VARIABLE,
  ERROR_CODE,
  EVIDENCE_STATUS,
  PRODUCT,
  TOOL,
} from "../protocol.mjs";
import {runDoctor} from "../lib/doctor.mjs";
import {collectStableSnapshot} from "../lib/stable-collection.mjs";
import {evaluateSemanticResult} from "./semantic-js-mcp-ci.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await mkdtemp(path.join(tmpdir(), `${PRODUCT.NAME}-negative-verification-`));
const sourceDirectory = path.join(workspace, "src");
const target = path.join(sourceDirectory, "target.ts");
const usage = path.join(sourceDirectory, "usage.ts");
const missingWorkspace = path.join(workspace, "missing-workspace");
const missingProviderRoot = path.join(workspace, "missing-providers");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function result(response, tool) {
  assert(!response.isError, response.content?.[0]?.text || `${tool} failed`);
  assert(response.structuredContent?.tool === tool, `${tool} omitted its canonical identity`);
  return response.structuredContent;
}

function errorResult(response, tool) {
  assert(response.isError, `${tool} was expected to fail`);
  assert(response.structuredContent?.tool === tool, `${tool} error omitted its canonical identity`);
  assert(response.structuredContent?.collection?.status === COLLECTION_STATUS.FAILED, `${tool} error was not failed`);
  return response.structuredContent;
}

function assertCiStatus(canonicalResult, expectedStatus, name) {
  strictEqual(evaluateSemanticResult(canonicalResult).status, expectedStatus, `${name} used the wrong CI status`);
}

async function expectInputRejection(action) {
  let rejection;
  let response;
  try {
    response = await action();
  } catch (error) {
    rejection = error;
  }
  if (response?.isError) {
    const message = response.content?.find((item) => item.type === "text")?.text || "";
    assert(/positive|greater than|invalid|expected/i.test(message), `Unexpected invalid-input response: ${message}`);
    return;
  }
  assert(rejection, "Invalid tool input was accepted");
  assert(/positive|greater than|invalid|expected/i.test(rejection.message), `Unexpected invalid-input error: ${rejection.message}`);
}

await mkdir(sourceDirectory, {recursive: true});
await mkdir(missingProviderRoot, {recursive: true});
await writeFile(path.join(workspace, "package.json"), JSON.stringify({private: true, type: "module"}));
await writeFile(path.join(missingProviderRoot, "package.json"), JSON.stringify({private: true, type: "module"}));
await writeFile(
  path.join(workspace, "tsconfig.json"),
  JSON.stringify({compilerOptions: {strict: true, target: "ES2022", module: "ESNext"}, include: ["src/**/*.ts"]}),
);
await writeFile(target, "export function negativeTarget(value: number): number { return value + 1; }\n");
await writeFile(
  usage,
  [
    'import {negativeTarget} from "./target.js";',
    "export const value = negativeTarget(1);",
    'export const unresolved = "negativeTarget";',
  ].join("\n"),
);

const missingProviderDoctor = await runDoctor({packageRoot: missingProviderRoot});
const missingProviderCheck = missingProviderDoctor.checks.find((check) => check.name === DOCTOR_CHECK.RUNTIME_COMPONENTS);
assert(missingProviderDoctor.status === CI_STATUS.BLOCKED && missingProviderDoctor.exitCode > 0, "Missing providers did not block doctor");
assert(missingProviderCheck?.reason === DOCTOR_REASON.RUNTIME_COMPONENT_MISSING, "Missing providers used the wrong doctor reason");
assert(
  missingProviderCheck.details.missingComponents.length === missingProviderCheck.details.components.length,
  "Missing provider fixture resolved a runtime component",
);

const changingInventories = [{id: 1}, {id: 2}, {id: 3}, {id: 4}];
const unstable = await collectStableSnapshot({
  attempts: 2,
  collect: async () => ({evidenceFiles: [target]}),
  inventory: async () => changingInventories.shift(),
  sameInventory: (left, right) => left.id === right.id,
  fingerprint: async () => [],
});
strictEqual(unstable, undefined, "Repository mutation fixture produced a stable collection");

const client = new Client({name: `${PRODUCT.NAME}-negative-verification`, version: "1.0.0"});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "server.mjs")],
  cwd: root,
  env: {...process.env, [ENVIRONMENT_VARIABLE.REFERENCE_SET_TTL_MS]: "150"},
});

try {
  await client.connect(transport);

  const unresolved = result(
    await client.callTool({name: TOOL.AUDIT_NAMED_SYMBOL, arguments: {root: workspace, symbol: "negativeTarget"}}),
    TOOL.AUDIT_NAMED_SYMBOL,
  );
  assert(unresolved.collection.status === COLLECTION_STATUS.PARTIAL, "Unresolved candidate did not weaken collection status");
  assert(unresolved.result.audits[0].textSearch.matchesWhoseDefinitionCouldNotBeResolved > 0, "Unresolved candidate count was omitted");
  assertCiStatus(unresolved, CI_STATUS.UNTRUSTED, "Unresolved candidate evidence");

  const references = result(
    await client.callTool({name: TOOL.REFERENCES, arguments: {file: target, root: workspace, line: 1, column: 17}}),
    TOOL.REFERENCES,
  );
  await writeFile(usage, `${await readFile(usage, "utf8")}\nexport const changed = true;\n`);
  const changed = errorResult(
    await client.callTool({name: TOOL.REFERENCE_PAGE, arguments: {referenceSetId: references.result.referenceSetId}}),
    TOOL.REFERENCE_PAGE,
  );
  assert(changed.error.code === ERROR_CODE.REFERENCE_SET_CONTENT_CHANGED, "Changed reference set used the wrong error code");
  assertCiStatus(changed, CI_STATUS.BLOCKED, "Changed reference set");

  const freshReferences = result(
    await client.callTool({name: TOOL.REFERENCES, arguments: {file: target, root: workspace, line: 1, column: 17}}),
    TOOL.REFERENCES,
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  const expired = errorResult(
    await client.callTool({name: TOOL.REFERENCE_PAGE, arguments: {referenceSetId: freshReferences.result.referenceSetId}}),
    TOOL.REFERENCE_PAGE,
  );
  assert(expired.error.code === ERROR_CODE.REFERENCE_SET_NOT_FOUND_OR_EXPIRED, "Expired reference set used the wrong error code");
  assertCiStatus(expired, CI_STATUS.BLOCKED, "Expired reference set");

  await expectInputRejection(() =>
    client.callTool({name: TOOL.COUNT_NAMED_SYMBOL, arguments: {root: workspace, symbol: "negativeTarget", maxCandidates: 0}}),
  );

  const invalidWorkspace = errorResult(
    await client.callTool({name: TOOL.COUNT_TEXT_MATCHES, arguments: {root: missingWorkspace, symbol: "negativeTarget"}}),
    TOOL.COUNT_TEXT_MATCHES,
  );
  assert(invalidWorkspace.error?.message, "Invalid workspace error omitted an actionable message");
  assertCiStatus(invalidWorkspace, CI_STATUS.BLOCKED, "Invalid workspace");

  const diagnostics = result(await client.callTool({name: TOOL.DIAGNOSTICS, arguments: {file: target, root: workspace}}), TOOL.DIAGNOSTICS);
  if (diagnostics.result.evidence.status === EVIDENCE_STATUS.UNTRUSTED) {
    assert(diagnostics.collection.status === COLLECTION_STATUS.PARTIAL, "Untrusted diagnostics claimed complete collection");
    assert(
      Object.values(DIAGNOSTIC_EVIDENCE_REASON).includes(diagnostics.result.evidence.reason),
      "Untrusted diagnostics used a non-canonical reason",
    );
  } else {
    assert(diagnostics.result.evidence.status === EVIDENCE_STATUS.VERIFIED, "Diagnostics used an unknown evidence status");
    assert(Array.isArray(diagnostics.result.diagnosticsForCurrentDocument?.items), "Verified diagnostics omitted the current report");
  }
  assertCiStatus(
    diagnostics,
    diagnostics.result.evidence.status === EVIDENCE_STATUS.VERIFIED ? CI_STATUS.PASS : CI_STATUS.UNTRUSTED,
    "Diagnostic evidence",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        cases: [
          {
            name: "missing-providers",
            observed: {doctorStatus: missingProviderDoctor.status, reason: missingProviderCheck.reason},
            expected: {doctorStatus: CI_STATUS.BLOCKED, reason: DOCTOR_REASON.RUNTIME_COMPONENT_MISSING},
          },
          {
            name: "invalid-workspace",
            observed: {collectionStatus: invalidWorkspace.collection.status},
            expected: {collectionStatus: COLLECTION_STATUS.FAILED, ciStatus: CI_STATUS.BLOCKED},
          },
          {
            name: "changed-reference-set",
            observed: {collectionStatus: changed.collection.status, errorCode: changed.error.code},
            expected: {collectionStatus: COLLECTION_STATUS.FAILED, ciStatus: CI_STATUS.BLOCKED},
          },
          {
            name: "expired-reference-set",
            observed: {collectionStatus: expired.collection.status, errorCode: expired.error.code},
            expected: {collectionStatus: COLLECTION_STATUS.FAILED, ciStatus: CI_STATUS.BLOCKED},
          },
          {
            name: "repository-mutation-during-collection",
            observed: {stableCollection: false},
            expected: {errorCode: ERROR_CODE.REPOSITORY_CHANGED_DURING_COLLECTION, ciStatus: CI_STATUS.BLOCKED},
          },
          {
            name: "invalid-limits",
            observed: {schemaAccepted: false},
            expected: {ciStatus: CI_STATUS.BLOCKED},
          },
          {
            name: "unresolved-candidates",
            observed: {
              collectionStatus: unresolved.collection.status,
              unresolvedCandidates: unresolved.result.audits[0].textSearch.matchesWhoseDefinitionCouldNotBeResolved,
            },
            expected: {collectionStatus: COLLECTION_STATUS.PARTIAL, ciStatus: CI_STATUS.UNTRUSTED},
          },
          {
            name: "diagnostic-trust",
            observed: {
              collectionStatus: diagnostics.collection.status,
              evidenceStatus: diagnostics.result.evidence.status,
            },
            expected: {
              collectionStatus:
                diagnostics.result.evidence.status === EVIDENCE_STATUS.VERIFIED ? COLLECTION_STATUS.COMPLETE : COLLECTION_STATUS.PARTIAL,
              ciStatus: diagnostics.result.evidence.status === EVIDENCE_STATUS.VERIFIED ? CI_STATUS.PASS : CI_STATUS.UNTRUSTED,
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.close().catch(() => undefined);
  await rm(workspace, {recursive: true, force: true});
}
