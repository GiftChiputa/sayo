import { app, BrowserWindow, ipcMain, session, screen, Tray, Menu, nativeImage, clipboard, safeStorage, dialog, powerMonitor, globalShortcut } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Store, atomicWrite } from './store';
import { Queue } from './queue';
import type { Snapshot, Settings } from './types';
import { WritingTools } from './writing-tools';
import { transcribe } from './transcriber';
import { cleanTranscript, type CleanupResult } from './cleaner';
import { prepareStorage } from './storage-location';

app.setName('VOOL');
// Keep the internal app identity; migrate private data to a stable user folder.
let storageRoot = '';
if (app.isPackaged || !process.env.VOOL_TEST_DATA) {
  try { storageRoot = prepareStorage(app.getPath('appData'), app.getPath('home')); }
  catch { /* The startup failure handler below reports a safe error. */ }
  if (storageRoot) app.setPath('userData', storageRoot);
}
// Integration tests get an isolated data directory and synthetic microphone.
if (!app.isPackaged && process.env.VOOL_TEST_DATA) {
  app.setPath('appData', process.env.VOOL_TEST_DATA);
  app.setPath('userData', path.join(process.env.VOOL_TEST_DATA, 'profile'));
  storageRoot = path.join(process.env.VOOL_TEST_DATA, 'VOOL');
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
let showWhenReady = !process.argv.includes('--background');
let main: BrowserWindow, overlay: BrowserWindow, tray: Tray, store: Store, queue: Queue;
let writingTools: WritingTools;
let helper: ChildProcessWithoutNullStreams | null = null;
let helperRestartTimer: NodeJS.Timeout | undefined, helperFailures = 0;
let recorderListening = false;
let nativeReady = false, quitting = false, notice = '', capture: Snapshot['capture'] = 'idle';
let pendingStop = false, captureMode: Snapshot['captureMode'] = 'latch';
let activeId: string | null = null, pasteId: string | null = null, pasteDeadline = 0;
let overlayRecordId: string | null = null, overlayStatus = '';
let overlayHideTimer: NodeJS.Timeout | undefined;
const overlaySize = { width: 300, height: 68 };
let captureTimer: NodeJS.Timeout | undefined, pasteResolver: ((ok: boolean) => void) | null = null;
const html = path.join(__dirname, 'index.html');
const snapshot = (): Snapshot => ({ recordings: store.list(), settings: store.settings, hasKey: hasKey(), capture, activeId, notice, nativeReady, captureMode, overlayRecordId });
function publish() {
  if (!store) return;
  const state = snapshot();
  for (const win of [main, overlay]) if (win && !win.isDestroyed()) win.webContents.send('snapshot-updated', state);
  if (capture === 'idle' && overlayRecordId && overlay && !overlay.isDestroyed()) {
    const record = store.get(overlayRecordId);
    const status = `${record.status}:${record.pasted}`;
    if (status !== overlayStatus) {
      overlayStatus = status; clearTimeout(overlayHideTimer);
      if (record.status !== 'transcribing') {
        const currentId = overlayRecordId;
        overlayHideTimer = setTimeout(() => { if (capture === 'idle' && overlayRecordId === currentId) overlay.hide(); }, record.status === 'completed' ? 1800 : 3000);
      }
    }
  }
}
function note(value: string) { notice = value; publish(); }
function secretPath() { return path.join(store.root, 'groq-key.enc'); }
function hasKey() { return fs.existsSync(secretPath()) && safeStorage.isEncryptionAvailable(); }
function readKey() { return hasKey() ? safeStorage.decryptString(fs.readFileSync(secretPath())) : ''; }
function sendNative(verb: string) { if (helper?.stdin.writable) helper.stdin.write(`${verb}\n`); }
async function nativePasteCheck(command: string) {
  return new Promise<boolean>(resolve => {
    pasteResolver = resolve; sendNative(command);
    setTimeout(() => { if (pasteResolver === resolve) { pasteResolver = null; resolve(false); } }, 1500);
  });
}
function showMain() { showWhenReady = true; if (main && !main.isDestroyed()) { main.show(); main.focus(); } }
// Listen during startup, so an early shortcut/icon launch is remembered.
app.on('second-instance', (_event, argv) => { if (!argv.includes('--background')) showMain(); });
function syncStartup() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ name: 'Sayo', openAtLogin: store.settings.startAtLogin, args: ['--background'], path: process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe') });
}
function placeOverlay() {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const position = store.settings.overlayPosition;
  const vertical = position === 'left' || position === 'right';
  const width = Math.min(vertical ? 88 : overlaySize.width, area.width);
  const height = Math.min(vertical ? 242 : overlaySize.height, area.height);
  const margin = 22;
  const x = position === 'left' ? area.x + margin : position === 'right' ? area.x + area.width - width - margin : area.x + (area.width - width) / 2;
  const y = position === 'top' ? area.y + margin : vertical ? area.y + (area.height - height) / 2 : area.y + area.height - height - margin;
  overlay.setBounds({ x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))), width, height });
}
function showOverlay() {
  clearTimeout(overlayHideTimer);
  placeOverlay();
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.showInactive(); overlay.moveTop();
  sendNative(`overlay ${overlay.getNativeWindowHandle().readBigUInt64LE(0)}`);
}
async function toggle(mode: Snapshot['captureMode'] = 'latch') {
  if (capture === 'recording') { stopCapture(); return; }
  if (capture !== 'idle') return;
  if (!hasKey()) { note('Add your Groq API key in Settings. Recordings can still be saved and transcribed later.'); }
  try {
    const record = store.create(); activeId = record.id; capture = 'starting'; pendingStop = false; captureMode = mode;
    pasteId = record.id; overlayRecordId = record.id; overlayStatus = '';
    sendNative(`arm ${record.id}`);
    showOverlay(); publish();
    if (recorderListening) overlay.webContents.send('capture-command', 'start', record.id);
    captureTimer = setTimeout(() => failCapture(record.id), 20_000);
  } catch { capture = 'idle'; note('Sayo could not save audio to disk. Check free space and try again.'); }
}
function stopCapture() {
  if (capture === 'starting') { pendingStop = true; return; }
  if (capture !== 'recording' || !activeId) return;
  sendNative(`freeze ${activeId}`);
  clearTimeout(captureTimer); capture = 'stopping'; pasteDeadline = Date.now() + 20_000; publish();
  overlay.webContents.send('capture-command', 'stop', activeId);
  captureTimer = setTimeout(() => failCapture(activeId!), 15_000);
}
function failCapture(id: string) {
  if (id !== activeId) return;
  clearTimeout(captureTimer);
  overlay.webContents.send('capture-command', 'stop', id);
  let message = 'Recording interrupted. Saved audio will be recovered when Sayo restarts.';
  try {
    const record = store.finish(id);
    message = record.duration > 0 ? 'Recording interrupted. Saved audio is queued for recovery.' : 'Microphone unavailable. Check the selected microphone and Windows microphone access.';
  } catch { message = 'Audio saving stopped. Check free space. Previously written audio remains in local storage.'; }
  finally {
    pasteId = null; sendNative('disarm'); capture = 'idle'; activeId = null; pendingStop = false;
    overlay.hide(); note(message); void queue.tick();
  }
}
function initNative() {
  if (quitting) return;
  clearTimeout(helperRestartTimer);
  const file = app.isPackaged ? path.join(process.resourcesPath, 'VOOL.Input.exe') : path.join(__dirname, '../native/VOOL.Input.exe');
  const child = spawn(file, [], { windowsHide: true });
  helper = child;
  createInterface({ input: child.stdout }).on('line', line => {
    if (helper !== child) return;
    try {
      const event = JSON.parse(line) as { type: string; ok?: boolean; id?: string; kind?: CleanupResult['intent'] };
      if (event.type === 'destination' && event.id === pasteId && event.kind && ['message', 'prompt', 'search', 'general'].includes(event.kind)) {
        const record = store.get(event.id!); record.destinationKind = event.kind; store.save(record);
      }
      if (event.type === 'ready') { if (helperFailures) notice = 'Right Alt shortcut is ready again.'; helperFailures = 0; nativeReady = true; sendNative(`overlay ${overlay.getNativeWindowHandle().readBigUInt64LE(0)}`); publish(); }
      if (event.type === 'start-hold' || event.type === 'start-latch') {
        if (capture === 'idle') void toggle(event.type === 'start-hold' ? 'hold' : 'latch').catch(() => note('Could not start recording. Please try again.'));
        else if (capture === 'stopping') sendNative('finished');
      }
      if (event.type === 'stop') stopCapture();
      if (event.type === 'paste' && pasteResolver) { pasteResolver(event.ok === true); pasteResolver = null; }
    } catch { /* ignore malformed native messages */ }
  });
  function restartHelper() {
    if (helper !== child) return;
    helper = null; nativeReady = false;
    if (quitting) return;
    pasteId = null;
    if (capture !== 'idle') stopCapture();
    note('Restarting the Right Alt shortcut. Ctrl+Shift+Space is also available.');
    helperRestartTimer = setTimeout(initNative, Math.min(1000 * 2 ** helperFailures++, 30000));
  }
  child.on('error', restartHelper);
  child.on('exit', restartHelper);
  // Secondary shortcut works if another app consumes bare Right Alt.
  if (!globalShortcut.isRegistered('Control+Shift+Space')) globalShortcut.register('Control+Shift+Space', () => {
    if (capture === 'idle') sendNative('capture');
    void toggle();
  });
}
function buildWindow(isOverlay: boolean) {
  const win = new BrowserWindow({
    width: isOverlay ? overlaySize.width : 1150, height: isOverlay ? overlaySize.height : 800,
    minWidth: isOverlay ? 0 : 850, minHeight: isOverlay ? 0 : 620,
    show: false, frame: false, transparent: isOverlay, resizable: !isOverlay,
    alwaysOnTop: isOverlay, skipTaskbar: isOverlay, focusable: !isOverlay,
    backgroundColor: isOverlay ? '#00000000' : '#f7f6f2', title: isOverlay ? 'Sayo · Recording' : 'Sayo',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  if (isOverlay) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(false);
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (isOverlay) win.webContents.on('did-start-loading', () => { recorderListening = false; });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('render-process-gone', () => {
    if (isOverlay && activeId) failCapture(activeId);
    if (!quitting) { void win.loadFile(html, { query: isOverlay ? { overlay: '1' } : {} }); }
  });
  void win.loadFile(html, { query: isOverlay ? { overlay: '1' } : {} });
  return win;
}
function installIPC() {
  function handle(name: string, action: (...args: unknown[]) => unknown, overlayOnly = false) {
    ipcMain.handle(name, (event, ...args: unknown[]) => {
      const allowed = overlayOnly ? [overlay.webContents] : [main.webContents, overlay.webContents];
      if (!allowed.includes(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted caller.');
      return action(...args);
    });
  }
  function id(value: unknown) { if (typeof value !== 'string') throw new Error('Invalid recording.'); return store.get(value).id; }
  handle('snapshot', () => snapshot()); handle('toggle', () => toggle());
  handle('recorder-ready', () => {
    recorderListening = true;
    if (capture === 'starting' && activeId) overlay.webContents.send('capture-command', 'start', activeId);
  }, true);
  handle('stop', () => { sendNative('finish-bar'); stopCapture(); }, true);
  handle('tools', () => writingTools.data);
  handle('save-tools', data => { writingTools.save(data); });
  handle('copy-text', text => { if (typeof text !== 'string' || text.length > 1_000_000) throw new Error('Invalid text.'); clipboard.writeText(text); note('Text copied.'); });
  handle('append', (value, data) => {
    const recordId = id(value); if (recordId !== activeId || !['starting', 'recording', 'stopping'].includes(capture) || !(data instanceof ArrayBuffer)) throw new Error('Inactive recording.');
    try { store.append(recordId, data); } catch { stopCapture(); note('Audio saving stopped. Previously saved audio is preserved.'); throw new Error('Unable to save this audio chunk.'); }
  }, true);
  handle('capture-ready', value => {
    if (id(value) !== activeId || capture !== 'starting') return;
    clearTimeout(captureTimer); capture = 'recording'; publish();
    captureTimer = setTimeout(stopCapture, 12 * 60_000);
    if (pendingStop) stopCapture();
  }, true);
  handle('capture-failed', value => failCapture(id(value)), true);
  handle('finish', value => {
    const recordId = id(value); if (recordId !== activeId) return;
    clearTimeout(captureTimer); store.finish(recordId); activeId = null; capture = 'idle'; sendNative('finished'); publish(); void queue.tick();
  }, true);
  handle('settings', (value, key) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid settings.');
    if (typeof key === 'string' && key.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows key encryption is unavailable.');
      if (key.length > 500 || /\s/.test(key.trim())) throw new Error('Check the API key format.');
      atomicWrite(secretPath(), safeStorage.encryptString(key.trim()));
    }
    store.saveSettings(value as Settings);
    syncStartup();
    if (overlay.isVisible()) placeOverlay();
    if (typeof key === 'string' && key.trim()) {
      for (const record of store.list()) if (record.status === 'blocked' && record.duration >= 0.2 && !record.text) { record.status = 'queued'; record.nextRetryAt = 0; store.save(record); }
    }
    note('Settings saved.'); void queue.tick();
  });
  handle('remove-key', () => { for (const suffix of ['', '.bak', '.tmp']) fs.rmSync(secretPath() + suffix, { force: true }); note('API key removed. Saved recordings remain on this PC.'); });
  handle('retry', value => queue.retry(id(value)));
  handle('copy', value => { const record = store.get(id(value)); if (!record.text) throw new Error('No transcript yet.'); clipboard.writeText(record.text); note('Transcript copied. Paste it wherever you need.'); });
  handle('audio', value => { const record = store.get(id(value)); if (!record.hasAudio) throw new Error('Audio was removed after transcription. Your text is saved.'); const audio = fs.readFileSync(store.audioPath(record.id)); return audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength); });
  handle('export', async value => {
    const recordId = id(value); if (!store.get(recordId).hasAudio) throw new Error('Audio was removed after transcription.'); const result = await dialog.showSaveDialog(main, { defaultPath: `Sayo-${recordId}.wav`, filters: [{ name: 'WAV audio', extensions: ['wav'] }] });
    if (!result.canceled && result.filePath) fs.copyFileSync(store.audioPath(recordId), result.filePath);
  });
  handle('folder', async () => {
    // Open only recordings, keeping credentials and Chromium profile files separate.
    // Pass the path as a single argument, including Windows usernames with spaces.
    try {
      fs.mkdirSync(store.audioDirectory, { recursive: true });
      await new Promise<void>((resolve, reject) => {
        const explorer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [fs.realpathSync.native(store.audioDirectory)], { windowsHide: false, stdio: 'ignore' });
        explorer.once('error', reject);
        explorer.once('spawn', () => { explorer.unref(); resolve(); });
      });
    } catch { throw new Error('Could not open the recordings folder. Your transcripts are available in History.'); }
  }); handle('show-main', showMain);
  handle('minimize', () => main.minimize()); handle('close', () => main.hide());
}
if (primaryInstance) app.whenReady().then(() => {
  if (!storageRoot) throw new Error('Storage is unavailable.');
  store = new Store(storageRoot);
  // Refresh the portable executable path after updates or moves.
  syncStartup();
  writingTools = new WritingTools(store.root);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(webContents === overlay?.webContents && permission === 'media' && 'mediaTypes' in details && details.mediaTypes?.every((type: string) => type === 'audio') === true);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => webContents === overlay?.webContents && permission === 'media');
  main = buildWindow(false); overlay = buildWindow(true); installIPC();
  main.on('close', event => { if (!quitting) { event.preventDefault(); main.hide(); } });
  queue = new Queue(store, readKey, publish, async (record, first) => {
    const eligible = first && record.id === pasteId && Date.now() < pasteDeadline && store.settings.autoPaste && nativeReady;
    let pasted = false;
    if (eligible && await nativePasteCheck(`can-paste ${record.id}`) && record.id === pasteId && capture === 'idle' && Date.now() < pasteDeadline) {
      clipboard.writeText(record.text);
      pasted = await nativePasteCheck(`paste ${record.id}`);
    }
    if (record.id === pasteId) { pasteId = null; sendNative('disarm'); }
    record.pasted = pasted; store.save(record);
    note(pasted ? 'Transcript saved and pasted.' : 'Transcript ready in History. Copy it whenever you need.');
  }, transcribe, async (record, raw, key) => {
    const original = writingTools.replace(raw);
    if (!store.settings.smartCleanup) { record.cleanupState = 'off'; return original; }
    record.cleanupState = 'pending'; store.save(record); publish();
    try {
      const known = writingTools.knownSpellings(store.settings.prompt);
      const cleaned = await cleanTranscript(original, key, known, undefined, record.destinationKind);
      const text = writingTools.replace(cleaned.text);
      record.intent = cleaned.intent; record.cleanupState = 'cleaned';
      // Learning is optional; a dictionary write error must not discard good text.
      try { writingTools.learn(cleaned.corrections, raw, text, known); } catch { /* keep the cleaned transcript */ }
      return text;
    } catch { record.cleanupState = 'fallback'; return original; }
  });
  initNative();
  if (!app.isPackaged && process.env.VOOL_TEST_DATA) {
    (app as NodeJS.EventEmitter).on('vool-test-start', () => { sendNative('capture'); void toggle(); });
    (app as NodeJS.EventEmitter).on('vool-test-stop-helper', () => { helper?.kill(); });
  }
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 20, height: 20 }));
  tray.setToolTip('Sayo · Hold Right Alt or double-tap to dictate');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Sayo', click: showMain }, { label: 'Record / Stop', click: () => { void toggle(); } }, { type: 'separator' }, { label: 'Quit Sayo', click: () => {
    if (capture !== 'idle') { stopCapture(); note('Finish saving this recording before quitting.'); return; }
    quitting = true; app.quit();
  } }]));
  tray.on('click', showMain);
  main.once('ready-to-show', () => { if (showWhenReady) showMain(); });
  powerMonitor.on('resume', () => { void queue.tick(); });
  powerMonitor.on('suspend', stopCapture);
  setInterval(() => { void queue.tick(); }, 2000);
  void queue.tick();
}).catch(() => { dialog.showErrorBox('Sayo could not start', 'Check that your local storage is writable and has free space. Your existing recordings have not been deleted.'); app.quit(); });
app.on('window-all-closed', () => { /* tray app */ });
app.on('before-quit', () => { quitting = true; clearTimeout(helperRestartTimer); globalShortcut.unregisterAll(); helper?.kill(); });
