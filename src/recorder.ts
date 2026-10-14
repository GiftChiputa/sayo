import type { Command } from './types';
interface Capture {
  id: string; audio: AudioContext | null; stream: MediaStream | null;
  worklet: AudioWorkletNode | null; stopping: boolean; writes: Promise<void>;
  flushed: (() => void) | null;
}
export function installRecorder(updateMeter: (level: number) => void) {
  let current: Capture | null = null;
  function cleanup(c: Capture) {
    c.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    c.stream = null; if (c.audio && c.audio.state !== 'closed') void c.audio.close().catch(() => {});
    c.audio = null; c.worklet = null;
    if (current === c) { current = null; updateMeter(0); }
  }
  async function start(id: string) {
    if (current) return;
    const c: Capture = { id, audio: null, stream: null, worklet: null, stopping: false, writes: Promise.resolve(), flushed: null };
    current = c;
    try {
      const state = await window.vool.snapshot();
      if (current !== c || c.stopping) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: state.settings.microphone ? { exact: state.settings.microphone } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (current !== c || c.stopping) { stream.getTracks().forEach(t => t.stop()); return; }
      c.stream = stream; const audio = new AudioContext(); c.audio = audio;
      await audio.audioWorklet.addModule('pcm-worklet.js');
      if (current !== c || c.stopping) { cleanup(c); return; }
      const worklet = new AudioWorkletNode(audio, 'pcm-writer'); c.worklet = worklet;
      worklet.port.onmessage = event => {
        const message = event.data as { pcm?: ArrayBuffer; done?: boolean; level?: number };
        if (typeof message.level === 'number' && current === c && !c.stopping) updateMeter(message.level);
        if (message.pcm) {
          const pcm = message.pcm;
          c.writes = c.writes.then(() => window.vool.append(id, pcm));
          void c.writes.catch(() => { if (!c.stopping) void stop(id); });
        }
        if (message.done) c.flushed?.();
      };
      audio.createMediaStreamSource(stream).connect(worklet); worklet.connect(audio.destination);
      for (const track of stream.getTracks()) track.onended = () => { void stop(id); };
      await audio.resume(); if (current === c && !c.stopping) await window.vool.captureReady(id);
    } catch {
      const active = current === c; cleanup(c);
      if (active) await window.vool.captureFailed(id, 'Microphone unavailable.').catch(() => {});
    }
  }
  async function stop(id: string) {
    const c = current; if (!c || c.id !== id || c.stopping) return;
    c.stopping = true;
    try {
      if (c.worklet) await new Promise<void>(resolve => {
        c.flushed = resolve; c.worklet!.port.postMessage('flush'); setTimeout(resolve, 1200);
      });
      await c.writes.catch(() => {}); cleanup(c); await window.vool.finish(id);
    } catch { cleanup(c); await window.vool.captureFailed(id, 'Recording interrupted.').catch(() => {}); }
  }
  const unsubscribe = window.vool.onCommand((command: Command, id: string) => { if (command === 'start') void start(id); else void stop(id); });
  // Tell main only after the listener exists; early hotkeys can be replayed safely.
  void window.vool.recorderReady();
  return () => { unsubscribe(); if (current) void stop(current.id); };
}
