# Security Policy

Semantic JS MCP is a read-only developer tool that starts bundled language servers and reads local source files. It must not apply workspace edits, execute repository-provided commands, require credentials, or use network access during normal local analysis.

## Security Model

The MCP client is an AI agent whose tool arguments may be influenced by untrusted content (prompt injection), and the analyzed repository may contain untrusted code. The server therefore enforces the following guarantees:

### Workspace boundary

Every `file` and `root` argument is resolved through `realpath` — so symbolic links cannot escape — and must stay inside the allowed analysis roots. By default those are the directory the server was started in and the package installation root. Requests outside the boundary fail with the `PATH_OUTSIDE_WORKSPACE_BOUNDARY` error code and never read file content. Repository discovery (walking up to find `.git` or project markers) and cross-workspace text scans are clamped to the same boundary.

Bundled language servers and tsserver processes receive an immutable snapshot
of those canonical roots through the Node.js permission model. They can read
only that snapshot and a server-owned temporary directory, and can write only
inside that temporary directory. A preload guard rejects canonical paths that
escape through symbolic links and restricts the TypeScript language server to
its one expected bundled tsserver child; all other provider child-process
creation is denied. Provider locations outside the current boundary are also
discarded before a tool result is returned.

Provider filesystem watch operations are inert on every platform. An inert
watcher never resolves the supplied path or reaches Node.js filesystem
permissions; analyzed documents are synchronized explicitly through the
provider protocol. This avoids granting broader read access merely to support
platform-specific polling watchers.

The Codex plugin enables a two-stage, host-mediated session authorization
flow. `lsp_prepare_workspace_root` canonicalizes one directory selected by the
human but does not grant access. The human must confirm the returned exact
canonical path before `lsp_authorize_workspace_root` can consume its
short-lived, one-time request. The authorization tool is annotated
security-sensitive and destructive, and the Codex plugin configures it for
`prompt`, so the model cannot approve the expansion. A successful call adds
the root only to the running MCP process. It is never written to configuration
and disappears when that process exits.

Filesystem roots, the home directory, and ancestors of the home directory
cannot be session-authorized. A mismatched, expired, or replayed preparation
fails without changing the boundary. The flow is disabled outside the Codex
plugin because a generic MCP host may not enforce the required human approval.
Conversation text, model inference, repository instructions, and a prepared
request are not authorization.

To preconfigure additional directories instead, set
`SEMANTIC_JS_MCP_WORKSPACE_ROOTS` to a path-delimiter-separated list of allowed
roots (`:` on POSIX, `;` on Windows) in the server's environment. This remains
the route for non-interactive operation and hosts without authoritative MCP
roots or the Codex human-approval boundary.

Hosts that advertise the MCP `roots` capability (for example Claude Code) report the active workspace directly. The server unions those host-provided roots into the boundary at initialization and whenever the host reports a change, so no manual variable is needed on those hosts. Authority stays with the host, not the agent, and the default stays restrictive when no roots are advertised.

The first tool call waits for the host's initial roots response. Root changes
are applied in request order: an older delayed response cannot overwrite a
newer response. Every effective boundary change closes existing providers and
invalidates reference-set caches before new analysis begins, so providers
cannot retain access granted by an earlier root snapshot.

### No execution of repository-provided code

The server always runs the TypeScript SDK bundled with this package. It does not execute `node_modules/typescript` from the analyzed repository unless `SEMANTIC_JS_MCP_ALLOW_WORKSPACE_TYPESCRIPT=1` is set explicitly, and even then discovery never walks above the workspace boundary or follows a TypeScript SDK symlink outside it. Enabling that variable explicitly trusts the selected workspace SDK as executable provider code; the filesystem restrictions are defense in depth, not a general sandbox for deliberately malicious provider code. TypeScript plugins load only from the bundled runtime probe location; local plugin loads from the analyzed repository are disabled. Language servers run with a sanitized environment (`NODE_OPTIONS`, `NODE_PATH`, and `NODE_REPL_EXTERNAL_MODULE` are removed) so inherited variables cannot inject code into child processes.

### Read-only surface

All semantic evidence tools are read-only. The session-root authorization tool
changes only the MCP process's in-memory boundary; it does not edit a file,
persist configuration, or execute repository code. It is deliberately
annotated non-read-only and destructive so Codex requires human approval. The
server rejects `workspace/applyEdit` requests from language servers, spawns
`rg` and language servers with argument arrays (never a shell), and disables
automatic typing acquisition so the TypeScript server performs no network
installs. Client-supplied search terms are passed to `rg` after a `--`
end-of-options separator so a value beginning with `-` cannot be interpreted
as a ripgrep flag (no argument injection).

### Supply chain

Runtime dependencies are pinned exactly in `package.json`, resolved from the npm registry with integrity hashes in `package-lock.json` (no git dependencies), and bundled into the published package via `bundleDependencies` so installs are deterministic. Known-vulnerable transitive versions are excluded through `overrides`. Keep `npm audit` at zero findings before every release.

This server communicates only over stdio. The `@modelcontextprotocol/sdk` dependency also carries an HTTP/SSE transport stack (for example `express`, `hono`, `cors`, `body-parser`, `qs`) as transitive dependencies. Those packages are bundled but are never imported or executed on the stdio path, so they are not reachable attack surface at runtime; they may still appear in dependency scans and SBOMs. They cannot be pruned without changes upstream in the SDK.

## Supported Versions

During pre-release development, security fixes are applied to the latest version only.

## Reporting A Vulnerability

Report vulnerabilities privately using the maintainer address in `package.json` or GitHub private vulnerability reporting when available. Do not open a public issue for an unpatched vulnerability.

Do not include repository credentials, proprietary source, access tokens, or other secrets in a report.

Include:

- semantic-js-mcp version;
- Node.js version;
- operating system;
- affected tool;
- minimal reproduction using non-sensitive source;
- observed and expected behavior.
