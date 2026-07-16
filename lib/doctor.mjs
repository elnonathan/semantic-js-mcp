import path from "node:path";
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ACCOUNTING_STATUS,
  CI_EXIT_CODE,
  CI_STATUS,
  CLI_ARGUMENT,
  CLI_COMMAND,
  CONFIGURATION_FILE,
  COLLECTION_STATUS,
  DEFINITION_MATCH,
  DOCTOR_CHECK,
  DOCTOR_REASON,
  DOCTOR_STATUS_PRIORITY,
  EVIDENCE_STATUS,
  PACKAGE_PATH,
  PRODUCT,
  RUNTIME_COMMAND,
  SERVER_VERSION,
  TOOL,
  TOOL_ORDER,
} from "../protocol.mjs";
import {PACKAGE_ROOT, inspectExternalCommand, inspectNodeRuntime, inspectRuntimeComponents} from "./runtime.mjs";

const STATUS_EXIT_CODE = Object.freeze({
  [CI_STATUS.PASS]: CI_EXIT_CODE.PASS,
  [CI_STATUS.FAIL]: CI_EXIT_CODE.FAIL,
  [CI_STATUS.UNTRUSTED]: CI_EXIT_CODE.UNTRUSTED,
  [CI_STATUS.BLOCKED]: CI_EXIT_CODE.BLOCKED,
});

const FIXTURE_CLEANUP = Object.freeze({
  MAXIMUM_RETRIES: 8,
  RETRY_DELAY_MILLISECONDS: 100,
});

function check(name, status, reason, details) {
  return {name, status, reason, ...(details === undefined ? {} : {details})};
}

function aggregateStatus(checks) {
  return checks.reduce(
    (current, item) => (DOCTOR_STATUS_PRIORITY[item.status] > DOCTOR_STATUS_PRIORITY[current] ? item.status : current),
    CI_STATUS.PASS,
  );
}

function doctorResult(packageRoot, checks, runtime) {
  const status = aggregateStatus(checks);
  return {
    product: {name: PRODUCT.NAME, version: SERVER_VERSION},
    command: CLI_COMMAND.DOCTOR,
    status,
    exitCode: STATUS_EXIT_CODE[status],
    installationRoot: packageRoot,
    runtime,
    checks,
  };
}

function assertToolResult(response, tool) {
  if (response.isError) throw new Error(response.content?.[0]?.text || `${tool} failed`);
  if (response.structuredContent?.tool !== tool) throw new Error(`${tool} returned a different canonical tool name`);
  return response.structuredContent;
}

