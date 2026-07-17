#!/usr/bin/env node

import {deepStrictEqual, strictEqual} from "node:assert";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {parse} from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowFile = path.join(root, ".github", "workflows", "publish.yml");
const workflowText = await readFile(workflowFile, "utf8");
const workflow = parse(workflowText);
const publish = workflow.jobs?.publish;
const steps = publish?.steps || [];
const setupNode = steps.find((step) => step.uses === "actions/setup-node@v6");
const commands = steps.flatMap((step) => (typeof step.run === "string" ? [step.run] : []));

deepStrictEqual(Object.keys(workflow.on || {}), ["push"], "Publish workflow must only run from tag pushes");
deepStrictEqual(workflow.on?.push?.tags, ["v*"], "Publish workflow must run only for release tags");
deepStrictEqual(
  workflow.permissions,
  {contents: "read", "id-token": "write"},
  "Publish workflow must grant only repository read and OIDC permissions",
);
strictEqual(publish?.if, "github.repository == 'elnonathan/semantic-js-mcp'", "Publishing must be restricted to the canonical repository");
strictEqual(publish?.["runs-on"], "ubuntu-latest", "Publishing must use a GitHub-hosted runner");
strictEqual(publish?.environment, "npm-publish", "Publishing must use the protected npm environment");
strictEqual(workflow.concurrency?.["cancel-in-progress"], false, "An active publication must never be cancelled by another tag");
strictEqual(setupNode?.with?.["node-version"], 24, "Publishing must use Node.js 24");
strictEqual(setupNode?.with?.["registry-url"], "https://registry.npmjs.org", "Publishing must target npmjs.org");
strictEqual(setupNode?.with?.["package-manager-cache"], false, "Release builds must not use a package-manager cache");
strictEqual(
  commands.includes("sudo apt-get update && sudo apt-get install --yes ripgrep"),
  true,
  "Publishing must install the required ripgrep executable",
);
strictEqual(commands.includes("rg --version"), true, "Publishing must verify ripgrep before the release gate");
strictEqual(commands.includes("npm install --global npm@11.17.0"), true, "Publishing must install the verified npm CLI");
strictEqual(commands.includes("npm ci"), true, "Publishing must install the locked dependency tree");
strictEqual(commands.includes("npm run release:verify"), true, "Publishing must run the complete release gate");
strictEqual(commands.includes("npm publish --access public"), true, "Publishing must use the public OIDC publish path");
strictEqual(
  commands.some((command) => command.includes("GITHUB_REF_NAME") && command.includes("package.json")),
  true,
  "Publishing must reject a tag that differs from the package version",
);
strictEqual(workflowText.includes("NODE_AUTH_TOKEN"), false, "OIDC publishing must not use an npm token");
strictEqual(workflowText.includes("secrets."), false, "OIDC publishing must not read repository secrets");

process.stdout.write(
  `${JSON.stringify(
    {
      workflow: "publish.yml",
      trigger: "release-tags",
      authentication: "oidc",
      environment: publish.environment,
      tokenSecret: "absent",
    },
    null,
    2,
  )}\n`,
);
