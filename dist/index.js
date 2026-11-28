// src/validators.ts
var digitsOf = (s) => s.replace(/\D/g, "");
function isValidIban(raw) {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s))
    return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v)
      rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
function isValidLuhn(raw) {
  const d = digitsOf(raw);
  if (d.length < 13 || d.length > 19)
    return false;
  let sum = 0;
  for (let i = 0;i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9)
        n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}
function isCardNumber(raw) {
  const d = digitsOf(raw);
  const brand = /^4\d{12}(?:\d{3})?$|^(?:5[1-5]\d{14}|2[2-7]\d{14})$|^3[47]\d{13}$|^3(?:0[0-5]|[68]\d)\d{11}$|^6(?:011|5\d{2})\d{12}$|^35\d{14}$/;
  return brand.test(d) && isValidLuhn(d);
}
function isValidSsn(raw) {
  const m = /^(\d{3})-(\d{2})-(\d{4})$/.exec(raw.replace(/\s/g, ""));
  if (!m)
    return false;
  const [, a, g, s] = m;
  if (a === "000" || a === "666" || a.startsWith("9"))
    return false;
  return g !== "00" && s !== "0000";
}
function isValidAbaRouting(raw) {
  const d = digitsOf(raw);
  if (d.length !== 9 || /^0{9}$/.test(d))
    return false;
  const n = [...d].map(Number);
  const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
  return sum % 10 === 0;
}

