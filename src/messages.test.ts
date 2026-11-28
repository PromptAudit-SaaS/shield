import { describe, expect, test } from 'bun:test';
import { shieldMessages } from './index';

describe('Shield Chat-Nachrichten', () => {
  test('Zuordnungen über mehrere Nachrichten unterscheiden Originale und zählen eindeutige Werte', () => {
    const source = [
      { role: 'system', content: 'Mail first@example.invalid', name: 'instruction' },
      { role: 'user', content: 'second@example.invalid und first@example.invalid' },
    ];
    const before = JSON.stringify(source);
    const result = shieldMessages(source);
    expect(result.messages[0]?.content).toBe('Mail [EMAIL_1]');
    expect(result.messages[1]?.content).toBe('[EMAIL_2] und [EMAIL_1]');
    expect(result.counts.EMAIL).toBe(2);
    expect(result.restore('[EMAIL_1] [EMAIL_2]')).toBe('first@example.invalid second@example.invalid');
    expect(result.messages[0]?.name).toBe('instruction');
    expect(JSON.stringify(source)).toBe(before);
  });
  test('Textblöcke erhalten Metadaten und bleiben unverändert im Original', () => {
    const source = [{ role: 'user', content: [{ type: 'text' as const, text: 'a@example.invalid', cache_control: { type: 'ephemeral' } }] }];
    const result = shieldMessages(source);
    expect(result.messages[0]?.content[0]?.text).toBe('[EMAIL_1]');
    expect(result.messages[0]?.content[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(source[0]?.content[0]?.text).toBe('a@example.invalid');
  });
  test('Vorhandene Platzhalter werden nicht mit neu erkannten Originalen verknüpft', () => {
    const result = shieldMessages([{ role: 'user', content: '[EMAIL_1] a@example.invalid' }]);
    expect(result.messages[0]?.content).toBe('[EMAIL_1] [EMAIL_2]');
    expect(result.restore('[EMAIL_1] [EMAIL_2]')).toBe('[EMAIL_1] a@example.invalid');
  });
  test('Unabhängige Aufrufe haben getrennte Zuordnungen', () => {
    const a = shieldMessages([{ role: 'user', content: 'a@example.invalid' }]);
    const b = shieldMessages([{ role: 'user', content: 'b@example.invalid' }]);
    a.clear();
    expect(() => a.restore('[EMAIL_1]')).toThrow('cleared');
    expect(() => a.createRestoreStream()).toThrow('cleared');
    expect(b.restore('[EMAIL_1]')).toBe('b@example.invalid');
  });
  test('Bilder, Tool-Payloads und unbekannte Inhaltsblöcke werden explizit verweigert', () => {
    expect(() => shieldMessages([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:secret' } }] }])).toThrow();
    expect(() => shieldMessages([{ role: 'assistant', content: null, tool_calls: [] }])).toThrow();
    expect(() => shieldMessages([{ role: 'tool', content: 'payload' }])).toThrow();
    expect(() => shieldMessages([{ role: 'user', content: [{ type: 'tool_result', content: 'payload' }] }])).toThrow();
  });
  test('Leere Nachrichten und null-Inhalte bleiben nutzbar', () => {
    expect(shieldMessages([]).messages).toEqual([]);
    expect(shieldMessages([{ role: 'assistant', content: null }]).messages).toEqual([{ role: 'assistant', content: null }]);
  });
  test('Gemeinsame Session darf nicht durch einen einzelnen Stream geleert werden', () => {
    const session = shieldMessages([{ role: 'user', content: 'a@example.invalid' }]);
    expect(() => session.createRestoreStream({ clearVaultOnTerminate: true })).toThrow();
  });
  test('Maskierte Literal-Inhalte werden typgerecht als neue Strings zurückgegeben', () => {
    const session = shieldMessages([{ role: 'user', content: 'a@example.invalid' } as const]);
    const value: string | undefined = session.messages[0]?.content;
    expect(value).toBe('[EMAIL_1]');
  });
});
