import React, { useEffect, useRef, useState } from 'react';
import type { Snapshot, ToolData } from './types';

export type ToolPage = 'insights' | 'dictionary';
type Props = { page: ToolPage; state: Snapshot; action: (task: Promise<unknown>) => void };
const headings: Record<ToolPage, [string, string, string]> = {
  insights: ['A LITTLE PERSPECTIVE', 'Your voice, in numbers.', 'A quiet look at the dictations saved on this PC.'],
  dictionary: ['THE WORDS YOU USE', 'Make yourself understood.', 'Correct recurring misspellings in new Sayo dictations.'],
};
const countWords = (text: string) => text.trim().split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
function localDay(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

function Insights({ state }: { state: Snapshot }) {
  const records = state.recordings.filter(r => r.status === 'completed' && r.text.trim());
  const words = records.reduce((sum, r) => sum + countWords(r.text), 0);
  const seconds = records.reduce((sum, r) => sum + r.duration, 0);
  const days = new Set(records.map(r => localDay(new Date(r.createdAt))));
  const cursor = new Date(); cursor.setHours(12, 0, 0, 0);
  if (!days.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDay(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  const activity = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(); day.setHours(12, 0, 0, 0); day.setDate(day.getDate() - 13 + i);
    const total = records.filter(r => localDay(new Date(r.createdAt)) === localDay(day)).reduce((sum, r) => sum + countWords(r.text), 0);
    return { day, total };
  });
  const maximum = Math.max(1, ...activity.map(a => a.total));
  return <><div className="tool-stats">
    <section><span>Words transcribed</span><strong>{words.toLocaleString()}</strong><small>{records.length} successful dictations</small></section>
    <section><span>Speaking pace</span><strong>{seconds > 0 ? Math.round(words * 60 / seconds) : '—'}<em>WPM</em></strong><small>Transcript words / recorded minutes</small></section>
    <section><span>Current streak</span><strong>{streak}<em>{streak === 1 ? 'day' : 'days'}</em></strong><small>Days with a successful dictation</small></section>
  </div><section className="tool-card"><div className="section-heading"><div><h2>A little every day</h2><p>Words from the last 14 days</p></div><span className="tool-tag">LOCAL HISTORY</span></div>
    <div className="activity-chart" role="img" aria-label={activity.map(a => `${a.day.toLocaleDateString()}: ${a.total} words`).join('; ')}>
      {activity.map(({ day, total }) => <div className="activity-day" key={localDay(day)} title={`${day.toLocaleDateString()}: ${total.toLocaleString()} words`}><span className="activity-count">{total || ''}</span><div className="activity-track"><span style={{ height: `${total ? Math.max(3, total / maximum * 100) : 1}%` }} /></div><span className="activity-label">{day.getDate()}</span></div>)}
    </div><p className="tool-help">Activity follows your local calendar. Your streak includes yesterday if you have not dictated today yet. Pace includes pauses and is an estimate.</p>
  </section>{!records.length && <p className="tool-callout">Your first successful dictation will bring this page to life.</p>}</>;
}

function Dictionary({ data, update }: { data: ToolData; update: (next: ToolData) => void }) {
  const [heard, setHeard] = useState(''), [written, setWritten] = useState(''), [editing, setEditing] = useState<number | null>(null), [error, setError] = useState('');
  function reset() { setHeard(''); setWritten(''); setEditing(null); setError(''); }
  function submit(event: React.FormEvent) {
    event.preventDefault(); const from = heard.trim(), to = written.trim();
    if (!from || !to) { setError('Add both the heard phrase and its replacement.'); return; }
    if (data.dictionary.some((entry, index) => index !== editing && entry.heard.toLocaleLowerCase() === from.toLocaleLowerCase())) { setError('This heard phrase already has a replacement. Edit that entry instead.'); return; }
    const entries = [...data.dictionary];
    if (editing === null) entries.push({ heard: from, written: to }); else entries[editing] = { heard: from, written: to };
    update({ ...data, dictionary: entries }); reset();
  }
  return <><section className="tool-card"><h2>{editing === null ? 'Add a word or phrase' : 'Edit a replacement'}</h2><form onSubmit={submit}>
    <div className="tool-form-grid"><label>When Whisper writes<input required maxLength={120} value={heard} onChange={e => setHeard(e.target.value)} placeholder="acme labs" /></label><label>Write this instead<input required maxLength={200} value={written} onChange={e => setWritten(e.target.value)} placeholder="Acme Labs" /></label></div>
    <p className="tool-help">Example: if Whisper writes “acme labs”, Sayo can change it to “Acme Labs” before saving and pasting. Matches ignore letter case and replace whole words or phrases. Smart writing also learns variants automatically when a known spelling in your vocabulary or dictionary supports the correction. Unknown names are not guessed. Existing history keeps its original text.</p>
    {error && <p className="tool-error" role="alert">{error}</p>}<div className="tool-actions"><button className="primary" type="submit">{editing === null ? 'Add replacement' : 'Save replacement'}</button>{editing !== null && <button type="button" className="text-button" onClick={reset}>Cancel</button>}</div>
  </form></section><section className="tool-card"><div className="section-heading"><h2>Your dictionary</h2><span className="tool-tag">{data.dictionary.length} {data.dictionary.length === 1 ? 'ENTRY' : 'ENTRIES'}</span></div>
    {data.dictionary.length ? <div className="tool-list">{data.dictionary.map((entry, index) => <div className="dictionary-row" key={`${index}-${entry.heard}`}><div><span>{entry.heard}</span><span className="replacement-arrow" aria-hidden="true">→</span><strong>{entry.written}</strong></div><div className="tool-row-actions"><button className="text-button" onClick={() => { setEditing(index); setHeard(entry.heard); setWritten(entry.written); setError(''); }} aria-label={`Edit ${entry.heard}`}>Edit</button><button className="tool-delete" onClick={() => { update({ ...data, dictionary: data.dictionary.filter((_, i) => i !== index) }); reset(); }} aria-label={`Remove ${entry.heard}`}>Remove</button></div></div>)}</div> : <div className="tool-empty"><span aria-hidden="true">Aa</span><strong>Every name deserves the right spelling.</strong><p>Add your first replacement above.</p></div>}
  </section></>;
}

export function ToolsView({ page, state, action }: Props) {
  const [data, setData] = useState<ToolData | null>(null), [status, setStatus] = useState(''), [loadError, setLoadError] = useState(false);
  const current = useRef<ToolData | null>(null), dirty = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saves = useRef<Promise<void>>(Promise.resolve()), mounted = useRef(true), actionRef = useRef(action); actionRef.current = action;
  function persist() {
    clearTimeout(timer.current); if (!current.current || !dirty.current) return Promise.resolve();
    const snapshot = current.current; dirty.current = false;
    const task = saves.current.catch(() => {}).then(() => window.vool.saveTools(snapshot));
    saves.current = task;
    void task.then(() => { if (mounted.current && current.current === snapshot) setStatus('Saved on this PC'); }, () => { if (current.current === snapshot) dirty.current = true; if (mounted.current) setStatus('Could not save. Try Save now.'); });
    actionRef.current(task); return task;
  }
  function update(next: ToolData, debounce = false) {
    current.current = next; dirty.current = true; setData(next); setStatus('Saving…'); clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(() => { void persist(); }, 500); else void persist();
  }
  useEffect(() => {
    mounted.current = true;
    const load = window.vool.tools().then(value => { if (mounted.current) { current.current = value; setData(value); } }, error => { if (mounted.current) setLoadError(true); throw error; });
    actionRef.current(load);
    return () => { mounted.current = false; void persist(); };
  }, []);
  useEffect(() => { void persist(); }, [page]);
  const completedCount = state.recordings.filter(record => record.status === 'completed').length;
  useEffect(() => { if (!dirty.current) void window.vool.tools().then(value => { if (mounted.current && !dirty.current) { current.current = value; setData(value); } }).catch(() => {}); }, [completedCount]);
  const [eyebrow, title, subtitle] = headings[page];
  return <div className="tools-view"><div className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>
    {page === 'insights' ? <Insights state={state} /> : !data ? <p className="tool-callout" role="status">{loadError ? 'Your local tools could not be opened. Reopen this page to try again.' : 'Opening your local tools…'}</p> : <>
      {page === 'dictionary' && <Dictionary data={data} update={update} />}
      <div className="tools-save-status" role="status"><span className="dot" />{status || 'Saved locally. No account needed.'}{status.startsWith('Could not') && <button className="text-button" onClick={() => { void persist(); }}>Save now</button>}</div>
    </>}
  </div>;
}
