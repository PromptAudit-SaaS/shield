# @promptaudit/shield

![PromptAudit Shield – lokale Textmaskierung](./assets/banner.png)

**Personendaten und bekannte Geheimnismuster lokal maskieren, Platzhalter in Antworten wiederherstellen – auch über mehrere Text-Chunks hinweg.**

MIT · TypeScript · keine Laufzeitabhängigkeiten · keine Netzwerkaufrufe oder Telemetrie im Paket

```bash
npm install @promptaudit/shield
```

```ts
import { shieldMessages } from '@promptaudit/shield';

const session = shieldMessages([
  { role: 'user', content: 'Kontakt: fictional@example.invalid' },
]);
console.log(session.messages); // content: 'Kontakt: [EMAIL_1]'
console.log(session.restore('Antwort für [EMAIL_1]')); // lokales Original
session.clear();
```

Die Daten sind fiktiv. Eine leere Trefferliste ist kein Nachweis, dass ein Text keine Geheimnisse enthält.

## Datenfluss und Vertrauensgrenze

```text
Ihr Prozess / Browser
  Originaltext -> shield / shieldMessages -> maskierter Text
                       |
                  Zuordnung im RAM
                       |
  lokale Wiederherstellung <- Modellantwort mit Platzhaltern
```

Das Paket sendet selbst nichts. **Ihr Code entscheidet**, welche Inhalte an ein Modell gehen und wer die wiederhergestellten Originale erhält. `restore`, `unshield` und die Streaming-Helfer geben Klartext an den jeweiligen Aufrufer zurück. Ein kompromittierter Prozess oder ein falscher Aufruf kann Originale offenlegen.

## Text und Chat-Nachrichten

| Funktion | Ergebnis |
| --- | --- |
| `shield(text, detectorsOrOptions?)` | `{ masked, map, counts }`, bestehende Einzeltext-API |
| `unshield(text, map)` | lokale Wiederherstellung bekannter Platzhalter |
| `withShield(prompt, call)` | maskieren → kundeneigener Aufruf → lokal wiederherstellen |
| `shieldMessages(messages, detectorsOrOptions?)` | neue Nachrichten, gemeinsame Kategorienzählung, `restore`, `createRestoreStream`, `clear` |
| `createUnshieldStream(map, options?)` | Web-Streams-Paar für Text-Chunks |
| `createUnshieldSseStream(map, options)` | begrenztes Web-Streams-Paar für ausdrücklich gewählte OpenAI-/Anthropic-SSE-Formate |

`shieldMessages` kopiert Nachrichten und Textblöcke, verändert die Eingabe nicht und verwendet eine getrennte Zuordnung pro Aufruf. Dieselbe erkannte Zeichenfolge erhält innerhalb dieses Aufrufs denselben Platzhalter; bereits im Eingang vorhandene Platzhalter werden nicht neu belegt. `counts` zählt eindeutige erkannte Werte, nicht jede Wiederholung.

Unterstützt werden `content: string`, `content: null` und reine `{ type: 'text', text: string }`-Blöcke. **Bilder, Dateien, Tool-Aufrufe und Tool-Ergebnisse werden verweigert**, nicht still als geschützt weitergereicht. Metadaten wie `name` werden unverändert übernommen und sind nicht maskiert. Anthropic-Systemtexte ausserhalb von `messages` und Gemini-`contents` sind nicht von dieser Funktion abgedeckt. Vercel-UI-Nachrichten mit `parts` statt `content` müssen ausdrücklich konvertiert werden.

## Eigene Begriffe und strukturierte Werte

```ts
import { shieldMessages, shieldToolCalls } from '@promptaudit/shield';
const session = shieldMessages([{ role: 'user', content: 'Projekt Alpha' }], {
  customTerms: ['Projekt Alpha'],
}); // content: [TERM_1]
session.clear();
const tools = shieldToolCalls([{ type: 'function', id: 'fiktiv', function: {
  name: 'lookup', arguments: '{"client":"Projekt Alpha","limit":10}',
} }], { customTerms: ['Projekt Alpha'] });
// tools.data enthält maskierte String-Werte; IDs, Namen und Zahlen bleiben erhalten.
tools.clear();
```

`shieldStructured(value, options)` liefert `{ data, counts, restore, clear }` für ausdrücklich übergebene reine JSON-Daten. Objekt- und Array-Eingaben werden kopiert; keine Typ-/Referenzidentität für Klassen versprochen. Keys bleiben **unmaskiert** und können selbst sensible Angaben enthalten. Keine ungeprüfte Übertragung solcher Keys.