async function createDoctorFixture() {
  const workspace = await mkdtemp(path.join(tmpdir(), `${PRODUCT.NAME}-doctor-`));
  const src = path.join(workspace, "src");
  await mkdir(src, {recursive: true});
  await writeFile(path.join(workspace, CONFIGURATION_FILE.PACKAGE), JSON.stringify({private: true, type: "module"}));
  await writeFile(
    path.join(workspace, CONFIGURATION_FILE.TYPESCRIPT),
    JSON.stringify({
      compilerOptions: {strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler"},
      include: ["src/**/*.ts", "src/**/*.vue"],
    }),
  );

  const target = path.join(src, "target.ts");
  const usage = path.join(src, "usage.ts");
  const unresolved = path.join(src, "unresolved.ts");
  const child = path.join(src, "DoctorChild.vue");
  const component = path.join(src, "DoctorPanel.vue");
  await writeFile(target, "export function doctorTarget(value: number): number { return value + 1; }\n");
  await writeFile(usage, 'import {doctorTarget} from "./target.js";\nexport const doctorValue = doctorTarget(1);\n');
  await writeFile(unresolved, 'export const unresolvedDoctorText = "doctorTarget";\n');
  await writeFile(
    child,
    '<script setup lang="ts">\ndefineProps<{label: string}>();\n</script>\n<template><span>{{ label }}</span></template>\n',
  );
  await writeFile(
    component,
    [
      '<script setup lang="ts">',
      'import DoctorChild from "./DoctorChild.vue";',
      "const doctorVueValue = 1;",
      "</script>",
      "<template>",
      '  <DoctorChild label="Doctor" />',
      "  <span>{{ doctorVueValue }}</span>",
      "</template>",
    ].join("\n"),
  );
  return {workspace, target, component, child};
}

function failedCheck(name, error) {
  return check(name, CI_STATUS.FAIL, DOCTOR_REASON.CHECK_FAILED, {message: error.message});
}

export async function runDoctor({packageRoot = PACKAGE_ROOT} = {}) {
  const checks = [];
  const node = inspectNodeRuntime();
  checks.push(
    check(
      DOCTOR_CHECK.NODE_RUNTIME,
      node.supported ? CI_STATUS.PASS : CI_STATUS.BLOCKED,
      node.supported ? DOCTOR_REASON.CHECK_COMPLETED : DOCTOR_REASON.UNSUPPORTED_NODE_RUNTIME,
      node,
    ),
  );

  const components = inspectRuntimeComponents(packageRoot);
  const missingComponents = components.filter((component) => !component.available);
  checks.push(
    check(
      DOCTOR_CHECK.RUNTIME_COMPONENTS,
      missingComponents.length === 0 ? CI_STATUS.PASS : CI_STATUS.BLOCKED,
      missingComponents.length === 0 ? DOCTOR_REASON.CHECK_COMPLETED : DOCTOR_REASON.RUNTIME_COMPONENT_MISSING,
      {components, missingComponents},
    ),
  );

  const ripgrep = await inspectExternalCommand(RUNTIME_COMMAND.RIPGREP, [CLI_ARGUMENT.VERSION]);
  checks.push(
    check(
      DOCTOR_CHECK.RIPGREP,
      ripgrep.available ? CI_STATUS.PASS : CI_STATUS.BLOCKED,
      ripgrep.available ? DOCTOR_REASON.CHECK_COMPLETED : DOCTOR_REASON.RIPGREP_UNAVAILABLE,
      ripgrep,
    ),
  );

  const runtime = {node, components, externalCommands: [ripgrep]};
  if (aggregateStatus(checks) === CI_STATUS.BLOCKED) return doctorResult(packageRoot, checks, runtime);

  const fixture = await createDoctorFixture();
  const client = new Client({name: `${PRODUCT.NAME}-doctor`, version: SERVER_VERSION});
  const serverFile = path.join(packageRoot, PACKAGE_PATH.SERVER);
  const transport = new StdioClientTransport({command: process.execPath, args: [serverFile], cwd: packageRoot});

  try {
    try {
      await client.connect(transport);
      checks.push(check(DOCTOR_CHECK.MCP_STARTUP, CI_STATUS.PASS, DOCTOR_REASON.CHECK_COMPLETED, {serverFile}));
    } catch (error) {
      checks.push(
        check(DOCTOR_CHECK.MCP_STARTUP, CI_STATUS.BLOCKED, DOCTOR_REASON.MCP_STARTUP_FAILED, {message: error.message, serverFile}),
      );
      return doctorResult(packageRoot, checks, runtime);
    }

    try {
      const listed = await client.listTools();
      const actualTools = listed.tools.map((tool) => tool.name);
      const matchesProtocol = JSON.stringify(actualTools) === JSON.stringify(TOOL_ORDER);
      checks.push(
        check(
          DOCTOR_CHECK.TOOL_DISCOVERY,
          matchesProtocol ? CI_STATUS.PASS : CI_STATUS.FAIL,
          matchesProtocol ? DOCTOR_REASON.CHECK_COMPLETED : DOCTOR_REASON.TOOL_SET_DIFFERENT,
          {expectedTools: TOOL_ORDER, actualTools},
        ),
      );
      if (!matchesProtocol) return doctorResult(packageRoot, checks, runtime);
    } catch (error) {
      checks.push(failedCheck(DOCTOR_CHECK.TOOL_DISCOVERY, error));
      return doctorResult(packageRoot, checks, runtime);
    }

    try {
      const symbols = assertToolResult(
        await client.callTool({
          name: TOOL.DOCUMENT_SYMBOLS,
          arguments: {file: fixture.target, root: fixture.workspace},
        }),
        TOOL.DOCUMENT_SYMBOLS,
      );
      const found = symbols.result.symbols.some((symbol) => symbol.name === "doctorTarget");
      checks.push(
        check(
          DOCTOR_CHECK.TYPESCRIPT_SYMBOLS,
          found ? CI_STATUS.PASS : CI_STATUS.FAIL,
          found ? DOCTOR_REASON.CHECK_COMPLETED : DOCTOR_REASON.TYPESCRIPT_SYMBOL_NOT_FOUND,
          {symbolsFound: symbols.result.symbols.length},
        ),
      );
    } catch (error) {
      checks.push(failedCheck(DOCTOR_CHECK.TYPESCRIPT_SYMBOLS, error));
    }

    try {
      const references = assertToolResult(
        await client.callTool({
          name: TOOL.COUNT_NAMED_SYMBOL,
          arguments: {root: fixture.workspace, symbol: "doctorTarget", fileHint: "target.ts"},
        }),
        TOOL.COUNT_NAMED_SYMBOL,
      );
      const definition = references.result.definitions[0];
      const accountingComplete = definition?.textSearch?.accountingStatus === ACCOUNTING_STATUS.COMPLETE;
      const unresolvedReported = definition?.textSearch?.matchesWhoseDefinitionCouldNotBeResolved === 1;
      const partial = references.collection.status === COLLECTION_STATUS.PARTIAL;
      const verified = accountingComplete && unresolvedReported && partial;
      checks.push(
        check(
          DOCTOR_CHECK.TYPESCRIPT_REFERENCES,
          verified ? CI_STATUS.PASS : CI_STATUS.FAIL,
          verified ? DOCTOR_REASON.CHECK_COMPLETED : DOCTOR_REASON.TYPESCRIPT_REFERENCE_ACCOUNTING_INCOMPLETE,
          {
            collectionStatus: references.collection.status,
            accountingStatus: definition?.textSearch?.accountingStatus,
            unresolvedCandidates: definition?.textSearch?.matchesWhoseDefinitionCouldNotBeResolved,
            verifiedReferences: definition?.references?.verifiedTotal,
          },
        ),
      );
    } catch (error) {
      checks.push(failedCheck(DOCTOR_CHECK.TYPESCRIPT_REFERENCES, error));
    }

    try {
      const diagnostics = assertToolResult(
        await client.callTool({
          name: TOOL.DIAGNOSTICS,
          arguments: {file: fixture.target, root: fixture.workspace},
        }),
        TOOL.DIAGNOSTICS,
      );
      const verified =
        diagnostics.result.evidence.status === EVIDENCE_STATUS.VERIFIED && diagnostics.result.diagnosticsForCurrentDocument !== null;
      checks.push(
        check(
          DOCTOR_CHECK.DIAGNOSTIC_FRESHNESS,
          verified ? CI_STATUS.PASS : CI_STATUS.UNTRUSTED,
          verified ? DOCTOR_REASON.CHECK_COMPLETED : DOCTOR_REASON.DIAGNOSTICS_NOT_CONFIRMED,
          {
            evidenceStatus: diagnostics.result.evidence.status,
            evidenceReason: diagnostics.result.evidence.reason,
            collectionStatus: diagnostics.collection.status,
            document: diagnostics.result.document,
          },
        ),
      );
    } catch (error) {
      checks.push(failedCheck(DOCTOR_CHECK.DIAGNOSTIC_FRESHNESS, error));
    }

    try {
      const symbols = assertToolResult(
        await client.callTool({
          name: TOOL.DOCUMENT_SYMBOLS,
          arguments: {file: fixture.component, root: fixture.workspace},
        }),
        TOOL.DOCUMENT_SYMBOLS,
      );
      const found = symbols.result.symbols.some((symbol) => symbol.name === "doctorVueValue");
      checks.push(
        check(
          DOCTOR_CHECK.VUE_SYMBOLS,
          found ? CI_STATUS.PASS : CI_STATUS.FAIL,
          found ? DOCTOR_REASON.CHECK_COMPLETED : DOCTOR_REASON.VUE_SYMBOL_NOT_FOUND,
          {symbolsFound: symbols.result.symbols.length},
        ),
      );
    } catch (error) {
      checks.push(failedCheck(DOCTOR_CHECK.VUE_SYMBOLS, error));
    }

    try {
      const definition = assertToolResult(
        await client.callTool({
          name: TOOL.DEFINITION,
          arguments: {file: fixture.component, root: fixture.workspace, line: 6, column: 4},
        }),
        TOOL.DEFINITION,
      );
      const expectedFile = await realpath(fixture.child);
      const resolvedDefinitions = await Promise.all(
        definition.result.definitions.map(async (item) => ({
          ...item,
          canonicalFile: await realpath(item.file).catch(() => path.resolve(item.file)),
        })),
      );
      const resolved =
        definition.result.definitionMatch === DEFINITION_MATCH.RESOLVED &&
        resolvedDefinitions.some((item) => item.canonicalFile === expectedFile);
      checks.push(
        check(
          DOCTOR_CHECK.VUE_TEMPLATE_DEFINITION,
          resolved ? CI_STATUS.PASS : CI_STATUS.FAIL,
          resolved ? DOCTOR_REASON.CHECK_COMPLETED : DOCTOR_REASON.VUE_TEMPLATE_DEFINITION_UNRESOLVED,
          {
            definitionMatch: definition.result.definitionMatch,
            resolutionMethod: definition.result.resolutionMethod,
            definitions: resolvedDefinitions,
            expectedFile,
          },
        ),
      );
    } catch (error) {
      checks.push(failedCheck(DOCTOR_CHECK.VUE_TEMPLATE_DEFINITION, error));
    }
  } finally {
    await client.close().catch(() => undefined);
    await rm(fixture.workspace, {
      recursive: true,
      force: true,
      maxRetries: FIXTURE_CLEANUP.MAXIMUM_RETRIES,
      retryDelay: FIXTURE_CLEANUP.RETRY_DELAY_MILLISECONDS,
    });
  }

  return doctorResult(packageRoot, checks, runtime);
}
