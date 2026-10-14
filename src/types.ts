export type RecordingStatus = 'recording' | 'queued' | 'transcribing' | 'retrying' | 'blocked' | 'completed';
export interface Recording {
  id: string; createdAt: string; duration: number; status: RecordingStatus;
  text: string; attempts: number; nextRetryAt: number; error: string;
  language: string; model: string; prompt: string; pasted: boolean;
  hasAudio: boolean; rawText?: string;
  cleanupState?: 'off' | 'pending' | 'cleaned' | 'fallback';
  intent?: 'message' | 'prompt' | 'search' | 'general';
  destinationKind?: 'message' | 'prompt' | 'search' | 'general';
}
export interface Settings {
  model: 'whisper-large-v3-turbo' | 'whisper-large-v3'; language: string;
  prompt: string; autoPaste: boolean; startAtLogin: boolean; microphone: string;
  overlayPosition: 'bottom' | 'top' | 'left' | 'right';
  smartCleanup: boolean;
}
export interface Snapshot {
  recordings: Recording[]; settings: Settings; hasKey: boolean;
  capture: 'idle' | 'starting' | 'recording' | 'stopping'; activeId: string | null;
  notice: string; nativeReady: boolean; captureMode: 'hold' | 'latch';
  overlayRecordId: string | null;
}
export type Command = 'start' | 'stop';
export interface ToolData {
  dictionary: Array<{ heard: string; written: string }>;
  snippets: Array<{ id: string; title: string; text: string }>;
  scratchpad: string;
  style: 'natural' | 'paragraphs' | 'bullets';
}
export interface VoolAPI {
  recorderReady(): Promise<void>;
  tools(): Promise<ToolData>; saveTools(data: ToolData): Promise<void>; copyText(text: string): Promise<void>;
  snapshot(): Promise<Snapshot>; toggle(): Promise<void>; stop(): Promise<void>;
  append(id: string, pcm: ArrayBuffer): Promise<void>; finish(id: string): Promise<void>;
  captureReady(id: string): Promise<void>; captureFailed(id: string, reason: string): Promise<void>;
  saveSettings(settings: Settings, key?: string): Promise<void>;
  removeKey(): Promise<void>; retry(id: string): Promise<void>;
  copy(id: string): Promise<void>; audio(id: string): Promise<ArrayBuffer>;
  exportAudio(id: string): Promise<void>; openFolder(): Promise<void>;
  showMain(): Promise<void>; minimize(): Promise<void>; close(): Promise<void>;
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void;
  onCommand(callback: (command: Command, id: string) => void): () => void;
}
declare global { interface Window { vool: VoolAPI } }
