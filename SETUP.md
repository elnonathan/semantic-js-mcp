# Setup

This guide provides one setup procedure for both people and coding agents. For
a new installation, complete Guards, Prerequisites, Choose A Version, one
installation route, and Verify The Installation in that order.

For an update, rollback, removal, or source checkout, go directly to the named
section and follow its references to the shared verification steps.

## Guards

Setup changes software or MCP configuration on the user's machine. Before
making a change, confirm all of the following:

1. The user explicitly requested the setup operation.
2. Choose exactly one installation route. Use the Codex route for Codex and the
   generic stdio route for another compatible MCP host.
3. Keep the package out of the current project's dependencies.
   Do not run `npm install semantic-js-mcp` without `--global`.
4. Inspect existing MCP configuration before editing it, and preserve every
   unrelated server and setting.
5. Obtain any approval required for network access, global installation,
   configuration changes, cleanup, or restart.
6. Respect the security policy and configuration schema of the operating
   system, organization, repository, and MCP host.

If a guard cannot be satisfied, stop and report `blocked` with the specific
reason. Do not continue from a failed command, a partial installation, or an
unknown configuration format.

Setup does not authorize source-code analysis. No source-code call is required
to verify installation unless the user separately requests a functional test.

## Prerequisites

Run:

```bash
node --version
rg --version
```

Both commands must succeed. Semantic JS MCP requires Node.js 22 or newer and
`rg` (ripgrep) on `PATH`.

If either prerequisite is missing, report `blocked`. Installing, replacing, or
downgrading Node.js or ripgrep is a separate system change and requires the
user's approval.

## Choose A Version

When the supplied npm URL ends in `/v/X.Y.Z`, use that exact numeric version.
For example, `/v/0.10.2` requests version `0.10.2`.

When no version is supplied for an installation or update, run:

```bash
npm view semantic-js-mcp version
```

Record the returned numeric version. Commands in this guide use `X.Y.Z` as a
placeholder; replace it before execution. A command containing the literal
`X.Y.Z` is not ready to run.

Do not silently substitute `latest`, an installed version, or a newer version
for the version the user requested.

## Install With Codex

Use this route when Codex is the MCP host. The plugin supplies both the MCP
server configuration and the semantic-navigation skill, so a separate global
npm installation is unnecessary.

### 1. Inspect Codex State

Run:

```bash
codex --version
codex plugin marketplace list
codex plugin list
```

Codex CLI must be version 0.144.4 or newer. The two list commands establish
whether the marketplace or plugin already exists. There is no need to locate
or edit a Codex configuration file.

If the Codex version is too old, report `blocked`.

### 2. Add Or Refresh The Marketplace

If marketplace `elnonathan` is absent, run:

```bash
codex plugin marketplace add elnonathan/semantic-js-mcp
```

If marketplace `elnonathan` is already present, refresh it instead:

```bash
codex plugin marketplace upgrade elnonathan
```

### 3. Confirm The Offered Version

Run:

```bash
codex plugin list
```

Find `semantic-js-mcp@elnonathan` and confirm that its offered version matches
the version recorded in Choose A Version. If it differs, report `blocked`
instead of installing a different release.

### 4. Install The Plugin

Run:

```bash
codex plugin add semantic-js-mcp@elnonathan
codex plugin list
```

The final list must show `semantic-js-mcp@elnonathan` as `installed, enabled`
at the requested version.

Do not also run `npm install` or `semantic-js-mcp doctor` for this route. The
plugin owns the package and server configuration.

### 5. Restart Codex

Start a new Codex session so it can load the plugin. A coding agent cannot
restart its own active session; in that case, report `pending-restart` and ask
the user to start the new session.

After restart, continue with Verify The Installation.

## Install With Another MCP Host

Use this route only when the application is not Codex and its official
documentation confirms support for local MCP servers over `stdio`.

### 1. Confirm The Host Configuration

Before installing the package:

1. identify the MCP host by name;
2. find its documented MCP configuration location and schema;
3. inspect the existing configuration;
4. record any existing Semantic JS MCP entry; and
5. preserve every unrelated entry.

If the host, stdio support, configuration location, or schema cannot be
confirmed, report `blocked`. Configuration formats are host-specific, so do
not copy a filename, JSON shape, URL, or port from another application.

### 2. Install The Exact Global Version

Replace `X.Y.Z` with the recorded version, then run:

```bash
npm install --global semantic-js-mcp@X.Y.Z
```

Read the complete npm output. A zero exit code is not sufficient when npm also
reports a permission or extraction problem.
Treat `EPERM`, `EACCES`, `TAR_ENTRY_ERROR`, or a missing-file error as a partial installation.

Do not edit the host configuration after a partial installation. Remove the
partial global package only with the user's approval, then report `blocked`
with the npm error.

### 3. Check The Executable

Run:

```bash
semantic-js-mcp --version
semantic-js-mcp doctor
```

The version must exactly match the requested version. Interpret the structured
doctor status as follows:

- `pass`: continue;
- `untrusted`: continue, but preserve the reported uncertainty;
- `blocked` or `fail`: do not configure the host until the reported problem is
  corrected with the user's approval.

### 4. Register The Server

Using the host's documented schema, add one server with these values:

- server name: `semanticjsmcp`
- transport: `stdio`
- executable or command: `semantic-js-mcp`
- arguments: one argument, `serve`
- enabled: `true`, only when the host schema defines an enabled field

Save the smallest possible configuration change and preserve every unrelated
entry. Do not add a URL, port, shell command, credentials, or background
service.

Do not start `semantic-js-mcp serve` manually. The MCP host must start the
process and communicate with it through standard input and standard output.

### 5. Restart The Host

Restart or reload the host exactly as its documentation requires, then continue
with Verify The Installation.

## Verify The Installation

Verification occurs after the required restart or reload.

### Codex

1. Run `codex plugin list`.
2. Confirm that `semantic-js-mcp@elnonathan` is `installed, enabled` at the
   requested version.
3. Open the MCP tool list in the new Codex session.

### Another MCP Host

Run:

```bash
semantic-js-mcp --version
semantic-js-mcp doctor
```

The version must match. Doctor must return `pass` or `untrusted`; preserve any
uncertainty reported by `untrusted`.

Confirm that the host still contains the `semanticjsmcp` entry, then open the
host's MCP tool list.

### Expected Result

The host must expose tools whose base names begin with `lsp_`. Some hosts add
the server name as a prefix.

Use one of these outcomes:

- `success`: the requested version is registered and `lsp_*` tools are
  available;
- `pending-restart`: installation and configuration succeeded, but a new host
  session is still required to check tool discovery;
- `blocked`: a prerequisite, installation, configuration, doctor, version, or
  tool-discovery check failed.

Package installation or configuration text by itself is not `success`. Missing
tools are a reason to inspect registration and restart state, not to start the
server manually.

An installation-only request ends after tool discovery. Do not call an `lsp_*`
tool against source code unless the user separately requests a functional test
or explicitly approves the target file.

Report the outcome, detected host, requested and installed versions, changed
Semantic JS MCP entry, doctor status for a generic installation, tool-discovery
result, and any remaining blocker or uncertainty. Do not expose credentials or
unrelated configuration values.

## Troubleshooting

| Symptom                                                             | Action                                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Node.js is older than 22 or `node` is missing                       | Report `blocked`. Change Node.js only with separate user approval.                                                    |
| `rg` is missing                                                     | Report `blocked`. Install ripgrep only with separate user approval.                                                   |
| npm reports `EPERM`, `EACCES`, `TAR_ENTRY_ERROR`, or a missing file | Treat the installation as partial. Do not configure the host. Remove only the partial global package when authorized. |
| `semantic-js-mcp --version` differs from the requested version      | Report `blocked`; do not configure the different version.                                                             |
| Doctor returns `blocked` or `fail`                                  | Correct only the reported prerequisite and only with user approval.                                                   |
| Codex offers the wrong version                                      | Run `codex plugin marketplace upgrade elnonathan`, check again, and report `blocked` if it still differs.             |
| The host does not show `lsp_*` tools                                | Confirm the saved entry, command, arguments, enabled state, and required restart. Do not invent a URL or port.        |
| The host configuration location or schema is unknown                | Use installed help or official host documentation. Report `blocked` rather than guessing.                             |