`shieldToolCalls` unterstützt OpenAI-`type: function` mit serialisierten `arguments` und Anthropic-`type: tool_use` mit `input`. Änderungen an gültigem serialisiertem JSON erfolgen nur an String-Wert-Spannen: Whitespace, Schlüssel, doppelte Schlüssel und Zahlenschreibweisen bleiben unverändert. **Ungültiges JSON, Zyklen, Getter, Klassen und überschrittene Grenzen werden verweigert**, niemals ungeprüft weitergegeben. Maskierte String-Werte können trotzdem Enum-/Formatvorgaben eines Tools verletzen; vor Ausführung separat schema-validieren und eine bewusste lokale Wiederherstellungsgrenze setzen. Ausgehende Modell-Toolbefehle werden vom Anbieter-Wrapper nicht automatisch demaskiert oder ausgeführt.

Begriffe: Aho–Corasick, frühester/längster nicht überlappender Treffer, Unicode-Ränder inklusive kombinierender Zeichen. Gross-/Kleinschreibung verwendet einfache Faltung pro Codepoint, **keine vollständige sprachabhängige Normalisierung** (z. B. ß/ss oder kontextuelles Sigma). `caseInsensitive: false` und `wholeWords: false` sind ausdrücklich wählbar. Normalisierung der Engine gilt weiterhin.

Grenzen: 1'000 Begriffe, 256 UTF-16-Einheiten pro Begriff, 1'048'576 Einheiten pro Text/Sitzungsreservierung, 100'000 Kandidaten, 10'000 Platzhalter; strukturierte Daten standardmässig Tiefe 64 und 50'000 Knoten. Aufwand hängt auch von Wörterbuch und Trefferzahl ab; kein O(1)-Speicher-/Null-Latenz-Versprechen. Beliebige kundeneigene Regex-Detektoren sind nicht durch den Begriffsmatcher gegen ReDoS abgesichert.

## Anbieter-Wrapper: ausdrücklich begrenzte Schnittstelle

```ts
import { wrapOpenAI } from '@promptaudit/shield';
// originalClient: Ihr separat installierter SDK-Client mit Ihrem eigenen Schlüssel.
const client = wrapOpenAI(originalClient, { customTerms: ['Projekt Alpha'] });
const stream = await client.chat.completions.create({
  model: configuredModel, messages: [{ role: 'user', content: 'Projekt Alpha' }], stream: true,
});
try {
  for await (const chunk of stream) {
    const localText = chunk.choices[0]?.delta.content ?? '';
    // localText kann Originale enthalten: nur an berechtigte Empfänger weitergeben.
  }
} finally { stream.abort(); }
```

`wrapAnthropic(originalClient).messages.create(...)` liefert eine normale Promise; `await client.messages.stream(...)` einen eigenen einmalig konsumierbaren AsyncIterable mit `abort()`. System-Text und unterstützte Text-/Tool-Payloads werden vor dem delegierten SDK-Aufruf maskiert. Textantworten werden lokal wiederhergestellt. Request-Optionen und AbortSignal werden an das kundeneigene SDK weitergereicht; dieses SDK, nicht Shield selbst, baut die Verbindung auf.

**Kein vollständiger SDK-Drop-in:** Keine OpenAI-Responses-/Realtime-/Batch-API, `.withResponse()`, `.asResponse()`, `.tee()` oder Anthropic-Eventlistener/`.finalMessage()`/`.finalText()`. Anthropic `.stream()` ist hier asynchron und kein nativer SDK-MessageStream. Bilder und unbekannte Inhaltsblöcke werden abgewiesen. OpenAI-Tool-Ergebnisse in `role: tool` werden in dieser Fassade nur als gültiges serialisiertes JSON akzeptiert; Anthropic-`tool_result` nur als String. Weitere Formate brauchen einen eigenen geprüften Adapter. Toolschemata, IDs, Namen und übrige Metadaten bleiben unmaskiert; nur ausdrücklich unterstützte Text- und Argumentfelder werden geschützt. Der Originalclient bleibt separat zugänglich, seine Aufrufe umgehen diesen Wrapper.

