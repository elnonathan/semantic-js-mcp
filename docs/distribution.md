# Distribution

The package manifest defines an explicit public file allowlist and exposes the `semantic-js-mcp` executable. Codex installs the package through the public `elnonathan` marketplace; other MCP hosts can use the executable directly.

## Codex

```bash
codex plugin marketplace add elnonathan/semantic-js-mcp
codex plugin add semantic-js-mcp@elnonathan
```

The marketplace entry pins a concrete npm package version. Codex CLI 0.144.4 is the minimum verified client for npm-backed marketplace installation. A release updates the package version, plugin manifest, and marketplace entry together.

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

The temporary installation uses an empty, isolated npm cache with offline mode. Published packages bundle every production dependency, matching Codex installation behavior without resolving dependencies from the registry after download. Normal semantic analysis requires no network access once the package is available.

## Source Validation

Run the complete local validation sequence before reviewing a distribution change:

```bash
npm run check
npm run check:runtime
npm run check:documentation
npm run smoke:ci
npm run smoke:negative
npm run smoke:doctor
npm run smoke
npm run smoke:vue
npm run smoke:lifecycle
npm run smoke:distribution
```

Run `npm run doctor` separately when the structured installation evidence is part of the review. Exit `2` is an explicit untrusted diagnostic result and must not be described as a clean semantic pass.

## Release Verification

```bash
npm run release:verify
npm run verify:published -- <version>
```

The local release gate runs every configured source, runtime, semantic, evaluation, distribution, and benchmark check and reports all failures instead of stopping at the first one. It performs no publication or installed-plugin mutation.

Postpublication verification requires an explicit version and the matching `v<version>` repository tag. It queries that immutable registry version, installs it with a fresh temporary npm cache and consumer project, verifies the installed executable and manifest, then runs the installed doctor to cover MCP startup, tool discovery, TypeScript evidence, and Vue navigation. It also installs the plugin from the tag-pinned marketplace inside a temporary `CODEX_HOME` and verifies the enabled plugin version. Temporary state is removed afterward. An unavailable registry, marketplace, or network is reported as `blocked`.

## Continuous Integration

GitHub Actions runs the complete release gate on Node.js 22 and 24 across Ubuntu, macOS, and Windows. A second Linux matrix runs the same gate on Node.js 22 across Ubuntu, Fedora, Arch Linux, and openSUSE. The gate verifies ripgrep before running static checks, runtime resolution, documentation, CI policy, negative fixtures, doctor, TypeScript and Vue semantics, provider lifecycle, package installation, and the short benchmark.