// src/engine.ts
var DEFAULT_DETECTORS = [
  { category: "PRIVATE_KEY", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { category: "DATABASE_URL", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/[^\s"'<>/@]+:[^\s"'<>/@]+@[^\s"'<>]+/gi },
  { category: "SECRET", pattern: /(?<=\b(?:[A-Z][A-Z0-9_]*_)?(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY)(?:_[A-Z0-9_]+)?[ \t]*=[ \t]*["']?)[^\s"'#]+/gim, validate: (value) => !/^(?:\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*|\[[A-Z_]+_\d+\])$/i.test(value) },
  { category: "SECRET", pattern: /(?<=\bBearer[ \t]+)[A-Za-z0-9._~+\/-]{8,}={0,2}/gi },
  { category: "API_KEY", pattern: /\bsk-(?:proj-|ant-(?:api\d{2}-)?)?[A-Za-z0-9_-]{20,}/g },
  { category: "API_KEY", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { category: "API_KEY", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { category: "API_KEY", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { category: "API_KEY", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/g },
  { category: "EMAIL", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { category: "IBAN", pattern: /\b[A-Z]{2}[ \t-]*\d{2}(?:[ \t-]*[0-9A-Z]){11,30}\b/g, validate: isValidIban },
  { category: "CREDIT_CARD", pattern: /(?<![\d-])\d(?:[ \t-]?\d){12,18}(?![\d-])/g, validate: isCardNumber },
  { category: "US_SSN", pattern: /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g, validate: isValidSsn },
  { category: "ROUTING", pattern: /(?<=\b(?:routing|ABA|RTN|transit)(?:[ \t]+(?:number|no\.?|#))?[ \t]*[:#]?[ \t]*)\d{9}\b/gi, validate: isValidAbaRouting },
  { category: "PHONE", pattern: /(?<![\w+])\+\d{1,3}(?:[ \t.-]?\(?\d{1,4}\)?){2,5}\d(?!\d)/g },
  { category: "NAME", pattern: /(?<=\b(?:Mr|Mrs|Ms|Dr|Prof)\.?[ \t]+|\bMiss[ \t]+)[A-Z][a-z'-]+(?:[ \t]+[A-Z][a-z'-]+)?/g }
];
function normalize(text) {
  return text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248));
}
function shield(text, detectors = DEFAULT_DETECTORS) {
  let masked = normalize(text);
  const map = new Map;
  const reverse = new Map;
  const counts = {};
  for (const d of detectors) {
    masked = masked.replace(new RegExp(d.pattern.source, d.pattern.flags), (m) => {
      if (d.validate && !d.validate(m))
        return m;
      const known = reverse.get(m);
      if (known)
        return known;
      const n = (counts[d.category] ?? 0) + 1;
      counts[d.category] = n;
      const ph = `[${d.category}_${n}]`;
      map.set(ph, m);
      reverse.set(m, ph);
      return ph;
    });
  }
  return { masked, map, counts };
}
function unshield(text, map) {
  return text.replace(/\[[A-Z_]+_\d+\]/g, (ph) => map.get(ph) ?? ph);
}
async function withShield(prompt, call) {
  const { masked, map } = shield(prompt);
  return unshield(await call(masked), map);
}
// src/custom-terms.ts
var word = (char) => char !== undefined && /[\p{L}\p{N}\p{M}_]/u.test(char);

class CustomTermMatcher {
  options;
  nodes = [{ next: new Map, fail: 0, output: [] }];
  terms = [];
  constructor(terms, options = {}) {
    this.options = options;
    if (terms.length > 1000)
      throw new RangeError("At most 1000 custom terms.");
    const unique = new Set;
    for (const term of terms) {
      if (!term || term.length > 256)
        throw new RangeError("Terms must contain 1–256 UTF-16 units.");
      const chars = Array.from(term);
      const folded = chars.map((c) => this.fold(c));
      const key = JSON.stringify(folded);
      if (unique.has(key))
        continue;
      unique.add(key);
      const id = this.terms.length;
      this.terms.push(chars);
      let state = 0;
      for (const char of folded) {
        const node = this.node(state);
        let next = node.next.get(char);
        if (next === undefined) {
          next = this.nodes.length;
          node.next.set(char, next);
          this.nodes.push({ next: new Map, fail: 0, output: [] });
        }
        state = next;
      }
      this.node(state).output.push(id);
    }
    const queue = [...this.node(0).next.values()];
    for (let head = 0;head < queue.length; head++) {
      const state = queue[head];
      if (state === undefined)
        throw new Error("Invalid trie.");
      for (const [char, target] of this.node(state).next) {
        queue.push(target);
        let fallback = this.node(state).fail;
        while (fallback && !this.node(fallback).next.has(char))
          fallback = this.node(fallback).fail;
        const fail = this.node(fallback).next.get(char) ?? 0;
        this.node(target).fail = fail;
        this.node(target).output.push(...this.node(fail).output);
      }
    }
  }
  fold(char) {
    return this.options.caseInsensitive === false ? char : char.toLowerCase();
  }
  node(index) {
    const node = this.nodes[index];
    if (!node)
      throw new Error("Invalid trie.");
    return node;
  }
  findMatches(text) {
    if (text.length > 1048576)
      throw new RangeError("Text limit exceeded.");
    const chars = Array.from(text);
    const offsets = [0];
    for (const char of chars)
      offsets.push((offsets.at(-1) ?? 0) + char.length);
    const best = new Map;
    let state = 0, candidates = 0;
    for (let i = 0;i < chars.length; i++) {
      const raw = chars[i];
      if (raw === undefined)
        continue;
      const char = this.fold(raw);
      while (state && !this.node(state).next.has(char))
        state = this.node(state).fail;
      state = this.node(state).next.get(char) ?? 0;
      for (const id of this.node(state).output) {
        if (++candidates > 1e5)
          throw new RangeError("Match budget exceeded.");
        const term = this.terms[id];
        if (!term)
          throw new Error("Invalid term.");
        const start = i + 1 - term.length;
        if (this.options.wholeWords !== false && (word(term[0]) && word(chars[start - 1]) || word(term.at(-1)) && word(chars[i + 1])))
          continue;
        best.set(start, Math.max(best.get(start) ?? 0, i + 1));
      }
    }
    const result = [];
    for (let i = 0;i < chars.length; ) {
      const end = best.get(i);
      if (end === undefined) {
        i++;
        continue;
      }
      const startOffset = offsets[i], endOffset = offsets[end];
      if (startOffset === undefined || endOffset === undefined)
        throw new Error("Invalid offset.");
      result.push({ start: startOffset, end: endOffset });
      i = end;
    }
    return result;
  }
}

// src/stream.ts
class RestoreParser {
  vault;
  pending = "";
  prefixes = new Set;
  constructor(vault, limit = 256) {
    this.vault = vault;
    if (!Number.isInteger(limit) || limit < 8 || limit > 4096) {
      throw new RangeError("maxBufferSize must be an integer between 8 and 4096.");
    }
    for (const key of vault.keys()) {
      if (!/^\[[A-Z_]+_\d+\]$/.test(key) || key.length > limit) {
        throw new RangeError("Map keys must be supported placeholders fitting maxBufferSize.");
      }
      for (let i = 1;i < key.length; i++)
        this.prefixes.add(key.slice(0, i));
    }
  }
  push(chunk) {
    if (this.prefixes.size === 0)
      return chunk;
    let out = "";
    for (const char of chunk) {
      const candidate = this.pending + char;
      const original = this.vault.get(candidate);
      if (original !== undefined) {
        out += original;
        this.pending = "";
      } else if (this.prefixes.has(candidate)) {
        this.pending = candidate;
      } else {
        out += this.pending;
        this.pending = "";
        if (this.prefixes.has(char))
          this.pending = char;
        else
          out += char;
      }
    }
    return out;
  }
  finish() {
    const tail = this.pending;
    this.pending = "";
    return tail;
  }
  clear() {
    this.pending = "";
    this.prefixes.clear();
  }
}
function managedTransform(transformer, cleanup, signal) {
  const native = new TransformStream(transformer);
  const reader = native.readable.getReader();
  const writer = native.writable.getWriter();
  let ended = false;
  let outputController;
  let writableController;
  const end = () => {
    if (ended)
      return;
    ended = true;
    signal?.removeEventListener("abort", abort);
    writableController?.signal.removeEventListener("abort", writableAbort);
    cleanup();
  };
  const abort = () => {
    const reason = signal?.reason ?? new Error("Stream aborted.");
    outputController?.error(reason);
    end();
    Promise.allSettled([reader.cancel(reason), writer.abort(reason)]);
  };
  const writableAbort = () => {
    const reason = writableController?.signal.reason ?? new Error("Stream aborted.");
    outputController?.error(reason);
    end();
    Promise.allSettled([reader.cancel(reason), writer.abort(reason)]);
  };
  const readable = new ReadableStream({
    start(controller) {
      outputController = controller;
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          end();
          controller.close();
        } else
          controller.enqueue(result.value);
      } catch (error) {
        end();
        controller.error(error);
      }
    },
    async cancel(reason) {
      end();
      await Promise.allSettled([reader.cancel(reason), writer.abort(reason)]);
    }
  }, { highWaterMark: 0 });
  const writable = new WritableStream({
    start(controller) {
      writableController = controller;
      controller.signal.addEventListener("abort", writableAbort, { once: true });
    },
    async write(chunk) {
      if (ended)
        throw new Error("Stream has terminated.");
      try {
        await writer.write(chunk);
      } catch (error) {
        end();
        throw error;
      }
    },
    async close() {
      try {
        await writer.close();
      } finally {
        end();
      }
    },
    async abort(reason) {
      end();
      await writer.abort(reason);
    }
  });
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted)
    abort();
  return { readable, writable };
}
function createUnshieldStream(vault, options = {}) {
  const parser = new RestoreParser(vault, options.maxBufferSize);
  return managedTransform({
    transform(chunk, controller) {
      const text = parser.push(chunk);
      if (text)
        controller.enqueue(text);
    },
    flush(controller) {
      const tail = parser.finish();
      if (tail)
        controller.enqueue(tail);
    }
  }, () => {
    parser.clear();
    if (options.clearVaultOnTerminate)
      vault.clear();
  }, options.signal);
}

// src/session.ts
function createMaskSession(reservedTexts, options = {}) {
  const reserved = reservedTexts.map(normalize).join(`
`);
  if (reserved.length > 1048576)
    throw new RangeError("Request text limit exceeded.");
  const matcher = new CustomTermMatcher(options.customTerms ?? [], options);
  const vault = new Map, reverse = new Map;
  const counts = {};
  const counters = {};
  let active = true;
  const guard = () => {
    if (!active)
      throw new Error("Shield session has been cleared.");
  };
  const token = (value, category) => {
    const known = reverse.get(value);
    if (known !== undefined)
      return known;
    if (vault.size >= 1e4)
      throw new RangeError("Placeholder limit exceeded.");
    let n = counters[category] ?? 0, key;
    do {
      key = `[${category}_${++n}]`;
    } while (reserved.includes(key) || vault.has(key));
    counters[category] = n;
    counts[category] = (counts[category] ?? 0) + 1;
    vault.set(key, value);
    reverse.set(value, key);
    return key;
  };
  return {
    counts,
    mask(text) {
      guard();
      let masked = normalize(text);
      if (masked.length > 1048576)
        throw new RangeError("Text limit exceeded.");
      for (const d of options.detectors ?? DEFAULT_DETECTORS) {
        masked = masked.replace(new RegExp(d.pattern.source, d.pattern.flags), (value) => d.validate && !d.validate(value) ? value : token(value, d.category));
      }
      masked = masked.split(/(\[[A-Z_]+_\d+\])/g).map((segment) => {
        if (/^\[[A-Z_]+_\d+\]$/.test(segment))
          return segment;
        let out = "", cursor = 0;
        for (const match of matcher.findMatches(segment)) {
          out += segment.slice(cursor, match.start) + token(segment.slice(match.start, match.end), "TERM");
          cursor = match.end;
        }
        return out + segment.slice(cursor);
      }).join("");
      return masked;
    },
    restore(text) {
      guard();
      return text.replace(/\[[A-Z_]+_\d+\]/g, (key) => vault.get(key) ?? key);
    },
    parser() {
      guard();
      return new RestoreParser(vault);
    },
    createRestoreStream(options = {}) {
      guard();
      if (options.clearVaultOnTerminate)
        throw new TypeError("Use session.clear().");
      return createUnshieldStream(vault, options);
    },
    clear() {
      active = false;
      vault.clear();
      reverse.clear();
    }
  };
}

// src/facade.ts
function shield2(text, options = DEFAULT_DETECTORS) {
  if (Array.isArray(options))
    return shield(text, options);
  const session = createMaskSession([text], options);
  try {
    const masked = session.mask(text);
    const map = new Map;
    for (const token of masked.match(/\[[A-Z_]+_\d+\]/g) ?? []) {
      const original = session.restore(token);
      if (original !== token)
        map.set(token, original);
    }
    return { masked, map, counts: session.counts };
  } finally {
    session.clear();
  }
}
// src/messages.ts
function textsOf(content) {
  if (typeof content === "string")
    return [content];
  if (content === null)
    return [];
  return content.map((part) => {
    if (!part || typeof part !== "object" || !("type" in part) || part.type !== "text" || !("text" in part) || typeof part.text !== "string") {
      throw new TypeError("Only string content and text-only content blocks are supported.");
    }
    return part.text;
  });
}
function shieldMessages(messages, detectors = DEFAULT_DETECTORS) {
  for (const message of messages) {
    if ("tool_calls" in message || "function_call" in message || message.role === "tool") {
      throw new TypeError("Tool calls and tool results require explicit masking outside shieldMessages.");
    }
  }
  const options = Array.isArray(detectors) ? { detectors } : detectors;
  const session = createMaskSession(messages.flatMap((message) => textsOf(message.content)), options);
  const mask = session.mask;
  let maskedMessages;
  try {
    maskedMessages = messages.map((message) => ({
      ...message,
      content: typeof message.content === "string" ? mask(message.content) : message.content === null ? null : message.content.map((part) => {
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return { ...part, text: mask(part.text) };
        }
        throw new TypeError("Unsupported content block.");
      })
    }));
  } catch (error) {
    session.clear();
    throw error;
  }
  return {
    messages: maskedMessages,
    counts: session.counts,
    restore: session.restore,
    createRestoreStream: session.createRestoreStream,
    clear: session.clear
  };
}
// src/sse.ts
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function createUnshieldSseStream(vault, options) {
  const maxEvent = options.maxEventSize ?? 65536;
  const maxChannels = options.maxChannels ?? 32;
  if (!Number.isInteger(maxEvent) || maxEvent < 256 || maxEvent > 1048576 || !Number.isInteger(maxChannels) || maxChannels < 1 || maxChannels > 128) {
    throw new RangeError("Invalid SSE bounds.");
  }
  if (options.provider !== "openai" && options.provider !== "anthropic") {
    throw new TypeError("Unsupported SSE provider.");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encoder = new TextEncoder;
  let pending = "";
  let afterCR = false;
  let lines = [];
  let eventSize = 0;
  const channels = new Map;
  const emit = (controller, text) => {
    controller.enqueue(encoder.encode(text));
  };
  const textFields = (payload) => {
    if (options.provider === "anthropic") {
      const delta = object(payload["delta"]);
      const index = payload["index"];
      return payload["type"] === "content_block_delta" && delta?.["type"] === "text_delta" && typeof delta["text"] === "string" && Number.isInteger(index) ? [{ id: `a:${String(index)}`, field: delta, key: "text" }] : [];
    }
    const choices = payload["choices"];
    if (!Array.isArray(choices))
      return [];
    return choices.flatMap((choice) => {
      const item = object(choice);
      const delta = object(item?.["delta"]);
      return delta && typeof delta["content"] === "string" && Number.isInteger(item?.["index"]) ? [{ id: `o:${String(item?.["index"])}`, field: delta, key: "content" }] : [];
    });
  };
  const finishChannels = (controller, ids) => {
    for (const [id, channel] of channels) {
      if (ids && !ids.has(id))
        continue;
      const tail = channel.parser.finish();
      if (tail) {
        const previous = channel.template;
        const index = Number(id.slice(2));
        const template = options.provider === "anthropic" ? { type: "content_block_delta", index, delta: { type: "text_delta", text: tail } } : { choices: [{ index, delta: { content: tail }, finish_reason: null }] };
        for (const key of ["id", "object", "created", "model"]) {
          if (previous[key] !== undefined)
            template[key] = previous[key];
        }
        emit(controller, [...channel.headers, `data: ${JSON.stringify(template)}`, "", ""].join(`
`));
      }
      channel.parser.clear();
      channels.delete(id);
    }
  };
  const event = (controller) => {
    if (!lines.length)
      return;
    const headers = lines.filter((line) => !/^data(?::|$)/.test(line));
    const data = lines.filter((line) => /^data(?::|$)/.test(line)).map((line) => line.slice(4).replace(/^: ?/, "")).join(`
`);
    const original = lines.join(`
`) + `

`;
    lines = [];
    eventSize = 0;
    if (!data) {
      emit(controller, original);
      return;
    }
    if (data === "[DONE]") {
      finishChannels(controller);
      emit(controller, original);
      return;
    }
    const parsed = JSON.parse(data);
    const payload = object(parsed);
    if (!payload)
      throw new TypeError("SSE JSON must be an object.");
    if (payload["type"] === "message_stop")
      finishChannels(controller);
    if (payload["type"] === "content_block_stop") {
      finishChannels(controller, new Set([`a:${String(payload["index"])}`]));
    }
    const ended = new Set;
    if (Array.isArray(payload["choices"])) {
      for (const choice of payload["choices"]) {
        const item = object(choice);
        if (item?.["finish_reason"] != null)
          ended.add(`o:${String(item["index"])}`);
      }
      const withText = new Set(textFields(payload).map((target) => target.id));
      finishChannels(controller, new Set([...ended].filter((id) => !withText.has(id))));
    }
    for (const target of textFields(payload)) {
      let channel = channels.get(target.id);
      if (!channel) {
        if (channels.size >= maxChannels)
          throw new RangeError("Too many SSE text channels.");
        channel = { parser: new RestoreParser(vault, options.maxBufferSize), template: payload, headers };
        channels.set(target.id, channel);
      }
      channel.template = JSON.parse(JSON.stringify(payload));
      channel.headers = headers;
      const text = target.field[target.key];
      if (typeof text === "string")
        target.field[target.key] = channel.parser.push(text);
      if (ended.has(target.id)) {
        target.field[target.key] = String(target.field[target.key]) + channel.parser.finish();
        channel.parser.clear();
        channels.delete(target.id);
      }
    }
    emit(controller, [...headers, `data: ${JSON.stringify(payload)}`, "", ""].join(`
`));
  };
  const feed = (text, controller, final = false) => {
    for (const char of text) {
      if (afterCR && char === `
`) {
        afterCR = false;
        continue;
      }
      afterCR = false;
      if (char === "\r" || char === `
`) {
        const line = pending;
        pending = "";
        afterCR = char === "\r";
        if (!line)
          event(controller);
        else {
          lines.push(line);
          eventSize += line.length + 1;
        }
      } else
        pending += char;
      if (pending.length + eventSize > maxEvent)
        throw new RangeError("SSE event exceeds maxEventSize.");
    }
    if (final) {
      if (pending)
        lines.push(pending);
      pending = "";
      event(controller);
    }
  };
  return managedTransform({
    transform(chunk, controller) {
      feed(decoder.decode(chunk, { stream: true }), controller);
    },
    flush(controller) {
      feed(decoder.decode(), controller, true);
      finishChannels(controller);
    }
  }, () => {
    pending = "";
    lines = [];
    for (const channel of channels.values())
      channel.parser.clear();
    channels.clear();
    if (options.clearVaultOnTerminate)
      vault.clear();
  }, options.signal);
}
// src/tool-calls.ts
function walkStructured(value, transform, options = {}) {
  const maxDepth = options.maxDepth ?? 64, maxNodes = options.maxNodes ?? 50000;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 128 || !Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 1e5)
    throw new RangeError("Invalid structured limits.");
  const seen = new Set;
  let nodes = 0, textUnits = 0;
  function walk(input, depth) {
    if (++nodes > maxNodes || depth > maxDepth)
      throw new RangeError("Structured limit exceeded.");
    if (typeof input === "string") {
      textUnits += input.length;
      if (textUnits > 1048576)
        throw new RangeError("Structured text limit exceeded.");
      return transform(input);
    }
    if (input === null || typeof input === "boolean" || typeof input === "number" && Number.isFinite(input))
      return input;
    if (typeof input !== "object" || input === null)
      throw new TypeError("Only plain JSON values are supported.");
    const proto = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && proto !== Object.prototype && proto !== null)
      throw new TypeError("Only plain JSON objects are supported.");
    if (seen.has(input))
      throw new TypeError("Cyclic input is not supported.");
    seen.add(input);
    try {
      const output = Array.isArray(input) ? [] : Object.create(null);
      for (const key of Object.keys(input)) {
        textUnits += key.length;
        if (textUnits > 1048576)
          throw new RangeError("Structured text limit exceeded.");
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !("value" in descriptor))
          throw new TypeError("Accessors are not supported.");
        Object.defineProperty(output, key, { value: walk(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
      }
      if (Array.isArray(input) && Array.isArray(output))
        output.length = input.length;
      return output;
    } finally {
      seen.delete(input);
    }
  }
  return walk(value, 0);
}
function transformSerializedJson(raw, transform, options = {}) {
  if (raw.length > 1048576)
    throw new RangeError("JSON text limit exceeded.");
  JSON.parse(raw);
  let depth = 0, strings = 0;
  const maxDepth = options.maxDepth ?? 64;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 128)
    throw new RangeError("Invalid JSON depth.");
  let out = "", cursor = 0;
  for (let i = 0;i < raw.length; i++) {
    const char = raw[i];
    if (char === "{" || char === "[") {
      if (++depth > maxDepth)
        throw new RangeError("JSON depth exceeded.");
    } else if (char === "}" || char === "]")
      depth--;
    else if (char === '"') {
      const start = i++;
      for (;i < raw.length; i++) {
        if (raw[i] === "\\")
          i++;
        else if (raw[i] === '"')
          break;
      }
      if (++strings > 50000)
        throw new RangeError("JSON string budget exceeded.");
      let next = i + 1;
      while (/\s/.test(raw[next] ?? "") && next < raw.length)
        next++;
      if (raw[next] !== ":") {
        const literal = raw.slice(start, i + 1);
        const value = JSON.parse(literal);
        if (typeof value !== "string")
          throw new TypeError("Invalid string.");
        const masked = transform(value);
        out += raw.slice(cursor, start) + (masked === value ? literal : JSON.stringify(masked));
        cursor = i + 1;
      }
    }
  }
  return out + raw.slice(cursor);
}
function shieldStructured(value, options = {}) {
  const texts = [];
  walkStructured(value, (text) => {
    texts.push(text);
    return text;
  }, options);
  const session = createMaskSession([...texts, JSON.stringify(value)], options);
  try {
    return { data: walkStructured(value, session.mask, options), restore: session.restore, clear: session.clear, counts: session.counts };
  } catch (error) {
    session.clear();
    throw error;
  }
}
function transformToolCalls(calls, transform, options = {}) {
  if (!Array.isArray(calls) || calls.length > 1000)
    throw new TypeError("Expected at most 1000 tool calls.");
  walkStructured(calls, (text) => text, options);
  return calls.map((call) => {
    if (!call || typeof call !== "object" || Array.isArray(call))
      throw new TypeError("Invalid tool call.");
    const record = call;
    const fn = record["function"];
    if (record["type"] === "function" && fn && typeof fn === "object" && !Array.isArray(fn)) {
      const f = fn;
      if (typeof f["arguments"] !== "string")
        throw new TypeError("Expected serialized tool arguments.");
      return { ...record, function: { ...f, arguments: transformSerializedJson(f["arguments"], transform, options) } };
    }
    if (record["type"] === "tool_use" && "input" in record)
      return { ...record, input: walkStructured(record["input"], transform, options) };
    throw new TypeError("Unsupported tool call type.");
  });
}
function shieldToolCalls(calls, options = {}) {
  const texts = [];
  transformToolCalls(calls, (text) => {
    texts.push(text);
    return text;
  }, options);
  const session = createMaskSession([...texts, JSON.stringify(calls)], options);
  try {
    return { data: transformToolCalls(calls, session.mask, options), restore: session.restore, clear: session.clear, counts: session.counts };
  } catch (error) {
    session.clear();
    throw error;
  }
}
// src/clients.ts
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Expected object.");
  return value;
}
function method(target, name) {
  const object = record(target), fn = object[name];
  if (typeof fn !== "function")
    throw new TypeError(`Missing client method ${name}.`);
  return (body, options) => Reflect.apply(fn, target, [body, options]);
}
function payload(body, provider, mask, options) {
  walkStructured(body, (text) => text, options);
  if (!Array.isArray(body["messages"]) || body["messages"].length > 1000)
    throw new TypeError("Expected messages.");
  const messages = body["messages"].map((raw) => {
    const m = record(raw);
    if ("function_call" in m)
      throw new TypeError("Legacy function calls are unsupported.");
    const content = m["content"];
    let masked;
    if (typeof content === "string")
      masked = m["role"] === "tool" ? transformSerializedJson(content, mask, options) : mask(content);
    else if (content === null)
      masked = null;
    else if (Array.isArray(content))
      masked = content.map((rawPart) => {
        const part = record(rawPart);
        if (part["type"] === "text" && typeof part["text"] === "string")
          return { ...part, text: mask(part["text"]) };
        if (provider === "anthropic" && part["type"] === "tool_use") {
          const transformed = transformToolCalls([part], mask, options);
          if (!Array.isArray(transformed))
            throw new TypeError("Invalid transformed tools.");
          return transformed[0];
        }
        if (provider === "anthropic" && part["type"] === "tool_result" && typeof part["content"] === "string")
          return { ...part, content: mask(part["content"]) };
        throw new TypeError("Unsupported content block.");
      });
    else
      throw new TypeError("Unsupported message content.");
    return { ...m, content: masked, ..."tool_calls" in m ? { tool_calls: transformToolCalls(m["tool_calls"], mask, options) } : {} };
  });
  let system = body["system"];
  if (provider === "anthropic" && system !== undefined) {
    if (typeof system === "string")
      system = mask(system);
    else if (Array.isArray(system))
      system = system.map((raw) => {
        const part = record(raw);
        if (part["type"] !== "text" || typeof part["text"] !== "string")
          throw new TypeError("Unsupported system block.");
        return { ...part, text: mask(part["text"]) };
      });
    else
      throw new TypeError("Unsupported system prompt.");
  }
  return { ...body, messages, ...system !== undefined ? { system } : {} };
}
function restoredResponse(value, provider, session) {
  const response = record(value);
  if (provider === "openai") {
    if (!Array.isArray(response["choices"]))
      throw new TypeError("Unsupported OpenAI response.");
    return { ...response, choices: response["choices"].map((raw) => {
      const choice = record(raw), message = record(choice["message"]);
      return { ...choice, message: { ...message, ...typeof message["content"] === "string" ? { content: session.restore(message["content"]) } : {} } };
    }) };
  }
  if (!Array.isArray(response["content"]))
    throw new TypeError("Unsupported Anthropic response.");
  return { ...response, content: response["content"].map((raw) => {
    const block = record(raw);
    return block["type"] === "text" && typeof block["text"] === "string" ? { ...block, text: session.restore(block["text"]) } : block;
  }) };
}
function adapter(client, provider, options) {
  const root = record(client);
  const endpoint = provider === "openai" ? record(root["chat"])["completions"] : root["messages"];
  const call = method(endpoint, "create");
  const timeout = options.timeoutMs ?? 300000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1800000)
    throw new RangeError("Invalid request timeout.");
  async function create(input, request = {}) {
    const texts = [];
    payload(input, provider, (text) => {
      texts.push(text);
      return text;
    }, options);
    const session = createMaskSession([...texts, JSON.stringify(input)], options);
    const controller = new AbortController;
    const parsers = new Map;
    let ended = false;
    const cleanup = () => {
      if (ended)
        return;
      ended = true;
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
      for (const parser of parsers.values())
        parser.clear();
      parsers.clear();
      session.clear();
    };
    const abort = () => {
      controller.abort(request.signal?.reason);
      cleanup();
    };
    const expiresAt = Date.now() + timeout;
    const assertAlive = () => {
      if (Date.now() >= expiresAt) {
        controller.abort(new Error("Shield request expired."));
        cleanup();
      }
      controller.signal.throwIfAborted();
    };
    const timer = setTimeout(() => {
      controller.abort(new Error("Shield request expired."));
      cleanup();
    }, timeout);
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted)
      abort();
    try {
      assertAlive();
      const masked = payload(input, provider, session.mask, options);
      const response = await call(masked, { ...request, signal: controller.signal });
      assertAlive();
      if (input["stream"] !== true) {
        try {
          return restoredResponse(response, provider, session);
        } finally {
          cleanup();
        }
      }
      const stream = record(response);
      const iteratorFn = Reflect.get(stream, Symbol.asyncIterator);
      if (typeof iteratorFn !== "function")
        throw new TypeError("Expected SDK async iterable.");
      let consumed = false;
      const getParser = (index) => {
        let parser = parsers.get(index);
        if (!parser) {
          if (parsers.size >= 32)
            throw new RangeError("Channel limit exceeded.");
          parser = session.parser();
          parsers.set(index, parser);
        }
        return parser;
      };
      const iterable = { [Symbol.asyncIterator]: () => Reflect.apply(iteratorFn, response, []) };
      const protectedStream = {
        abort() {
          controller.abort(new Error("Shield stream aborted."));
          cleanup();
        },
        async* [Symbol.asyncIterator]() {
          if (consumed)
            throw new Error("Shield stream is single-consumer.");
          consumed = true;
          try {
            assertAlive();
            for await (const raw of iterable) {
              assertAlive();
              const event = record(raw);
              if (provider === "openai") {
                if (!Array.isArray(event["choices"]))
                  throw new TypeError("Unsupported stream chunk.");
                const choices = event["choices"].map((rawChoice) => {
                  const choice = record(rawChoice), delta = record(choice["delta"]);
                  const index = choice["index"];
                  if (!Number.isInteger(index) || typeof index !== "number" || index < 0)
                    throw new TypeError("Invalid channel.");
                  const parser = getParser(index);
                  let text = typeof delta["content"] === "string" ? parser.push(delta["content"]) : "";
                  if (choice["finish_reason"] !== null && choice["finish_reason"] !== undefined)
                    text += parser.finish();
                  return { ...choice, delta: { ...delta, ...typeof delta["content"] === "string" || text ? { content: text } : {} } };
                });
                yield { ...event, choices };
              } else {
                const index = event["index"];
                if (event["type"] === "content_block_delta") {
                  const delta = record(event["delta"]);
                  if (delta["type"] === "text_delta") {
                    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || typeof delta["text"] !== "string")
                      throw new TypeError("Invalid text delta.");
                    yield { ...event, delta: { ...delta, text: getParser(index).push(delta["text"]) } };
                    continue;
                  }
                } else if (event["type"] === "content_block_stop" && typeof index === "number") {
                  const tail = parsers.get(index)?.finish();
                  if (tail)
                    yield { type: "content_block_delta", index, delta: { type: "text_delta", text: tail } };
                } else if (event["type"] === "content_block_start") {
                  const block = record(event["content_block"]);
                  if (block["type"] === "text" && typeof block["text"] === "string") {
                    if (typeof index !== "number")
                      throw new TypeError("Invalid block index.");
                    yield { ...event, content_block: { ...block, text: getParser(index).push(block["text"]) } };
                    continue;
                  }
                }
                yield event;
              }
            }
            for (const parser of parsers.values())
              if (parser.finish())
                throw new Error("Truncated stream without channel-end event.");
          } finally {
            controller.abort();
            cleanup();
          }
        }
      };
      return protectedStream;
    } catch (error) {
      controller.abort();
      cleanup();
      throw error;
    }
  }
  return create;
}
function wrapOpenAI(client, options = {}) {
  return { chat: { completions: { create: adapter(client, "openai", options) } } };
}
function wrapAnthropic(client, options = {}) {
  const create = adapter(client, "anthropic", options);
  return { messages: { create, async stream(body, request = {}) {
    return await create({ ...body, stream: true }, request);
  } } };
}
export {
  CustomTermMatcher,
  DEFAULT_DETECTORS,
  createUnshieldSseStream,
  createUnshieldStream,
  isCardNumber,
  isValidAbaRouting,
  isValidIban,
  isValidLuhn,
  isValidSsn,
  normalize,
  shield2 as shield,
  shieldMessages,
  shieldStructured,
  shieldToolCalls,
  unshield,
  withShield,
  wrapAnthropic,
  wrapOpenAI
};
