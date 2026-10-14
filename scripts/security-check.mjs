// Local, read-only publication check. Never prints matched credentials.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { extractFile, listPackage, statFile } from '@electron/asar';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = desktop;
const excluded = new Set(['node_modules', '.git', '.test-artifacts', 'research', 'build', 'release', 'dist']);
const secrets = [
  ['Groq API key', /\bgsk_[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ['GitHub token', /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Machine-specific user path', /\b[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\s"'<>\\/]+/i],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
];
const findings = [];
let checked = 0;
function privateFile(name) {
  return /^groq-key\.enc(?:\..*)?$/i.test(name) || ['local state', 'preferences'].includes(name.toLowerCase()) ||
    /^(?:settings|writing-tools)\.json(?:\..*)?$/i.test(name) ||
    /^\.env(?:\..*)?$/.test(name) && !/^\.env\.(?:example|sample|template)$/.test(name);
}
function privatePath(label) {
  return label.split(/[\\/]/).some(part => ['recordings', 'profile', 'VOOL', '.sayo', '.sayo-app', 'research', '.test-artifacts'].includes(part)) ||
    privateFile(path.basename(label)) || /\.(?:wav|mp3|mp4|log|pdb)$/i.test(label);
}
function inspect(label, data) {
  checked++;
  const text = data.toString('utf8');
  for (const [type, pattern] of secrets) if (pattern.test(text)) findings.push(`${label}: ${type} detected (value withheld)`);
}
function walk(directory, source) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const label = path.relative(workspace, file);
    if (entry.isSymbolicLink()) { findings.push(`${label}: symbolic link requires review`); continue; }
    if (entry.isDirectory()) {
      if (source && excluded.has(entry.name)) continue;
      if (['recordings', 'profile', 'VOOL', '.sayo', '.sayo-app'].includes(entry.name)) { findings.push(`${label}: private runtime folder`); continue; }
      walk(file, source);
    } else if (entry.isFile()) {
      if (privateFile(entry.name)) findings.push(`${label}: private credential/profile file`);
      // Media is not source. Text and executable build inputs are checked.
      if (/\.(?:png|ico|jpg|jpeg|webp|mp3|mp4|wav|pdf|woff2?|zip|jar)$/i.test(entry.name)) continue;
      inspect(label, fs.readFileSync(file));
    }
  }
}
const staged = process.argv.includes('--staged');
const tracked = process.argv.includes('--tracked');
if (staged || tracked) {
  const command = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '-z'];
  const files = execFileSync('git', command, { cwd: workspace }).toString('utf8').split('\0').filter(Boolean);
  for (const file of files) {
    if (privatePath(file) || file.split('/').some(part => ['node_modules', 'dist', 'release'].includes(part))) findings.push(`${file}: private or generated file in Git index`);
    const mode = execFileSync('git', ['ls-files', '--stage', '--', file], { cwd: workspace }).toString('utf8');
    if (mode.startsWith('120000 ')) findings.push(`${file}: symbolic link requires review`);
    inspect(`index/${file}`, execFileSync('git', ['show', `:${file}`], { cwd: workspace, maxBuffer: 32 * 1024 * 1024 }));
  }
} else walk(workspace, true);
if (!staged && !tracked && fs.existsSync(path.join(desktop, 'dist'))) walk(path.join(desktop, 'dist'), false);
const archive = path.join(desktop, 'release/win-unpacked/resources/app.asar');
if (!staged && !tracked && fs.existsSync(archive)) {
  for (const item of listPackage(archive)) {
    const file = item.replace(/^[\\/]+/, '').replaceAll('\\', '/');
    const archivePath = file.replaceAll('/', path.sep);
    const entry = statFile(archive, archivePath, false);
    if (entry.files) continue;
    if (entry.link) { findings.push(`app.asar/${file}: symbolic link requires review`); continue; }
    if (file.split('/').some(part => ['recordings', 'profile', 'VOOL', '.sayo'].includes(part)) || privateFile(path.basename(file))) findings.push(`app.asar/${file}: private runtime data`);
    inspect(`app.asar/${file}`, extractFile(archive, archivePath));
  }
}
if (findings.length) {
  console.error('Publication check failed. No secret values are displayed.\n' + findings.join('\n'));
  process.exitCode = 1;
} else console.log(`PASS: ${checked} source/build/package files checked; no recognized credential tokens or private profile files. No network requests made.`);
