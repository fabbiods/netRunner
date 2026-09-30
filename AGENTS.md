# AGENTS.md

## Project conventions

- Write source code, identifiers, code comments, tests and commit messages in English.
- Write user-facing UI and user documentation in Brazilian Portuguese.
- Use Conventional Commits.
- Do not add packages from public registries. New packages must be reviewed and installed only through the corporate Fury registry with exact versions and `--ignore-scripts`.
- Do not add CDNs, remote fonts, telemetry, analytics or automatic update checks.
- Bind the local service exclusively to `127.0.0.1` and retain host, origin and session-token validation.
- Never persist, return or log passwords, OTPs or ephemeral session tokens.
- Keep SSH debug filtering restricted to algorithm-negotiation lines; full `ssh2` debug output is forbidden.
- Keep legacy algorithms opt-in per device and never add algorithms outside the explicit allowlist.
- Treat browser input, imported files, device output and network responses as untrusted.
- Add or update tests for every behavior change.
- Update the relevant file in `docs/` when architecture, security or compatibility changes.

## Required runtime

```bash
nvm install 24.21.0
nvm use 24.21.0
```

## Exact commands

Validate the dependency-free lockfile:

```bash
npm ci --ignore-scripts --no-audit --no-fund
```

Run the application:

```bash
npm start
```

Run source and security checks:

```bash
npm run lint
```

Run tests:

```bash
npm test
```

Run all required checks:

```bash
npm run verify
```

Run the 10,000-device inventory benchmark:

```bash
npm run benchmark:inventory
```

Create a local distribution:

```bash
npm run package
```

## Definition of done

A milestone is complete only when `npm run verify` and `npm run package` pass, documentation is current and the report lists the commands actually executed.
