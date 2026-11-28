/** Browser-safe Web Streams pair with explicit cleanup on close, cancel, abort and error. */
export interface UnshieldStreamOptions {
    /** UTF-16 code units, not bytes. Must fit every key in the supplied map. */
    maxBufferSize?: number;
    /** Only when this stream exclusively owns the map. Clearing is not secure memory erasure. */
    clearVaultOnTerminate?: boolean;
    signal?: AbortSignal;
}
/** Exact key prefixes: unknown placeholders and ordinary brackets stay unchanged. */
export declare class RestoreParser {
    private readonly vault;
    private pending;
    private readonly prefixes;
    constructor(vault: ReadonlyMap<string, string>, limit?: number);
    push(chunk: string): string;
    finish(): string;
    clear(): void;
}
/** Transformer.cancel is not portable: wrap the native readable/writable endpoints instead. */
export declare function managedTransform<I, O>(transformer: Transformer<I, O>, cleanup: () => void, signal?: AbortSignal): ReadableWritablePair<O, I>;
export declare function createUnshieldStream(vault: Map<string, string>, options?: UnshieldStreamOptions): ReadableWritablePair<string, string>;
