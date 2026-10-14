import fs from 'node:fs';
import type { Recording } from './types';
export class TranscriptionError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly retryAfter = 0) { super(message); }
}
export function retryDelay(attempts: number) { return Math.min(300_000, 5_000 * 2 ** Math.min(Math.max(0, attempts - 1), 6)); }
export async function transcribe(record: Recording, audioPath: string, key: string, request: typeof fetch = fetch): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(fs.readFileSync(audioPath))], { type: 'audio/wav' }), `${record.id}.wav`);
  form.append('model', record.model); form.append('response_format', 'json'); form.append('temperature', '0');
  if (record.language) form.append('language', record.language);
  if (record.prompt) form.append('prompt', record.prompt);
  let response: Response;
  try {
    response = await request('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
      signal: AbortSignal.timeout(120_000), redirect: 'error'
    });
  } catch { throw new TranscriptionError('Connection interrupted. Your audio is saved; Sayo will retry.', true); }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new TranscriptionError('Check your Groq API key in Settings, then retry.', false);
    if (response.status === 429) {
      const value = response.headers.get('retry-after');
      const seconds = Number(value);
      const delay = value ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now()) : 0;
      throw new TranscriptionError('Groq is busy or your rate limit was reached. Retrying automatically.', true, Number.isFinite(delay) ? Math.max(0, delay) : 0);
    }
    if (response.status >= 500 || [408, 409, 425].includes(response.status)) throw new TranscriptionError('The transcription service is unavailable. Retrying automatically.', true);
    throw new TranscriptionError('Groq could not process this recording. Audio is saved; check Settings and retry.', false);
  }
  let result: unknown;
  try { result = await response.json(); } catch { throw new TranscriptionError('An incomplete response arrived. Retrying automatically.', true); }
  const text = (result as { text?: unknown })?.text;
  if (typeof text !== 'string' || !text.trim()) throw new TranscriptionError('No speech was returned. You can listen to the audio and retry.', false);
  return text.trim();
}
