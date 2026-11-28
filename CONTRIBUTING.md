# Contributing

## Local development

In the standalone Shield repository:

```sh
bun install --frozen-lockfile
bun test src
bun run build
```

Provider SDKs are development-only fixtures. Tests use local fictional responses, not live paid model requests or real keys.

## Contribution requirements

- Keep the package MIT, local and free of runtime dependencies, telemetry and proprietary platform imports.
- Preserve the legacy engine behind the explicit facade; do not silently change established detection or restoration behaviour.
- Add a concrete regression test for each behavioural change. Include chunk boundaries, cancellation, request isolation and unsupported input when relevant.
- Preserve serialized JSON key/number lexemes. Do not replace bounded transformations with parse/stringify round-trips.
- Keep types strict and budgets explicit. Do not suppress checks to make tests pass.
- Write documentation, errors and public examples in English. Use fictional fixtures only.
- Describe known gaps. A finite benchmark cannot establish universal accuracy, physical memory erasure or compliance.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) rather than posting details publicly.
