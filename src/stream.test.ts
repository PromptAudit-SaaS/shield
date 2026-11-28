import { describe, expect, test } from 'bun:test';
import { createUnshieldStream, createUnshieldSseStream, shieldMessages } from './index';

const vault = () => new Map([['[IBAN_1]', 'CH9300762011623852957'], ['[EMAIL_1]', 'a@example.invalid']]);
async function collect<I, O>(chunks: I[], pair: ReadableWritablePair<O, I>): Promise<O[]> {
  const input = new ReadableStream<I>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
  const reader = input.pipeThrough(pair).getReader();
  const out: O[] = [];
  try { while (true) { const result = await reader.read(); if (result.done) break; out.push(result.value); } }
  finally { reader.releaseLock(); }
  return out;
}
async function text(chunks: string[], map = vault()) {
  return (await collect(chunks, createUnshieldStream(map))).join('');
}
const enc = new TextEncoder();
async function sse(source: string, provider: 'openai' | 'anthropic' = 'openai', width = 1) {
  const bytes = enc.encode(source);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += width) chunks.push(bytes.slice(i, i + width));
  const output = await collect(chunks, createUnshieldSseStream(vault(), { provider }));
  return output.map((chunk) => new TextDecoder().decode(chunk)).join('');
}
function frame(content: string, index = 0) {
  return `data: ${JSON.stringify({ choices: [{ index, delta: { content } }] })}\n\n`;
}
function deltas(source: string, index = 0): string {
  return source.split('\n').filter((line) => line.startsWith('data: {')).map((line) => {
    const payload = JSON.parse(line.slice(6)) as { choices?: { index: number; delta?: { content?: string } }[] };
    return payload.choices?.find((choice) => choice.index === index)?.delta?.content ?? '';
  }).join('');
}

