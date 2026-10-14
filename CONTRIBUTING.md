# Contributing to Sayo

Sayo is a Windows-only personal dictation app today. Contributions are welcome, including exploratory iOS, macOS and Linux work. Open an issue to discuss a port before making a large change. Desktop platform hooks and iOS input flows need different implementations; do not claim support until that platform is implemented and tested.

## Development checks

Use Windows x64 and Node.js 22.12 or newer. Run `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, and `npm run security:check`.

Interactive checks use isolated profiles and synthetic audio, without a real API key:

- `npm run test:desktop`
- `node scripts/check-readiness.mjs`
- `node scripts/check-overlay.mjs`
- `node scripts/check-paste.mjs`

Close other Sayo instances before interactive checks because the native helper registers a global shortcut. Test artifacts are written to `.test-artifacts` and must not be committed. CI runs unit/native gesture checks and packages on Windows; interactive desktop checks are local.

## Architecture

- `src/main.ts`: trusted Electron main process, windows, restricted IPC, startup, native helper and encrypted credential handling.
- `src/store.ts`, `queue.ts`, `storage-location.ts`: durable local storage, recovery and legacy migration.
- `src/transcriber.ts`, `cleaner.ts`: direct Groq requests from main; no renderer-side provider key.
- `src/recorder.ts`, `pcm-worklet.js`: capture and PCM chunk delivery.
- `native/InputBridge.cs`: Windows keyboard gestures, focus tracking and paste.
- `src/ui.tsx` and related components/styles: interface and history.

Keep secrets out of code, screenshots, logs and tests. Never add a key-readback API to the renderer. Preserve durable audio until recognition text is saved, preserve text on cleanup/paste failure, and do not send messages automatically. Keep API calls intentional; typing settings must not trigger provider requests.

Use small, focused pull requests with a clear problem, behavior and validation summary. For bug reports include Sayo/Windows versions, reproduction steps and a redacted error. Use synthetic examples rather than private transcripts.

## Publishing checks

Run `npm run security:check` and `npm run security:staged` before committing/pushing. Review the exact staged filenames. Packaging has an explicit allowlist; never include `.sayo`, profiles, transcripts, recordings, `.env` files, research extracts or local diagnostics in a release.
