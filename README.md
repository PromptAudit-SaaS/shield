<div align="center">

# @promptaudit/shield

[![npm version](https://img.shields.io/npm/v/@promptaudit/shield.svg?color=cb3837&style=flat-square)](https://www.npmjs.com/package/@promptaudit/shield)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-success.svg?style=flat-square)](package.json)
[![types](https://img.shields.io/badge/types-included-informational.svg?style=flat-square)](dist/index.d.ts)

**Zero-dependency, fast & reversible PII and secret masking for LLMs & AI agents.**

[Live Interactive Demo](https://promptaudit.ch/shield) · [Report Issue](https://github.com/PromptAudit-SaaS/shield/issues) · [Commercial Suite](https://promptaudit.ch)

</div>

---

```bash
npm install @promptaudit/shield
```

```ts
import { withShield } from "@promptaudit/shield";

const answer = await withShield(userPrompt, (safe) => llm.complete(safe));
// The model saw [API_KEY_1], [IBAN_1] … — your user gets the real values back.
```

## Before / after

```
You wrote:   Deploy with key sk-proj-AbC123…xyz and refund Mr. John Miller, IBAN CH93 0076 2011 6238 5295 7
Model sees:  Deploy with key [API_KEY_1] and refund Mr. [NAME_1], IBAN [IBAN_1]
You get:     the model's answer with the original values restored in your process memory
```

## Why Shield

- **Zero dependencies.** One small TypeScript module. Browser, Node, Bun, Deno, edge workers.
- **Checksum-validated.** IBAN (ISO 7064 Mod 97), cards (Luhn + brand prefix), US SSN (SSA rules), ABA routing (3-7-1). Order and serial numbers are not masked by accident.
- **Secrets included.** OpenAI/Anthropic `sk-…`, AWS `AKIA…`/`ASIA…`, GitHub `ghp_…`/`github_pat_…`, Slack `xox…-`, JWT and PEM private keys.
- **Reversible.** Placeholders go out, the map stays in your process memory.
- **Obfuscation-aware.** Zero-width characters and full-width digits are normalised first.
- **No network, no telemetry.**

## How it compares

| | Typical Python NLP stack | Ad-hoc regex snippets | **@promptaudit/shield** |
| --- | --- | --- | --- |
| Runtime | Python server | varies | **Browser, Node, Bun, Deno, edge** |
| Dependencies | NLP models and packages | varies | **0** |
| Checksum validation | partial | rarely | **IBAN, cards, SSN, ABA** |
| API keys / secrets | separate tooling | rarely | **built in** |
| Restore originals | manual | usually one-way | **`unshield()` / `withShield()`** |

NLP stacks (e.g. Microsoft Presidio) detect free-text names and addresses, which Shield does not. Choose by need; they can be combined.

## API

| Function | Purpose |
| --- | --- |
| `shield(text, detectors?)` | Returns `{ masked, map, counts }` |
| `unshield(text, map)` | Restores originals in a model answer |
| `withShield(prompt, call)` | Mask → call → restore in one step |
| `DEFAULT_DETECTORS` | Extend with your own `{ category, pattern, validate? }` |

## Detected today

IBAN · payment card · US SSN · US routing (with keyword) · e-mail · international phone (`+` prefix) · names after Mr./Mrs./Ms./Dr./Prof. · API keys · private keys

## Limits (read before production)

- Pattern-based, not NER: names without a title, free-text addresses and medical terms are **not** detected.
- Unknown key formats are not caught.
- Detection is best-effort. It reduces exposure; it does not guarantee that no personal data leaves your system.
- No audit trail.

## Need proof, not just masking?

Shield runs inside your code. Teams that must **prove** what was sent, by whom and when — with browser enforcement for every employee, append-only hash-chained logs and Swiss storage — use the [PromptAudit platform](https://promptaudit.ch).

Try it live: https://promptaudit.ch/shield · MIT © PromptAudit
