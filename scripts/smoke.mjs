import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
fs.mkdirSync('.test-artifacts',{recursive:true});
import os from 'node:os';
import path from 'node:path';
import { waitState } from './wait-state.mjs';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'vool-smoke-'));
const screenshots=path.resolve('.test-artifacts');
let application;
async function mainWindow(app) {
  const deadline=Date.now()+120000;
  while(Date.now()<deadline) {
    const page=app.windows().find(p=>p.url().includes('/index.html')&&!p.url().includes('overlay=1'));
    if(page) return page;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Main VOOL window did not load.');
}
try {
  application=await electron.launch({ args:['.'], env:{...process.env,VOOL_TEST_DATA:data}, timeout:120000 });
  const page=await mainWindow(application);
  await page.waitForSelector('nav', {timeout:120000});
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  assert.equal(await page.evaluate(()=>window.vool.snapshot().then(s=>s.hasKey)), false);
  await page.screenshot({path:path.join(screenshots,'vool-overview.png')});
  for(const label of ['History','Insights','Dictionary','Settings','Dictation']) {
    await page.getByRole('button',{name:label,exact:true}).first().click();
    await page.waitForTimeout(120);
    assert.ok(await page.locator('h1').textContent(), `heading missing: ${label}`);
  }
  await page.getByRole('button',{name:'Settings',exact:true}).first().click();
  await page.screenshot({path:path.join(screenshots,'vool-settings.png')});
  await page.getByRole('button',{name:'Dictionary',exact:true}).click();
  await page.getByLabel('When Whisper writes').fill('acme labs');
  await page.getByLabel('Write this instead').fill('Acme Labs');
  await page.getByRole('button',{name:'Add replacement',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.vool.tools())).dictionary[0].written,'Acme Labs');
  assert.equal(await page.getByRole('button',{name:'Scratchpad',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Snippets',exact:true}).count(),0);
  await page.evaluate(()=>window.vool.toggle());
  await waitState(page, s=>s.capture==='recording');
  await page.waitForTimeout(3200);
  await page.evaluate(()=>window.vool.toggle());
  await waitState(page, s=>s.capture==='idle',15000);
  const snapshot=await page.evaluate(()=>window.vool.snapshot());
  console.log(JSON.stringify({capture:snapshot.capture,records:snapshot.recordings,notice:snapshot.notice})); assert.equal(snapshot.recordings.length,1);
  assert.ok(snapshot.recordings[0].duration>1, 'Worklet audio did not reach durable storage');
  assert.equal(snapshot.recordings[0].status,'queued'); assert.equal(snapshot.hasKey,false);
  const id=snapshot.recordings[0].id;
  const audio=fs.readFileSync(path.join(data,'VOOL','recordings',`${id}.wav`));
  assert.equal(audio.readUInt32LE(40),audio.length-44);
  await page.getByRole('button',{name:'History',exact:true}).click();
  await page.locator('.record-body').first().click();
  await page.getByRole('dialog').waitFor();
  await page.screenshot({path:path.join(screenshots,'vool-recovery.png')});
  await page.getByRole('button',{name:'Close details',exact:true}).click();
  assert.deepEqual(errors,[]);
  await application.close(); application=null;
  application=await electron.launch({args:['.'],env:{...process.env,VOOL_TEST_DATA:data},timeout:120000});
  const again=await mainWindow(application); await again.waitForSelector('nav',{timeout:120000});
  const after=await again.evaluate(()=>window.vool.snapshot());
  assert.equal(after.recordings[0].id,id); assert.ok(after.recordings[0].duration>1);
  const savedTools=await again.evaluate(()=>window.vool.tools());
  assert.equal(savedTools.dictionary[0].written,'Acme Labs');
  console.log('PASS: desktop navigation, dictionary entry, synthetic microphone -> durable WAV, queued-without-key recovery, audio playback dialog, dictionary survives restart; no renderer errors.');
} finally {
  if(application) await application.close();
  fs.rmSync(data,{recursive:true,force:true});
}
