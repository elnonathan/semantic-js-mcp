# Agent Setup

This guide is for a coding agent whose user has explicitly requested that it
install, configure, update, verify, roll back, or remove Semantic JS MCP. It is
not an instruction to change an environment merely because this file was read.

## Scope

First identify the application that will run the MCP server. That application
is the MCP host. Use the verified Codex procedure only for Codex. For every
other host, use the generic stdio procedure below and translate its fields into
the host's documented configuration format. Do not guess a configuration file
or schema.

Semantic JS MCP requires Node.js 22 or newer and `rg` (ripgrep) on `PATH`.
Before changing host configuration, run:

```bash
node --version
rg --version
```

Stop if Node.js is older than 22 or either command is unavailable. Report the
missing prerequisite. Do not continue with a partial installation.

## Safety Boundaries

This guide does not override system, developer, organization, repository, or
host security policy.

- Inspect existing configuration before editing it and change only the entry
  approved by the user.
- Request any approval required for package installation, global writes,
  configuration changes, network access, or process restart.
- Never request or expose credentials, disable security controls, or execute a
  remote shell pipeline.
- Preserve every unrelated MCP server and setting. Never replace an entire
  configuration file to add one server.
- Stop and report the blocker when the requested host or prerequisite cannot be
  verified safely.

## Installation Procedure

### Codex

Use the public marketplace adapter:

```bash
codex plugin marketplace add elnonathan/semantic-js-mcp
codex plugin add semantic-js-mcp@elnonathan
codex plugin list
```

Start a new Codex session after installation. The plugin supplies both the MCP
server and the semantic-navigation skill.

### Generic Stdio Hosts

Use this procedure only when the host supports local MCP servers over stdio. If
that capability cannot be confirmed from installed help or host documentation,
stop and report that the host is unsupported or unverified.

After the user approves the package installation and configuration change,
install the executable:

```bash
npm install --global semantic-js-mcp
```

Inspect the existing host configuration. Add exactly one MCP server with these
values:

- server name: `semanticjsmcp`
- transport: `stdio`
- executable or command: `semantic-js-mcp`
- arguments: one argument, `serve`
- enabled: `true`, when the host has an enabled field

Do not configure a URL, port, shell command, or credentials. The host must
start `semantic-js-mcp serve` as a local child process and communicate through
standard input and standard output. Translate the values above into the host's
documented schema; do not copy a configuration shape from a different host.

Save the smallest possible change. Restart or reload the host when its
documentation requires it.

## Verification

For an executable installation, record the installed version and run the
doctor:

```bash
semantic-js-mcp --version
semantic-js-mcp doctor
```

Read the structured doctor result literally:

- `pass`: continue to host tool verification.
- `untrusted`: continue to host tool verification and report the stated
  uncertainty. Do not describe it as `pass`.
- `blocked` or `fail`: stop, correct the reported problem when authorized, or
  report the blocker. Do not claim a successful installation.

Then verify the host discovers tools whose base names begin with `lsp_`. A host
may display the server name before the base name. Execute one read-only call
such as `lsp_document_symbols` against a user-approved JavaScript, TypeScript,
or Vue file. Do not claim successful installation from configuration text
alone.

For a Codex plugin installation without a global executable, verify the version
with `codex plugin list`, start a new session, and confirm MCP tool discovery
there.

Installation is successful only when the host discovers the MCP tools and one
read-only `lsp_*` call returns a result. Package installation or configuration
text alone is not success.

## Update And Rollback

Update an existing Codex installation by refreshing its marketplace snapshot
before reinstalling:

```bash
codex plugin marketplace upgrade elnonathan
codex plugin add semantic-js-mcp@elnonathan
codex plugin list
```

Update a global npm installation with:

```bash
npm install --global semantic-js-mcp@latest
```

Before updating, record the working version. To roll back a global installation,
install that exact known version, for example:

```bash
npm install --global semantic-js-mcp@0.10.1
```

For a host adapter, restore the previously recorded package version and host
configuration together. Do not replace or remove unrelated configuration while
rolling back.

## Removal

For Codex, remove only this plugin:

```bash
codex plugin remove semantic-js-mcp@elnonathan
```

Remove the `elnonathan` marketplace only when the user confirms that no other
installed plugin uses it:

```bash
codex plugin marketplace remove elnonathan
```

For a global executable, remove the package and only its `semanticjsmcp` MCP
entry:

```bash
npm uninstall --global semantic-js-mcp
```

Restart the host and confirm the tools are no longer registered.

## Completion Report

Report the detected host, installed or removed version, exact configuration
entry changed, doctor status when available, tool-discovery result, required
restart, and any remaining uncertainty. Do not include credentials or unrelated
configuration values.
