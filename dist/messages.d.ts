import { type Detector } from './engine';
import type { UnshieldStreamOptions } from './stream';
import { type ShieldOptions, type MaskCategory } from './session';
export interface ChatMessageLike {
    role: string;
    content: string | readonly unknown[] | null;
}
export type MaskedPart<P> = P extends {
    type: 'text';
    text: string;
} ? Omit<P, 'text'> & {
    text: string;
} : P;
export type MaskedContent<C> = C extends string ? string : C extends readonly (infer P)[] ? MaskedPart<P>[] : C;
export type MaskedMessage<T extends ChatMessageLike> = Omit<T, 'content'> & {
    content: MaskedContent<T['content']>;
};
export interface ShieldMessagesResult<T extends ChatMessageLike> {
    messages: MaskedMessage<T>[];
    counts: Partial<Record<MaskCategory, number>>;
    restore(text: string): string;
    createRestoreStream(options?: UnshieldStreamOptions): ReadableWritablePair<string, string>;
    /** Ends this session; it does not securely erase JavaScript strings or caller-owned inputs. */
    clear(): void;
}
/** One map per call, shared across all text blocks; inputs are never mutated. */
export declare function shieldMessages<T extends ChatMessageLike>(messages: readonly T[], detectors?: readonly Detector[] | ShieldOptions): ShieldMessagesResult<T>;
