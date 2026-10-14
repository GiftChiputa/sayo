import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './store';
import type { ToolData } from './types';
export const emptyTools: ToolData = { dictionary: [], snippets: [], scratchpad: '', style: 'natural' };
function closeSpelling(a: string, b: string) {
  a = a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); b = b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (Math.max(a.length, b.length) < 4) return false;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length] <= Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.35));
}
export function normalizeTools(data: unknown): ToolData {
  const value = data as Partial<ToolData> | null;
  return {
    dictionary: Array.isArray(value?.dictionary) ? value.dictionary.filter(p => typeof p?.heard === 'string' && typeof p?.written === 'string').slice(0, 1000).map(p => ({ heard: p.heard.trim().slice(0,100), written: p.written.trim().slice(0,100) })).filter(p => p.heard && p.written) : [],
    snippets: Array.isArray(value?.snippets) ? value.snippets.filter(s => typeof s?.id === 'string' && typeof s?.title === 'string' && typeof s?.text === 'string').slice(0,1000).map(s => ({ id:s.id.slice(0,100), title:s.title.slice(0,200), text:s.text.slice(0,100000) })) : [],
    scratchpad: typeof value?.scratchpad === 'string' ? value.scratchpad.slice(0,1_000_000) : '',
    style: value?.style === 'paragraphs' || value?.style === 'bullets' ? value.style : 'natural'
  };
}
export class WritingTools {
  data: ToolData = { ...emptyTools };
  readonly file: string;
  constructor(root: string) {
    this.file = path.join(root, 'writing-tools.json');
    for (const file of [this.file, `${this.file}.bak`]) {
      try { this.data = normalizeTools(JSON.parse(fs.readFileSync(file,'utf8'))); break; } catch { /* recover backup */ }
    }
  }
  save(data: unknown) { const next = normalizeTools(data); atomicWrite(this.file,JSON.stringify(next)); this.data=next; }
  knownSpellings(vocabulary: string) {
    return [...new Set(['Sayo', 'Groq', 'ChatGPT', 'Google', 'YouTube', 'WhatsApp', 'GitHub', 'OpenAI', ...vocabulary.split(/[,;\n]/).map(term => term.trim()).filter(Boolean), ...this.data.dictionary.map(pair => pair.written)])].slice(0, 150);
  }
  learn(corrections: Array<{ heard: string; written: string }>, original: string, cleaned: string, known: string[]) {
    const dictionary = [...this.data.dictionary];
    for (const pair of corrections) {
      const heard = pair.heard.trim(), written = pair.written.trim();
      const literal = heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!heard || heard.length > 100 || !written || written.length > 100 || heard === written || !known.includes(written) || !closeSpelling(heard, written) || !new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`, 'iu').test(original) || !cleaned.includes(written) || dictionary.some(entry => entry.heard.toLowerCase() === heard.toLowerCase())) continue;
      dictionary.push({ heard, written });
    }
    if (dictionary.length !== this.data.dictionary.length) this.save({ ...this.data, dictionary });
  }
  replace(text: string) {
    for (const pair of this.data.dictionary) {
      const literal = pair.heard.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      text=text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`,'giu'),()=> pair.written);
    }
    return text;
  }
  format(text: string) {
    text = this.replace(text);
    if (this.data.style !== 'natural') {
      const sentences=text.match(/[^.!?]+(?:[.!?]+|$)/g)?.map(s=>s.trim()).filter(Boolean) ?? [text];
      text = this.data.style === 'bullets' ? sentences.map(s=>`• ${s}`).join('\n') : sentences.join('\n\n');
    }
    return text;
  }
}
