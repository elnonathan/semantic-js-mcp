#!/usr/bin/env node

import path from "node:path";
import {mkdtemp, mkdir, readFile, realpath, symlink, writeFile} from "node:fs/promises";
import {homedir, tmpdir} from "node:os";
import {fileURLToPath, pathToFileURL} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {ListRootsRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {CODEX_SESSION_ROOT_AUTHORIZATION} from "../lib/codex-session-root-authorization.mjs";
import {removeTemporaryDirectory} from "../lib/temporary-directory.mjs";
import {ERROR_CODE, TOOL} from "../protocol.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const workspace = await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-roots-smoke-"));
await mkdir(path.join(workspace, "src"), {recursive: true});
const file = path.join(workspace, "src", "target.ts");
const outsideFile = path.join(workspace, "..", `${path.basename(workspace)}-outside.ts`);
const outsideMarker = "OUTSIDE_BOUNDARY_SECRET_MARKER";
await writeFile(outsideFile, `/** ${outsideMarker} */\nexport function outsideSecret(): number {\n  return 42;\n}\n`);
const directImport = path.relative(path.dirname(file), outsideFile).replaceAll(path.sep, "/").replace(/\.ts$/, "");
const directSpecifier = directImport.startsWith(".") ? directImport : `./${directImport}`;
await symlink(outsideFile, path.join(workspace, "src", "outside-link.ts"));
await writeFile(
  file,
  [
    `import {outsideSecret as directSecret} from ${JSON.stringify(directSpecifier)};`,
    'import {outsideSecret as linkedSecret} from "./outside-link";',
    "export const directValue = directSecret();",
    "export const linkedValue = linkedSecret();",
    "export function rootsTarget(value: number): number {",
    "  return value + directValue + linkedValue;",
    "}",
    "",
  ].join("\n"),
);
await writeFile(path.join(workspace, "package.json"), JSON.stringify({name: "roots-fixture", version: "1.0.0"}));
const secondWorkspace = await mkdtemp(path.join(tmpdir(), "semantic-js-mcp-session-root-smoke-"));
const secondFile = path.join(secondWorkspace, "second.ts");
await writeFile(secondFile, "export const secondRootTarget = 2;\n");
await writeFile(path.join(secondWorkspace, "package.json"), JSON.stringify({name: "second-roots-fixture", version: "1.0.0"}));

// The client advertises the MCP roots capability and reports the fixture workspace.
const client = new Client({name: "semantic-js-mcp-roots-smoke", version: "1.0.0"}, {capabilities: {roots: {listChanged: true}}});
let currentRoots = [{uri: pathToFileURL(workspace).href, name: "workspace"}];
let rootRequestCount = 0;
client.setRequestHandler(ListRootsRequestSchema, () => {
  rootRequestCount++;
  return {roots: currentRoots};
});

// Started WITHOUT SEMANTIC_JS_MCP_WORKSPACE_ROOTS: only the client-provided root should authorize the fixture.
const transport = new StdioClientTransport({command: process.execPath, args: [path.join(pluginRoot, "server.mjs")], cwd: pluginRoot});
await client.connect(transport);

async function callTool(targetClient, name, args) {
  return targetClient.callTool({name, arguments: args});
}

