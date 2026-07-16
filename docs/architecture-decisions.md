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
