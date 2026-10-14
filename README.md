<p align="center"><img src="src/icon.png" width="96" alt="Sayo voice-wave icon"></p>

# Sayo

**Open-source voice dictation for Windows.** Hold a key, speak, and paste your words into the active text field. Bring your own Groq API key; Sayo has no hosted backend or account system.

Built for everyday personal use. **Windows x64 is the only supported platform today.** Contributions for macOS, Linux and iOS are welcome; iOS needs a separate application implementation.

## Download

Get the Windows ZIP from [Releases](https://github.com/GiftChiputa/sayo/releases). Extract the whole folder to a permanent location, then run `Sayo.exe`. Keep its libraries and `resources` folder together. The ZIP is extracted once; the app does not unpack itself each time it opens.

Open **Settings**, enter your own [Groq API key](https://console.groq.com/keys), and save. The input clears intentionally; **Key saved securely** confirms it remains configured. These community builds are unsigned.

## Dictate

- **Hold Right Alt** to record; release to transcribe and paste.
- **Double-tap Right Alt** for hands-free recording; tap again to stop.
- **Ctrl+Shift+Space** is an alternative toggle.
- Click **Stop recording** on the floating bar to finish.

The recording bar stays above normal windows and can sit at the top, bottom, left or right. You can switch apps while speaking: the destination is the active text field when you stop. Keep it focused until the immediate result arrives. Sayo does not press Enter or submit messages. Protected or elevated apps can block automatic paste; use History to copy the saved text there.

## Recovery and smart writing

Audio is written locally in chunks before upload. Network failures retry in the background while Sayo is running, with backoff. Once speech recognition succeeds, the transcript is saved and its audio is deleted. Failed recordings retain audio until recognition succeeds. Original and cleaned text stay in History; delayed retries do not paste into unrelated windows.

Optional smart writing uses Groq to clean grammar and repetition and choose paragraphs or lists. Spoken prompts remain prompts. If cleanup fails, the original text stays usable. Dictionary and vocabulary entries improve names and spelling. Recordings stop at 12 minutes.

## Privacy and keys

- Your API key is encrypted by Windows and stored outside the source/install directory, under `%USERPROFILE%/.sayo`.
- Audio goes directly to Groq for recognition. Enabled smart writing sends transcription text, vocabulary and a broad destination category to Groq. Provider usage charges and policies apply.
- Sayo has no hosted server, telemetry or cloud history sync. Transcripts, settings and pending audio are stored locally. Window titles and screen contents are not sent to Groq.
- Removing the key removes its encrypted backup/temporary copies. Never share your `.sayo` profile, recordings, encryption files or API key in an issue.

See [SECURITY.md](SECURITY.md). No API key or `.env` file is needed to build or run the default tests.

## Startup

Closing the window keeps Sayo in the system tray. Use the tray menu to open or quit it. **Launch at Windows sign-in** enables quiet background startup. If you move the extracted app folder, run it once from its new location so the sign-in path can refresh.

Healthy history is read without unnecessary writes on launch. Early recording commands wait for the recorder listener, and the keyboard helper restarts if it exits unexpectedly.

## Build from source

Requires Windows x64, Node.js 22.12 or newer, npm, and the .NET Framework 4.x C# compiler included on supported Windows installations. The project uses Electron, React and a small Windows-native C# input bridge.

```powershell
git clone https://github.com/GiftChiputa/sayo.git
cd sayo
npm ci
npm run typecheck
npm run build
npm test
npm start
```

For a persistent local install with Desktop/Start menu shortcuts:

```powershell
npm run install:local
```

To build without changing your installed app:

```powershell
npm run pack
node scripts/check-package.mjs --bundle-only
```

`release/win-unpacked` contains the complete Windows application. An optional self-extracting portable EXE can be built with `npm run dist`; it is slower on cold launches. Do not commit `dist`, `release` or user-profile files.

## Contribute

Bug reports, accessibility improvements, documentation, Windows reliability fixes and other-platform work are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md). There is no supported iOS/macOS/Linux build yet; please discuss a port in an issue and preserve Windows behavior.

MIT licensed. See [LICENSE](LICENSE). The interface, code and abstract icon are part of this independent project; no proprietary application code is distributed.
