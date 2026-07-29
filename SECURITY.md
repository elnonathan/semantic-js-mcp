# Security Policy

Semantic JS MCP is a read-only developer tool that starts bundled language servers and reads local source files. It must not apply workspace edits, execute repository-provided commands, require credentials, or use network access during normal local analysis.

## Security Model

The MCP client is an AI agent whose tool arguments may be influenced by untrusted content (prompt injection), and the analyzed repository may contain untrusted code. The server therefore enforces the following guarantees:

### Workspace boundary

Every `file` and `root` argument is resolved through `realpath` at validation
time and must stay inside the allowed analysis roots, so an existing symbolic
link cannot escape the boundary. By default those are the directory the server
was started in and the package installation root. Requests outside the boundary
fail with the `PATH_OUTSIDE_WORKSPACE_BOUNDARY` error code and never read file
content. Repository discovery (walking up to find `.git` or project markers)
and cross-workspace text scans are clamped to the same boundary. Each file
reported by ripgrep is independently canonicalized and re-filtered before it
can affect counts, verified references, or evidence-file metadata.

The boundary check and the later filesystem operation are not an atomic
`openat`-style path walk. A separate local process that can concurrently replace
a previously validated path component could race `realpath` and the subsequent
read. This is an accepted limitation: Node.js does not expose one portable API
that opens every path component without following links across the supported
platforms, and `O_NOFOLLOW` protects only the final component. The threat model
covers untrusted repository contents and tool arguments, not an untrusted local
actor with concurrent write access to the workspace during analysis. Analyze
only workspaces that are not being actively mutated by such a process; operating
system permissions remain the security boundary against local actors.

Bundled language servers and tsserver processes run behind two mechanisms bound
to an immutable canonical-root snapshot: an in-process preload guard, imported
into every provider, that mediates Node's filesystem and child-process APIs in
JavaScript; and, where it is active, the Node.js permission model, which also
restricts filesystem access in the runtime. For the APIs they mediate, these
mechanisms permit reads only within that snapshot and a server-owned temporary
directory, permit writes only inside that temporary directory, reject canonical
paths that escape through symbolic links, restrict the TypeScript language
server to its one expected bundled tsserver child, and deny all other provider
child-process creation. That one fork is rebuilt from a pre-provider executable,
working directory, root, environment, and (where active) permission snapshot;
caller-supplied `execPath`, environment, and unsupported stdio are refused, and
direct `ChildProcess.prototype.spawn` and `process.execve` calls are denied.
Provider locations outside the current boundary are also discarded before a
tool result is returned.

On macOS and Linux both mechanisms apply. Beyond the JavaScript guard, the
permission model also refuses filesystem access from routes the guard cannot
patch — a Worker thread with a fresh `fs`, a native addon, WASI, or
`process.binding` — which the guard alone cannot stop. Node documents the
permission model as a hardening measure for trusted code rather than a complete
sandbox, so it raises the bar substantially without being an absolute guarantee
against a fully compromised process. On Windows the permission model is currently
disabled for providers because it rejects some tsserver reads whose Windows path
form differs from the granted roots, which breaks navigation, so the preload
guard is the sole layer there. The guard mediates the filesystem and
child-process APIs it patches, which is sufficient for the trusted, pinned,
bundled providers' normal operation, but it is not a sandbox for a compromised
provider: arbitrary provider code could bypass it through those same Worker,
native-addon, WASI, or `process.binding` routes. On Windows, provider-execution
safety therefore rests on the bundled, version-pinned providers being trusted
(and on the workspace TypeScript SDK remaining an explicit, opt-in trust
decision). Restoring the permission model on Windows is the priority follow-up;
the internal `SEMANTIC_JS_MCP_INTERNAL_WINDOWS_PROVIDER_PERMISSION` and
`SEMANTIC_JS_MCP_INTERNAL_PROVIDER_PERMISSION_TRACE` toggles exist to reproduce
and diagnose that mismatch on a Windows host, and the trace prints full paths.

Provider filesystem watch operations never widen the read roots. They remain
inert on macOS and Linux. On Windows, where TypeScript uses polling watchers,
the guard delegates a real watch only after the path resolves inside the
immutable provider root snapshot. Lexically outside paths and canonical
symlink escapes return inert handles without reaching the watch API; a Node.js
filesystem-permission mismatch, including one encountered during canonical
resolution, also degrades to an inert handle. Workspace
boundary and provider-location comparisons use case-insensitive file identity
on Windows. Workspace permission arguments include case variants only on
Windows; macOS and Linux receive each canonical workspace root exactly as
resolved. The server-owned macOS temporary directory additionally receives the
read-path case variants required by the language server's
filesystem-sensitivity probe.

The Codex plugin enables a two-stage, host-mediated session authorization
flow. `lsp_prepare_workspace_root` canonicalizes one directory selected by the
human but does not grant access. The human must confirm the returned exact
canonical path before `lsp_authorize_workspace_root` can consume its
short-lived, one-time request. The authorization tool is annotated
security-sensitive and destructive, and the Codex plugin configures it for
`prompt`, so the model cannot approve the expansion. A successful call adds
the root only to the running MCP process. It is never written to configuration
and disappears when that process exits.

Filesystem roots, the home directory, ancestors of the home directory,
temporary roots, and protected system directories cannot be
session-authorized. If the server cannot canonicalize the home or protected
system boundary, authorization fails closed. A mismatched, expired, or
replayed preparation fails without changing the boundary. The flow is disabled
outside the Codex plugin because a generic MCP host may not enforce the
required human approval. Conversation text, model inference, repository
instructions, and a prepared request are not authorization.

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

The server always runs the TypeScript SDK bundled with this package. It does not execute `node_modules/typescript` from the analyzed repository unless `SEMANTIC_JS_MCP_ALLOW_WORKSPACE_TYPESCRIPT=1` is set explicitly, and even then discovery never walks above the workspace boundary or follows a TypeScript SDK symlink outside it. Enabling that variable explicitly trusts the selected workspace SDK as executable provider code; the filesystem restrictions are defense in depth, not a general sandbox for deliberately malicious provider code. TypeScript plugins load only from the bundled runtime probe location; local plugin loads from the analyzed repository are disabled. Spawned processes receive a sanitized environment: Node code-loading, TLS/CA, ICU, native-loader, and output-path variables such as `NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_ICU_DATA`, `LD_PRELOAD`, and `DYLD_INSERT_LIBRARIES` are removed before launch.

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

The self-contained tarball deliberately preserves the files published by each
bundled dependency, including upstream tests and fixtures. Those inert files
increase artifact size and package-scanner surface, but Semantic JS MCP does not
import or execute them. The release does not rewrite dependency packages to
prune them because doing so could remove resources that a dependency resolves
dynamically and would replace the registry artifact with a locally modified
tree. Exact package-surface inspection and `npm audit` cover the resulting
distribution tradeoff before release.

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
