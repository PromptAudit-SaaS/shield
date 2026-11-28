import { createMaskSession, type MaskSession } from './session';
import { transformToolCalls, transformSerializedJson, walkStructured, type StructuredOptions } from './tool-calls';
import type { RestoreParser } from './stream';
export interface ClientOptions extends StructuredOptions { timeoutMs?: number }
export interface RequestOptions { signal?: AbortSignal; [key: string]: unknown }
export interface TextStream<T = unknown> extends AsyncIterable<T> { abort(): void }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object.');
  return value as Record<string, unknown>;
}
function method(target: unknown, name: string): (body: unknown, options: unknown) => unknown {
  const object = record(target), fn = object[name];
  if (typeof fn !== 'function') throw new TypeError(`Missing client method ${name}.`);
  return (body, options) => Reflect.apply(fn, target, [body, options]);
}
function payload(body: Record<string, unknown>, provider: 'openai' | 'anthropic', mask: (text: string) => string, options: StructuredOptions) {
  // Reject accessors, cycles and resource-limit bypasses before touching SDK/network.
  walkStructured(body, text => text, options);
  if (!Array.isArray(body['messages']) || body['messages'].length > 1000) throw new TypeError('Expected messages.');
  const messages = body['messages'].map((raw: unknown) => {
    const m = record(raw);
    if ('function_call' in m) throw new TypeError('Legacy function calls are unsupported.');
    const content = m['content'];
    let masked: unknown;
    if (typeof content === 'string') masked = m['role'] === 'tool' ? transformSerializedJson(content, mask, options) : mask(content);
    else if (content === null) masked = null;
    else if (Array.isArray(content)) masked = content.map((rawPart: unknown) => {
      const part = record(rawPart);
      if (part['type'] === 'text' && typeof part['text'] === 'string') return { ...part, text: mask(part['text']) };
      if (provider === 'anthropic' && part['type'] === 'tool_use') {
        const transformed = transformToolCalls([part], mask, options);
        if (!Array.isArray(transformed)) throw new TypeError('Invalid transformed tools.');
        return transformed[0];
      }
      // tool_result may contain images or nested blocks; no silent passthrough.
      if (provider === 'anthropic' && part['type'] === 'tool_result' && typeof part['content'] === 'string') return { ...part, content: mask(part['content']) };
      throw new TypeError('Unsupported content block.');
    });
    else throw new TypeError('Unsupported message content.');
    return { ...m, content: masked, ...('tool_calls' in m ? { tool_calls: transformToolCalls(m['tool_calls'], mask, options) } : {}) };
  });
  let system = body['system'];
  if (provider === 'anthropic' && system !== undefined) {
    if (typeof system === 'string') system = mask(system);
    else if (Array.isArray(system)) system = system.map((raw: unknown) => {
      const part = record(raw);
      if (part['type'] !== 'text' || typeof part['text'] !== 'string') throw new TypeError('Unsupported system block.');
      return { ...part, text: mask(part['text']) };
    });
    else throw new TypeError('Unsupported system prompt.');
  }
  return { ...body, messages, ...(system !== undefined ? { system } : {}) };
}
function restoredResponse(value: unknown, provider: 'openai' | 'anthropic', session: MaskSession): unknown {
  const response = record(value);
  if (provider === 'openai') {
    if (!Array.isArray(response['choices'])) throw new TypeError('Unsupported OpenAI response.');
    return { ...response, choices: response['choices'].map((raw: unknown) => {
      const choice = record(raw), message = record(choice['message']);
      return { ...choice, message: { ...message, ...(typeof message['content'] === 'string' ? { content: session.restore(message['content']) } : {}) } };
    }) };
  }
  if (!Array.isArray(response['content'])) throw new TypeError('Unsupported Anthropic response.');
  return { ...response, content: response['content'].map((raw: unknown) => {
    const block = record(raw);
    return block['type'] === 'text' && typeof block['text'] === 'string' ? { ...block, text: session.restore(block['text']) } : block;
  }) };
}
/** Explicit bounded facade, NOT a proxy claiming full native SDK compatibility. */
function adapter(client: unknown, provider: 'openai' | 'anthropic', options: ClientOptions) {
  const root = record(client);
  const endpoint = provider === 'openai' ? record(root['chat'])['completions'] : root['messages'];
  const call = method(endpoint, 'create');
  const timeout = options.timeoutMs ?? 300_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1_800_000) throw new RangeError('Invalid request timeout.');
  async function create(input: Record<string, unknown>, request: RequestOptions = {}): Promise<unknown> {
    const texts: string[] = [];
    payload(input, provider, text => { texts.push(text); return text; }, options);
    const session = createMaskSession([...texts, JSON.stringify(input)], options);
    const controller = new AbortController();
    const parsers = new Map<number, RestoreParser>();
    let ended = false;
    const cleanup = () => {
      if (ended) return; ended = true; clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
      for (const parser of parsers.values()) parser.clear(); parsers.clear(); session.clear();
    };
    const abort = () => { controller.abort(request.signal?.reason); cleanup(); };
    const expiresAt = Date.now() + timeout;
    const assertAlive = () => { if (Date.now() >= expiresAt) { controller.abort(new Error('Shield request expired.')); cleanup(); } controller.signal.throwIfAborted(); };
    const timer = setTimeout(() => { controller.abort(new Error('Shield request expired.')); cleanup(); }, timeout);
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abort();
    try {
      assertAlive();
      const masked = payload(input, provider, session.mask, options);
      const response: unknown = await call(masked, { ...request, signal: controller.signal });
      assertAlive();
      if (input['stream'] !== true) { try { return restoredResponse(response, provider, session); } finally { cleanup(); } }
      const stream = record(response);
      const iteratorFn: unknown = Reflect.get(stream, Symbol.asyncIterator);
      if (typeof iteratorFn !== 'function') throw new TypeError('Expected SDK async iterable.');
      let consumed = false;
      const getParser = (index: number) => {
        let parser = parsers.get(index);
        if (!parser) { if (parsers.size >= 32) throw new RangeError('Channel limit exceeded.'); parser = session.parser(); parsers.set(index, parser); }
        return parser;
      };
      const iterable: AsyncIterable<unknown> = { [Symbol.asyncIterator]: () => Reflect.apply(iteratorFn, response, []) as AsyncIterator<unknown> };
      const protectedStream: TextStream = {
        abort() { controller.abort(new Error('Shield stream aborted.')); cleanup(); },
        async *[Symbol.asyncIterator]() {
          if (consumed) throw new Error('Shield stream is single-consumer.'); consumed = true;
          try {
            assertAlive();
            for await (const raw of iterable) {
              assertAlive();
              const event = record(raw);
              if (provider === 'openai') {
                if (!Array.isArray(event['choices'])) throw new TypeError('Unsupported stream chunk.');
                const choices = event['choices'].map((rawChoice: unknown) => {
                  const choice = record(rawChoice), delta = record(choice['delta']);
                  const index = choice['index'];
                  if (!Number.isInteger(index) || typeof index !== 'number' || index < 0) throw new TypeError('Invalid channel.');
                  const parser = getParser(index);
                  let text = typeof delta['content'] === 'string' ? parser.push(delta['content']) : '';
                  if (choice['finish_reason'] !== null && choice['finish_reason'] !== undefined) text += parser.finish();
                  return { ...choice, delta: { ...delta, ...(typeof delta['content'] === 'string' || text ? { content: text } : {}) } };
                });
                yield { ...event, choices };
              } else {
                const index = event['index'];
                if (event['type'] === 'content_block_delta') {
                  const delta = record(event['delta']);
                  if (delta['type'] === 'text_delta') {
                    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || typeof delta['text'] !== 'string') throw new TypeError('Invalid text delta.');
                    yield { ...event, delta: { ...delta, text: getParser(index).push(delta['text']) } }; continue;
                  }
                } else if (event['type'] === 'content_block_stop' && typeof index === 'number') {
                  const tail = parsers.get(index)?.finish();
                  if (tail) yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text: tail } };
                } else if (event['type'] === 'content_block_start') {
                  const block = record(event['content_block']);
                  if (block['type'] === 'text' && typeof block['text'] === 'string') {
                    if (typeof index !== 'number') throw new TypeError('Invalid block index.');
                    yield { ...event, content_block: { ...block, text: getParser(index).push(block['text']) } }; continue;
                  }
                }
                yield event;
              }
            }
            for (const parser of parsers.values()) if (parser.finish()) throw new Error('Truncated stream without channel-end event.');
          } finally { controller.abort(); cleanup(); }
        },
      };
      return protectedStream;
    } catch (error) { controller.abort(); cleanup(); throw error; }
  }
  return create;
}
export interface OpenAITextResponse {
  choices: { message: { content?: string | null; [key: string]: unknown }; [key: string]: unknown }[];
  [key: string]: unknown;
}
export interface OpenAITextChunk {
  choices: { index: number; delta: { content?: string | null; [key: string]: unknown }; finish_reason?: string | null; [key: string]: unknown }[];
  [key: string]: unknown;
}
export interface AnthropicTextResponse { content: { type: string; text?: string; [key: string]: unknown }[]; [key: string]: unknown }
export interface AnthropicTextEvent { type: string; index?: number; delta?: { type: string; text?: string; [key: string]: unknown }; [key: string]: unknown }
interface OpenAICreate {
  (body: Record<string, unknown> & { stream: true }, request?: RequestOptions): Promise<TextStream<OpenAITextChunk>>;
  (body: Record<string, unknown> & { stream?: false }, request?: RequestOptions): Promise<OpenAITextResponse>;
  (body: Record<string, unknown>, request?: RequestOptions): Promise<OpenAITextResponse | TextStream<OpenAITextChunk>>;
}
interface AnthropicCreate {
  (body: Record<string, unknown> & { stream: true }, request?: RequestOptions): Promise<TextStream<AnthropicTextEvent>>;
  (body: Record<string, unknown> & { stream?: false }, request?: RequestOptions): Promise<AnthropicTextResponse>;
  (body: Record<string, unknown>, request?: RequestOptions): Promise<AnthropicTextResponse | TextStream<AnthropicTextEvent>>;
}
export function wrapOpenAI(client: unknown, options: ClientOptions = {}) {
  return { chat: { completions: { create: adapter(client, 'openai', options) as OpenAICreate } } };
}
export function wrapAnthropic(client: unknown, options: ClientOptions = {}) {
  const create = adapter(client, 'anthropic', options) as AnthropicCreate;
  return { messages: { create, async stream(body: Record<string, unknown>, request: RequestOptions = {}): Promise<TextStream<AnthropicTextEvent>> {
    return await create({ ...body, stream: true }, request) as TextStream<AnthropicTextEvent>;
  } } };
}
