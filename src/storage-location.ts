import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './store';

// AppData can be virtualized by a packaged launcher. User-home storage is stable.
export function prepareStorage(appData: string, home: string): string {
  const root = path.join(home, '.sayo');
  fs.mkdirSync(root, { recursive: true });
  const marker = path.join(root, 'migration-complete.json');
  if (!fs.existsSync(marker)) {
    const candidates = [path.join(appData, 'VOOL')];
    const packages = path.join(home, 'AppData', 'Local', 'Packages');
    if (fs.existsSync(packages)) for (const name of fs.readdirSync(packages)) {
      if (name.startsWith('OpenAI.Codex_')) candidates.push(path.join(packages, name, 'LocalCache', 'Roaming', 'VOOL'));
    }
    const legacy = candidates.filter(folder => fs.existsSync(folder)).sort((a, b) => score(b) - score(a))[0];
    if (legacy) {
      for (const name of ['Local State', 'groq-key.enc', 'settings.json', 'writing-tools.json']) {
        for (const suffix of ['', '.bak', '.tmp']) copyPrivate(path.join(legacy, name + suffix), path.join(root, name + suffix));
      }
      const recordings = path.join(legacy, 'recordings');
      fs.mkdirSync(path.join(root, 'recordings'), { recursive: true });
      if (fs.existsSync(recordings)) for (const name of fs.readdirSync(recordings)) {
        if (/^[a-f0-9-]{36}\.(?:json|wav)(?:\.(?:bak|tmp))?$/.test(name)) copyPrivate(path.join(recordings, name), path.join(root, 'recordings', name));
      }
    }
    // An interrupted copy resumes before startup. Keep the old recovery copy.
    atomicWrite(marker, JSON.stringify({ version: 1 }));
  }
  return fs.realpathSync.native(root);
}
function score(folder: string): number {
  const recordings = path.join(folder, 'recordings');
  return (fs.existsSync(path.join(folder, 'groq-key.enc')) ? 1000000 : 0) +
    (fs.existsSync(recordings) ? fs.readdirSync(recordings).filter(name => name.endsWith('.json')).length : 0);
}
function copyPrivate(source: string, destination: string) {
  if (!fs.existsSync(source) || fs.existsSync(destination)) return;
  if (!fs.lstatSync(source).isFile()) throw new Error('Unexpected legacy storage entry.');
  atomicWrite(destination, fs.readFileSync(source));
}
