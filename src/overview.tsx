import React, { useState } from 'react';
import type { Snapshot } from './types';
import { Icon, Shortcut, RecordRow } from './ui';
export function Overview({ state, action, select, history, settings }: {
  state: Snapshot; action: (task: Promise<unknown>) => void; select: (id: string) => void;
  history: () => void; settings: () => void;
}) {
  const [query, setQuery] = useState('');
  const complete = state.recordings.filter(r => r.status === 'completed');
  const words = complete.reduce((sum, r) => sum + r.text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length, 0);
  const seconds = complete.reduce((sum, r) => sum + r.duration, 0);
  const pending = state.recordings.filter(r => r.status !== 'completed');
  const records = state.recordings.filter(r => !query || r.text.toLowerCase().includes(query.toLowerCase())).slice(0, 20);
  const active = state.capture !== 'idle';
  return <>
    <header className="dictation-heading">
      <div><h1>Dictation</h1><p>Hold <kbd>Right Alt</kbd> to record. Double-tap for hands-free dictation.</p></div>
      <span className={`workspace-status ${active ? 'recording' : ''}`}><span/>{active ? state.capture === 'recording' ? 'Recording' : 'Preparing' : state.hasKey ? 'Ready to record' : 'Key needed'}</span>
    </header>
    <div className="dictation-grid"><div className="dictation-main">
      {!state.hasKey && <div className="compact-setup"><Icon name="settings" size={18}/><div><strong>Add your Groq API key</strong><p>Recordings are saved while you finish setting up.</p></div><button className="text-button" onClick={settings}>Open Settings</button></div>}
      <div className="dictation-list-heading"><h2>Recent dictations</h2><label className="workspace-search"><Icon name="search" size={16}/><input aria-label="Search recent transcripts" placeholder="Search dictations" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
      <section className="dictation-list">
        {records.length ? records.map((r, i) => {
          const date = new Date(r.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
          const previous = i ? new Date(records[i - 1].createdAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : '';
          return <React.Fragment key={r.id}>{date !== previous && <h3 className="day-heading">{new Date(r.createdAt).toDateString() === new Date().toDateString() ? 'Today' : date}</h3>}<RecordRow record={r} select={() => select(r.id)} action={action}/></React.Fragment>;
        }) : <div className="flow-empty"><span className="workspace-empty-mic"><Icon name="mic" size={26}/></span><h3>{query ? 'No matching dictations' : 'Your dictations appear here'}</h3><p>{query ? 'Try another word or clear the search.' : 'Hold Right Alt and speak. Your transcript is saved here.'}</p>{!query && <Shortcut/>}</div>}
      </section>
      {state.recordings.length > 0 && <button className="text-button all-history" onClick={history}>View all dictations <Icon name="arrow" size={15}/></button>}
    </div><aside className="flow-stats">
      <h2 className="summary-heading">Your activity</h2>
      <div className="flow-stat-numbers"><div><span>Words dictated</span><strong>{words.toLocaleString()}</strong></div><div><span>Speaking pace</span><strong>{seconds ? Math.round(words / seconds * 60) : '—'}<small>wpm</small></strong></div><div><span>Recordings saved</span><strong>{state.recordings.length}</strong></div></div>
      <div className="flow-safety"><span className="safety-icon"><Icon name="check" size={18}/></span><h3>Saved on this PC</h3><p>{pending.length ? `${pending.length} recording${pending.length === 1 ? '' : 's'} awaiting text.` : 'Transcripts stay saved. Successful audio is removed.'}</p><button className="text-button" onClick={history}>Open History</button></div>
    </aside></div>
    <div className="flow-footer"><span><span className="dot"/>Audio kept until transcription succeeds</span><span>Release to finish · Double-tap, then tap again to finish</span></div>
  </>;
}
