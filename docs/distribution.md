# Distribution Verification

The package manifest defines an explicit public file allowlist and exposes the `semantic-js-mcp` executable. Publication remains a separate release action; the checks in this document operate on a locally produced package artifact.

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
