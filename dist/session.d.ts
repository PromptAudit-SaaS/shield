import { type Category, type Detector } from './engine';
import { type CustomTermsOptions } from './custom-terms';
import { RestoreParser, type UnshieldStreamOptions } from './stream';
export interface ShieldOptions extends CustomTermsOptions {
    detectors?: readonly Detector[];
    customTerms?: readonly string[];
}
export type MaskCategory = Category | 'TERM';
export declare function createMaskSession(reservedTexts: readonly string[], options?: ShieldOptions): {
    counts: Partial<Record<MaskCategory, number>>;
    mask(text: string): string;
    restore(text: string): string;
    parser(): RestoreParser;
    createRestoreStream(options?: UnshieldStreamOptions): ReadableWritablePair<string, string>;
    clear(): void;
};
export type MaskSession = ReturnType<typeof createMaskSession>;
