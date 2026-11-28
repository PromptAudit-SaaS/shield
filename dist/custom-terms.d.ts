/** Bounded local Aho–Corasick matcher. No dynamic regular expressions. */
export interface CustomTermsOptions {
    caseInsensitive?: boolean;
    wholeWords?: boolean;
}
export interface TermMatch {
    start: number;
    end: number;
}
export declare class CustomTermMatcher {
    private options;
    private nodes;
    private terms;
    constructor(terms: readonly string[], options?: CustomTermsOptions);
    private fold;
    private node;
    findMatches(text: string): TermMatch[];
}
