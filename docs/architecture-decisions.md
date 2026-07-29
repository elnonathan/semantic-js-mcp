# Architecture Decisions

This document records accepted product boundaries. These decisions may be revised through an explicit change that documents the reason and migration impact.

## Independent MCPs By Semantic Domain

Semantic support for JavaScript, CSS, PHP, and other domains belongs in independent projects with separate dependencies, processes, releases, installation, and lifecycle management.

This project is `semantic-js-mcp`; it does not load or bundle semantic providers for other domains.

## Composition Belongs To The Consumer

One MCP does not call another MCP. A model, skill, CI adapter, or other consumer decides whether evidence from multiple semantic domains is needed.

This avoids runtime coupling, chained failures, implicit configuration, and assumptions that another product exists.

## Common Representation, Domain-Specific Evidence

Related semantic MCPs should use a compatible evidence envelope when practical:

- producer identity and result-schema version;
- tool and normalized request;
- result;
- collection status;
- presentation status;
- exact continuation tool names.

Each domain owns the vocabulary inside its result. A CSS class relationship is not represented as a JavaScript LSP reference.

## Continuations Stay Inside One MCP

`continueWith` names tools from the server that produced the response. It does not recommend tools from another MCP. Cross-product guidance belongs in consumer documentation or skills.

## Narrow And Composed Tools Coexist

Narrow tools provide one focused fact with a small response. Composed audits reuse the same internal primitives to reduce tool calls for consumers that can use a larger evidence summary.

Composed tools do not remove access to narrow tools and do not weaken collection accounting.

## Diagnostics Require Current Snapshot Evidence

The server uses advertised diagnostic-pull capability when available and push
notifications otherwise. Concurrent requests for the same document snapshot
share one acquisition. A version match or completed pull request is not enough
when the file content changes before the result is returned.

Diagnostics that cannot be correlated to the current document remain
explicitly untrusted.

## Preserve Provider-Native Embedded Evidence

The JavaScript ecosystem includes mixed-language documents. When the owning provider reports diagnostics for a Vue template or embedded CSS, SCSS, or Less block, semantic-js-mcp preserves that evidence instead of filtering it according to another provider's domain.

Where it can be determined safely, diagnostic evidence should identify:

- provider;
- document language;
- embedded region;
- embedded language.

Unknown provenance remains explicit. Provider-native style diagnostics do not imply complete CSS graph analysis.

## Extract Shared Code Only After A Second Implementation

The project may document transferable concepts, but it will not create a shared runtime package or universal provider framework before a second semantic MCP demonstrates concrete duplication.

Compatibility should begin with result concepts and conformance fixtures, not premature runtime coupling.

## Compact Summaries Preserve Complete Collections

Count and audit tools return the smallest summary that preserves symbol identity, signature, reference and text-match accounting, unresolved evidence, collection status, and freshness. They do not include per-file reference groups, locations, performance, or memory observations by default.

The complete requested reference set remains available through `lsp_reference_page` and `lsp_unresolved_reference_page` using the returned `referenceSetId`. `lsp_references` creates or reuses a set when the consumer starts from an exact source position.

This keeps model context proportional to the question without making a compact response look more complete than its underlying collection. Presentation size never changes `collection.status`.

Detailed verified locations may be grouped by their exact source file because the file is a shared property of every location in that group. Pagination and counts remain location-based, and each location keeps its explicit range and discovery method. Reference locations have no cross-file ordering contract. Status, freshness, unresolved candidates, and unlike evidence are not grouped merely to shorten output.

## Named Selection Reports Ambiguity Without Inferring Identity

Named-symbol tools report whether exact declaration filtering selected zero, one, or multiple definitions. A `fileHint` narrows declarations already reported by the owning provider; it does not turn a matching filename, Vue component name, import alias, or test double into declaration evidence.