Zuordnungen und Textkanäle sind je Anfrage getrennt. Ende, Fehler und vorzeitiger Schleifenabbruch räumen auf und brechen die eigene Anbieteranfrage ab. Unkonsumierte Streams verfallen nach standardmässig fünf Minuten (`timeoutMs`, maximal 30 Minuten); für schnellere Freigabe ausdrücklich `stream.abort()`. Aufbewahrung im RAM ist keine sichere Speicherlöschung. Pufferreste erscheinen vor Kanal-Ende, fehlerhaft abgebrochene Streams werden nicht als vollständig dargestellt. Nach Streamende ist Wiederherstellung über dieselbe Sitzung nicht mehr möglich.

Kompatibilitätstests verwenden die tatsächlich installierten SDKs **OpenAI 7.65.0 und Anthropic 1.14.0** mit lokalen Fetch-Antworten. Das prüft deren Serialisierung/Streaming, **keinen echten Modellaufruf, Modellverhalten oder alle SDK-Versionen**. Die SDKs sind ausschliesslich Entwicklungsabhängigkeiten und werden nicht ins Laufzeitpaket gebündelt.

## Beispiel: OpenAI-Chat (kundeneigenes SDK)

```ts
import { shieldMessages } from '@promptaudit/shield';
// client ist Ihr separat installierter und konfigurierter OpenAI-Client.
const session = shieldMessages([{ role: 'user' as const, content: 'Mail fictional@example.invalid' }]);
try {
  const response = await client.chat.completions.create({
    model: configuredModel, messages: session.messages,
  });
  const localAnswer = session.restore(response.choices[0]?.message.content ?? '');
  // localAnswer enthält wieder Originale. Nicht ungeprüft an andere Empfänger senden.
} finally {
  session.clear();
}
```

Dies ist ein Integrationsmuster, kein ausgeführter externer Modellaufruf. SDK und Modell werden vom Entwickler ausgewählt. Weitere Anbieter dürfen nur nach Prüfung ihrer konkreten Nachrichtentypen angeschlossen werden.

## Text-Streaming

Ein Platzhalter kann in mehreren Chunks eintreffen: `[` → `IB` → `AN_1]`. Die Wiederherstellung prüft **exakte Schlüssel der lokalen Zuordnung**, nicht nur Kategoriennamen. Unbekannte Tokens, Markdown-Klammern und unvollständige Tokens bleiben unverändert. Backpressure wird über native Web Streams weitergegeben.

```ts
import { createUnshieldStream, shield } from '@promptaudit/shield';
const session = shield('Mail fictional@example.invalid');
// textStream: ReadableStream<string> mit Modell-Text, nicht rohem SSE/JSON.
const restored = textStream.pipeThrough(createUnshieldStream(session.map));
```

Für Vercel AI SDK ist dieses Muster auf einen tatsächlichen `ReadableStream<string>` wie `result.textStream` beschränkt. Es ist **kein** allgemeiner Ersatz für dessen UI-/Tool-Stream-Protokoll.

Die Helfer liefern ein `ReadableWritablePair`, das eine native `TransformStream`-Instanz mit Abbruchbereinigung umschliesst. Kein zusätzlicher Parser wird benötigt. `Transformer.cancel` wird nicht als portable Funktion vorausgesetzt.

### Ressourcen und Abbruch

- Standard `maxBufferSize: 256` **UTF-16-Codeeinheiten**, nicht Bytes. Bereich 8–4'096; sämtliche Map-Schlüssel müssen hineinpassen, sonst Fehler vor dem Start.
- Der ausstehende Tokenpuffer ist begrenzt. Die Präfixmenge wächst mit Anzahl und Länge der bekannten Schlüssel; die gesamte Sitzung ist **nicht O(1)**.
- Leser-Cancel, Schreiber-Abort, Fehler und normales Ende räumen den internen Parser auf. Optionaler `signal`-Abbruch beendet die Verarbeitung.
- `clearVaultOnTerminate: true` löscht die Map nur bei exklusiver Eigentümerschaft. Bei `shieldMessages` verwenden Sie `session.clear()` nach Abschluss aller Streams; ein einzelner Stream darf die gemeinsame Session nicht leeren.
- Map-Clear ist **keine sichere RAM-Nullung**; JavaScript kann vorhandene Strings und externe Kopien nicht garantiert löschen. Zuordnungen niemals global zwischen Nutzern teilen oder protokollieren.

## Rohes SSE

```ts
import { shield, createUnshieldSseStream } from '@promptaudit/shield';
const session = shield('Mail fictional@example.invalid');
// body: ReadableStream<Uint8Array> eines kundeneigenen Anbieteraufrufs.
const restoredBody = body.pipeThrough(createUnshieldSseStream(session.map, {
  provider: 'openai', // oder 'anthropic'; ausdrücklich wählen
  clearVaultOnTerminate: true,
}));
```

