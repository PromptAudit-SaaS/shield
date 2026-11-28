import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { shield } from '../src/engine';

// Fictitious reproducible corpus; developer-only measurement, no network or real secrets.
const input = 'IBAN CH9300762011623852957; mail fictional@example.invalid; DB_PASSWORD=fictional-password; '.repeat(10);
for (let i = 0; i < 200; i++) shield(input);
const samples: number[] = [];
for (let i = 0; i < 1000; i++) {
  const start = performance.now(); shield(input); samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const bundle = readFileSync(new URL('../dist/index.js', import.meta.url));
console.log(JSON.stringify({
  corpusUtf16Units: input.length, iterations: samples.length,
  medianMs: samples[500], p95Ms: samples[950],
  esmBytes: bundle.length, esmGzipBytes: gzipSync(bundle).length,
  note: 'Lokale Messung des unminifizierten ESM-Pakets; kein Anbieter- oder Laufzeitvergleich, keine Garantie.',
}, null, 2));