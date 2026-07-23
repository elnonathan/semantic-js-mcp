# Setup Instructions

Use these instructions one numbered step at a time. Do not skip a step. Each
step says where to continue or when to stop.

## Guards

### 1. Start Here

Keep this execution contract for the entire procedure:

- one requested operation;
- one recorded host route;
- one host application name when generic configuration requires it;
- one recorded server source when maintaining an existing installation;
- one numbered step at a time;
- one command or configuration action before waiting for its complete result;
  and
- no success report until the configured host application shows Semantic JS
  MCP tools whose names start with `lsp_`, such as `lsp_document_symbols`.

Use the language of the user's latest message for explanations, questions,
expected results, stop conditions, and the final report. Keep commands,
identifiers, status values, and pasted output unchanged. Do not switch the
surrounding prose to English merely because this procedure is written in
English.

Do not replace the recorded host route because another
application, executable, plugin system, or package manager is available.

Complete Sections 1.1 through 1.4 before invoking any terminal, filesystem, package-manager, or host tool.

Until Section 1.4 records the command runner, do not inspect installations,
plugins, source checkouts, configuration files, executable paths, or package
state. Reading this procedure is not permission to inspect the user's machine.

#### 1.1 Identify The Requested Operation

Choose the operation the user requested:

- Record exactly one operation: `new installation`.
- Record exactly one operation: `verification`.
- Record exactly one operation: `update`.
- Record exactly one operation: `rollback`.
- Record exactly one operation: `removal`.
- Record exactly one operation: `source checkout`.
- If the request is unclear, ask one question and wait for the answer.
- After recording the operation, continue at Section 1.2.

Do not perform a different operation because it seems useful.

Recording `new installation`, `verification`, `update`, `rollback`, `removal`, or `source checkout` does not authorize a tool call.

After recording the operation, do not inspect anything. Continue directly at
Section 1.2.

#### 1.2 Record The Host Route

Record exactly one host route:

- `Codex direct`;
- `Claude Code direct`;
- `generic stdio`; or
- `no host`.

The host application and the host route are different facts. The host
application is the program that will load the MCP server. The host route says
whether this procedure has a documented direct integration for that
application.

The server source is a third fact. It records how the host obtains Semantic JS
MCP:

- `Codex plugin`;
- `Claude Code plugin`;
- `global npm package`; or
- `source checkout`.

The host route does not identify the server source. A `generic stdio` host may
start either the global executable or `server.mjs` from a source checkout.

The application running the agent can also be the MCP host. Do not reject the
current application as a host merely because its name also identifies the
agent or command-line interface. For example, an agent running in
Factory/Droid may record `Factory/Droid` as the host application and
`generic stdio` as the host route.

Use a direct integration only after positive evidence identifies the application running this setup session.

For an agent, positive evidence is an explicit host identity supplied by the
session's system instructions, host interface, or dedicated integration. For a
person following this file without an agent, positive evidence is the coding
application that person is currently configuring and will restart. A web
browser or text viewer used only to read this file is not the host.

Apply these decisions in order:

1. If the operation is `source checkout` and no host registration was
   requested, record `no host`.
2. Otherwise, if positive evidence identifies Codex as the application running
   this setup session, record `Codex direct`.
3. Otherwise, if positive evidence identifies Claude Code as the application
   running this setup session, record `Claude Code direct`.
4. Otherwise, record `generic stdio`.

If no documented direct integration is positively identified, record `generic stdio` and continue without asking the user to identify the agent.

After recording `generic stdio`, choose the target host in this order:

1. If the user already named the application to configure, record that exact
   application and continue.
2. Otherwise, if positive session evidence identifies the application running
   the current session, recommend that application as the target host.
3. Otherwise, ask for the application name because no target can be
   identified.

When recommending the current application, state:

> Recommended target host: `<application>` using `generic stdio`. Confirm this
> target, or name a different application.

Wait for the answer. If the user confirms, record the recommended application.
If the user names another application, record that application instead. This
choice changes the target host, not the recorded `generic stdio` route.

Do not repeatedly ask for the application name after positive session evidence already identifies it. If the user asks who or what is running the session,
state both facts: the agent or interface identity and the application that is
the recommended MCP host.

Do not present direct integrations as a menu. Do not ask the user to choose
between Codex and another route. Do not infer a host from the model provider,
model name, installed programs, executable files, or a command that happens to
run successfully. Available MCP tools may corroborate that the already
identified current application loaded a server; they do not identify the
application by themselves.

