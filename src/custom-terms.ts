/** Bounded local Aho–Corasick matcher. No dynamic regular expressions. */
export interface CustomTermsOptions { caseInsensitive?: boolean; wholeWords?: boolean }
interface Node { next: Map<string, number>; fail: number; output: number[] }
export interface TermMatch { start: number; end: number }
const word = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}\p{M}_]/u.test(char);
export class CustomTermMatcher {
  private nodes: Node[] = [{ next: new Map(), fail: 0, output: [] }];
  private terms: string[][] = [];
  constructor(terms: readonly string[], private options: CustomTermsOptions = {}) {
    if (terms.length > 1000) throw new RangeError('At most 1000 custom terms.');
    const unique = new Set<string>();
    for (const term of terms) {
      if (!term || term.length > 256) throw new RangeError('Terms must contain 1–256 UTF-16 units.');
      const chars = Array.from(term);
      const folded = chars.map(c => this.fold(c));
      const key = JSON.stringify(folded);
      if (unique.has(key)) continue;
      unique.add(key);
      const id = this.terms.length;
      this.terms.push(chars);
      let state = 0;
      for (const char of folded) {
        const node = this.node(state);
        let next = node.next.get(char);
        if (next === undefined) { next = this.nodes.length; node.next.set(char, next); this.nodes.push({ next: new Map(), fail: 0, output: [] }); }
        state = next;
      }
      this.node(state).output.push(id);
    }
    const queue = [...this.node(0).next.values()];
    for (let head = 0; head < queue.length; head++) {
      const state = queue[head];
      if (state === undefined) throw new Error('Invalid trie.');
      for (const [char, target] of this.node(state).next) {
        queue.push(target);
        let fallback = this.node(state).fail;
        while (fallback && !this.node(fallback).next.has(char)) fallback = this.node(fallback).fail;
        const fail = this.node(fallback).next.get(char) ?? 0;
        this.node(target).fail = fail;
        this.node(target).output.push(...this.node(fail).output);
      }
    }
  }
  private fold(char: string) { return this.options.caseInsensitive === false ? char : char.toLowerCase(); }
  private node(index: number): Node { const node = this.nodes[index]; if (!node) throw new Error('Invalid trie.'); return node; }
  findMatches(text: string): TermMatch[] {
    if (text.length > 1_048_576) throw new RangeError('Text limit exceeded.');
    const chars = Array.from(text);
    const offsets = [0];
    for (const char of chars) offsets.push((offsets.at(-1) ?? 0) + char.length);
    const best = new Map<number, number>();
    let state = 0, candidates = 0;
    for (let i = 0; i < chars.length; i++) {
      const raw = chars[i]; if (raw === undefined) continue;
      const char = this.fold(raw);
      while (state && !this.node(state).next.has(char)) state = this.node(state).fail;
      state = this.node(state).next.get(char) ?? 0;
      for (const id of this.node(state).output) {
        if (++candidates > 100_000) throw new RangeError('Match budget exceeded.');
        const term = this.terms[id]; if (!term) throw new Error('Invalid term.');
        const start = i + 1 - term.length;
        if (this.options.wholeWords !== false && ((word(term[0]) && word(chars[start - 1])) || (word(term.at(-1)) && word(chars[i + 1])))) continue;
        best.set(start, Math.max(best.get(start) ?? 0, i + 1));
      }
    }
    const result: TermMatch[] = [];
    for (let i = 0; i < chars.length;) {
      const end = best.get(i);
      if (end === undefined) { i++; continue; }
      const startOffset = offsets[i], endOffset = offsets[end];
      if (startOffset === undefined || endOffset === undefined) throw new Error('Invalid offset.');
      result.push({ start: startOffset, end: endOffset }); i = end;
    }
    return result;
  }
}
