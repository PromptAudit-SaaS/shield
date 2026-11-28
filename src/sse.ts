import { managedTransform, RestoreParser, type UnshieldStreamOptions } from './stream';

export interface SseUnshieldOptions extends UnshieldStreamOptions {
  /** Explicit wire format; not a universal SDK interceptor. */
  provider: 'openai' | 'anthropic';
  /** Per SSE event, in UTF-16 code units. Overflow and malformed JSON fail explicitly. */
  maxEventSize?: number;
  maxChannels?: number;
}
type Obj = Record<string, unknown>;
function object(value: unknown): Obj | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : undefined;
}

/** Parses SSE events, not individual lines; retains event/id/retry/comment fields and non-text data. */
export function createUnshieldSseStream(
  vault: Map<string, string>, options: SseUnshieldOptions,
): ReadableWritablePair<Uint8Array, Uint8Array> {
  const maxEvent = options.maxEventSize ?? 65536;
  const maxChannels = options.maxChannels ?? 32;
  if (!Number.isInteger(maxEvent) || maxEvent < 256 || maxEvent > 1048576
    || !Number.isInteger(maxChannels) || maxChannels < 1 || maxChannels > 128) {
    throw new RangeError('Invalid SSE bounds.');
  }
  if (options.provider !== 'openai' && options.provider !== 'anthropic') {
    throw new TypeError('Unsupported SSE provider.');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  let pending = '';
  let afterCR = false;
  let lines: string[] = [];
  let eventSize = 0;
  const channels = new Map<string, { parser: RestoreParser; template: Obj; headers: string[] }>();
  const emit = (controller: TransformStreamDefaultController<Uint8Array>, text: string) => {
    controller.enqueue(encoder.encode(text));
  };
  const textFields = (payload: Obj): { id: string; field: Obj; key: string }[] => {
    if (options.provider === 'anthropic') {
      const delta = object(payload['delta']);
      const index = payload['index'];
      return payload['type'] === 'content_block_delta' && delta?.['type'] === 'text_delta'
        && typeof delta['text'] === 'string' && Number.isInteger(index)
        ? [{ id: `a:${String(index)}`, field: delta, key: 'text' }] : [];
    }
    const choices = payload['choices'];
    if (!Array.isArray(choices)) return [];
    return choices.flatMap((choice: unknown) => {
      const item = object(choice);
      const delta = object(item?.['delta']);
      return delta && typeof delta['content'] === 'string' && Number.isInteger(item?.['index'])
        ? [{ id: `o:${String(item?.['index'])}`, field: delta, key: 'content' }] : [];
    });
  };
  const finishChannels = (controller: TransformStreamDefaultController<Uint8Array>, ids?: Set<string>) => {
    for (const [id, channel] of channels) {
      if (ids && !ids.has(id)) continue;
      const tail = channel.parser.finish();
      if (tail) {
        // Tail-only delta: never replay tool arguments, usage, role or other incremental fields.
        const previous = channel.template;
        const index = Number(id.slice(2));
        const template: Obj = options.provider === 'anthropic'
          ? { type: 'content_block_delta', index, delta: { type: 'text_delta', text: tail } }
          : { choices: [{ index, delta: { content: tail }, finish_reason: null }] };
        for (const key of ['id', 'object', 'created', 'model']) {
          if (previous[key] !== undefined) template[key] = previous[key];
        }
        emit(controller, [...channel.headers, `data: ${JSON.stringify(template)}`, '', ''].join('\n'));
      }
      channel.parser.clear();
      channels.delete(id);
    }
  };
  const event = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!lines.length) return;
    const headers = lines.filter((line) => !/^data(?::|$)/.test(line));
    const data = lines.filter((line) => /^data(?::|$)/.test(line))
      .map((line) => line.slice(4).replace(/^: ?/, '')).join('\n');
    const original = lines.join('\n') + '\n\n';
    lines = []; eventSize = 0;
    if (!data) { emit(controller, original); return; }
    if (data === '[DONE]') { finishChannels(controller); emit(controller, original); return; }
    const parsed: unknown = JSON.parse(data);
    const payload = object(parsed);
    if (!payload) throw new TypeError('SSE JSON must be an object.');
    // Flush unfinished text before a provider's lifecycle end, never after it.
    if (payload['type'] === 'message_stop') finishChannels(controller);
    if (payload['type'] === 'content_block_stop') {
      finishChannels(controller, new Set([`a:${String(payload['index'])}`]));
    }
    const ended = new Set<string>();
    if (Array.isArray(payload['choices'])) {
      for (const choice of payload['choices']) {
        const item = object(choice);
        if (item?.['finish_reason'] != null) ended.add(`o:${String(item['index'])}`);
      }
      // Finish each non-text channel even if another choice has a text delta.
      const withText = new Set(textFields(payload).map((target) => target.id));
      finishChannels(controller, new Set([...ended].filter((id) => !withText.has(id))));
    }
    for (const target of textFields(payload)) {
      let channel = channels.get(target.id);
      if (!channel) {
        if (channels.size >= maxChannels) throw new RangeError('Too many SSE text channels.');
        channel = { parser: new RestoreParser(vault, options.maxBufferSize), template: payload, headers };
        channels.set(target.id, channel);
      }
      channel.template = JSON.parse(JSON.stringify(payload)) as Obj;
      channel.headers = headers;
      const text = target.field[target.key];
      if (typeof text === 'string') target.field[target.key] = channel.parser.push(text);
      if (ended.has(target.id)) {
        target.field[target.key] = String(target.field[target.key]) + channel.parser.finish();
        channel.parser.clear();
        channels.delete(target.id);
      }
    }
    emit(controller, [...headers, `data: ${JSON.stringify(payload)}`, '', ''].join('\n'));
  };
  const feed = (text: string, controller: TransformStreamDefaultController<Uint8Array>, final = false) => {
    for (const char of text) {
      if (afterCR && char === '\n') { afterCR = false; continue; }
      afterCR = false;
      if (char === '\r' || char === '\n') {
        const line = pending;
        pending = '';
        afterCR = char === '\r';
        if (!line) event(controller);
        else { lines.push(line); eventSize += line.length + 1; }
      } else pending += char;
      if (pending.length + eventSize > maxEvent) throw new RangeError('SSE event exceeds maxEventSize.');
    }
    if (final) {
      if (pending) lines.push(pending);
      pending = '';
      event(controller);
    }
  };
  return managedTransform<Uint8Array, Uint8Array>({
    transform(chunk, controller) { feed(decoder.decode(chunk, { stream: true }), controller); },
    flush(controller) { feed(decoder.decode(), controller, true); finishChannels(controller); },
  }, () => {
    pending = ''; lines = [];
    for (const channel of channels.values()) channel.parser.clear();
    channels.clear();
    if (options.clearVaultOnTerminate) vault.clear();
  }, options.signal);
}