The presence of an installed host executable is not positive host evidence.
The output of `codex --version`, `codex plugin marketplace list`, or
`codex plugin list` proves only that the Codex CLI can be inspected. It does
not authorize the `Codex direct` route.

Codex and Claude Code are the direct integrations documented in this version. A
future direct integration must define its own positive host evidence and
recorded route. Until then, every session without positive Codex or Claude Code
evidence uses `generic stdio`.

Continue at Section 1.3.

#### 1.3 Choose One Host Route

Choose exactly one installation route.

Apply that choice to a new installation.

For a new installation, record the server source from the selected path:

- `Codex direct` uses `Codex plugin`;
- `Claude Code direct` uses `Claude Code plugin`;
- `generic stdio` uses `global npm package`; and
- the `source checkout` operation uses `source checkout`.

For verification, update, rollback, or removal, do not infer the server source
from the host route. If the request already identifies it, record it. Otherwise,
inspect only the recorded Semantic JS MCP host entry after Section 1.4 records
the command runner. Record `global npm package` only when the entry launches
`semantic-js-mcp serve`. Record `source checkout` only when it launches `node`
with an absolute path to that checkout's `server.mjs`. A Codex plugin entry uses
`Codex plugin`. If the source cannot be confirmed, stop and report `blocked`.

Do not uninstall the global package merely because the host route is `generic
stdio`.

For verification, inspect only the recorded host entry and server source, then
continue at Section 7.
Do not install, update, remove, or reconfigure anything.

For an update, rollback, or removal, continue only with the recorded host route
and server source for the existing installation.

Do not inspect, modify, or remove an installation from another host route or
server source.

- If the operation is `source checkout` and the recorded host route is
  `Codex direct`,
  stop and report `blocked`. Source checkout registration is not supported by the Codex plugin route.
- If the operation is `source checkout` and the recorded host route is
  `no host`, use Section 12.
- If the operation is `source checkout` and the recorded host route is
  `generic stdio`, use Section 12.
- If the operation is `verification`, use Section 7.
- If the recorded host route is `Codex direct`, use Section 4.
- If the recorded host route is `Claude Code direct`, use Section 5.
- If the recorded host route is `generic stdio`, use Section 6.

Do not combine the Codex, generic package, and source checkout routes.

Do not run `npm install semantic-js-mcp` without `--global`.

Do not use `npx`, `npm exec`, `@latest`, or an npm cache as an installation route.

Before using the selected route, continue at Section 1.4.

#### 1.4 Decide Who Will Run Commands

Use these rules. Do not choose a different command runner.

- When the recorded host route is `Codex direct`, the agent may run the
  read-only checks in Sections 2 and 3 and the official `codex plugin` commands
  in Section 4. It must not install a global package or edit Codex
  configuration another way. If a command is blocked, the user must run it.
- When the recorded host route is `generic stdio`, the user must run every
  terminal command and every configuration action. The agent must provide one
  command or action and wait for the complete result.
- For a source checkout with no host registration, the agent may run commands
  inside the repository when its rules allow them.

The presence of a shell or command-execution tool does not allow the agent to
install a global package, run doctor, modify host configuration, or test
whether its sandbox permits those actions.

When the recorded host route is `generic stdio`, record `user` as the command runner.

