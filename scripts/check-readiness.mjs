import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { waitState } from './wait-state.mjs';

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sayo-ready-'));
let app;
try {
  const env = { ...process.env, VOOL_TEST_DATA: data };
  const started = performance.now();
  app = await electron.launch({ args: ['.', '--background'], env, timeout: 120000 });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isVisible())), false);
  await app.evaluate(({app})=>app.emit('vool-test-start'));
  let page;
  for (let i = 0; i < 600; i++) {
    page = app.windows().find(p => p.url().includes('index.html') && !p.url().includes('overlay=1'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page); await page.waitForSelector('nav');
  await waitState(page, s => s.nativeReady);
  const readyMs = Math.round(performance.now() - started);
  await waitState(page,s=>s.capture==='recording');
  await waitState(page,s=>s.recordings.some(r=>r.id===s.activeId&&r.duration>=0.4));
  await page.evaluate(()=>window.vool.toggle());
  await waitState(page,s=>s.capture==='idle');
  const secondStarted = performance.now();
  const second = spawn(electronPath, ['.'], { cwd: process.cwd(), env, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { second.once('error', reject); second.once('exit', code => code === 0 ? resolve() : reject(Error('Second launch failed'))); });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isVisible()&&!w.webContents.getURL().includes('overlay=1')).length), 1);
  const reopenMs = Math.round(performance.now() - secondStarted);
  const restarted = performance.now();
  assert.equal(await app.evaluate(({app})=>app.emit('vool-test-stop-helper')),true);
  await waitState(page, s => !s.nativeReady, 10000);
  await waitState(page, s => s.nativeReady, 15000);
  const recoveryMs = Math.round(performance.now() - restarted);
  await page.evaluate(() => window.vool.toggle());
  await waitState(page, s => s.capture === 'recording');
  await waitState(page, s => s.recordings.some(r => r.id === s.activeId && r.duration >= 0.4));
  await page.evaluate(() => window.vool.toggle());
  await waitState(page, s => s.capture === 'idle');
  assert.equal((await page.evaluate(() => window.vool.snapshot())).hasKey, false);
  console.log(JSON.stringify({ readyMs, reopenMs, recoveryMs }));
  console.log('PASS: quiet background startup and immediate cold capture, actual second launch opens the existing window, keyboard helper automatically restarts, synthetic recording still works; no key/API request.');
} finally {
  if (app) await app.close();
  const target = path.resolve(data);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith('sayo-ready-'));
  fs.rmSync(target, { recursive: true, force: true });
}