When selection is empty or ambiguous, continuation guidance points consumers toward structural or position-based tools. Reference-page guidance appears only when the response contains a reusable reference set. This keeps ambiguity actionable without guessing which homonymous symbol the consumer intended.

A named audit may separately verify that an exact text occurrence resolves to a `fileHint` target. This binding evidence retains its source position, target definitions, resolution method, complete classification counts, and unresolved accounting. It does not promote the target filename or local alias into a named declaration, and the lighter count tool does not perform these per-match definition requests.

## Provider Processes Use Revocable Root Snapshots

The main MCP process remains the authority for host roots, explicit
workspace-root configuration, and roots approved by a human for one Codex
process. Each language-server or tsserver process is bound to one immutable canonical-root
snapshot by two mechanisms: a symlink-aware preload guard that mediates the
filesystem and child-process APIs in JavaScript, and, where active, the Node.js
permission model that enforces the snapshot in the runtime. Provider writes are
limited to a server-owned temporary directory, and provider child-process
creation is limited to the one bundled tsserver child required by
`typescript-language-server`. On macOS and Linux both apply: beyond the guard,
the permission model also refuses filesystem access from routes the guard cannot
patch — Worker threads, native addons, WASI, or `process.binding`. Node documents
it as hardening for trusted code rather than a complete sandbox, so it raises the
bar substantially without absolutely guaranteeing containment of a fully
compromised process. On Windows the permission model is currently disabled for
providers because it
rejects some tsserver reads whose Windows path form differs from the granted
roots, breaking navigation; the preload guard is the sole layer there. The guard
mediates the APIs it patches — sufficient for the trusted, pinned, bundled
providers — but it is not a sandbox for a compromised provider, which could
bypass it through the same Worker, native-addon, WASI, or `process.binding`
routes. This is a deliberate, documented Windows-only trade-off that rests on the
bundled providers being trusted; restoring the permission model on Windows is the
priority follow-up, and internal toggles force it on and trace denied paths for
diagnosis on a Windows host.
The preload authorizes that fork through a one-use internal spawn gate and
rebuilds its options from a pre-provider snapshot: the executable, working
directory, filesystem permissions, roots, and sanitized environment are
server-controlled. Direct use of the public `ChildProcess` class or
`process.execve`, caller-supplied `execPath`, and caller-supplied child
environment remain denied.
Provider filesystem watchers remain inert on macOS and Linux. Windows
providers may use their polling watchers only for canonical paths inside the
immutable read-root snapshot. Outside paths, symlink escapes, and Node.js
permission mismatches degrade to inert handles instead of widening that
snapshot. Windows workspace-boundary and provider-location comparisons share
case-insensitive file identity so valid provider results are not discarded
solely because drive or path casing differs. Node.js permission arguments use
case variants for workspace roots only on Windows; macOS and Linux receive
exact canonical workspace roots. The server-owned macOS temporary directory
also receives the read-path variants required by the language server's
case-sensitivity probe.

An effective host-root change closes every existing provider and invalidates
reference-set caches before another analysis starts. Root refreshes use a
monotonic request sequence, so a delayed older `roots/list` response cannot
restore authority removed by a newer response. The first file operation waits
for the initial host-root response.

Codex session authorization uses separate preparation and authorization
operations. Preparation canonicalizes a human-selected directory without
granting access and binds it to a short-lived, one-time identifier. The
authorization operation is host-prompted, requires the exact canonical root,
and keeps it only in MCP process memory. Generic hosts cannot enable this path,
because an agent-controlled tool call without enforced human approval would
not be workspace authority. Filesystem roots, home directories and their
ancestors, temporary roots, and protected system directories are never
accepted through this flow. Failure to verify the home or protected-system
boundary disables preparation rather than assuming the root is safe.

This is a process-level defense for bundled providers, not permission to load
arbitrary repository code. Workspace TypeScript remains disabled by default;
enabling it explicitly trusts that SDK while retaining the same filesystem
boundary.
