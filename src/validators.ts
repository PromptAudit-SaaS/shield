/**
 * Globale Erkennungsmuster mit mathematischer Prüfung (reine Funktionen, ohne I/O).
 * Ein Treffer zählt nur, wenn die Prüfsumme stimmt, damit Seriennummern und
 * Bestellnummern nicht fälschlich maskiert werden.
 */

export interface GlobalRule {
  label: string;
  pattern: RegExp;
  validate: (match: string) => boolean;
}

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** ISO 7064 Mod 97-10 für IBAN (alle Länder). */
export function isValidIban(raw: string): boolean {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** Luhn-Prüfung (Mod 10) für Zahlungskarten. */
export function isValidLuhn(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Bekannte Kartenpräfixe (Visa, Mastercard, Amex, Diners, Discover, JCB). */
export function isCardNumber(raw: string): boolean {
  const d = digitsOf(raw);
  const brand = /^4\d{12}(?:\d{3})?$|^(?:5[1-5]\d{14}|2[2-7]\d{14})$|^3[47]\d{13}$|^3(?:0[0-5]|[68]\d)\d{11}$|^6(?:011|5\d{2})\d{12}$|^35\d{14}$/;
  return brand.test(d) && isValidLuhn(d);
}

/** US Social Security Number: Bereichs-, Gruppen- und Seriennummer gemäss SSA-Regeln. */
export function isValidSsn(raw: string): boolean {
  const m = /^(\d{3})-(\d{2})-(\d{4})$/.exec(raw.replace(/\s/g, ""));
  if (!m) return false;
  const [, a, g, s] = m as unknown as [string, string, string, string];
  if (a === "000" || a === "666" || a.startsWith("9")) return false;
  return g !== "00" && s !== "0000";
}

/** US ABA Routing Number: Gewichtung 3-7-1, Summe Mod 10 = 0. */
export function isValidAbaRouting(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 9 || /^0{9}$/.test(d)) return false;
  const n = [...d].map(Number) as number[];
  const sum = 3 * (n[0]! + n[3]! + n[6]!) + 7 * (n[1]! + n[4]! + n[7]!) + (n[2]! + n[5]! + n[8]!);
  return sum % 10 === 0;
}

export const GLOBAL_RULES: readonly GlobalRule[] = [
  { label: "IBAN", pattern: /\b[A-Z]{2}[ \t-]*\d{2}(?:[ \t-]*[0-9A-Z]){11,30}\b/g, validate: isValidIban },
  { label: "KREDITKARTE", pattern: /(?<![\d-])\d(?:[ \t-]?\d){12,18}(?![\d-])/g, validate: isCardNumber },
  { label: "US-SSN", pattern: /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g, validate: isValidSsn },
  // Routing-Nummern nur mit Bankbegriff davor, sonst zu viele 9-stellige Zahlen.
  { label: "US-ROUTING", pattern: /(?<=\b(?:routing|ABA|RTN|transit)(?:[ \t]+(?:number|no\.?|#))?[ \t]*[:#]?[ \t]*)\d{9}\b/gi, validate: isValidAbaRouting },
];
