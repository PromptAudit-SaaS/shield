import { shield as legacyShield, type Detector } from './engine';
import { DEFAULT_DETECTORS } from './engine';
import { createMaskSession, type ShieldOptions } from './session';
/** Legacy detector-array calls remain unchanged; options enable custom terms. */
export function shield(text: string, options: readonly Detector[] | ShieldOptions = DEFAULT_DETECTORS) {
  if (Array.isArray(options)) return legacyShield(text, options);
  const session = createMaskSession([text], options as ShieldOptions);
  try {
    const masked = session.mask(text);
    // Export an independent map for compatibility with the existing single-text API.
    const map = new Map<string, string>();
    for (const token of masked.match(/\[[A-Z_]+_\d+\]/g) ?? []) {
      const original = session.restore(token); if (original !== token) map.set(token, original);
    }
    return { masked, map, counts: session.counts };
  } finally { session.clear(); }
}
