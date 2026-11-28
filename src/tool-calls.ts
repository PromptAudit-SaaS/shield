import { createMaskSession, type ShieldOptions } from './session';
export interface StructuredOptions extends ShieldOptions { maxDepth?: number; maxNodes?: number }
/** Plain JSON data only. Limits, cycles and accessors fail closed, never bypass masking. */
export function walkStructured(value: unknown, transform: (text: string) => string, options: StructuredOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 64, maxNodes = options.maxNodes ?? 50_000;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 128 || !Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 100_000) throw new RangeError('Invalid structured limits.');
  const seen = new Set<object>(); let nodes = 0, textUnits = 0;
  function walk(input: unknown, depth: number): unknown {
    if (++nodes > maxNodes || depth > maxDepth) throw new RangeError('Structured limit exceeded.');
    if (typeof input === 'string') { textUnits += input.length; if (textUnits > 1_048_576) throw new RangeError('Structured text limit exceeded.'); return transform(input); }
    if (input === null || typeof input === 'boolean' || typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || input === null) throw new TypeError('Only plain JSON values are supported.');
    const proto: unknown = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && proto !== Object.prototype && proto !== null) throw new TypeError('Only plain JSON objects are supported.');
    if (seen.has(input)) throw new TypeError('Cyclic input is not supported.');
    seen.add(input);
    try {
      const output: Record<string, unknown> | unknown[] = Array.isArray(input) ? [] : Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(input)) {
        textUnits += key.length; if (textUnits > 1_048_576) throw new RangeError('Structured text limit exceeded.');
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !('value' in descriptor)) throw new TypeError('Accessors are not supported.');
        Object.defineProperty(output, key, { value: walk(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
      }
      if (Array.isArray(input) && Array.isArray(output)) output.length = input.length;
      return output;
    } finally { seen.delete(input); }
  }
  return walk(value, 0);
}
/** Validate JSON, then rewrite value-string spans only: retain numeric lexemes, keys and whitespace. */
export function transformSerializedJson(raw: string, transform: (text: string) => string, options: StructuredOptions = {}): string {
  if (raw.length > 1_048_576) throw new RangeError('JSON text limit exceeded.');
  JSON.parse(raw); // Invalid or truncated arguments must not be sent as supposedly protected JSON.
  let depth = 0, strings = 0;
  const maxDepth = options.maxDepth ?? 64;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 128) throw new RangeError('Invalid JSON depth.');
  let out = '', cursor = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '{' || char === '[') { if (++depth > maxDepth) throw new RangeError('JSON depth exceeded.'); }
    else if (char === '}' || char === ']') depth--;
    else if (char === '"') {
      const start = i++;
      for (; i < raw.length; i++) { if (raw[i] === '\\') i++; else if (raw[i] === '"') break; }
      if (++strings > 50_000) throw new RangeError('JSON string budget exceeded.');
      let next = i + 1; while (/\s/.test(raw[next] ?? '') && next < raw.length) next++;
      if (raw[next] !== ':') {
        const literal = raw.slice(start, i + 1);
        const value: unknown = JSON.parse(literal);
        if (typeof value !== 'string') throw new TypeError('Invalid string.');
        const masked = transform(value);
        out += raw.slice(cursor, start) + (masked === value ? literal : JSON.stringify(masked)); cursor = i + 1;
      }
    }
  }
  return out + raw.slice(cursor);
}
export function shieldStructured(value: unknown, options: StructuredOptions = {}) {
  const texts: string[] = [];
  walkStructured(value, text => { texts.push(text); return text; }, options);
  const session = createMaskSession([...texts, JSON.stringify(value)], options);
  try { return { data: walkStructured(value, session.mask, options), restore: session.restore, clear: session.clear, counts: session.counts }; }
  catch (error) { session.clear(); throw error; }
}
/** Preserve tool IDs/names; rewrite only explicitly supported payload fields. */
export function transformToolCalls(calls: unknown, transform: (text: string) => string, options: StructuredOptions = {}): unknown {
  if (!Array.isArray(calls) || calls.length > 1000) throw new TypeError('Expected at most 1000 tool calls.');
  walkStructured(calls, text => text, options);
  return calls.map((call: unknown) => {
    if (!call || typeof call !== 'object' || Array.isArray(call)) throw new TypeError('Invalid tool call.');
    const record = call as Record<string, unknown>;
    const fn = record['function'];
    if (record['type'] === 'function' && fn && typeof fn === 'object' && !Array.isArray(fn)) {
      const f = fn as Record<string, unknown>;
      if (typeof f['arguments'] !== 'string') throw new TypeError('Expected serialized tool arguments.');
      return { ...record, function: { ...f, arguments: transformSerializedJson(f['arguments'], transform, options) } };
    }
    if (record['type'] === 'tool_use' && 'input' in record) return { ...record, input: walkStructured(record['input'], transform, options) };
    throw new TypeError('Unsupported tool call type.');
  });
}
export function shieldToolCalls(calls: unknown, options: StructuredOptions = {}) {
  const texts: string[] = [];
  transformToolCalls(calls, text => { texts.push(text); return text; }, options);
  const session = createMaskSession([...texts, JSON.stringify(calls)], options);
  try { return { data: transformToolCalls(calls, session.mask, options), restore: session.restore, clear: session.clear, counts: session.counts }; }
  catch (error) { session.clear(); throw error; }
}
