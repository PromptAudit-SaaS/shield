import { type UnshieldStreamOptions } from './stream';
export interface SseUnshieldOptions extends UnshieldStreamOptions {
    /** Explicit wire format; not a universal SDK interceptor. */
    provider: 'openai' | 'anthropic';
    /** Per SSE event, in UTF-16 code units. Overflow and malformed JSON fail explicitly. */
    maxEventSize?: number;
    maxChannels?: number;
}
/** Parses SSE events, not individual lines; retains event/id/retry/comment fields and non-text data. */
export declare function createUnshieldSseStream(vault: Map<string, string>, options: SseUnshieldOptions): ReadableWritablePair<Uint8Array, Uint8Array>;