describe('Shield Text-Streaming', () => {
  test('Alle Zwei-Chunk-Schnitte sowie einzelne Zeichen ergeben identische Wiederherstellung', async () => {
    const source = '🛡️ [IBAN_1] [EMAIL_1] Ende';
    const expected = '🛡️ CH9300762011623852957 a@example.invalid Ende';
    for (let i = 0; i <= source.length; i++) expect(await text([source.slice(0, i), source.slice(i)])).toBe(expected);
    expect(await text([...source])).toBe(expected);
  });
  test('Normaler Text im Folge-Chunk wird nicht doppelt ausgegeben', async () => {
    expect(await text(['[IB', 'AN_1] weiter'])).toBe('CH9300762011623852957 weiter');
    expect(await text(['[Link', '](url) und arr[i]'])).toBe('[Link](url) und arr[i]');
  });
  test('Unbekannte, verschachtelte und unvollständige Platzhalter bleiben erhalten', async () => {
    expect(await text(['[[IBAN_1]] [IBAN_99] [EMAIL'])).toBe('[CH9300762011623852957] [IBAN_99] [EMAIL');
    expect(await text(['['.repeat(10000)])).toBe('['.repeat(10000));
  });
  test('Leere Zuordnung und leere Chunks verändern Text nicht', async () => {
    expect(await text(['', 'a[IBAN_1]', ''], new Map())).toBe('a[IBAN_1]');
  });
  test('Unzulässige oder zu kurze Puffer werden vor Stream-Start verweigert', () => {
    for (const maxBufferSize of [NaN, Infinity, 7, 8.5, 4097]) {
      expect(() => createUnshieldStream(vault(), { maxBufferSize })).toThrow();
    }
    expect(() => createUnshieldStream(new Map([['[PRIVATE_KEY_100]', 'x']]), { maxBufferSize: 8 })).toThrow();
  });
  test('Stream-Ende leert nur eine ausdrücklich exklusiv zugeordnete Map', async () => {
    const map = vault();
    expect((await collect(['[EMAIL_1]'], createUnshieldStream(map, { clearVaultOnTerminate: true }))).join('')).toBe('a@example.invalid');
    expect(map.size).toBe(0);
    const shared = vault(); await text(['[IBAN_1]'], shared); expect(shared.size).toBe(2);
  });
  test('Leser-Abbruch löscht die exklusiv zugeordnete Map', async () => {
    const map = vault(); const pair = createUnshieldStream(map, { clearVaultOnTerminate: true });
    await pair.readable.cancel('test'); expect(map.size).toBe(0);
  });
  test('Schreiber-Abbruch löscht die exklusiv zugeordnete Map', async () => {
    const map = vault(); const pair = createUnshieldStream(map, { clearVaultOnTerminate: true });
    void pair.readable.getReader().closed.catch(() => {});
    await pair.writable.abort('test'); expect(map.size).toBe(0);
  });
  test('AbortSignal beendet aktive Streams und lehnt weitere Eingaben ab', async () => {
    const map = vault(); const abort = new AbortController();
    const pair = createUnshieldStream(map, { clearVaultOnTerminate: true, signal: abort.signal });
    void pair.readable.getReader().closed.catch(() => {});
    abort.abort(); expect(map.size).toBe(0);
    const writer = pair.writable.getWriter(); await expect(writer.write('x')).rejects.toThrow();
    await writer.closed.catch(() => {});
  });
  test('Chat-Session lässt sich ohne Netzverbindung durch einen echten Stream wiederherstellen', async () => {
    const session = shieldMessages([{ role: 'user', content: 'a@example.invalid' }]);
    const masked = session.messages[0]?.content;
    if (typeof masked !== 'string') throw new Error('Missing text');
    expect((await collect([...masked], session.createRestoreStream())).join('')).toBe('a@example.invalid');
    session.clear();
  });
  test('Deterministische Zufallsschnitte erhalten Text inklusive Klammern und Unicode', async () => {
    let seed = 12345;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const input = 'x[IBAN_1] [EMAIL_1] [[IBAN_1]] [foo] [IBAN_99] 🛡️ arr[i] [IB'.repeat(20);
    const expected = input.replace(/\[[A-Z_]+_\d+\]/g, (key) => vault().get(key) ?? key);
    for (let run = 0; run < 50; run++) {
      const chunks: string[] = [];
      for (let i = 0; i < input.length;) {
        const size = 1 + random() % 31; chunks.push(input.slice(i, i + size)); i += size;
      }
      expect(await text(chunks)).toBe(expected);
    }
  });
  test('Abbruch eines blockierten Schreibvorgangs räumt ohne wartenden Leser auf', async () => {
    const map = vault(); const pair = createUnshieldStream(map, { clearVaultOnTerminate: true });
    void pair.readable.getReader().closed.catch(() => {});
    const writer = pair.writable.getWriter();
    const writing = writer.write('hello').catch(() => {});
    await Promise.resolve();
    await writer.abort('aborted');
    await writing;
    expect(map.size).toBe(0);
  });
  test('Signal-Abbruch meldet Fehler statt einen erfolgreichen vorzeitigen Abschluss', async () => {
    const abort = new AbortController(); const pair = createUnshieldStream(vault(), { signal: abort.signal });
    const reader = pair.readable.getReader();
    const reading = reader.read();
    abort.abort(new Error('stop-request'));
    await expect(reading).rejects.toThrow('stop-request');
  });
});

