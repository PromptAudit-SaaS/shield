import { DEFAULT_DETECTORS, normalize, type Category, type Detector } from './engine';
import { CustomTermMatcher, type CustomTermsOptions } from './custom-terms';
import { RestoreParser, createUnshieldStream, type UnshieldStreamOptions } from './stream';
export interface ShieldOptions extends CustomTermsOptions { detectors?: readonly Detector[]; customTerms?: readonly string[] }
export type MaskCategory = Category | 'TERM';
export function createMaskSession(reservedTexts: readonly string[], options: ShieldOptions = {}) {
  const reserved = reservedTexts.map(normalize).join('\n');
  if (reserved.length > 1_048_576) throw new RangeError('Request text limit exceeded.');
  const matcher = new CustomTermMatcher(options.customTerms ?? [], options);
  const vault = new Map<string, string>(), reverse = new Map<string, string>();
  const counts: Partial<Record<MaskCategory, number>> = {};
  const counters: Partial<Record<MaskCategory, number>> = {};
  let active = true;
  const guard = () => { if (!active) throw new Error('Shield session has been cleared.'); };
  const token = (value: string, category: MaskCategory) => {
    const known = reverse.get(value); if (known !== undefined) return known;
    if (vault.size >= 10_000) throw new RangeError('Placeholder limit exceeded.');
    let n = counters[category] ?? 0, key: string;
    do { key = `[${category}_${++n}]`; } while (reserved.includes(key) || vault.has(key));
    counters[category] = n; counts[category] = (counts[category] ?? 0) + 1;
    vault.set(key, value); reverse.set(value, key); return key;
  };
  return {
    counts,
    mask(text: string) {
      guard(); let masked = normalize(text);
      if (masked.length > 1_048_576) throw new RangeError('Text limit exceeded.');
      // Built-in detectors have priority; custom terms never split known secrets or rewrite tokens.
      for (const d of options.detectors ?? DEFAULT_DETECTORS) {
        masked = masked.replace(new RegExp(d.pattern.source, d.pattern.flags), value => d.validate && !d.validate(value) ? value : token(value, d.category));
      }
      masked = masked.split(/(\[[A-Z_]+_\d+\])/g).map(segment => {
        if (/^\[[A-Z_]+_\d+\]$/.test(segment)) return segment;
        let out = '', cursor = 0;
        for (const match of matcher.findMatches(segment)) {
          out += segment.slice(cursor, match.start) + token(segment.slice(match.start, match.end), 'TERM'); cursor = match.end;
        }
        return out + segment.slice(cursor);
      }).join('');
      return masked;
    },
    restore(text: string) { guard(); return text.replace(/\[[A-Z_]+_\d+\]/g, key => vault.get(key) ?? key); },
    parser() { guard(); return new RestoreParser(vault); },
    createRestoreStream(options: UnshieldStreamOptions = {}) { guard(); if (options.clearVaultOnTerminate) throw new TypeError('Use session.clear().'); return createUnshieldStream(vault, options); },
    clear() { active = false; vault.clear(); reverse.clear(); },
  };
}
export type MaskSession = ReturnType<typeof createMaskSession>;
