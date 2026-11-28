/**
 * @promptaudit/shield — zero-dependency, reversible PII masking for LLM prompts.
 * Runs locally (browser, Node, Bun, Deno, edge workers). No network, no telemetry.
 */
import { isCardNumber, isValidAbaRouting, isValidIban, isValidSsn } from "./validators";

export { isCardNumber, isValidAbaRouting, isValidIban, isValidLuhn, isValidSsn } from "./validators";

export type Category = "IBAN" | "CREDIT_CARD" | "US_SSN" | "ROUTING" | "EMAIL" | "PHONE" | "NAME" | "API_KEY" | "PRIVATE_KEY" | "DATABASE_URL" | "SECRET";

export interface Detector {
  category: Category;
  pattern: RegExp;
  validate?: (match: string) => boolean;
}

export interface ShieldResult {
  /** Masked text; pattern detection is not a guarantee of absence of secrets. */
  masked: string;
  /** Placeholder -> original. Keep in memory only; never send it anywhere. */
  map: Map<string, string>;
  /** Count per category. */
  counts: Partial<Record<Category, number>>;
}

export const DEFAULT_DETECTORS: readonly Detector[] = [
  // Secrets first, so later detectors never split a key.
  { category: "PRIVATE_KEY", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { category: "DATABASE_URL", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/[^\s"'<>/@]+:[^\s"'<>/@]+@[^\s"'<>]+/gi },
  { category: "SECRET", pattern: /(?<=\b(?:[A-Z][A-Z0-9_]*_)?(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY)(?:_[A-Z0-9_]+)?[ \t]*=[ \t]*["']?)[^\s"'#]+/gim, validate: (value) => !/^(?:\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*|\[[A-Z_]+_\d+\])$/i.test(value) },
  { category: "SECRET", pattern: /(?<=\bBearer[ \t]+)[A-Za-z0-9._~+\/-]{8,}={0,2}/gi },
  { category: "API_KEY", pattern: /\bsk-(?:proj-|ant-(?:api\d{2}-)?)?[A-Za-z0-9_-]{20,}/g },
  { category: "API_KEY", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { category: "API_KEY", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { category: "API_KEY", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { category: "API_KEY", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/g },
  { category: "EMAIL", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { category: "IBAN", pattern: /\b[A-Z]{2}[ \t-]*\d{2}(?:[ \t-]*[0-9A-Z]){11,30}\b/g, validate: isValidIban },
  { category: "CREDIT_CARD", pattern: /(?<![\d-])\d(?:[ \t-]?\d){12,18}(?![\d-])/g, validate: isCardNumber },
  { category: "US_SSN", pattern: /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g, validate: isValidSsn },
  { category: "ROUTING", pattern: /(?<=\b(?:routing|ABA|RTN|transit)(?:[ \t]+(?:number|no\.?|#))?[ \t]*[:#]?[ \t]*)\d{9}\b/gi, validate: isValidAbaRouting },
  { category: "PHONE", pattern: /(?<![\w+])\+\d{1,3}(?:[ \t.-]?\(?\d{1,4}\)?){2,5}\d(?!\d)/g },
  { category: "NAME", pattern: /(?<=\b(?:Mr|Mrs|Ms|Dr|Prof)\.?[ \t]+|\bMiss[ \t]+)[A-Z][a-z'-]+(?:[ \t]+[A-Z][a-z'-]+)?/g },
];

/** Removes zero-width chars and folds full-width digits/letters, so obfuscated values are still caught. */
export function normalize(text: string): string {
  return text
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

export function shield(text: string, detectors: readonly Detector[] = DEFAULT_DETECTORS): ShieldResult {
  let masked = normalize(text);
  const map = new Map<string, string>();
  const reverse = new Map<string, string>();
  const counts: Partial<Record<Category, number>> = {};
  for (const d of detectors) {
    masked = masked.replace(new RegExp(d.pattern.source, d.pattern.flags), (m) => {
      if (d.validate && !d.validate(m)) return m;
      const known = reverse.get(m);
      if (known) return known;
      const n = (counts[d.category] ?? 0) + 1;
      counts[d.category] = n;
      const ph = `[${d.category}_${n}]`;
      map.set(ph, m);
      reverse.set(m, ph);
      return ph;
    });
  }
  return { masked, map, counts };
}

/** Puts originals back into an LLM answer, locally. */
export function unshield(text: string, map: Map<string, string>): string {
  return text.replace(/\[[A-Z_]+_\d+\]/g, (ph) => map.get(ph) ?? ph);
}

/** Wraps any async LLM call: masks the prompt, calls the model, restores the answer. */
export async function withShield(prompt: string, call: (safePrompt: string) => Promise<string>): Promise<string> {
  const { masked, map } = shield(prompt);
  return unshield(await call(masked), map);
}
