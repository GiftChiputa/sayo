import type { Recording } from './types';
import { Store } from './store';
import { transcribe, TranscriptionError, retryDelay } from './transcriber';
export class Queue {
  busy = false;
  constructor(readonly store: Store, readonly key: () => string, readonly updated: () => void,
    readonly success: (record: Recording, firstAttempt: boolean) => Promise<void>,
    readonly run: typeof transcribe = transcribe,
    readonly polish?: (record: Recording, text: string, key: string) => Promise<string>) {}
  async tick() {
    if (this.busy) return;
    for (const done of this.store.list()) if (done.hasAudio && (done.rawText?.trim() || done.status === 'completed')) this.store.discardAudio(done);
    const record = this.store.list().reverse().find(r => ['queued', 'retrying'].includes(r.status) && r.nextRetryAt <= Date.now());
    if (!record) return;
    let key: string;
    try { key = this.key(); } catch { return; }
    if (!key) return;
    this.busy = true;
    try {
      const first = record.attempts === 0;
      record.status = 'transcribing'; record.attempts++; record.error = '';
      this.store.save(record); this.updated();
      const raw = record.rawText || await this.run(record, this.store.audioPath(record.id), key);
      record.rawText = raw; record.text = raw;
      this.store.save(record); this.store.discardAudio(record); this.updated();
      // Cleanup operates on persisted text; it never repeats speech recognition.
      let text = raw;
      if (this.polish) {
        try { text = await this.polish(record, raw, key); }
        catch { record.cleanupState = 'fallback'; }
      }
      record.text = text; record.status = 'completed'; record.error = ''; record.nextRetryAt = 0;
      // Persist text before any clipboard or UI side effect.
      this.store.save(record); this.updated();
      try { await this.success(record, first); } catch { /* a paste error must never re-submit paid transcription */ }
    } catch (error) {
      const e = error instanceof TranscriptionError ? error : new TranscriptionError('Unable to process this recording. Audio remains saved; please retry.', false);
      record.status = e.retryable ? 'retrying' : 'blocked'; record.error = e.message;
      record.nextRetryAt = e.retryable ? Date.now() + Math.max(retryDelay(record.attempts), e.retryAfter) : 0;
      try { this.store.save(record); } catch { /* existing WAV and prior metadata survive disk failure */ }
      this.updated();
    } finally { this.busy = false; }
  }
  retry(id: string) {
    const record = this.store.get(id);
    if (['recording', 'transcribing'].includes(record.status) || (!record.hasAudio && !record.rawText)) return;
    record.status = 'queued'; record.nextRetryAt = 0; record.error = ''; record.attempts = Math.max(1, record.attempts);
    record.model = this.store.settings.model; record.language = this.store.settings.language; record.prompt = this.store.settings.prompt;
    this.store.save(record); this.updated(); void this.tick();
  }
}