async function waitForRequestCount(readCount, expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (readCount() >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for roots/list request ${expected}`);
}

const inside = await callTool(client, TOOL.DOCUMENT_SYMBOLS, {file});
const outside = await callTool(client, TOOL.DOCUMENT_SYMBOLS, {file: outsideFile});
const directDefinition = await callTool(client, TOOL.DEFINITION, {file, line: 3, column: 29});
const linkedDefinition = await callTool(client, TOOL.DEFINITION, {file, line: 4, column: 29});
const directHover = await callTool(client, TOOL.HOVER, {file, line: 3, column: 29});
const linkedHover = await callTool(client, TOOL.HOVER, {file, line: 4, column: 29});
const referenceCount = await callTool(client, TOOL.COUNT_REFERENCES, {
  file,
  line: 5,
  column: 17,
  includeDeclaration: true,
  crossWorkspace: false,
});
const referenceSetId = referenceCount.structuredContent?.result?.referenceSetId;

currentRoots = [];
await client.sendRootsListChanged();
await waitForRequestCount(() => rootRequestCount, 2);
const afterRevocation = await callTool(client, TOOL.DOCUMENT_SYMBOLS, {file});
const revokedReferenceSet = referenceSetId ? await callTool(client, TOOL.REFERENCE_PAGE, {referenceSetId, cursor: "0"}) : undefined;

await client.close();

let resolveStaleRoots;
const staleRoots = new Promise((resolve) => {
  resolveStaleRoots = resolve;
});
let raceRequestCount = 0;
const raceClient = new Client({name: "semantic-js-mcp-roots-race-smoke", version: "1.0.0"}, {capabilities: {roots: {listChanged: true}}});
raceClient.setRequestHandler(ListRootsRequestSchema, () => {
  raceRequestCount++;
  if (raceRequestCount === 1) return staleRoots;
  return {roots: []};
});
const raceTransport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(pluginRoot, "server.mjs")],
  cwd: pluginRoot,
});
await raceClient.connect(raceTransport);
await waitForRequestCount(() => raceRequestCount, 1);
await raceClient.sendRootsListChanged();
await waitForRequestCount(() => raceRequestCount, 2);
const afterNewerRevocation = await callTool(raceClient, TOOL.DOCUMENT_SYMBOLS, {file});
resolveStaleRoots({roots: [{uri: pathToFileURL(workspace).href, name: "stale-workspace"}]});
await new Promise((resolve) => setTimeout(resolve, 50));
const afterStaleCompletion = await callTool(raceClient, TOOL.DOCUMENT_SYMBOLS, {file});
const unavailablePreparation = await callTool(raceClient, TOOL.PREPARE_WORKSPACE_ROOT, {root: workspace});
await raceClient.close();

const authorizationClient = new Client({name: "semantic-js-mcp-session-root-smoke", version: "1.0.0"}, {capabilities: {}});
const authorizationTransport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(pluginRoot, "server.mjs")],
  cwd: pluginRoot,
  env: {
    ...process.env,
    [CODEX_SESSION_ROOT_AUTHORIZATION.ENVIRONMENT_VARIABLE]: CODEX_SESSION_ROOT_AUTHORIZATION.ENABLED_VALUE,
  },
});
await authorizationClient.connect(authorizationTransport);
const listedTools = await authorizationClient.listTools();
const authorizationTool = listedTools.tools.find((tool) => tool.name === TOOL.AUTHORIZE_WORKSPACE_ROOT);
const beforeSessionAuthorization = await callTool(authorizationClient, TOOL.DOCUMENT_SYMBOLS, {file});
const broadRootPreparation = await callTool(authorizationClient, TOOL.PREPARE_WORKSPACE_ROOT, {
  root: path.parse(workspace).root,
});
const homePreparation = await callTool(authorizationClient, TOOL.PREPARE_WORKSPACE_ROOT, {root: homedir()});
const homeAncestorPreparation = await callTool(authorizationClient, TOOL.PREPARE_WORKSPACE_ROOT, {
  root: path.dirname(homedir()),
});
const protectedSystemRoot =
  process.platform === "win32" ? path.join(path.parse(workspace).root, "Windows") : process.platform === "darwin" ? "/Library" : "/usr";
const protectedSystemRootPreparation = await callTool(authorizationClient, TOOL.PREPARE_WORKSPACE_ROOT, {
  root: protectedSystemRoot,
});
const firstPreparation = await callTool(authorizationClient, TOOL.PREPARE_WORKSPACE_ROOT, {root: workspace});
const firstPrepared = firstPreparation.structuredContent?.result;
const afterPreparationBeforeAuthorization = await callTool(authorizationClient, TOOL.DOCUMENT_SYMBOLS, {file});
const mismatchAuthorization = await callTool(authorizationClient, TOOL.AUTHORIZE_WORKSPACE_ROOT, {
  authorizationRequestId: firstPrepared?.authorizationRequestId,
  root: path.join(firstPrepared?.canonicalRoot || workspace, "src"),
});
const consumedAfterMismatch = await callTool(authorizationClient, TOOL.AUTHORIZE_WORKSPACE_ROOT, {
  authorizationRequestId: firstPrepared?.authorizationRequestId,
  root: firstPrepared?.canonicalRoot,
});
const secondPreparation = await callTool(authorizationClient, TOOL.PREPARE_WORKSPACE_ROOT, {root: workspace});
const secondPrepared = secondPreparation.structuredContent?.result;
const sessionAuthorization = await callTool(authorizationClient, TOOL.AUTHORIZE_WORKSPACE_ROOT, {
  authorizationRequestId: secondPrepared?.authorizationRequestId,
  root: secondPrepared?.canonicalRoot,
});
const afterSessionAuthorization = await callTool(authorizationClient, TOOL.DOCUMENT_SYMBOLS, {file});
const sessionReferenceCount = await callTool(authorizationClient, TOOL.COUNT_REFERENCES, {
  file,
  line: 5,
  column: 17,
  includeDeclaration: true,
  crossWorkspace: false,
});
const sessionReferenceSetId = sessionReferenceCount.structuredContent?.result?.referenceSetId;
const replayedAuthorization = await callTool(authorizationClient, TOOL.AUTHORIZE_WORKSPACE_ROOT, {
  authorizationRequestId: secondPrepared?.authorizationRequestId,
  root: secondPrepared?.canonicalRoot,
});
const thirdPreparation = await callTool(authorizationClient, TOOL.PREPARE_WORKSPACE_ROOT, {root: secondWorkspace});
const thirdPrepared = thirdPreparation.structuredContent?.result;
const secondSessionAuthorization = await callTool(authorizationClient, TOOL.AUTHORIZE_WORKSPACE_ROOT, {
  authorizationRequestId: thirdPrepared?.authorizationRequestId,
  root: thirdPrepared?.canonicalRoot,
});
const invalidatedBySessionRootAddition = sessionReferenceSetId
  ? await callTool(authorizationClient, TOOL.REFERENCE_PAGE, {referenceSetId: sessionReferenceSetId, cursor: "0"})
  : undefined;
const secondSessionRootSymbols = await callTool(authorizationClient, TOOL.DOCUMENT_SYMBOLS, {file: secondFile});
await authorizationClient.close();

const restartedAuthorizationClient = new Client(
  {name: "semantic-js-mcp-restarted-session-root-smoke", version: "1.0.0"},
  {capabilities: {}},
);
const restartedAuthorizationTransport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(pluginRoot, "server.mjs")],
  cwd: pluginRoot,
  env: {
    ...process.env,
    [CODEX_SESSION_ROOT_AUTHORIZATION.ENVIRONMENT_VARIABLE]: CODEX_SESSION_ROOT_AUTHORIZATION.ENABLED_VALUE,
  },
});
await restartedAuthorizationClient.connect(restartedAuthorizationTransport);
const afterServerRestart = await callTool(restartedAuthorizationClient, TOOL.DOCUMENT_SYMBOLS, {file});
await restartedAuthorizationClient.close();

const missingHome = path.join(path.parse(workspace).root, "semantic-js-mcp-missing-home-boundary");
const unavailableHomeClient = new Client({name: "semantic-js-mcp-unavailable-home-smoke", version: "1.0.0"}, {capabilities: {}});
const unavailableHomeTransport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(pluginRoot, "server.mjs")],
  cwd: pluginRoot,
  env: {
    ...process.env,
    HOME: missingHome,
    USERPROFILE: missingHome,
    HOMEDRIVE: path.parse(missingHome).root,
    HOMEPATH: missingHome.slice(path.parse(missingHome).root.length),
    [CODEX_SESSION_ROOT_AUTHORIZATION.ENVIRONMENT_VARIABLE]: CODEX_SESSION_ROOT_AUTHORIZATION.ENABLED_VALUE,
  },
});
await unavailableHomeClient.connect(unavailableHomeTransport);
const unavailableHomePreparation = await callTool(unavailableHomeClient, TOOL.PREPARE_WORKSPACE_ROOT, {root: workspace});
await unavailableHomeClient.close();

const codexMcpConfiguration = JSON.parse(await readFile(path.join(pluginRoot, ".mcp.json"), "utf8"));
const codexServerConfiguration = codexMcpConfiguration.mcpServers?.["semantic-js-mcp"];

const results = {
  clientRootAuthorizesWorkspace: inside.isError !== true && (inside.structuredContent?.result?.symbolsFound ?? 0) > 0,
  outsideRootStillRejected:
    outside.isError === true && outside.structuredContent?.error?.code === ERROR_CODE.PATH_OUTSIDE_WORKSPACE_BOUNDARY,
  directImportCannotReturnOutsideDefinition: !(directDefinition.structuredContent?.result?.definitions || []).some(
    (definition) => definition.file === outsideFile,
  ),
  symlinkImportCannotReturnOutsideDefinition: !(linkedDefinition.structuredContent?.result?.definitions || []).some(
    (definition) => definition.file === outsideFile,
  ),
  directImportCannotExposeOutsideHover: !JSON.stringify(directHover).includes(outsideMarker),
  symlinkImportCannotExposeOutsideHover: !JSON.stringify(linkedHover).includes(outsideMarker),
  revokedRootRejected:
    afterRevocation.isError === true && afterRevocation.structuredContent?.error?.code === ERROR_CODE.PATH_OUTSIDE_WORKSPACE_BOUNDARY,
  revokedRootClearsReferenceSets:
    Boolean(referenceSetId) &&
    revokedReferenceSet?.isError === true &&
    revokedReferenceSet.structuredContent?.error?.code === ERROR_CODE.REFERENCE_SET_NOT_FOUND_OR_EXPIRED,
  newerRootRefreshWins:
    afterNewerRevocation.isError === true &&
    afterNewerRevocation.structuredContent?.error?.code === ERROR_CODE.PATH_OUTSIDE_WORKSPACE_BOUNDARY,
  staleRootRefreshCannotReauthorize:
    afterStaleCompletion.isError === true &&
    afterStaleCompletion.structuredContent?.error?.code === ERROR_CODE.PATH_OUTSIDE_WORKSPACE_BOUNDARY,
  genericHostCannotPrepareSessionRoot:
    unavailablePreparation.isError === true &&
    unavailablePreparation.structuredContent?.error?.code === ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_UNAVAILABLE,
  authorizationToolAdvertisesHumanApprovalBoundary:
    authorizationTool?.annotations?.readOnlyHint === false && authorizationTool?.annotations?.destructiveHint === true,
  codexPluginForcesAuthorizationPrompt:
    codexServerConfiguration?.default_tools_approval_mode === "prompt" &&
    codexServerConfiguration?.tools?.[TOOL.PREPARE_WORKSPACE_ROOT]?.approval_mode === "prompt" &&
    codexServerConfiguration?.tools?.[TOOL.AUTHORIZE_WORKSPACE_ROOT]?.approval_mode === "prompt",
  codexPluginAloneEnablesSessionAuthorization:
    codexServerConfiguration?.env?.[CODEX_SESSION_ROOT_AUTHORIZATION.ENVIRONMENT_VARIABLE] ===
    CODEX_SESSION_ROOT_AUTHORIZATION.ENABLED_VALUE,
  outsideRootOffersPreparationWithoutAuthorizing:
    beforeSessionAuthorization.isError === true &&
    beforeSessionAuthorization.structuredContent?.error?.code === ERROR_CODE.PATH_OUTSIDE_WORKSPACE_BOUNDARY &&
    beforeSessionAuthorization.structuredContent?.continueWith?.[0] === TOOL.PREPARE_WORKSPACE_ROOT &&
    beforeSessionAuthorization.structuredContent?.error?.details?.sessionWorkspaceRootAuthorizationAvailable === true,
  filesystemRootCannotBePrepared:
    broadRootPreparation.isError === true && broadRootPreparation.structuredContent?.error?.code === ERROR_CODE.WORKSPACE_ROOT_TOO_BROAD,
  homeRootCannotBePrepared:
    homePreparation.isError === true && homePreparation.structuredContent?.error?.code === ERROR_CODE.WORKSPACE_ROOT_TOO_BROAD,
  homeAncestorCannotBePrepared:
    homeAncestorPreparation.isError === true &&
    homeAncestorPreparation.structuredContent?.error?.code === ERROR_CODE.WORKSPACE_ROOT_TOO_BROAD,
  protectedSystemRootCannotBePrepared:
    protectedSystemRootPreparation.isError === true &&
    protectedSystemRootPreparation.structuredContent?.error?.code === ERROR_CODE.WORKSPACE_ROOT_TOO_BROAD,
  unverifiableHomeBoundaryFailsClosed:
    unavailableHomePreparation.isError === true &&
    unavailableHomePreparation.structuredContent?.error?.code === ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_UNAVAILABLE,
  preparationCanonicalizesWithoutAuthorizing:
    firstPreparation.isError !== true &&
    firstPrepared?.canonicalRoot === (await realpath(workspace)) &&
    firstPrepared?.authorizationRequired === true &&
    afterPreparationBeforeAuthorization.isError === true &&
    afterPreparationBeforeAuthorization.structuredContent?.error?.code === ERROR_CODE.PATH_OUTSIDE_WORKSPACE_BOUNDARY,
  mismatchedRootCannotBeAuthorized:
    mismatchAuthorization.isError === true &&
    mismatchAuthorization.structuredContent?.error?.code === ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_INVALID,
  mismatchedAttemptConsumesAuthorization:
    consumedAfterMismatch.isError === true &&
    consumedAfterMismatch.structuredContent?.error?.code === ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_INVALID,
  humanApprovedRootLivesOnlyForServerProcess:
    sessionAuthorization.isError !== true &&
    sessionAuthorization.structuredContent?.result?.authorizedWorkspaceRoot === secondPrepared?.canonicalRoot &&
    sessionAuthorization.structuredContent?.result?.persistsAfterServerExit === false,
  authorizedSessionRootCanBeAnalyzed:
    afterSessionAuthorization.isError !== true && (afterSessionAuthorization.structuredContent?.result?.symbolsFound ?? 0) > 0,
  authorizationCannotBeReplayed:
    replayedAuthorization.isError === true &&
    replayedAuthorization.structuredContent?.error?.code === ERROR_CODE.WORKSPACE_ROOT_AUTHORIZATION_INVALID,
  addingSessionRootInvalidatesReferenceSets:
    secondSessionAuthorization.isError !== true &&
    Boolean(sessionReferenceSetId) &&
    invalidatedBySessionRootAddition?.isError === true &&
    invalidatedBySessionRootAddition.structuredContent?.error?.code === ERROR_CODE.REFERENCE_SET_NOT_FOUND_OR_EXPIRED,
  secondHumanApprovedRootCanBeAnalyzed:
    secondSessionRootSymbols.isError !== true && (secondSessionRootSymbols.structuredContent?.result?.symbolsFound ?? 0) > 0,
  sessionRootsDisappearWhenServerExits:
    afterServerRestart.isError === true && afterServerRestart.structuredContent?.error?.code === ERROR_CODE.PATH_OUTSIDE_WORKSPACE_BOUNDARY,
};

console.log(JSON.stringify(results, null, 2));

await removeTemporaryDirectory(workspace);
await removeTemporaryDirectory(secondWorkspace);
await removeTemporaryDirectory(outsideFile).catch(() => undefined);

process.exit(Object.values(results).every(Boolean) ? 0 : 1);
