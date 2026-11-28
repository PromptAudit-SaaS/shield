import { describe, test, expect } from 'bun:test';
import { shield, unshield, shieldStructured, shieldToolCalls, CustomTermMatcher, wrapOpenAI, wrapAnthropic } from './index';
import { transformSerializedJson } from './tool-calls';
const email = 'person@example.invalid';
const message = { role: 'user', content: email };
const openClient = (create: (body: Record<string, unknown>, options: Record<string, unknown>) => unknown) => ({ chat: { completions: { create } } });
async function collect(value: unknown): Promise<unknown[]> {
  if (!value || typeof value !== 'object' || !(Symbol.asyncIterator in value)) throw new TypeError('Not iterable');
  const result: unknown[] = []; for await (const chunk of value as AsyncIterable<unknown>) result.push(chunk); return result;
}
function chunk(text: string, index = 0, finish: string | null = null) { return { id: 'fixture', choices: [{ index, delta: { content: text }, finish_reason: finish }] }; }
describe('Custom terms', () => {
  test('Legacy single-text API remains compatible', () => { const s = shield(email); expect(s.masked).toBe('[EMAIL_1]'); expect(unshield(s.masked, s.map)).toBe(email); });
  test('Term placeholders restore exact recognised strings', () => { const s = shield('Projekt Alpha', { customTerms: ['Projekt Alpha'] }); expect(s.masked).toBe('[TERM_1]'); expect(unshield(s.masked, s.map)).toBe('Projekt Alpha'); });
  test('Longest term at the leftmost start wins', () => { expect(shield('Acme Holding AG', { customTerms: ['Acme', 'Acme Holding AG'] }).masked).toBe('[TERM_1]'); });
  test('Otto is not masked inside Lotto', () => { expect(shield('Lotto Otto', { customTerms: ['Otto'], detectors: [] }).masked).toBe('Lotto [TERM_1]'); });
  test('Umlauts, combining marks and astral letters preserve offsets', () => {
    const s = shield('😀 Müller Müllerin e\u0301 \u{10400} \u{10400}x', { customTerms: ['Müller', 'e', '\u{10400}'], detectors: [] });
    expect(s.masked).toBe('😀 [TERM_1] Müllerin e\u0301 [TERM_2] \u{10400}x');
  });
  test('Simple Unicode fold handles length-expanding İ consistently', () => { expect(shield('İSTANBUL', { customTerms: ['İstanbul'], detectors: [] }).masked).toBe('[TERM_1]'); });
  test('C++, .NET and regex metacharacters are literal', () => { expect(shield('C++ .NET [.*]', { customTerms: ['C++', '.NET', '[.*]'], detectors: [] }).masked).toBe('[TERM_1] [TERM_2] [TERM_3]'); });
  test('Case-sensitive mode is explicit', () => { expect(shield('ACME Acme', { customTerms: ['Acme'], caseInsensitive: false, detectors: [] }).masked).toBe('ACME [TERM_1]'); });
  test('Reserved token is never reassigned', () => { const s = shield('[TERM_1] Acme', { customTerms: ['Acme'] }); expect(s.masked).toBe('[TERM_1] [TERM_2]'); expect(unshield(s.masked, s.map)).toBe('[TERM_1] Acme'); });
  test('Empty terms and oversized dictionaries fail', () => { expect(() => new CustomTermMatcher([''])).toThrow(); expect(() => new CustomTermMatcher(Array(1001).fill('x'))).toThrow(); });
  test('Overlap match budget fails closed', () => { const matcher = new CustomTermMatcher(Array.from({ length: 100 }, (_, i) => 'a'.repeat(i + 1)), { wholeWords: false }); expect(() => matcher.findMatches('a'.repeat(2000))).toThrow('budget'); });
});
describe('Structured masking', () => {
  test('Keys, values and source object remain distinct', () => { const source = { label: email, num: 2, flag: true, none: null }; const s = shieldStructured(source); expect(s.data).toEqual({ label: '[EMAIL_1]', num: 2, flag: true, none: null }); expect(source.label).toBe(email); expect(s.restore('[EMAIL_1]')).toBe(email); s.clear(); expect(() => s.restore('x')).toThrow(); });
  test('Cycles and deep secrets never bypass the mask', () => { const cyclic: Record<string, unknown> = {}; cyclic['self'] = cyclic; expect(() => shieldStructured(cyclic)).toThrow('Cyclic'); expect(() => shieldStructured({ a: { b: email } }, { maxDepth: 1 })).toThrow('limit'); });
  test('Accessors never execute', () => { let hit = false; const obj = { get secret() { hit = true; return email; } }; expect(() => shieldStructured(obj)).toThrow('Accessors'); expect(hit).toBe(false); });
  test('Class instances are not treated as JSON', () => { expect(() => shieldStructured(new Date())).toThrow('plain'); });
  test('NaN, fractional depth and excessive nodes fail', () => { expect(() => shieldStructured({}, { maxDepth: NaN })).toThrow(); expect(() => shieldStructured({}, { maxDepth: 1.5 })).toThrow(); expect(() => shieldStructured([1, 2], { maxNodes: 1 })).toThrow(); });
  test('Prototype keys do not pollute ordinary objects', () => { const s = shieldStructured(JSON.parse('{"__proto__":{"email":"person@example.invalid"}}')); expect(Object.getPrototypeOf(s.data)).toBe(null); expect({}).not.toHaveProperty('email'); expect(JSON.stringify(s.data)).toContain('[EMAIL_1]'); });
  test('Serialized number lexemes and duplicate keys are preserved', () => { const raw = '{ "n":9007199254740993,"n":1e400,"z":-0,"s":"person@example.invalid" }'; const result = transformSerializedJson(raw, t => t === email ? '[EMAIL_1]' : t); expect(result).toBe(raw.replace(email, '[EMAIL_1]')); });
  test('Escaped string values are decoded and safely rewritten', () => { expect(transformSerializedJson('{"s":"a\\u0040example.invalid"}', t => t.includes('@') ? '[EMAIL_1]' : t)).toBe('{"s":"[EMAIL_1]"}'); });
  test('JSON keys and unchanged formatting are retained', () => { const raw = '{\n "person@example.invalid": "public"\n}'; expect(transformSerializedJson(raw, () => 'public')).toBe(raw); });
  test('Malformed serialized JSON is rejected, not raw-masked', () => { expect(() => transformSerializedJson('{"s":"incomplete', t => t)).toThrow(); });
  test('Deep serialized JSON fails', () => { expect(() => transformSerializedJson('[[["secret"]]]', t => t, { maxDepth: 2 })).toThrow(); });
  test('Only supported tool arguments change, not IDs or names', () => { const s = shieldToolCalls([{ type: 'function', id: 'stable', function: { name: 'read', arguments: JSON.stringify({ email }) } }]); expect(s.data).toEqual([{ type: 'function', id: 'stable', function: { name: 'read', arguments: '{"email":"[EMAIL_1]"}' } }]); });
  test('Anthropic tool inputs use same local mask', () => { const s = shieldToolCalls([{ type: 'tool_use', name: 'read', input: { email } }]); expect(JSON.stringify(s.data)).toContain('[EMAIL_1]'); });
  test('Unsupported tool shapes fail', () => { expect(() => shieldToolCalls([{ type: 'custom' }])).toThrow(); });
});
describe('Bounded client adapters', () => {
  test('Original receiver, options and original body are preserved', async () => {
    const endpoint = { marker: 7, create(body: unknown, opts: unknown) { expect(this.marker).toBe(7); expect(JSON.stringify(body)).toContain('[EMAIL_1]'); expect(opts).toHaveProperty('temperatureHint', 2); return { choices: [{ message: { content: '[EMAIL_1]' } }], usage: { total_tokens: 4 } }; } };
    const client = wrapOpenAI({ chat: { completions: endpoint } });
    const response = await client.chat.completions.create({ messages: [message] }, { temperatureHint: 2 });
    expect(response).toEqual({ choices: [{ message: { content: email } }], usage: { total_tokens: 4 } }); expect(message.content).toBe(email);
  });
  test('Concurrent requests never share originals', async () => {
    const client = wrapOpenAI(openClient(async () => ({ choices: [{ message: { content: '[EMAIL_1]' } }] })));
    const [a, b] = await Promise.all([client.chat.completions.create({ messages: [message] }), client.chat.completions.create({ messages: [{ role: 'user', content: 'other@example.invalid' }] })]);
    expect(JSON.stringify(a)).toContain(email); expect(JSON.stringify(b)).toContain('other@example.invalid');
  });
  test('Fragmented OpenAI tokens restore in independent channels', async () => {
    const raw = [chunk('[EM', 0), chunk('[EMAIL_', 1), chunk('AIL_1]', 0), chunk('1]', 1), chunk('', 0, 'stop'), chunk('', 1, 'stop')];
    const client = wrapOpenAI(openClient(async () => ({ async *[Symbol.asyncIterator]() { yield* raw; } })));
    const result = await collect(await client.chat.completions.create({ messages: [message], stream: true }));
    expect(JSON.stringify(result)).toContain(email); expect(JSON.stringify(raw)).toContain('[EM'); expect(JSON.stringify(raw)).not.toContain(email);
  });
  test('Partial token is flushed before terminal choice', async () => {
    const client = wrapOpenAI(openClient(async () => ({ async *[Symbol.asyncIterator]() { yield chunk('[EMAIL_'); yield chunk('', 0, 'stop'); } })));
    const out = await collect(await client.chat.completions.create({ messages: [message], stream: true })); expect(out[1]).toEqual(chunk('[EMAIL_', 0, 'stop'));
  });
  test('Truncated stream fails rather than silently losing buffered text', async () => {
    const client = wrapOpenAI(openClient(async () => ({ async *[Symbol.asyncIterator]() { yield chunk('[EMAIL_'); } })));
    await expect(collect(await client.chat.completions.create({ messages: [message], stream: true }))).rejects.toThrow('Truncated');
  });
  test('Early break returns upstream and aborts request', async () => {
    let closed = false, signal: unknown;
    const client = wrapOpenAI(openClient(async (_body, options) => { signal = options['signal']; return { async *[Symbol.asyncIterator]() { try { yield chunk('plain'); yield chunk('later'); } finally { closed = true; } } }; }));
    const stream = await client.chat.completions.create({ messages: [message], stream: true });
    if (!stream || typeof stream !== 'object' || !(Symbol.asyncIterator in stream)) throw new Error('stream');
    for await (const _ of stream as AsyncIterable<unknown>) break;
    expect(closed).toBe(true); expect(signal instanceof AbortSignal && signal.aborted).toBe(true);
  });
  test('Already aborted signals never call the provider', async () => { let calls = 0; const c = wrapOpenAI(openClient(() => { calls++; return {}; })); const controller = new AbortController(); controller.abort(); await expect(c.chat.completions.create({ messages: [message] }, { signal: controller.signal })).rejects.toThrow(); expect(calls).toBe(0); });
  test('Unsupported images and malformed tools fail before provider call', async () => { let calls = 0; const c = wrapOpenAI(openClient(() => { calls++; return {}; })); await expect(c.chat.completions.create({ messages: [{ role: 'user', content: [{ type: 'image_url' }] }] })).rejects.toThrow(); await expect(c.chat.completions.create({ messages: [{ role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { arguments: '{' } }] }] })).rejects.toThrow(); expect(calls).toBe(0); });
  test('Anthropic system text and nested tool input are masked together', async () => {
    const c = wrapAnthropic({ messages: { create(body: unknown) { expect(JSON.stringify(body)).not.toContain(email); return { content: [{ type: 'text', text: '[EMAIL_1]' }] }; } } });
    const out = await c.messages.create({ system: email, messages: [{ role: 'assistant', content: [{ type: 'tool_use', name: 'read', input: { email } }] }] }); expect(JSON.stringify(out)).toContain(email);
  });
  test('Anthropic text stream and stop lifecycle remain ordered', async () => {
    const c = wrapAnthropic({ messages: { create() { return { async *[Symbol.asyncIterator]() { yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '[EMAIL_' } }; yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '1]' } }; yield { type: 'content_block_stop', index: 0 }; } }; } } });
    const out = await collect(await c.messages.stream({ messages: [message] })); expect(JSON.stringify(out)).toContain(email); expect(out.at(-1)).toEqual({ type: 'content_block_stop', index: 0 });
  });
  test('Abandoned streams expire and cannot be reused', async () => { const c = wrapOpenAI(openClient(() => ({ async *[Symbol.asyncIterator]() { yield chunk('[EMAIL_1]'); } })), { timeoutMs: 5 }); const stream = await c.chat.completions.create({ messages: [message], stream: true }); await new Promise(resolve => setTimeout(resolve, 15)); await expect(collect(stream)).rejects.toThrow(); });
});
test('Chat custom terms share a session and retain reserved tokens', async () => {
  const { shieldMessages } = await import('./index');
  const s = shieldMessages([{ role: 'user', content: '[TERM_1] Acme Acme' }], { customTerms: ['Acme'] });
  expect(s.messages[0]?.content).toBe('[TERM_1] [TERM_2] [TERM_2]'); expect(s.restore('[TERM_2]')).toBe('Acme'); s.clear();
});
test('Custom partial terms do not split a complete known email', () => {
  const s = shield(email, { customTerms: ['person'] }); expect(s.masked).toBe('[EMAIL_1]');
});
test('Tool getters are refused before executing', () => {
  let called = false;
  const tool = { type: 'function', get function() { called = true; return { arguments: '{}' }; } };
  expect(() => shieldToolCalls([tool])).toThrow('Accessors'); expect(called).toBe(false);
});
test('Metadata placeholders cannot be reused for a different original', async () => {
  const c = wrapOpenAI(openClient(body => { expect(JSON.stringify(body)).toContain('[EMAIL_2]'); return { choices: [{ message: { content: '[EMAIL_1] [EMAIL_2]' } }] }; }));
  const out = await c.chat.completions.create({ messages: [message], user: '[EMAIL_1]' }); expect(JSON.stringify(out)).toContain('[EMAIL_1] ' + email);
});
test('Combined structured strings exceed a total budget, not only per-leaf', () => {
  expect(() => shieldStructured(['a'.repeat(600_000), 'b'.repeat(600_000)])).toThrow('text limit');
});
test('Stream explicit abort and single consumer are enforced', async () => {
  const c = wrapOpenAI(openClient(() => ({ async *[Symbol.asyncIterator]() { yield chunk('plain'); } })));
  const stream = await c.chat.completions.create({ messages: [message], stream: true }); await collect(stream);
  await expect(collect(stream)).rejects.toThrow('single-consumer');
  const aborted = await c.chat.completions.create({ messages: [message], stream: true }); aborted.abort(); await expect(collect(aborted)).rejects.toThrow();
});