Troubleshooting never requires disabling a security control, bypassing a
sandbox, executing a remote shell pipeline, or replacing an entire
configuration file.

## Update

Record the installed version and existing Semantic JS MCP entry first. Resolve
the exact target version with Choose A Version.

For Codex, run:

```bash
codex plugin marketplace upgrade elnonathan
codex plugin list
codex plugin add semantic-js-mcp@elnonathan
codex plugin list
```

Confirm the offered version before `plugin add`. Start a new Codex session,
then complete Verify The Installation.

For another host, replace `X.Y.Z` and run:

```bash
npm install --global semantic-js-mcp@X.Y.Z
```

Repeat the executable check, doctor, required restart, and Verify The
Installation. Keep an existing host entry when it is already correct.

## Rollback

Record the previously known working version and Semantic JS MCP entry. Do not
replace that version with the current registry version.

For another host, replace `X.Y.Z` with the previous numeric version:

```bash
npm install --global semantic-js-mcp@X.Y.Z
```

Restore only the recorded Semantic JS MCP entry. Restart the host and complete
Verify The Installation.

A Codex marketplace can install only the version it currently offers. If it
does not offer the requested rollback version, report `blocked`; do not
substitute another version or edit the marketplace cache.

## Removal

Record the installed version and current Semantic JS MCP entry before making a
change.

For Codex, run:

```bash
codex plugin remove semantic-js-mcp@elnonathan
```

Remove marketplace `elnonathan` only when no other installed plugin uses it
and the user approves:

```bash
codex plugin marketplace remove elnonathan
```

For another host:

1. Remove only the `semanticjsmcp` entry from the documented host
   configuration.
2. Preserve every unrelated server and setting.
3. Run:

```bash
npm uninstall --global semantic-js-mcp
```

Restart or reload the host. Confirm that Semantic JS MCP tools are no longer
registered.

## Source Checkout

Use this section for repository development or when the user explicitly asks
to run a source checkout. Do not combine it with a registry or Codex plugin
installation.

From the repository root, run:

```bash
npm ci
npm run check:runtime
npm run doctor
```

For a non-Codex host that supports direct stdio commands, use its documented
schema and these values:

- server name: `semanticjsmcp`
- transport: `stdio`
- executable or command: `node`
- arguments: the absolute path to the checkout's `server.mjs`

Preserve every unrelated host entry. Restart or reload the host and complete
the source-checkout verification below. Do not run the global executable checks
for this route.

After restart, confirm that the host still contains the `semanticjsmcp` entry
with the recorded `node` command and absolute `server.mjs` argument. Open the
host's MCP tool list and apply the outcomes under
[Expected Result](#expected-result). Do not call an `lsp_*` tool unless the
user separately requests a functional test or explicitly approves the target
file.

The repository's `.mcp.json` is the relative-path configuration bundled by the
Codex plugin. It is not a universal configuration file for other MCP hosts.

## Background

An MCP host is the application that starts the server and exposes its tools.
Installing an npm package places files and an executable on the machine, but it
does not register that executable with an MCP host.

A generic stdio host starts `semantic-js-mcp serve` as a child process and
communicates through standard input and standard output. The host owns that
process lifecycle, which is why manually starting the command does not make
tools appear in the host.

The Codex plugin route supplies both MCP configuration and the
semantic-navigation skill. Codex plugin state and tool discovery verify that
route, so it does not need a separate global npm installation or doctor run.

This procedure does not override system, developer, organization, repository,
or host security policy. Its authority is limited to the requested Semantic JS
MCP operation and never includes unrelated configuration, credentials, or
source-code analysis.
