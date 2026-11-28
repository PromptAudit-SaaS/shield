/** Real installed SDKs; local fetch fixtures only, no credentials or external requests. */
import { test, expect } from 'bun:test';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { wrapOpenAI, wrapAnthropic } from './index';
const email = 'fixture@example.invalid';
function localFetch(responseBody: string, type: string, requests: unknown[]): typeof fetch {
  return async (_url, init) => {
    if (typeof init?.body !== 'string') throw new Error('Expected SDK JSON body.');
    requests.push(JSON.parse(init.body));
    return new Response(responseBody, { headers: { 'content-type': type } });
  };
}
const messages = [{ role: 'user', content: email }];
test('OpenAI 7.65.0 SDK non-stream: masked wire body and restored result', async () => {
  const requests: unknown[] = [];
  const client = new OpenAI({ apiKey: 'fixture-not-a-credential', maxRetries: 0, fetch: localFetch(JSON.stringify({ id: 'fixture', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '[EMAIL_1]' }, finish_reason: 'stop' }] }), 'application/json', requests) });
  const response = await wrapOpenAI(client).chat.completions.create({ model: 'fixture-model', messages });
  expect(JSON.stringify(requests)).not.toContain(email);
  expect(response.choices[0]?.message.content).toBe(email);
});
test('OpenAI 7.65.0 SDK streamed deltas: fragmented token and finish reason', async () => {
  const requests: unknown[] = [];
  const chunks = ['[EMAIL_', '1]', ''].map((text, i) => ({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text }, finish_reason: i === 2 ? 'stop' : null }] }));
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  const client = new OpenAI({ apiKey: 'fixture-not-a-credential', maxRetries: 0, fetch: localFetch(body, 'text/event-stream', requests) });
  const stream = await wrapOpenAI(client).chat.completions.create({ model: 'fixture-model', messages, stream: true });
  let text = '', reason: unknown;
  for await (const chunk of stream) { text += chunk.choices[0]?.delta.content ?? ''; reason = chunk.choices[0]?.finish_reason; }
  expect(text).toBe(email); expect(reason).toBe('stop'); expect(JSON.stringify(requests)).not.toContain(email);
});
test('Anthropic 1.14.0 SDK non-stream: system and messages masked on wire', async () => {
  const requests: unknown[] = [];
  const body = JSON.stringify({ id: 'fixture', type: 'message', role: 'assistant', content: [{ type: 'text', text: '[EMAIL_1]' }], model: 'fixture', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  const client = new Anthropic({ apiKey: 'fixture-not-a-credential', maxRetries: 0, fetch: localFetch(body, 'application/json', requests) });
  const response = await wrapAnthropic(client).messages.create({ model: 'fixture-model', max_tokens: 10, system: email, messages });
  expect(response.content[0]?.text).toBe(email); expect(JSON.stringify(requests)).not.toContain(email);
});
test('Anthropic 1.14.0 SDK stream: text restore before block stop', async () => {
  const requests: unknown[] = [];
  const events = [
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '[EMAIL_' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '1]' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_stop' },
  ];
  const body = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const client = new Anthropic({ apiKey: 'fixture-not-a-credential', maxRetries: 0, fetch: localFetch(body, 'text/event-stream', requests) });
  const stream = await wrapAnthropic(client).messages.stream({ model: 'fixture-model', max_tokens: 10, messages });
  let text = '', last = '';
  for await (const event of stream) { if (event.delta?.type === 'text_delta') text += event.delta.text ?? ''; last = event.type; }
  expect(text).toBe(email); expect(last).toBe('message_stop'); expect(JSON.stringify(requests)).not.toContain(email);
});
