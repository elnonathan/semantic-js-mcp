# Architecture Decisions

This document records accepted product boundaries. These decisions may be revised through an explicit change that documents the reason and migration impact.

## DEC-001: Independent MCPs By Semantic Domain

Status: accepted

Semantic support for JavaScript, CSS, PHP, and other domains belongs in independent projects with separate dependencies, processes, releases, installation, and lifecycle management.

This project is `semantic-js-mcp`; it does not load or bundle semantic providers for other domains.

## DEC-002: Composition Belongs To The Consumer

Status: accepted

One MCP does not call another MCP. A model, skill, CI adapter, or other consumer decides whether evidence from multiple semantic domains is needed.

This avoids runtime coupling, chained failures, implicit configuration, and assumptions that another product exists.

## DEC-003: Common Representation, Domain-Specific Evidence

Status: accepted

Related semantic MCPs should use a compatible evidence envelope when practical:

- server identity;
- result-schema identity;
- tool and normalized request;
- result;
- collection status;
- presentation status;
- exact continuation tool names.

Each domain owns the vocabulary inside its result. A CSS class relationship is not represented as a JavaScript LSP reference.

## DEC-004: Continuations Stay Inside One MCP

Status: accepted

`continueWith` names tools from the server that produced the response. It does not recommend tools from another MCP. Cross-product guidance belongs in consumer documentation or skills.

## DEC-005: Narrow And Composed Tools Coexist

Status: accepted

Narrow tools provide one focused fact with a small response. Composed audits reuse the same internal primitives to reduce tool calls for consumers that can use a larger evidence summary.

Composed tools do not remove access to narrow tools and do not weaken collection accounting.

## DEC-006: Preserve Provider-Native Embedded Evidence

Status: accepted

The JavaScript ecosystem includes mixed-language documents. When the owning provider reports diagnostics for a Vue template or embedded CSS, SCSS, or Less block, semantic-js-mcp preserves that evidence instead of filtering it according to another provider's domain.

Where it can be determined safely, diagnostic evidence should identify:

- provider;
- document language;
- embedded region;
- embedded language.

Unknown provenance remains explicit. Provider-native style diagnostics do not imply complete CSS graph analysis.

## DEC-007: Extract Shared Code Only After A Second Implementation

Status: accepted

The project may document transferable concepts, but it will not create a shared runtime package or universal provider framework before a second semantic MCP demonstrates concrete duplication.

Compatibility should begin with result concepts and conformance fixtures, not premature runtime coupling.
