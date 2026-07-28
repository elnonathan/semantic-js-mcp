# Distribution

The package manifest defines an explicit public file allowlist and exposes the `semantic-js-mcp` executable. Codex installs the package through the public `elnonathan` marketplace; other MCP hosts can use the executable directly.

## Codex

The marketplace entry pins a concrete npm package version. Codex CLI 0.144.4
is the minimum verified client for npm-backed marketplace installation. A
release updates the package version, plugin manifest, and marketplace entry
together.

Follow [Install With Codex](../SETUP.md#install-with-codex) for installation or
update commands, version checks, restart handling, and tool verification. This
document describes the distribution contract and does not define a second
setup procedure.

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

That self-contained artifact intentionally retains the complete npm-published
contents of bundled dependencies, including upstream tests and fixtures. These
files increase package size but remain inert; preserving them avoids rewriting
third-party packages or accidentally removing resources resolved dynamically at
runtime. Release review therefore inspects the exact tarball surface and audits
the complete bundled dependency tree instead of pruning selected upstream
paths.

## Source Validation

Run the complete local validation sequence before reviewing a distribution change:

```bash
npm run check
npm run check:runtime
npm run check:documentation
npm run smoke:ci
npm run smoke:publish
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

## npm Trusted Publishing

The `publish.yml` workflow publishes tags matching `v*` from a GitHub-hosted Node.js 24 runner. It requires the protected `npm-publish` environment, verifies that the tag exactly matches the package version, runs the complete release gate, and publishes through npm Trusted Publishing with OIDC. No long-lived npm token is used. npm generates provenance automatically for the public package.

Configure the npm trusted publisher for GitHub user `elnonathan`, repository `semantic-js-mcp`, workflow filename `publish.yml`, and environment `npm-publish`. Allow `npm publish` only. In package publishing access, require two-factor authentication and disallow tokens.

Create and push the matching `v<version>` tag only after the release commit is on `main` and its CI matrix passes. If the protected environment requires review, approve the waiting deployment. Verify the published package before creating the matching GitHub release.

## Continuous Integration

GitHub Actions runs the complete release gate on Node.js 22 and 24 across Ubuntu, macOS, and Windows. A second Linux matrix runs the same gate on Node.js 22 across Ubuntu, Fedora, Arch Linux, and openSUSE. The gate verifies ripgrep before running static checks, runtime resolution, documentation, CI policy, negative fixtures, doctor, TypeScript and Vue semantics, provider lifecycle, package installation, and the short benchmark.
