/** Browser-safe Web Streams pair with explicit cleanup on close, cancel, abort and error. */
export interface UnshieldStreamOptions {
  /** UTF-16 code units, not bytes. Must fit every key in the supplied map. */
  maxBufferSize?: number;
  /** Only when this stream exclusively owns the map. Clearing is not secure memory erasure. */
  clearVaultOnTerminate?: boolean;
  signal?: AbortSignal;
}

/** Exact key prefixes: unknown placeholders and ordinary brackets stay unchanged. */
export class RestoreParser {
  private pending = '';
  private readonly prefixes = new Set<string>();
  constructor(private readonly vault: ReadonlyMap<string, string>, limit = 256) {
    if (!Number.isInteger(limit) || limit < 8 || limit > 4096) {
      throw new RangeError('maxBufferSize must be an integer between 8 and 4096.');
    }
    for (const key of vault.keys()) {
      if (!/^\[[A-Z_]+_\d+\]$/.test(key) || key.length > limit) {
        throw new RangeError('Map keys must be supported placeholders fitting maxBufferSize.');
      }
      for (let i = 1; i < key.length; i++) this.prefixes.add(key.slice(0, i));
    }
  }
  push(chunk: string): string {
    if (this.prefixes.size === 0) return chunk;
    let out = '';
    for (const char of chunk) {
      const candidate = this.pending + char;
      const original = this.vault.get(candidate);
      if (original !== undefined) {
        out += original;
        this.pending = '';
      } else if (this.prefixes.has(candidate)) {
        this.pending = candidate;
      } else {
        // Replay a new '[' as a possible start after a mismatching prefix.
        out += this.pending;
        this.pending = '';
        if (this.prefixes.has(char)) this.pending = char;
        else out += char;
      }
    }
    return out;
  }
  finish(): string {
    const tail = this.pending;
    this.pending = '';
    return tail;
  }
  clear(): void { this.pending = ''; this.prefixes.clear(); }
}

/** Transformer.cancel is not portable: wrap the native readable/writable endpoints instead. */
export function managedTransform<I, O>(
  transformer: Transformer<I, O>,
  cleanup: () => void,
  signal?: AbortSignal,
): ReadableWritablePair<O, I> {
  const native = new TransformStream<I, O>(transformer);
  const reader = native.readable.getReader();
  const writer = native.writable.getWriter();
  let ended = false;
  let outputController: ReadableStreamDefaultController<O> | undefined;
  let writableController: WritableStreamDefaultController | undefined;
  const end = () => {
    if (ended) return;
    ended = true;
    signal?.removeEventListener('abort', abort);
    writableController?.signal.removeEventListener('abort', writableAbort);
    cleanup();
  };
  const abort = () => {
    const reason: unknown = signal?.reason ?? new Error('Stream aborted.');
    outputController?.error(reason);
    end();
    void Promise.allSettled([reader.cancel(reason), writer.abort(reason)]);
  };
  const writableAbort = () => {
    const reason: unknown = writableController?.signal.reason ?? new Error('Stream aborted.');
    outputController?.error(reason);
    end();
    void Promise.allSettled([reader.cancel(reason), writer.abort(reason)]);
  };
  const readable = new ReadableStream<O>({
    start(controller) { outputController = controller; },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) { end(); controller.close(); }
        else controller.enqueue(result.value);
      } catch (error) { end(); controller.error(error); }
    },
    async cancel(reason) {
      end();
      await Promise.allSettled([reader.cancel(reason), writer.abort(reason)]);
    },
  }, { highWaterMark: 0 });
  const writable = new WritableStream<I>({
    start(controller) {
      writableController = controller;
      controller.signal.addEventListener('abort', writableAbort, { once: true });
    },
    async write(chunk) {
      if (ended) throw new Error('Stream has terminated.');
      try { await writer.write(chunk); }
      catch (error) { end(); throw error; }
    },
    async close() {
      try { await writer.close(); }
      finally { end(); }
    },
    async abort(reason) {
      end();
      await writer.abort(reason);
    },
  });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return { readable, writable };
}

export function createUnshieldStream(
  vault: Map<string, string>, options: UnshieldStreamOptions = {},
): ReadableWritablePair<string, string> {
  const parser = new RestoreParser(vault, options.maxBufferSize);
  return managedTransform<string, string>({
    transform(chunk, controller) {
      const text = parser.push(chunk);
      if (text) controller.enqueue(text);
    },
    flush(controller) {
      const tail = parser.finish();
      if (tail) controller.enqueue(tail);
    },
  }, () => {
    parser.clear();
    if (options.clearVaultOnTerminate) vault.clear();
  }, options.signal);
}
