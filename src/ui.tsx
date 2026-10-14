import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Recording, Settings, Snapshot } from './types';
import { installRecorder } from './recorder';
import { Overview } from './overview';
import { ToolsView } from './tools';
import './tools.css';
import './overview.css';
import './polish.css';
import './recording.css';

type IconName = 'mic' | 'home' | 'history' | 'settings' | 'copy' | 'arrow' | 'search' | 'check' | 'retry' | 'folder' | 'play' | 'download';
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    mic: <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-8h6v8"/></>,
    history: <><path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/></>,
    settings: <><path d="m10 3-1 3-3 1-3-1-1 4 2 2-1 3 2 3 3-1 3 2 3-1 1-3 3-1 2-3-2-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/></>,
    copy: <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 4V3H3v13h1"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    check: <path d="m5 12 4 4L19 6"/>, retry: <><path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/></>,
    folder: <path d="M3 7V4h7l2 3h9v13H3z"/>, play: <path d="m8 4 12 8-12 8z"/>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Logo() { return <span className="logo-mark" aria-hidden="true"><img src="icon.png" alt="" draggable={false}/></span>; }
export function Shortcut() { return <span className="shortcut"><kbd>Right Alt</kbd><span>× 2</span></span>; }
function duration(seconds: number) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
const labels: Record<Recording['status'], string> = { recording: 'Recording', queued: 'Saved · queued', transcribing: 'Transcribing', retrying: 'Retrying', blocked: 'Needs attention', completed: 'Transcribed' };
function useSnapshot() {
  const [state, setState] = useState<Snapshot | null>(null);
  useEffect(() => { void window.vool.snapshot().then(setState); return window.vool.onSnapshot(setState); }, []); return state;
}
function Overlay() {
  const state = useSnapshot(), [meter, setMeter] = useState(0), [elapsed, setElapsed] = useState(0), [stopPending, setStopPending] = useState(false);
  useEffect(() => installRecorder(setMeter), []);
  useEffect(() => {
    if (state?.capture === 'starting') { setElapsed(0); setStopPending(false); }
    if (state?.capture !== 'recording') return;
    const time = Date.now(); const timer = setInterval(() => setElapsed((Date.now() - time) / 1000), 200);
    return () => clearInterval(timer);
  }, [state?.capture]);
  const isRecording = state?.capture === 'recording';
  const record = state?.recordings.find(r => r.id === state.overlayRecordId);
  const processing = state?.capture === 'stopping' || (state?.capture === 'idle' && record?.status === 'transcribing');
  const done = state?.capture === 'idle' && record?.status === 'completed';
  const saved = state?.capture === 'idle' && !processing && !done;
  const polishing = processing && record?.cleanupState === 'pending';
  const title = isRecording ? 'Listening' : processing ? polishing ? 'Polishing' : 'Transcribing' : done ? record?.pasted ? 'Pasted' : 'Text ready' : saved ? 'Audio saved' : 'Getting ready';
  const hint = isRecording ? state?.captureMode === 'hold' ? 'Release to finish' : 'Tap Alt to finish' : processing ? polishing ? 'Grammar and layout' : 'Turning voice into words' : done ? record?.pasted ? 'Saved in History' : 'Copy from History' : saved ? record?.status === 'retrying' ? 'Retrying in background' : 'Safe in History' : 'Opening your microphone';
  async function finish() { if (stopPending) return; setStopPending(true); try { await window.vool.stop(); } catch { setStopPending(false); } }
  return <div className={`recording-pill ${state?.settings.overlayPosition === 'left' || state?.settings.overlayPosition === 'right' ? 'vertical' : ''} ${isRecording ? 'is-listening' : ''} ${processing ? 'is-processing' : ''}`}>
    <span className="recording-mic" aria-hidden="true">{processing ? <span className="recording-spinner"/> : <Icon name={done || saved ? 'check' : 'mic'} size={18}/>}</span>
    <div className="pill-copy"><strong role="status" aria-live="polite">{title}<span className="recording-time">{duration(state?.capture === 'idle' ? record?.duration ?? elapsed : elapsed)}</span></strong><span>{hint}</span></div>
    <div className="waveform" aria-label="Microphone level">{Array.from({ length: 11 }, (_, i) => <i key={i} style={{ height: `${4 + (isRecording ? meter : 0) * (7 + 15 * Math.abs(Math.sin(i * 1.6)))}px` }}/>)}</div>
    <button className="stop" onMouseDown={e => e.preventDefault()} onClick={() => void finish()} aria-label="Stop recording" title="Finish and transcribe" disabled={stopPending || !['starting','recording'].includes(state?.capture ?? 'idle')}><span/></button>
  </div>;
}
export function RecordRow({ record, select, action }: { record: Recording; select: () => void; action: (task: Promise<unknown>) => void }) {
  return <div className="record-row"><button className="record-body" onClick={select}><span className={`record-symbol ${record.status === 'completed' ? 'done' : 'pending'}`}><Icon name={record.status === 'completed' ? 'check' : 'mic'}/></span><span className="record-info"><strong>{record.text ? record.text.slice(0, 105) : labels[record.status]}</strong><span>{new Date(record.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<b>·</b>{duration(record.duration)}<b>·</b><span className={`status-${record.status}`}>{labels[record.status]}</span></span></span></button><button className="icon-button" title={record.text ? 'Copy transcript' : 'View saved audio'} aria-label={record.text ? 'Copy transcript' : 'View saved audio'} onClick={() => record.text ? action(window.vool.copy(record.id)) : select()}><Icon name={record.text ? 'copy' : 'arrow'} size={18}/></button></div>;
}
function Detail({ record, close, action }: { record: Recording; close: () => void; action: (task: Promise<unknown>) => void }) {
  const [audio, setAudio] = useState('');
  useEffect(() => {
    let url = '', alive = true; setAudio('');
    if (record.hasAudio) void window.vool.audio(record.id).then(data => { if (alive) { url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' })); setAudio(url); } }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [record.id, record.hasAudio]);
  const retryDisabled = ['recording', 'transcribing'].includes(record.status) || (!record.hasAudio && (!record.rawText || record.cleanupState === 'cleaned')) || record.duration < 0.2;
  return <div className="modal-backdrop" onClick={close}><section className="detail modal" role="dialog" aria-modal="true" aria-label="Saved dictation" onClick={e => e.stopPropagation()}>
    <div className="detail-heading"><div><h2>Your dictation</h2><p>{new Date(record.createdAt).toLocaleString()} · {duration(record.duration)}</p></div><button className="icon-button" onClick={close} aria-label="Close details">×</button></div>
    <span className={`status-badge status-${record.status}`}>{labels[record.status]}{record.pasted ? ' · pasted' : ''}{record.cleanupState === 'cleaned' ? ` · ${record.intent ?? 'smart writing'}` : ''}</span>
    {record.error && <p className="recovery-note">{record.error}</p>}
    {record.cleanupState === 'fallback' && <p className="recovery-note">Smart cleanup was unavailable. Your original words are saved and ready to copy. Retry cleanup to polish them without uploading audio again.</p>}
    <div className="transcript">{record.text || 'Audio is saved while transcription is pending.'}</div>
    {record.rawText && record.rawText !== record.text && <details className="original-transcript"><summary>Original transcription</summary><div className="transcript">{record.rawText}</div><button className="text-button" onClick={() => action(window.vool.copyText(record.rawText!))}>Copy original</button></details>}
    {audio && <audio controls src={audio}/>}
    <p className="field-help">{record.hasAudio ? 'Audio is kept until a transcript is saved, then removed automatically.' : 'Transcript kept. Audio removed to save space.'}</p>
    <div className="detail-actions"><button className="primary" disabled={!record.text} onClick={() => action(window.vool.copy(record.id))}><Icon name="copy" size={17}/>Copy text</button><button className="secondary" disabled={retryDisabled} onClick={() => action(window.vool.retry(record.id))}><Icon name="retry" size={17}/>{record.hasAudio ? 'Retry transcription' : 'Retry cleanup'}</button>{record.hasAudio && <button className="icon-button" aria-label="Export original audio" onClick={() => action(window.vool.exportAudio(record.id))}><Icon name="download"/></button>}</div>
  </section></div>;
}

function RecordingPositionSettings({ value, onChange }: { value: Settings['overlayPosition']; onChange: (value: Settings['overlayPosition']) => void }) {
  return <div className="recording-position-setting"><label>Recording bar position<select value={value} onChange={event => onChange(event.target.value as Settings['overlayPosition'])}>
    <option value="bottom">Bottom · horizontal</option><option value="top">Top · horizontal</option><option value="left">Left · vertical</option><option value="right">Right · vertical</option>
  </select></label><p className="field-help">Choose an edge that leaves your text field visible. Save settings to apply it.</p></div>;
}
function SettingsView({ state, action }: { state: Snapshot; action: (task: Promise<unknown>) => void }) {
  const [settings, setSettings] = useState<Settings>(state.settings), [key, setKey] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => { void navigator.mediaDevices.enumerateDevices().then(list => setDevices(list.filter(d => d.kind === 'audioinput'))).catch(() => {}); }, []);
  function change<K extends keyof Settings>(name: K, value: Settings[K]) { setSettings(s => ({ ...s, [name]: value })); setSaved(false); }
  async function save() {
    setSaving(true); try { await window.vool.saveSettings(settings, key || undefined); setKey(''); setSaved(true); } finally { setSaving(false); }
  }
  return <><div className="page-heading"><span className="eyebrow">MAKE IT YOURS</span><h1>Settings</h1><p>Your voice. Your key. Your computer.</p></div><section className="settings-card"><div className="section-heading"><h2>Transcription</h2><span className={`small-badge ${state.hasKey ? 'sage' : ''}`}>{state.hasKey ? 'Key saved securely' : 'Add your API key'}</span></div><label>Groq API key<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => { setKey(e.target.value); setSaved(false); }} placeholder={state.hasKey ? 'Enter a new key to replace the saved key' : 'gsk_…'}/></label><p className="field-help">Your key stays saved after this field clears. Encrypted by Windows outside the project, and used only for direct Groq requests.</p><div className="form-grid"><label>Whisper model<select value={settings.model} onChange={e => change('model', e.target.value as Settings['model'])}><option value="whisper-large-v3-turbo">Whisper Large V3 Turbo · faster</option><option value="whisper-large-v3">Whisper Large V3 · more accurate</option></select></label><label>Spoken language<select value={settings.language} onChange={e => change('language', e.target.value)}>{[['','Detect automatically'],['en','English'],['fr','French'],['es','Spanish'],['pt','Portuguese'],['de','German'],['it','Italian'],['tl','Tagalog'],['ar','Arabic'],['hi','Hindi'],['ja','Japanese'],['zh','Chinese']].map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label></div><label>Microphone<select value={settings.microphone} onChange={e => change('microphone', e.target.value)}><option value="">Windows default microphone</option>{devices.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i+1}`}</option>)}</select></label><label>Names & vocabulary <span className="optional">optional</span><textarea value={settings.prompt} maxLength={600} onChange={e => change('prompt', e.target.value)} placeholder="Names, project titles, or technical terms you use often…" rows={2}/></label><p className="field-help">Help Whisper spell uncommon words. This is sent with each transcription.</p></section><section className="settings-card"><h2>Everyday flow</h2><div className="setting-row"><div><strong>Smart writing</strong><p>Automatically clean grammar and fillers, and choose paragraphs or lists. Prompts stay prompts. Uses GPT-OSS 120B on Groq after transcription.</p></div><button className={`switch ${settings.smartCleanup ? 'on' : ''}`} role="switch" aria-checked={settings.smartCleanup} aria-label="Smart writing" onClick={() => change('smartCleanup', !settings.smartCleanup)}><span/></button></div><RecordingPositionSettings value={settings.overlayPosition} onChange={value => change('overlayPosition', value)}/><div className="setting-row"><div><strong>Paste after dictating</strong><p>Paste into the text field active when you stop recording. You can switch apps while speaking.</p></div><button className={`switch ${settings.autoPaste ? 'on' : ''}`} role="switch" aria-checked={settings.autoPaste} aria-label="Paste after dictating" onClick={() => change('autoPaste', !settings.autoPaste)}><span/></button></div><div className="setting-row"><div><strong>Launch at Windows sign-in</strong><p>Keep Sayo ready in your system tray.</p></div><button className={`switch ${settings.startAtLogin ? 'on' : ''}`} role="switch" aria-checked={settings.startAtLogin} aria-label="Launch at Windows sign-in" onClick={() => change('startAtLogin', !settings.startAtLogin)}><span/></button></div><div className="setting-row"><div><strong>Dictation shortcut</strong><p>Hold to record; release to finish. Double-tap to stay recording; tap again to finish.</p></div><Shortcut/></div></section><div className="settings-footer"><button className="primary" disabled={saving} onClick={() => action(save())}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save settings'}<Icon name={saved ? 'check' : 'arrow'} size={17}/></button>{state.hasKey && <button className="text-button" onClick={() => { if (confirm('Remove the saved API key? Your recordings and transcripts will stay on this PC.')) action(window.vool.removeKey()); }}>Remove API key</button>}</div><section className="storage-note"><Icon name="folder"/><div><strong>Everything you say has a home.</strong><p>Transcripts stay on this PC. Audio is removed after transcription succeeds; failed recordings keep their audio and retry automatically.</p><button className="text-button" onClick={() => action(window.vool.openFolder())}>Open recordings folder <Icon name="arrow" size={15}/></button></div></section></>;
}
function App() {
  const state = useSnapshot(), [page, setPage] = useState<'home'|'history'|'settings'|'insights'|'dictionary'>('home');
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [selected, setSelected] = useState<string | null>(null), [error, setError] = useState('');
  function action(task: Promise<unknown>) { setError(''); void task.catch(e => setError(e instanceof Error ? e.message : 'That action could not be completed. Please try again.')); }
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  if (!state) return <div className="loading">Opening Sayo…</div>;
  const completed = state.recordings.filter(r => r.status === 'completed');
  const pending = state.recordings.filter(r => ['queued','retrying','transcribing','blocked'].includes(r.status));
  const words = completed.reduce((sum, r) => sum + r.text.split(/\s+/).filter(Boolean).length, 0);
  const list = state.recordings.filter(r => (filter !== 'pending' || r.status !== 'completed') && (!query || `${r.text} ${r.error}`.toLowerCase().includes(query.toLowerCase())));
  const selectedRecord = selected ? state.recordings.find(r => r.id === selected) : null;
  const active = state.capture !== 'idle';
  return <div className="app"><aside className="sidebar"><div className="brand"><Logo/><span>Sayo</span></div><div className="sidebar-caption">LET YOUR WORDS FLOW</div><nav>{([['home','mic','Dictation'],['history','history','History'],['insights','arrow','Insights'],['dictionary','copy','Dictionary']] as const).map(([id,icon,label]) => <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><Icon name={icon}/>{label}{id === 'history' && pending.length > 0 && <span className="nav-count" aria-hidden="true">{pending.length}</span>}</button>)}</nav><div className="sidebar-bottom"><button className={page === 'settings' ? 'nav-item active' : 'nav-item'} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => setPage('settings')}><Icon name="settings"/>Settings</button><div className="local-card"><span className="local-dot"/><div><strong>Just you and your PC</strong><span>Transcripts saved locally.</span></div></div><button className="storage-link" onClick={() => action(window.vool.openFolder())}><Icon name="folder" size={16}/>Open recordings folder</button><span className="version">Sayo for Windows <span>v0.1.6</span></span></div></aside><main className="main"><div className="titlebar"><span>Personal dictation</span><div><button onClick={() => action(window.vool.minimize())} aria-label="Minimize">−</button><button onClick={() => action(window.vool.close())} aria-label="Close to system tray">×</button></div></div><div className="content">{page === 'home' && <Overview state={state} action={action} select={setSelected} history={() => setPage('history')} settings={() => setPage('settings')}/>}{page === 'history' && <><div className="page-heading"><span className="eyebrow">NOT A WORD LOST</span><h1>Your words, kept.</h1><p>Your transcripts stay here. Audio is removed after transcription.</p></div><div className="history-toolbar"><div className="filters"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>All dictations <span>{state.recordings.length}</span></button><button className={filter === 'pending' ? 'selected' : ''} onClick={() => setFilter('pending')}>Awaiting text <span>{pending.length}</span></button></div><label className="search"><Icon name="search" size={17}/><input aria-label="Search transcripts" placeholder="Find your words…" value={query} onChange={e => setQuery(e.target.value)}/></label></div><section className="history-list">{list.length ? list.map((r,i) => { const day = new Date(r.createdAt).toLocaleDateString([], { month:'long',day:'numeric',year:'numeric' }); const previousDay = i ? new Date(list[i-1].createdAt).toLocaleDateString([], { month:'long',day:'numeric',year:'numeric' }) : ''; return <React.Fragment key={r.id}>{day !== previousDay && <h3 className="day-heading">{day}</h3>}<RecordRow record={r} select={() => setSelected(r.id)} action={action}/></React.Fragment>; }) : <div className="empty"><Icon name="history" size={32}/><strong>{query ? 'No matching words yet.' : filter === 'pending' ? 'All caught up.' : 'A fresh page for your voice.'}</strong><p>{filter === 'pending' ? 'No recordings are waiting for transcription.' : 'Your saved dictations will appear here.'}</p></div>}</section></>}{(['insights','dictionary'] as const).map(tool => page === tool ? <ToolsView key={tool} page={tool} state={state} action={action}/> : null)}{page === 'settings' && <SettingsView state={state} action={action}/>}</div>{(error || state.notice) && <div className={`toast ${error ? 'toast-error' : ''}`} role="status"><Icon name={error ? 'retry' : 'check'} size={16}/>{error || state.notice}</div>}{!state.nativeReady && <div className="native-notice">Right Alt shortcut is starting or unavailable. Use the tray menu or Ctrl+Shift+Space.</div>}</main>{selectedRecord && <Detail record={selectedRecord} close={() => setSelected(null)} action={action}/>}</div>;
}
const isOverlay = new URLSearchParams(location.search).has('overlay');
if (isOverlay) { document.body.classList.add('overlay-body'); document.documentElement.classList.add('overlay-root'); }
createRoot(document.getElementById('root')!).render(isOverlay ? <Overlay/> : <App/>);