Keep the user as command runner even for apparently harmless checks such as
`node --version`, `rg --version`, and `semantic-js-mcp --version`. These commands
have low side-effect risk, but they are not sandbox-neutral evidence:
the agent may observe a different `PATH`, Node version manager, global package
prefix, or installation from the user's normal terminal. `semantic-js-mcp
doctor` also starts provider processes and uses temporary directories, so the
user must run it for the generic route.

Do not invoke any tool that reads or changes the user's local machine.
This includes terminal, filesystem, package-manager, process, host-configuration,
and source-search tools. The agent must not perform even read-only local checks.

Do not inspect Codex, another direct integration, a global package, a source
checkout, or a host configuration on behalf of the user. Give the user the one
command or configuration action required by the current numbered step and wait
for the complete result.

When the recorded host route is `generic stdio`, do not change `HOME`,
`TMPDIR`, the npm prefix, the npm cache, the working directory, or the
installation directory to make a command run inside the agent. The user must
run the command in a normal terminal instead.

Once the user is required to run commands, the agent must not retry the same
operation inside its sandbox.

Continue at Section 1.5.

#### 1.5 Build One Command

Before running a command or giving it to the user, confirm all of these facts:

- the requested operation;
- the recorded host route;
- the host application name, when the generic route requires it;
- the server source, when the current operation requires it and it is already
  known;
- the operating system and shell;
- the exact numeric package version, when already resolved;
- the current numbered step; and
- who will run the command.

The command must:

- perform one action;
- match the confirmed operating system and shell;
- contain no unresolved placeholder;
- quote a path when the shell requires it;
- modify only Semantic JS MCP or its recorded host entry; and
- use an official host command when one exists.

Do not join commands with `&&` or `;`. Do not shorten output with a pipe such
as `| head`. Do not use `sudo`, `chmod`, or `chown` to bypass a security or
sandbox restriction. Do not replace an entire configuration file.

When the user will run the command, present:

1. the current section number;
2. one sentence explaining the command;
3. one command in a code block;
4. the expected successful result;
5. the result that requires stopping; and
6. a request for the complete output.

Wait for the user's response before building another command.

Continue at Section 1.6.

#### 1.6 Evaluate One Result

Read the complete output of the command. Do not use only its exit code.

- Apply the success and failure conditions written in the current step before
  using a command's exit code. For example, doctor may report `untrusted` with
  a nonzero exit code and still allow the next documented step.
- If the step's success condition is met and no unhandled error is present,
  continue to the next numbered step.
- If the output is incomplete, ask for the complete output and wait.
- If an agent-run command was blocked by its sandbox, continue at Section 8.2.
- If another command failed, the configuration format is unknown, or
  installation is incomplete, stop and report `blocked`.
- If a step says to obtain approval, wait for that approval.

A later successful command does not erase an earlier incomplete installation.
Only the cleanup and clean reinstall described in Section 8.1 can clear it.

Setup changes software or MCP configuration on the user's machine. Inspect
existing MCP configuration before editing it, preserve every unrelated server
and setting, and obtain approval for global installation, configuration,
cleanup, or restart when the execution environment requires it.

Setup does not authorize source-code analysis. No source-code call is required
to verify installation unless the user separately requests a functional test.

- For a new installation, continue at Section 2.
- For verification, continue at Section 7.
- For an update, continue at Section 9.
- For a rollback, continue at Section 10.
- For removal, continue at Section 11.
- For a source checkout, continue at Section 12.

## Prerequisites

### 2. Check The Required Programs

When the recorded host route is `Codex direct`, the agent may run each
read-only check in this section. If a check is blocked, ask the user to run that
one command and wait for the complete output.

When the recorded host route is `generic stdio`, ask the user to run Section
2.1 and wait for the complete output. Then ask the user to run Section 2.2 and
wait again. Do not run these commands inside the agent.

#### 2.1 Check Node.js

Run:

```bash
node --version
```

- If the command reports Node.js 22 or newer, continue at Section 2.2.
- If it is missing or older than 22, stop and report `blocked`.

Installing, replacing, or downgrading Node.js is a separate system change and
requires the user's approval.

#### 2.2 Check Ripgrep

Run:

```bash
rg --version
```

- If the command succeeds, continue at Section 3.
- If it fails, stop and report `blocked`.

Installing ripgrep is a separate system change and requires the user's
approval.

## Choose A Version

### 3. Resolve The Exact Version

#### 3.1 Check The Supplied URL

If the supplied npm URL ends in `/v/X.Y.Z`, record that numeric version. For
example, `/v/1.2.3` requests version `1.2.3`. Continue at Section 3.3.

If the URL does not contain a numeric version, continue at Section 3.2.

#### 3.2 Read The Current Registry Version

When the recorded host route is `Codex direct`, the agent may run this
read-only command. If it is blocked, ask the user to run it and wait for the
complete output.

When the recorded host route is `generic stdio`, ask the user to run this
command and wait for its complete output. Do not run it inside the agent.

Run:

```bash
npm view semantic-js-mcp version
```

- If the command returns one numeric version, record it and continue at
  Section 3.3.
- If the command fails or the result is unclear, stop and report `blocked`.

Do not silently substitute `latest`, an installed version, or a newer version.

#### 3.3 Choose The Next Section

- For an update, return to Section 9.2.
- If the recorded host route is `Codex direct`, continue at Section 4.
- If the recorded host route is `generic stdio`, continue at Section 6.

## Install With Codex

### 4. Install In Codex

Use this section only when the recorded host route is `Codex direct`. For any
other route, return to Section 1.3. The Codex plugin installs the server
configuration and the semantic-navigation skill. A global npm installation is
not needed.

#### 4.1 Check The Codex Version

Run:

```bash
codex --version
```

- If Codex CLI is version 0.144.4 or newer, continue at Section 4.2.
- Otherwise, stop and report `blocked`.

#### 4.2 Inspect The Marketplace

Run:

```bash
codex plugin marketplace list
```

Record whether marketplace `elnonathan` is present. Continue at Section 4.3.

#### 4.3 Inspect The Plugin

Run:

```bash
codex plugin list
```

Record the offered and installed Semantic JS MCP versions, when present.
Continue at Section 4.4.

#### 4.4 Add Or Refresh The Marketplace

If marketplace `elnonathan` is absent, run:

```bash
codex plugin marketplace add elnonathan/semantic-js-mcp
```

If marketplace `elnonathan` is present, run instead:

```bash
codex plugin marketplace upgrade elnonathan
```

- If the selected command succeeds, continue at Section 4.5.
- If it fails, stop and report `blocked`.

#### 4.5 Confirm The Offered Version

Run:

```bash
codex plugin list
```

- If `semantic-js-mcp@elnonathan` offers the version recorded in Section 3,
  continue at Section 4.6.
- If it offers another version, stop and report `blocked`.

#### 4.6 Install The Plugin

Run:

```bash
codex plugin add semantic-js-mcp@elnonathan
```

- If the command succeeds, continue at Section 4.7.
- If it fails, stop and report `blocked`.

Do not also run `npm install` or `semantic-js-mcp doctor` for the Codex route.

#### 4.7 Confirm The Installed Plugin

Run:

```bash
codex plugin list
```

- If the requested version is `installed, enabled`, continue at Section 4.8.
- Otherwise, stop and report `blocked`.

#### 4.8 Restart Codex

The Codex plugin starts the server from the installed plugin directory, not
from the active repository. Before starting Codex, set
`SEMANTIC_JS_MCP_WORKSPACE_ROOTS` in the environment that launches Codex to the
absolute repository roots the server may analyze. Separate multiple roots with
`:` on POSIX or `;` on Windows. The plugin forwards this variable to the
bundled server.

For one repository on POSIX:

```bash
SEMANTIC_JS_MCP_WORKSPACE_ROOTS=/absolute/repository/root codex -C /absolute/repository/root
```

For one repository in PowerShell:

```powershell
$env:SEMANTIC_JS_MCP_WORKSPACE_ROOTS = 'C:\absolute\repository\root'
codex -C C:\absolute\repository\root
```

If Codex is started by a desktop application or IDE, configure the variable in
that launch environment before restarting the application.

Start a new Codex session. An agent cannot restart its own active session.

- If the user must start the new session, report `pending-restart` and wait.
- After the new session starts, continue at Section 7.1.

## Install With Claude Code

### 5. Install In Claude Code

Use this section only when the recorded host route is `Claude Code direct`. Claude
Code installs the server and the semantic-navigation skill together as a plugin
from the `elnonathan` marketplace; a separate global npm installation is not
needed. Update and removal use Claude Code's native `/plugin` commands.

The user runs each command. The agent provides one command, waits for the
complete result, then continues.

#### 5.1 Add The Marketplace

Ask the user to run:

```text
/plugin marketplace add elnonathan/semantic-js-mcp
```

- If the marketplace is added, continue at Section 5.2.
- If it fails, stop and report `blocked`.

#### 5.2 Install The Plugin

Ask the user to run:

```text
/plugin install semantic-js-mcp@elnonathan
```

The plugin sources the published npm package with its bundled dependencies, so it
runs offline after installation.

- If the plugin installs, continue at Section 5.3.
- If it fails, stop and report `blocked`.

#### 5.3 Restart And Verify

Claude Code advertises the MCP `roots` capability, so the server limits its
workspace boundary to the directories Claude Code exposes — the session workspace
and any directory added with `/add-dir` — and `SEMANTIC_JS_MCP_WORKSPACE_ROOTS`
is not required. Ask the user to restart Claude Code or run `/reload-plugins`.

- Until the user confirms the restart, report `pending-restart` and wait.
- After restart, continue at Section 7.

To register only the server without the skill, use the generic route in Section 6.

## Install With Another MCP Host

### 6. Install In Another MCP Host

Use this section only for the application recorded in Section 1.2.

The user runs every terminal command and configuration action in this section.
The agent provides one command or action, waits for the complete result, and
then decides whether to continue. The agent must not execute these steps
inside its own shell or sandbox.

#### 6.1 Confirm The Host Configuration

If the host application name is not already known, ask:

> I cannot identify the current host application. Which application should I configure?

Ask this only when Section 1.2 could not identify or confirm a target host.
Wait for the answer and record the exact application name. The application
name locates the generic configuration; it does not change the recorded
`generic stdio` route into a direct integration.

Before installing the package, confirm from the host's installed help or
official documentation:

- support for local MCP servers over `stdio`;
- the configuration location or official configuration command; and
- the exact configuration fields the host accepts.

When the host provides a configuration command, confirm the exact subcommand
grammar for the pending configuration action before constructing a command
that changes state. A command name is not enough to infer its argument grammar.
If the complete current help output was not already supplied, ask the user to
run the exact subcommand with `--help` and wait for that output.

Inspect the existing configuration and record any existing Semantic JS MCP
entry. Preserve every unrelated entry.

- If all facts are confirmed, continue at Section 6.2.
- If any fact is unknown, ask the user for the missing fact and wait. If it
  cannot be confirmed, stop and report `blocked`.

Give the user one read-only command or one host-supported inspection action and
wait for the complete result. Do not inspect the local configuration inside the
agent.

Do not copy a path, JSON shape, URL, or port from another application.

#### 6.2 Install The Exact Global Version

Build the command by placing the numeric version recorded in Section 3
immediately after `npm install --global semantic-js-mcp@`. Confirm that the
finished command contains that exact numeric version and no placeholder. Give
the command to the user and wait for the complete npm output. Do not run it
inside the agent.

Read the complete npm output. A zero exit code is not enough when the output
also reports a permission or extraction problem.

Treat `EPERM`, `EACCES`, `TAR_ENTRY_ERROR`, or a missing-file error as a partial installation.

- If installation completes without those errors, continue at Section 6.3.
- If installation is partial, stop. Do not run doctor and do not edit the host
  configuration. Continue at Section 8.1.

#### 6.3 Check The Installed Version

Ask the user to run:

```bash
semantic-js-mcp --version
```

Wait for the complete output.

- If it exactly matches the version recorded in Section 3, continue at
  Section 6.4.
- Otherwise, stop and continue at Section 8.5.

The version command succeeding does not prove that an earlier partial
installation became complete.

#### 6.4 Run Doctor

Ask the user to run:

```bash
semantic-js-mcp doctor
```

Wait for the complete output.

- If doctor reports `pass`, continue at Section 6.5.
- If doctor reports `untrusted`, record the reported uncertainty and continue
  at Section 6.5.
- If doctor reports `fail` or `blocked`, stop and continue at Section 8.3.

Do not shorten or filter the doctor output.

#### 6.5 Register The Server

Use only the configuration method and fields confirmed in Section 6.1. Ask the
user to add one entry with these values:

- server name: `semanticjsmcp`
- transport: `stdio`
- executable or command: `semantic-js-mcp`
- arguments: one argument, `serve`
- enabled: `true`, only if the host defines that field

Do not construct the add command unless Section 6.1 recorded its exact current
grammar. If that grammar is missing, return to Section 6.1 before showing any
state-changing command.

Change only the Semantic JS MCP entry. Do not replace the entire configuration
file. Do not add an environment variable unless the host documents that field
and a previous numbered step established why it is needed.

- Give the user one safe host-supported action and wait for the result.
- If the entry is saved and validated, continue at Section 6.6.
- If the configuration format is uncertain, stop and report `blocked`.

An added-entry message is not enough. Compare the host's reported transport,
command, and arguments with the requested values. The executable must be
exactly `semantic-js-mcp` and its only argument must be `serve`. A reported
command such as `stdio semantic-js-mcp serve` is incorrect because `stdio`
became part of the executable command.

When the host provides a status or list command, ask the user to run it before
restart and wait for the complete output. Preserve unrelated entries. If the
new entry reports `failed`, do not continue to restart. Remove only the broken
Semantic JS MCP entry using the documented method, then continue at Section
7.7.

Do not start `semantic-js-mcp serve` manually. Do not pipe JSON-RPC messages to
it, run it in the background, or start a second server to test the first one.
The configured host application must start it over standard input and standard
output.

A manually started server does not prove that the configured host application loaded the MCP tools.

#### 6.6 Restart The Host

Ask the user to restart or reload the host exactly as its documentation
requires. Wait for confirmation.

- If the host confirms that it already reloaded the entry and its MCP tool list
  contains the `lsp_` tools, treat the reload as complete and continue at
  Section 7.2.
- Until the user confirms the restart, report `pending-restart` and wait.
- After restart, continue at Section 7.2.

## Verify The Installation

### 7. Verify The Current State

For a `verification` operation, use this section without changing the existing
installation. A restart is required only when an earlier step changed the host
entry or the host requires it to refresh MCP tools.

#### 7.1 Verify Codex

Use this section only when the recorded host route is `Codex direct`.

Run:

```bash
codex plugin list
```

Confirm that `semantic-js-mcp@elnonathan` is `installed, enabled` at the
requested version. Open the MCP tool list in the new Codex session.

- If tools whose names start with `lsp_` are present, continue at
  Section 7.3.
- If they are absent, continue at Section 8.7.

#### 7.2 Verify Another MCP Host

Use this section only when the recorded host route is `generic stdio`.

First confirm the recorded Semantic JS MCP host entry and use its command and
arguments to record the server source.

If the server source is `global npm package`, ask the user to run these as
separate steps. Wait for and evaluate each complete result before giving the
next command:

```bash
semantic-js-mcp --version
```

```bash
semantic-js-mcp doctor
```

The version must match. Doctor must report `pass` or `untrusted`.

If the server source is `source checkout`, confirm its repository root and ask
the user to run these as separate steps from that root:

```bash
npm run check:runtime
```

```bash
npm run doctor
```

The runtime check must succeed. Doctor must report `pass` or `untrusted`. Do not
run global executable checks for a source checkout.

After the checks for the recorded server source pass, confirm that the host
still contains the recorded `semanticjsmcp` entry, then open its MCP tool list.

- If tools whose names start with `lsp_` are present, continue at
  Section 7.3.
- If they are absent, continue at Section 8.7.

#### 7.3 Report The Result

Use exactly one outcome:

- `success`: the requested version is registered and the `lsp_` tools are
  available;
- `pending-restart`: installation and configuration succeeded, but a new host
  session is still needed; or
- `blocked`: a prerequisite, installation, configuration, doctor, version, or
  tool check failed.

Package installation by itself is not `success`.

Report the recorded host route, configured host application, requested version,
installed version, changed Semantic JS MCP entry, doctor status for a generic
host, tool result, and any remaining problem. Do not expose credentials or
unrelated configuration.

An installation-only request ends here. Do not call an `lsp_` tool against
source code unless the user separately requests a functional test.

#### 7.4 Run An Optional Functional Test

Use this section only after Section 7.3 reports `success` and the user
separately requests a source-code test.

Confirm one repository root and one JavaScript, TypeScript, JSX, TSX, or Vue
source file. Use `lsp_document_symbols` on that file as the first functional
test. Do not start with the user's home directory, a parent containing multiple
repositories, or `lsp_workspace_symbols` with a common query such as `app` or
`test`.

The chosen file must lie inside the server's workspace boundary — the directory
the server was started in or the package root. For the Codex plugin, Section
4.8 requires the repository root in `SEMANTIC_JS_MCP_WORKSPACE_ROOTS`. A
`PATH_OUTSIDE_WORKSPACE_BOUNDARY` error means the path is outside that
boundary; add its root to the variable in the server's environment, restart
the host, and retry.

A result limit may reduce presentation without reducing collection work. Keep
the first test narrow by selecting one file, not by applying a small result
limit to a broad workspace query. Report the literal collection status and any
error or uncertainty.

## Troubleshooting

### 8. When Something Goes Wrong

Troubleshooting identifies the next safe step. It does not authorize bypassing
a security control or ignoring an earlier error.

#### 8.1 If npm Shows A Permission Or Extraction Error

This includes `EPERM`, `EACCES`, `TAR_ENTRY_ERROR`, `Operation not permitted`,
or a missing-file error.

The installation is incomplete, even if npm returned exit code `0` or the
version command works.

Stop. Do not run doctor and do not edit the host configuration.

With the user's approval, remove the incomplete global installation:

```bash
npm uninstall --global semantic-js-mcp
```

When the user must run commands, give only that command and wait for its
complete output. After removal succeeds, ask the user to run the exact
installation command from Section 6.2 outside the blocked agent. Wait for the
complete npm output again.

Only an uninstall followed by an error-free reinstall clears the incomplete
installation.

#### 8.2 If A Command Works For The User But Not For The Agent

The agent may be blocked from files or directories outside its allowed area.
This does not prove that the user's operating-system permissions are wrong.

Ask the user to run the command. Give one command, explain what it checks, and
wait for its complete output.

Do not use `sudo`, `chmod`, or `chown`. Do not ask the user to disable the
sandbox. Do not change `HOME`, `TMPDIR`, the npm prefix, the npm cache, or the
installation directory to retry inside the agent.

#### 8.3 If The Version Command Works But Doctor Fails

The executable exists, but Semantic JS MCP is not ready to register.

- If npm previously reported an error from Section 8.1, return to Section 8.1.
- Otherwise, read the complete doctor output and report the failed check.

Stop before editing the host configuration. Correct only the reported problem
and only with the user's approval.

#### 8.4 If A Temporary Directory Cannot Be Created

If the error contains a temporary path and `EPERM` or `Operation not permitted`,
the agent may be unable to write to that location.

Ask the user to run the same failing check in a normal terminal and wait for
the complete output.

Do not invent another temporary path. Use one only after the user confirms it
is writable and the host's configuration schema confirms how to provide it.

#### 8.5 If The Installed Version Is Different

Stop. Do not configure or verify the different version.

- If the recorded host route is `Codex direct`, return to Section 4.4 and
  refresh the marketplace.
- If the recorded host route is `generic stdio`, obtain approval to remove the
  incorrect global version, then return to Section 6.2 with the recorded
  numeric version.

#### 8.6 If Doctor Says Untrusted

`untrusted` means doctor completed but could not fully confirm some semantic
evidence. It is not the same as `pass`, and it is not the same as `fail`.

Continue only when installation was clean. Record the uncertainty and continue
at Section 6.5 or Section 7.2, whichever sent you here.

#### 8.7 If The MCP Tools Do Not Appear

A host status of `failed` is a failure, not an expected pre-restart state. Do
not describe it as pending restart unless current host documentation explicitly
says that its status command cannot connect before restart.

Confirm, in this order:

1. the exact add-command grammar from current help or official documentation;
2. the saved server entry;
3. the transport, command, and arguments;
4. the enabled value, if the host uses one; and
5. the required restart.

Perform and evaluate one check at a time. Do not start the server manually and
do not invent a URL or port.

#### 8.8 If A Configuration File Cannot Be Changed

Stop the attempted edit. Do not change file permissions and do not replace the
whole file.

Ask the user to use the host's official settings screen, configuration command,
or documented file format. Give the user one action and wait for the result.

#### 8.9 If Command Output Is Incomplete

Do not infer the result. Ask for the complete output without `head`, filtering,
or omitted lines. Wait before continuing.

#### 8.10 If Repeated Attempts Produce Different Errors

Stop retrying. Inspect the current installation and configuration again. Do
not assume that an earlier result still describes the machine.

Return to the numbered step that first failed and continue only after its
failure condition has been cleared.

## Update

### 9. Update An Existing Installation

#### 9.1 Record The Current State

Record the installed version, the existing Semantic JS MCP host entry, and the
server source. Preserve every unrelated setting.

Continue at Section 3 to resolve the exact target version.

#### 9.2 Follow The Recorded Host Route

- If the recorded host route is `Codex direct`, continue at Section 4.2.
  Refresh the marketplace, confirm the offered version, install, restart, and
  verify.
- If the recorded host route is `generic stdio` and the server source is
  `global npm package`, continue at Section 6.2. Keep the existing entry when
  its command and arguments are already correct.
- If the server source is `source checkout`, do not choose or change a source
  revision. Ask the user to place the checkout at the intended revision, then
  continue at Section 12.1. If that revision is unknown, report `blocked`.

Do not remove the working version before the replacement command is ready.

## Rollback

### 10. Restore A Previous Version

#### 10.1 Record The Previous Version

Use the exact numeric version that was previously known to work. Do not replace
it with the registry's current version.

#### 10.2 Follow The Host Route

- If the recorded host route is `generic stdio` and the server source is
  `global npm package`, return to Section 6.2 using the recorded previous
  version. Restore only the recorded Semantic JS MCP entry, restart, and verify.
- If the server source is `source checkout`, do not choose or change a source
  revision. Ask the user to restore the previously known working revision, then
  continue at Section 12.1. If that revision is unknown, report `blocked`.
- If the recorded host route is `Codex direct`, inspect the offered marketplace
  version. If it does not offer the requested previous version, stop and report
  `blocked`.

Do not edit the Codex marketplace cache or substitute another version.

## Removal

### 11. Remove Semantic JS MCP

#### 11.1 Record The Current State

Record the installed version, the existing Semantic JS MCP entry, and the
server source before changing anything.

Use only evidence from the recorded route. Do not inspect Codex when the route
is `generic stdio`. Do not search source directories during removal. When the
server source is `source checkout`, use the absolute `server.mjs` path from the
recorded host entry.

A similarly named file is not evidence of a Semantic JS MCP installation.

- If the recorded host route is `Codex direct`, continue at Section 11.2.
- If the recorded host route is `generic stdio`, continue at Section 11.3.

Do not use both removal routes.

#### 11.2 Remove It From Codex

Use this section only when the recorded host route is `Codex direct`. Run:

```bash
codex plugin remove semantic-js-mcp@elnonathan
```

Remove marketplace `elnonathan` only when no other plugin uses it and the user
approves:

```bash
codex plugin marketplace remove elnonathan
```

Run those commands separately. Restart Codex and confirm the tools are absent.
The removal ends here. Do not continue at Section 11.3.

#### 11.3 Remove It From Another Host

Use this section only when the recorded host route is `generic stdio`.

Before constructing a removal command, confirm the exact remove subcommand
grammar from complete current help or official documentation. If the host does
not provide a removal command, use only its documented settings or file-editing
method.

Then ask the user to remove only the recorded `semanticjsmcp` entry using that
documented method. Preserve every unrelated entry. Wait for confirmation.

If the recorded server source is `global npm package`, then ask the user to run:

```bash
npm uninstall --global semantic-js-mcp
```

Wait for the complete output.

If the recorded server source is `source checkout`, do not run the global npm
uninstall. Do not delete the checkout. Removing source files is a separate
filesystem operation and requires an explicit request.

Restart the host and confirm that Semantic JS MCP tools are absent.

## Source Checkout

### 12. Use A Source Checkout

Use this section only for repository development or when the user explicitly
requests a source checkout. Do not combine it with a registry or Codex plugin
installation.

The source checkout must already exist. If its root is not the current working
directory and the user did not provide it, ask for the root and wait. Do not
search the user's home directory or unrelated directories for a checkout.

#### 12.1 Install The Locked Dependencies

From the repository root, run:

```bash
npm ci
```

- If it succeeds without installation errors, continue at Section 12.2.
- If it fails, stop and report `blocked`.

#### 12.2 Check The Source Runtime

Run:

```bash
npm run check:runtime
```

- If it succeeds, continue at Section 12.3.
- If it fails, stop and report `blocked`.

#### 12.3 Run The Source Doctor

Run:

```bash
npm run doctor
```

- If it reports `pass` or `untrusted` and the recorded host route is
  `no host`,
  report that the source checkout is ready and stop.
- If it reports `pass` or `untrusted` and the recorded host route is
  `generic stdio`, continue at Section 12.4.
- If the recorded host route is `Codex direct`, stop and report `blocked`.
- If it reports `fail` or `blocked`, stop.

#### 12.4 Register The Source Server

For a non-Codex host that supports direct `stdio` commands, use its documented
schema and these values:

- server name: `semanticjsmcp`
- transport: `stdio`
- executable or command: `node`
- arguments: the absolute path to the checkout's `server.mjs`

Before constructing a source-checkout registration command, confirm the exact
add subcommand grammar from complete current help or official documentation.
Do not reuse grammar recorded for another application.

Preserve every unrelated host entry. Restart or reload the host. Do not run the
global executable checks for this route.

After restart, confirm the recorded `node` command and absolute `server.mjs`
argument, then open the host's MCP tool list. Apply the outcomes in Section
6.3. Do not call an `lsp_` tool unless the user separately requests a
functional test.

The repository's `.mcp.json` is used by the Codex plugin. It is not a universal
configuration file for other hosts.

## Background

### 13. Why These Steps Exist

An MCP host is the application that starts Semantic JS MCP and exposes its
tools. Installing the npm package places files and an executable on the
machine. It does not register the server with an application.

A generic host starts `semantic-js-mcp serve` and communicates with it through
standard input and standard output. The host owns that process, so starting it
manually does not make tools appear.

The Codex plugin provides both server configuration and agent instructions.
That is why the Codex route does not need a separate global npm installation.

This procedure does not override system, developer, organization, repository,
or host security policy. It is limited to the Semantic JS MCP operation the
user requested. It does not authorize unrelated configuration changes,
credentials access, or source-code analysis.
