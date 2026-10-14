import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Recording, Settings } from './types';

export const defaults: Settings = { model: 'whisper-large-v3-turbo', language: '', prompt: '', autoPaste: true, startAtLogin: true, microphone: '', overlayPosition: 'bottom', smartCleanup: true };
export const MAX_AUDIO_BYTES = 23_040_000; // 12 minutes at 16 kHz mono PCM16; below Groq's 25 MB limit.
export function wavHeader(bytes: number): Buffer {
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(bytes + 36, 4);
  h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(bytes, 40); return h;
}
export function atomicWrite(file: string, content: string | Buffer) {
  const temp = `${file}.tmp`;
  const fd = fs.openSync(temp, 'w');
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(temp, file);
}
function readJSON(file: string, recovered?: () => void): unknown {
  for (const candidate of [file, `${file}.bak`, `${file}.tmp`]) {
    try { const value: unknown = JSON.parse(fs.readFileSync(candidate, 'utf8')); if (candidate !== file) recovered?.(); return value; } catch { /* recover next copy */ }
  }
  return null;
}
export function normalizeSettings(value: unknown): Settings {
  const s = value as Partial<Settings> | null;
  return {
    model: s?.model === 'whisper-large-v3' ? s.model : defaults.model,
    language: typeof s?.language === 'string' && /^([a-z]{2})?$/.test(s.language) ? s.language : '',
    prompt: typeof s?.prompt === 'string' ? s.prompt.slice(0, 600) : '',
    autoPaste: typeof s?.autoPaste === 'boolean' ? s.autoPaste : true,
    startAtLogin: typeof s?.startAtLogin === 'boolean' ? s.startAtLogin : defaults.startAtLogin,
    microphone: typeof s?.microphone === 'string' ? s.microphone.slice(0, 300) : '',
    overlayPosition: s?.overlayPosition === 'top' || s?.overlayPosition === 'left' || s?.overlayPosition === 'right' ? s.overlayPosition : 'bottom',
    smartCleanup: typeof s?.smartCleanup === 'boolean' ? s.smartCleanup : true
  };
}
export class Store {
  readonly recordings = new Map<string, Recording>();
  settings: Settings;
  constructor(readonly root: string) {
    fs.mkdirSync(this.audioDirectory, { recursive: true });
    this.settings = normalizeSettings(readJSON(path.join(root, 'settings.json')));
    const ids = new Set(fs.readdirSync(this.audioDirectory).map(name => name.split('.')[0]).filter(id => /^[a-f0-9-]{36}$/.test(id)));
    for (const id of ids) {
      const audio = this.audioPath(id);
      const hasAudio = fs.existsSync(audio);
      const bytes = hasAudio ? Math.max(0, fs.statSync(audio).size - 44) : 0;
      let recoveredMetadata = false;
      const saved = readJSON(this.metaPath(id), () => { recoveredMetadata = true; }) as Partial<Recording> | null;
      const text = typeof saved?.text === 'string' ? saved.text : '';
      const rawText = typeof saved?.rawText === 'string' ? saved.rawText : saved?.status === 'completed' ? text : undefined;
      const record: Recording = {
        id, createdAt: saved?.createdAt ?? (hasAudio ? fs.statSync(audio).birthtime.toISOString() : new Date().toISOString()),
        duration: hasAudio ? bytes / 32000 : saved?.duration ?? 0, status: saved?.status ?? 'queued', text,
        attempts: saved?.attempts ?? 0, nextRetryAt: saved?.nextRetryAt ?? 0,
        error: saved?.error ?? '', language: saved?.language ?? '', model: saved?.model ?? defaults.model,
        prompt: saved?.prompt ?? '', pasted: saved?.pasted ?? false, hasAudio, rawText,
        cleanupState: saved?.cleanupState ?? 'off', intent: saved?.intent, destinationKind: saved?.destinationKind
      };
      if (['recording', 'transcribing'].includes(record.status)) {
        record.status = 'queued'; record.nextRetryAt = 0; record.error = 'Recovered after an interruption. Your audio is safe.';
      }
      // WAV length is reconstructed from actual saved PCM after a process crash.
      if (hasAudio) {
        const fd = fs.openSync(audio, 'r+');
        try { fs.writeSync(fd, wavHeader(bytes), 0, 44, 0); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
      if (bytes === 0 && !rawText?.trim() && record.status !== 'completed') { record.status = 'blocked'; record.error = hasAudio ? 'No audio reached disk. Please make a new recording.' : 'The audio file is missing. Please make a new recording.'; }
      this.recordings.set(id, record);
      // Healthy history is read-only on launch; fsync only repaired/changed data.
      if (recoveredMetadata || !saved || (Object.keys(record) as (keyof Recording)[]).some(key => record[key] !== saved[key])) this.save(record);
      if (rawText?.trim() || (record.status === 'completed' && text.trim())) this.discardAudio(record);
    }
  }
  get audioDirectory() { return path.join(this.root, 'recordings'); }
  audioPath(id: string) { return path.join(this.audioDirectory, `${id}.wav`); }
  metaPath(id: string) { return path.join(this.audioDirectory, `${id}.json`); }
  get(id: string) { const record = this.recordings.get(id); if (!record) throw new Error('Recording not found.'); return record; }
  list() { return [...this.recordings.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  save(record: Recording) { atomicWrite(this.metaPath(record.id), JSON.stringify(record)); }
  discardAudio(record: Recording) {
    if (!record.rawText?.trim() && !(record.status === 'completed' && record.text.trim())) return;
    if (!['', '.bak', '.tmp'].some(suffix => fs.existsSync(this.audioPath(record.id) + suffix))) {
      if (record.hasAudio) { record.hasAudio = false; this.save(record); }
      return;
    }
    // Duplicate the durable text into the metadata backup before irreversible removal.
    this.save(record);
    try {
      for (const suffix of ['', '.bak', '.tmp']) fs.rmSync(this.audioPath(record.id) + suffix, { force: true });
      record.hasAudio = false; this.save(record);
    } catch { record.hasAudio = fs.existsSync(this.audioPath(record.id)); }
  }
  create() {
    const record: Recording = {
      id: randomUUID(), createdAt: new Date().toISOString(), duration: 0, status: 'recording',
      text: '', attempts: 0, nextRetryAt: 0, error: '',
      language: this.settings.language, model: this.settings.model, prompt: this.settings.prompt, pasted: false, hasAudio: true
    };
    atomicWrite(this.audioPath(record.id), wavHeader(0)); this.save(record); this.recordings.set(record.id, record); return record;
  }
  append(id: string, data: ArrayBuffer) {
    const record = this.get(id);
    if (record.status !== 'recording') throw new Error('Recording is no longer active.');
    const bytes = Buffer.from(data);
    if (bytes.length > 16000 || bytes.length % 2) throw new Error('Invalid audio chunk.');
    const file = this.audioPath(id); const length = fs.statSync(file).size - 44;
    if (length + bytes.length > MAX_AUDIO_BYTES) throw new Error('Recording reached the 12-minute limit.');
    const fd = fs.openSync(file, 'r+');
    try {
      fs.writeSync(fd, bytes, 0, bytes.length, length + 44);
      fs.writeSync(fd, wavHeader(length + bytes.length), 0, 44, 0); fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    record.duration = (length + bytes.length) / 32000;
  }
  finish(id: string) {
    const r = this.get(id); r.status = r.duration < 0.2 ? 'blocked' : 'queued'; r.nextRetryAt = 0;
    r.error = r.duration < 0.2 ? 'This recording was too short. Please try again.' : ''; this.save(r); return r;
  }
  saveSettings(value: Settings) { this.settings = normalizeSettings(value); atomicWrite(path.join(this.root, 'settings.json'), JSON.stringify(this.settings)); }
}