Gemessen werden in lokalen Fixtures OpenAI-Chat-Completions (`choices[index].delta.content`) und Anthropic-Text-Deltas (`content_block_delta`, `index`, `delta.type: text_delta`). Keine Behauptung über alle SDK-Versionen oder Gemini-/OpenAI-Responses-/Vercel-UI-Protokolle.

Der Parser erhält SSE-Kommentare, `event`, `id`, `retry`, mehrzeilige `data`-Felder und Nicht-Text-Ereignisse; Zeilenenden werden zu LF normalisiert. Ausgabekanäle haben getrennte Tokenpuffer. Unvollständiger Text wird vor einem Endereignis ausgegeben; dazu kann ein zusätzlicher Text-Delta mit der letzten bekannten Hülle entstehen. Nicht für signierte oder byteidentisch zu erhaltende Ereignisse verwenden.

Standardgrenzen: **65'536 UTF-16-Codeeinheiten pro Event, 32 aktive Textkanäle**; maximal einstellbar 1'048'576 bzw. 128. Ungültiges UTF-8, fehlerhaftes JSON und überschrittene Grenzen erzeugen einen Fehler statt stillen Textverlust. Metadaten und Nicht-Text-Payloads werden nicht maskiert. Kein Fetch-Interceptor, keine automatische Eingabeabfangfunktion.

## Erkennung und Grenzen

IBAN (Mod-97), Karten (Luhn + unterstützte Präfixe), US-SSN-Strukturregeln, ABA-Routing-Prüfsumme mit Schlüsselwort, E-Mail, internationale Telefonnummern, Namen nach unterstützten englischen Titeln, bekannte API-Schlüsselmuster/JWT, PEM-Privatschlüssel, Datenbank-URLs mit Zugangsdaten, `.env`-Geheimnismuster und Bearer-Werte.

- US-SSN-Regeln sind Strukturprüfungen, **keine Prüfsumme oder Identitätsprüfung**.
- Keine Entropieprüfung eingebaut. `.env`-Treffer sind Mustererkennung, keine Garantie für echte Zugangsdaten.
- Freitextadressen, Namen ohne unterstützten Titel, medizinische Begriffe und unbekannte Geheimnisformate können unerkannt bleiben. Falschtreffer sind möglich, auch bei gültigen Prüfsummen.
- Normalisierung entfernt Zero-Width-Zeichen und faltet Full-Width-Zeichen; Wiederherstellung liefert normalisierte erkannte Werte, **keine byteidentische Originalrekonstruktion**.
- Keine NER-Modelle, unabhängige Zertifizierung, DLP-Garantie, verschlüsselte Ablage oder Auditprotokolle. NLP-Lösungen lösen andere Erkennungsaufgaben; hier wurde kein Presidio-Geschwindigkeits-/Grössenvergleich gemessen.

## Reproduzierbare lokale Prüfungen

Im Quellrepository mit Bun:

```bash
bun test src
bun run typecheck
bun run build
bun run bench
```

Der Benchmark nutzt fiktive Daten und berichtet Corpuslänge, 1'000 Messungen, Median/p95 sowie unminifizierte ESM- und gzip-Grösse. Werte gelten für das ausgeführte Gerät und die Laufzeit; **keine festen <5-KB-, 0-ms- oder Sub-Millisekunden-Versprechen**.

Grundlagen: [Web Streams](https://streams.spec.whatwg.org/), [SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html).

## Mitwirken und weitere Bausteine

Fiktive Gegenbeispiele und reproduzierbare Regressionstests sind willkommen. Bitte keine echten Schlüssel oder Personendaten in Issues oder Pull Requests einfügen. Vor Veröffentlichung API-Verträglichkeit, Abbruchpfade und Paketinhalt prüfen.

Der separate [MCP-Adapter](https://github.com/PromptAudit-SaaS/mcp) nutzt die lokale Engine. Seine Werkzeugnamen bleiben `mask_text`, `scan_text`, `restore_text`; er fängt keine beliebigen Client-Eingaben automatisch ab. Git-Diff-/Pre-Commit-Scan und SARIF sind hier **nicht implementiert**.

[PromptAudit](https://promptaudit.ch) entwickelt daneben Datenschutz-/Tresor- und KI-Audit-Funktionen; diese proprietären Module sind nicht Bestandteil dieses MIT-Pakets.
