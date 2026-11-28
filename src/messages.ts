import { DEFAULT_DETECTORS, type Detector } from './engine';
import type { UnshieldStreamOptions } from './stream';
import { createMaskSession, type ShieldOptions, type MaskCategory } from './session';

export interface ChatMessageLike {
  role: string;
  content: string | readonly unknown[] | null;
}
export type MaskedPart<P> = P extends { type: 'text'; text: string }
  ? Omit<P, 'text'> & { text: string } : P;
export type MaskedContent<C> = C extends string ? string
  : C extends readonly (infer P)[] ? MaskedPart<P>[] : C;
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

/** Reject unsupported structured fields instead of silently claiming they were masked. */
function textsOf(content: ChatMessageLike['content']): string[] {
  if (typeof content === 'string') return [content];
  if (content === null) return [];
  return content.map((part) => {
    if (!part || typeof part !== 'object' || !('type' in part) || part.type !== 'text'
      || !('text' in part) || typeof part.text !== 'string') {
      throw new TypeError('Only string content and text-only content blocks are supported.');
    }
    return part.text;
  });
}

/** One map per call, shared across all text blocks; inputs are never mutated. */
export function shieldMessages<T extends ChatMessageLike>(
  messages: readonly T[], detectors: readonly Detector[] | ShieldOptions = DEFAULT_DETECTORS,
): ShieldMessagesResult<T> {
  for (const message of messages) {
    // Metadata identifiers remain untouched. Tool payloads require their own explicit schema.
    if ('tool_calls' in message || 'function_call' in message || message.role === 'tool') {
      throw new TypeError('Tool calls and tool results require explicit masking outside shieldMessages.');
    }
  }
  const options: ShieldOptions = Array.isArray(detectors) ? { detectors } : detectors as ShieldOptions;
  const session = createMaskSession(messages.flatMap(message => textsOf(message.content)), options);
  const mask = session.mask;
  let maskedMessages: { content: unknown; role: string }[];
  try {
  maskedMessages = messages.map((message) => ({
    ...message,
    content: typeof message.content === 'string' ? mask(message.content)
      : message.content === null ? null : message.content.map((part) => {
        // Validation above guarantees only text parts; narrow again without assertions.
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return { ...part, text: mask(part.text) };
        }
        throw new TypeError('Unsupported content block.');
      }),
  }));
  } catch (error) { session.clear(); throw error; }
  return {
    // Runtime validation above preserves the content variant and text-part metadata.
    // TS cannot resolve a conditional generic from runtime branches; the public type
    // deliberately widens rewritten strings rather than promising original literals.
    messages: maskedMessages as unknown as MaskedMessage<T>[],
    counts: session.counts,
    restore: session.restore,
    createRestoreStream: session.createRestoreStream,
    clear: session.clear,
  };
}
