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
export declare const DEFAULT_DETECTORS: readonly Detector[];
/** Removes zero-width chars and folds full-width digits/letters, so obfuscated values are still caught. */
export declare function normalize(text: string): string;
export declare function shield(text: string, detectors?: readonly Detector[]): ShieldResult;
/** Puts originals back into an LLM answer, locally. */
export declare function unshield(text: string, map: Map<string, string>): string;
/** Wraps any async LLM call: masks the prompt, calls the model, restores the answer. */
export declare function withShield(prompt: string, call: (safePrompt: string) => Promise<string>): Promise<string>;
