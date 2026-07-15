# Distribution

The package manifest defines an explicit public file allowlist and exposes the `semantic-js-mcp` executable. Codex installs the package through the public `elnonathan` marketplace; other MCP hosts can use the executable directly.

## Codex

```bash
codex plugin marketplace add elnonathan/semantic-js-mcp
codex plugin add semantic-js-mcp@elnonathan
```

The marketplace entry pins a concrete npm package version. A release updates the package version, plugin manifest, and marketplace entry together.

## Executable

```bash
semantic-js-mcp serve
semantic-js-mcp doctor
semantic-js-mcp doctor --yaml
```

`serve` starts the MCP server over stdio. `doctor` creates isolated TypeScript and Vue fixtures and reports `pass`, `fail`, `untrusted`, or `blocked` with exit codes `0`, `1`, `2`, or `3`.

## Package Artifact

```bash
npm run smoke:distribution
```

The distribution smoke performs these checks:

1. creates an npm tarball from the declared `files` allowlist;
2. verifies required runtime, plugin, and skill files are present;
3. rejects every tarball entry outside the package's declared public allowlist;
4. installs the tarball in a temporary consumer project;
5. runs `semantic-js-mcp doctor` from that installed copy;
6. verifies that language-server components resolve within the consumer dependency tree and never from the source checkout.

The temporary installation uses an isolated npm cache and may resolve dependencies from the registry. Once installed, normal semantic analysis requires no network access.

## Source Validation

Run the complete local validation sequence before reviewing a distribution change:

```bash
npm run check
npm run check:runtime
npm run smoke:ci
npm run smoke
npm run smoke:vue
npm run smoke:distribution
```

Run `npm run doctor` separately when the structured installation evidence is part of the review. Exit `2` is an explicit untrusted diagnostic result and must not be described as a clean semantic pass.
