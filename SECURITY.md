# Security Policy

Semantic JS MCP is a read-only developer tool that starts bundled language servers and reads local source files. It must not apply workspace edits, execute repository-provided commands, require credentials, or use network access during normal local analysis.

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
