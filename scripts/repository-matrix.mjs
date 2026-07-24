#!/usr/bin/env node

import {readFile, realpath, stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {parse as parseYaml, stringify as stringifyYaml} from "yaml";
import {z} from "zod";
import {CI_STATUS, CLI_ARGUMENT, ENVIRONMENT_VARIABLE, PACKAGE_PATH, PRODUCT, SERVER_VERSION, TOOL} from "../protocol.mjs";
import {
  REPOSITORY_MATRIX_ARGUMENT,
  REPOSITORY_MATRIX_MODE,
  REPOSITORY_MATRIX_PROBE_KIND,
  REPOSITORY_MATRIX_REASON,
  diagnosticEvaluation,
  namedSymbolEvaluation,
  repositoryMatrixExitCode,
  repositoryMatrixStatus,
} from "./repository-matrix-contract.mjs";

const identifier = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const namedSymbolProbe = z.object({
  id: identifier,
  kind: z.literal(REPOSITORY_MATRIX_PROBE_KIND.NAMED_SYMBOL),
  symbol: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
  fileHint: z.string().min(1).optional(),
});
const diagnosticProbe = z.object({
  id: identifier,
  kind: z.literal(REPOSITORY_MATRIX_PROBE_KIND.DIAGNOSTICS),
  file: z
    .string()
    .min(1)
    .refine((file) => !path.isAbsolute(file), "Diagnostic probe file must be repository-relative"),
});
const configurationSchema = z
  .object({
    repositories: z
      .array(
        z.object({
          id: identifier,
          root: z.string().min(1).refine(path.isAbsolute, "Repository root must be absolute"),
          probes: z.array(z.discriminatedUnion("kind", [namedSymbolProbe, diagnosticProbe])).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((configuration, context) => {
    const repositoryIds = new Set();
    configuration.repositories.forEach((repository, repositoryIndex) => {
      if (repositoryIds.has(repository.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Repository ids must be unique",
          path: ["repositories", repositoryIndex, "id"],
        });
      }
      repositoryIds.add(repository.id);
      const probeIds = new Set();
      repository.probes.forEach((probe, probeIndex) => {
        if (probeIds.has(probe.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Probe ids must be unique within a repository",
            path: ["repositories", repositoryIndex, "probes", probeIndex, "id"],
          });
        }
        probeIds.add(probe.id);
      });
    });
  });

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configurationFile = process.argv[REPOSITORY_MATRIX_ARGUMENT.CONFIGURATION_OFFSET];
const useYaml = process.argv.includes(CLI_ARGUMENT.YAML);

function outputResult(output) {
  process.stdout.write(useYaml ? stringifyYaml(output, {lineWidth: 0}) : `${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = output.exitCode;
}

function blockedOutput(reason, message) {
  const status = CI_STATUS.BLOCKED;
  return {
    product: {name: PRODUCT.NAME, version: SERVER_VERSION},
    mode: REPOSITORY_MATRIX_MODE,
    status,
    exitCode: repositoryMatrixExitCode(status),
    reason,
    ...(message ? {message} : {}),
    repositories: [],
  };
}

function parseConfiguration(text) {
  try {
    return JSON.parse(text);
  } catch {
    return parseYaml(text);
  }
}

function assertToolResult(response, tool) {
  if (response.isError) throw new Error(response.structuredContent?.error?.message || `${tool} failed`);
  if (response.structuredContent?.tool !== tool) throw new Error(`${tool} returned a different canonical tool name`);
  return response.structuredContent;
}

async function resolvedProbeFile(root, file) {
  const candidate = path.resolve(root, file);
  const candidateInsideRoot = candidate === root || candidate.startsWith(`${root}${path.sep}`);
  if (!candidateInsideRoot) throw new Error("Diagnostic probe file must be inside its repository root");

  const resolved = await realpath(candidate);
  const resolvedInsideRoot = resolved === root || resolved.startsWith(`${root}${path.sep}`);
  if (!resolvedInsideRoot) throw new Error("Diagnostic probe file must resolve inside its repository root");
  return resolved;
}

async function runNamedSymbolProbe(client, repository, probe) {
  const argumentsForTool = {
    root: repository.root,
    symbol: probe.symbol,
    ...(probe.fileHint ? {fileHint: probe.fileHint} : {}),
  };
  const count = assertToolResult(
    await client.callTool({name: TOOL.COUNT_NAMED_SYMBOL, arguments: argumentsForTool}),
    TOOL.COUNT_NAMED_SYMBOL,
  );
  const audit = assertToolResult(
    await client.callTool({name: TOOL.AUDIT_NAMED_SYMBOL, arguments: argumentsForTool}),
    TOOL.AUDIT_NAMED_SYMBOL,
  );
  return {
    id: probe.id,
    kind: probe.kind,
    ...namedSymbolEvaluation(count, audit),
    evidence: {
      countCollectionStatus: count.collection.status,
      auditCollectionStatus: audit.collection.status,
      definitionSelectionStatus: audit.result.definitionSelectionStatus,
      exactDefinitionsFound: audit.result.exactDefinitionsFound,
    },
  };
}

async function runDiagnosticProbe(client, repository, probe) {
  const file = await resolvedProbeFile(repository.root, probe.file);
  const diagnostics = assertToolResult(
    await client.callTool({name: TOOL.DIAGNOSTICS, arguments: {root: repository.root, file}}),
    TOOL.DIAGNOSTICS,
  );
  return {
    id: probe.id,
    kind: probe.kind,
    ...diagnosticEvaluation(diagnostics),
    evidence: {
      collectionStatus: diagnostics.collection.status,
      evidenceStatus: diagnostics.result.evidence?.status,
      diagnosticsReported: diagnostics.result.diagnosticsForCurrentDocument?.itemsReported,
    },
  };
}

async function runProbe(client, repository, probe) {
  try {
    if (probe.kind === REPOSITORY_MATRIX_PROBE_KIND.NAMED_SYMBOL) {
      return await runNamedSymbolProbe(client, repository, probe);
    }
    return await runDiagnosticProbe(client, repository, probe);
  } catch (error) {
    return {
      id: probe.id,
      kind: probe.kind,
      status: CI_STATUS.FAIL,
      reason: REPOSITORY_MATRIX_REASON.TOOL_EXECUTION_FAILED,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function prepareRepository(repository) {
  try {
    const root = await realpath(repository.root);
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) throw new Error("Repository root is not a directory");
    return {...repository, root};
  } catch (error) {
    return {
      id: repository.id,
      status: CI_STATUS.BLOCKED,
      reason: REPOSITORY_MATRIX_REASON.REPOSITORY_UNAVAILABLE,
      message: error instanceof Error ? error.message : String(error),
      probes: [],
    };
  }
}

async function loadConfiguration() {
  if (!configurationFile) return {error: blockedOutput(REPOSITORY_MATRIX_REASON.CONFIGURATION_REQUIRED)};
  try {
    const text = await readFile(configurationFile, "utf8");
    return {configuration: configurationSchema.parse(parseConfiguration(text))};
  } catch (error) {
    return {
      error: blockedOutput(REPOSITORY_MATRIX_REASON.CONFIGURATION_INVALID, error instanceof Error ? error.message : String(error)),
    };
  }
}

async function connectClient(prepared) {
  const repositories = prepared.filter((repository) => !repository.status);
  if (repositories.length === 0) return {};
  const client = new Client({name: `${PRODUCT.NAME}-repository-matrix`, version: SERVER_VERSION});
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, PACKAGE_PATH.SERVER)],
    cwd: packageRoot,
    env: {
      ...process.env,
      [ENVIRONMENT_VARIABLE.WORKSPACE_ROOTS]: repositories.map((repository) => repository.root).join(path.delimiter),
    },
  });
  try {
    await client.connect(transport);
    return {client};
  } catch (error) {
    return {client, startupError: error instanceof Error ? error.message : String(error)};
  }
}

async function runRepository(client, startupError, repository) {
  if (repository.status) return repository;
  if (startupError || !client) {
    return {
      id: repository.id,
      status: CI_STATUS.BLOCKED,
      reason: REPOSITORY_MATRIX_REASON.MCP_STARTUP_FAILED,
      message: startupError,
      probes: [],
    };
  }
  const probes = [];
  for (const probe of repository.probes) probes.push(await runProbe(client, repository, probe));
  return {
    id: repository.id,
    status: repositoryMatrixStatus(probes),
    probes,
  };
}

async function runRepositoryMatrix() {
  const loaded = await loadConfiguration();
  if (loaded.error) return loaded.error;
  const prepared = await Promise.all(loaded.configuration.repositories.map(prepareRepository));
  const {client, startupError} = await connectClient(prepared);
  const repositories = [];
  try {
    for (const repository of prepared) repositories.push(await runRepository(client, startupError, repository));
  } finally {
    try {
      await client?.close();
    } catch {
      // A completed result remains usable even when transport teardown reports an error.
    }
  }
  const status = repositoryMatrixStatus(repositories);
  return {
    product: {name: PRODUCT.NAME, version: SERVER_VERSION},
    mode: REPOSITORY_MATRIX_MODE,
    status,
    exitCode: repositoryMatrixExitCode(status),
    repositories,
  };
}

outputResult(await runRepositoryMatrix());
