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
/** ISO 7064 Mod 97-10 für IBAN (alle Länder). */
export declare function isValidIban(raw: string): boolean;
/** Luhn-Prüfung (Mod 10) für Zahlungskarten. */
export declare function isValidLuhn(raw: string): boolean;
/** Bekannte Kartenpräfixe (Visa, Mastercard, Amex, Diners, Discover, JCB). */
export declare function isCardNumber(raw: string): boolean;
/** US Social Security Number: Bereichs-, Gruppen- und Seriennummer gemäss SSA-Regeln. */
export declare function isValidSsn(raw: string): boolean;
/** US ABA Routing Number: Gewichtung 3-7-1, Summe Mod 10 = 0. */
export declare function isValidAbaRouting(raw: string): boolean;
export declare const GLOBAL_RULES: readonly GlobalRule[];
