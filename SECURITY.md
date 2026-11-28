# Security policy

Do not publish real credentials, personal records or unmasked reproductions in issues or pull requests.

Report through GitHub private vulnerability reporting **if enabled**; otherwise contact **info@promptaudit-vault.ch** with the version, affected API and a minimal fictional reproduction. Do not send live keys or memory dumps. This policy does not promise a response-time or remediation-time SLA.

## Boundaries

- Shield is a pure local MIT masking library, not an automatic network firewall, compliance assessment or certification.
- Supported patterns and custom terms can miss values or match benign content.
- Restoration deliberately reveals originals to its caller. Keep mapping and restoration outside model context if originals must remain local.
- Explicit provider facades do not cover every SDK endpoint, payload or direct HTTP call. Unsupported operations and budgets fail closed where the facade handles them.
- Serialized JSON keys and number lexemes are preserved and unmasked by contract.
- References are cleared on supported lifecycle paths; JavaScript cannot guarantee physical RAM erasure.
- No telemetry, network calls or proprietary platform code belongs in this package.

Reports for all versions are welcome; fixes normally target the current development line. No older-version support window is promised. Published versions are immutable.