describe('Shield SSE-Rahmung', () => {
  test('UTF-8-Bytes, CRLF, Header und fragmentierte JSON-Deltas bleiben erhalten', async () => {
    const source = ('event: message\nid: 42\n: note\n' + frame('🛡 [IB') + frame('AN_1] ok') + 'data: [DONE]\n\n').replace(/\n/g, '\r\n');
    const output = await sse(source);
    expect(deltas(output)).toBe('🛡 CH9300762011623852957 ok');
    expect(output).toContain('event: message\nid: 42\n: note');
    expect(output).toContain('data: [DONE]');
  });
  test('Mehrzeilige data-Felder werden als ein SSE-Event geparst', async () => {
    const output = await sse('retry: 1000\ndata: {"choices":\ndata: [{"index":0,"delta":{"content":"[EMAIL_1]"}}]}\n\n');
    expect(deltas(output)).toBe('a@example.invalid'); expect(output).toContain('retry: 1000');
  });
  test('Parallele OpenAI-Ausgabekanäle vermischen keine Tokens', async () => {
    const output = await sse(frame('[IB', 0) + frame('[EMAIL_', 1) + frame('AN_1]', 0) + frame('1]', 1));
    expect(deltas(output, 0)).toBe('CH9300762011623852957');
    expect(deltas(output, 1)).toBe('a@example.invalid');
  });
  test('Anthropic-Textblöcke und deren Endereignisse werden erhalten', async () => {
    const aframe = (value: string) => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: value } })}\n\n`;
    const output = await sse(aframe('[EMAIL_') + aframe('1]') + 'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n', 'anthropic');
    expect(output).toContain('a@example.invalid'); expect(output).toContain('event: content_block_stop');
  });
  test('Unvollständige Tokens stehen vor DONE statt nach einem Endereignis', async () => {
    const output = await sse(frame('[IB') + 'data: [DONE]\n\n');
    expect(deltas(output)).toBe('[IB'); expect(output.indexOf('[IB')).toBeLessThan(output.indexOf('[DONE]'));
  });
  test('Nicht-Text-Ereignisse werden nicht unterdrückt', async () => {
    const source = 'event: usage\ndata: {"usage":{"total_tokens":12}}\n\n';
    expect(await sse(source)).toBe(source);
  });
  test('Fehlerhaftes JSON und übergrosse Ereignisse führen zu einem ausdrücklichen Fehler', async () => {
    await expect(sse('data: {bad}\n\n')).rejects.toThrow();
    await expect(collect([enc.encode('data: ' + 'x'.repeat(300))], createUnshieldSseStream(vault(), { provider: 'openai', maxEventSize: 256 }))).rejects.toThrow('maxEventSize');
  });
  test('Zu viele parallele Kanäle werden begrenzt', async () => {
    await expect(collect([enc.encode(frame('[IB', 0) + frame('[IB', 1))], createUnshieldSseStream(vault(), { provider: 'openai', maxChannels: 1 }))).rejects.toThrow('channels');
  });
  test('Text im selben Frame wie finish_reason verliert keine unvollständigen Tokens', async () => {
    const terminal = 'data: {"choices":[{"index":0,"delta":{"content":"B"},"finish_reason":"stop"}]}\n\n';
    const output = await sse(frame('[I') + terminal);
    expect(deltas(output)).toBe('[IB');
    expect(output).toContain('"finish_reason":"stop"');
  });
  test('Unvollständiger UTF-8-Input wird als Fehler gemeldet', async () => {
    await expect(collect([new Uint8Array([0xf0, 0x9f])], createUnshieldSseStream(vault(), { provider: 'openai' }))).rejects.toThrow();
  });
  test('Abbruch mit anstehendem SSE-Token löscht eine exklusive Zuordnung', async () => {
    const map = vault();
    const pair = createUnshieldSseStream(map, { provider: 'openai', clearVaultOnTerminate: true });
    const reader = pair.readable.getReader(); const writer = pair.writable.getWriter();
    const read = reader.read();
    await writer.write(enc.encode(frame('[IB')));
    await read;
    await reader.cancel();
    expect(map.size).toBe(0);
  });
  test('Ende eines Kanals wird vor Finish ausgegeben auch wenn ein anderer Text liefert', async () => {
    const terminal = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"},{"index":1,"delta":{"content":"hello"}}]}\n\n';
    const output = await sse(frame('[IB', 0) + terminal + 'data: [DONE]\n\n');
    expect(deltas(output, 0)).toBe('[IB');
    const tail = output.indexOf('"content":"[IB"');
    expect(tail).toBeLessThan(output.indexOf('"finish_reason":"stop"'));
    expect(deltas(output, 1)).toBe('hello');
  });
  test('Zusätzlicher Resttext wiederholt keine Tool-Argumente oder Verbrauchszähler', async () => {
    const source = 'data: {"choices":[{"index":0,"delta":{"content":"[IB","tool_calls":[{"index":0,"function":{"arguments":"fragment"}}]}}],"usage":{"total_tokens":5}}\n\n';
    const output = await sse(source + 'data: [DONE]\n\n');
    expect(deltas(output)).toBe('[IB');
    expect(output.match(/fragment/g)?.length).toBe(1);
    expect(output.match(/total_tokens/g)?.length).toBe(1);
  });
});
