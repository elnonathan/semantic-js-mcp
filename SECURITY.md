# Security Policy

Semantic JS MCP is a read-only developer tool that starts bundled language servers and reads local source files. It must not apply workspace edits, execute repository-provided commands, require credentials, or use network access during normal local analysis.

## Security Model

The MCP client is an AI agent whose tool arguments may be influenced by untrusted content (prompt injection), and the analyzed repository may contain untrusted code. The server therefore enforces the following guarantees:

### Workspace boundary

Every `file` and `root` argument is resolved through `realpath` — so symbolic links cannot escape — and must stay inside the allowed analysis roots. By default those are the directory the server was started in and the package installation root. Requests outside the boundary fail with the `PATH_OUTSIDE_WORKSPACE_BOUNDARY` error code and never read file content. Repository discovery (walking up to find `.git` or project markers) and cross-workspace text scans are clamped to the same boundary.

To analyze additional directories, set `SEMANTIC_JS_MCP_WORKSPACE_ROOTS` to a path-delimiter-separated list of allowed roots (`:` on POSIX, `;` on Windows) in the server's environment. The Codex plugin starts the server from its installed package directory, so repositories are outside its default boundary. Codex users must set this variable in Codex's environment before starting a session; the plugin forwards it to the bundled server.

Hosts that advertise the MCP `roots` capability (for example Claude Code) report the active workspace directly. The server unions those host-provided roots into the boundary at initialization and whenever the host reports a change, so no manual variable is needed on those hosts. Authority stays with the host, not the agent, and the default stays restrictive when no roots are advertised.

### No execution of repository-provided code

The server always runs the TypeScript SDK bundled with this package. It does not execute `node_modules/typescript` from the analyzed repository unless `SEMANTIC_JS_MCP_ALLOW_WORKSPACE_TYPESCRIPT=1` is set explicitly, and even then discovery never walks above the workspace boundary. TypeScript plugins load only from the bundled runtime probe location; local plugin loads from the analyzed repository are disabled. Language servers run with a sanitized environment (`NODE_OPTIONS`, `NODE_PATH`, and `NODE_REPL_EXTERNAL_MODULE` are removed) so inherited variables cannot inject code into child processes.

### Read-only surface

All tools are read-only and are annotated as such. The server rejects `workspace/applyEdit` requests from language servers, spawns `rg` and language servers with argument arrays (never a shell), and disables automatic typing acquisition so the TypeScript server performs no network installs. Client-supplied search terms are passed to `rg` after a `--` end-of-options separator so a value beginning with `-` cannot be interpreted as a ripgrep flag (no argument injection).

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
