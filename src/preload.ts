import { contextBridge, ipcRenderer } from 'electron';
import type { VoolAPI, Snapshot, Command } from './types';
const api: VoolAPI = {
  tools: () => ipcRenderer.invoke('tools'), saveTools: data => ipcRenderer.invoke('save-tools', data), copyText: text => ipcRenderer.invoke('copy-text', text),
  snapshot: () => ipcRenderer.invoke('snapshot'), toggle: () => ipcRenderer.invoke('toggle'), stop: () => ipcRenderer.invoke('stop'),
  append: (id, data) => ipcRenderer.invoke('append', id, data), finish: id => ipcRenderer.invoke('finish', id),
  captureReady: id => ipcRenderer.invoke('capture-ready', id), captureFailed: (id, reason) => ipcRenderer.invoke('capture-failed', id, reason),
  recorderReady: () => ipcRenderer.invoke('recorder-ready'),
  saveSettings: (settings, key) => ipcRenderer.invoke('settings', settings, key), removeKey: () => ipcRenderer.invoke('remove-key'),
  retry: id => ipcRenderer.invoke('retry', id), copy: id => ipcRenderer.invoke('copy', id), audio: id => ipcRenderer.invoke('audio', id),
  exportAudio: id => ipcRenderer.invoke('export', id), openFolder: () => ipcRenderer.invoke('folder'),
  showMain: () => ipcRenderer.invoke('show-main'), minimize: () => ipcRenderer.invoke('minimize'), close: () => ipcRenderer.invoke('close'),
  onSnapshot: callback => { const listener = (_: Electron.IpcRendererEvent, snapshot: Snapshot) => callback(snapshot); ipcRenderer.on('snapshot-updated', listener); return () => { ipcRenderer.removeListener('snapshot-updated', listener); }; },
  onCommand: callback => { const listener = (_: Electron.IpcRendererEvent, command: Command, id: string) => callback(command, id); ipcRenderer.on('capture-command', listener); return () => { ipcRenderer.removeListener('capture-command', listener); }; }
};
contextBridge.exposeInMainWorld('vool', api);
