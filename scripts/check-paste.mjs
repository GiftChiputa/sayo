import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
fs.mkdirSync('.test-artifacts',{recursive:true});

import os from 'node:os';

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { waitState } from './wait-state.mjs';



const data=fs.mkdtempSync(path.join(os.tmpdir(),'sayo-paste-test-'));

let app;

try {

  app=await electron.launch({args:['.'],env:{...process.env,VOOL_TEST_DATA:data},timeout:120000});

  const deadline=Date.now()+60000;

  let main;

  while(Date.now()<deadline) {

    main=app.windows().find(page=>page.url().includes('index.html')&&!page.url().includes('overlay=1'));

    if(main) break;

    await new Promise(resolve=>setTimeout(resolve,100));

  }

  assert.ok(main); await main.waitForSelector('nav',{timeout:60000});

  await waitState(main,s=>s.nativeReady);

  // Stub the provider in the trusted process. No network request or real key is used.

  await app.evaluate(()=>{

    globalThis.fetch=async(url,options)=>{
      await new Promise(resolve=>setTimeout(resolve,1000));

      if (String(url).includes('/chat/completions')) {
        globalThis.lastDestinationHint=JSON.parse(JSON.parse(options.body).messages[1].content).destinationKind;
        return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:globalThis.testCleanedText,intent:globalThis.lastDestinationHint==='search'?'search':'prompt',corrections:[]})}}]}));
      }
      return new Response(JSON.stringify({text:'Acme labs. Next sentence.'}));

    };

  });

  const settings=await main.evaluate(()=>window.vool.snapshot().then(s=>s.settings));

  await main.evaluate(s=>window.vool.saveSettings(s,'synthetic-test-key'),settings);

  const ids=await app.evaluate(async({BrowserWindow})=>{

    const ids=[];

    for(const title of ['Sayo paste target A','Sayo paste target B']) {

      const win=new BrowserWindow({width:850,height:550,title});

      await win.loadURL('data:text/html,'+encodeURIComponent(`<title>${title}</title><body style="font:20px Segoe UI;padding:40px"><h1>${title}</h1><textarea autofocus style="width:90%;height:160px"></textarea></body>`));

      ids.push(win.id);

    }

    return ids;

  });

  const pages=await Promise.all(app.windows().filter(p=>p.url().startsWith('data:')).map(async page=>({page,title:await page.title()})));
  const targets=['Sayo paste target A','Sayo paste target B'].map(title=>pages.find(item=>item.title===title)?.page);
  assert.equal(targets.length,2);
  assert.ok(targets.every(Boolean));
  const initialHandle=await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getNativeWindowHandle().readBigUInt64LE(0).toString(),ids[0]);
  const foreground=()=>JSON.parse(execFileSync(path.resolve('native/VOOL.Input.exe'),['--inspect-overlay',initialHandle],{encoding:'utf8'})).foreground;
  if(foreground()!==initialHandle) {
    console.log('READY: activate the visible Sayo paste target A window to grant Windows foreground input.');
    const deadline=Date.now()+90000;
    while(foreground()!==initialHandle&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(foreground(),initialHandle,'The native Windows target needs activation');
  }
  async function focus(index) {

    await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).focus(),ids[index]);

    await targets[index].locator('textarea').focus();

    await main.waitForTimeout(180);

  }

  async function start(fromApp=false) {

    if(fromApp) await main.evaluate(()=>window.vool.toggle());

    else await app.evaluate(({app})=>app.emit('vool-test-start'));

    await waitState(main,s=>s.capture==='recording');

    await waitState(main,s=>s.recordings.some(r=>r.id===s.activeId&&r.duration>=0.6));
  }

  for(const [index,style] of ['natural','paragraphs','bullets'].entries()) {

    const expected=style==='natural'?'Acme Labs. Next sentence.':style==='paragraphs'?'Acme Labs.\n\nNext sentence.':'• Acme Labs.\n• Next sentence.';

    await app.evaluate((_,text)=>{globalThis.testCleanedText=text;},expected);

    await main.evaluate(async style=>{

      const tools=await window.vool.tools();

      await window.vool.saveTools({...tools,style,dictionary:[{heard:'acme labs',written:'Acme Labs'}]});

    },style);

    await focus(0); await start(index===2);
    if(index===2) await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setTitle('Google'),ids[1]);
    await focus(1);

    if(index===0) await focus(0); // Leave and return while recording.

    const destination=index===0?0:1;
    const overlay=app.windows().find(p=>p.url().includes('overlay=1'));
    const targetHandle=await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getNativeWindowHandle().readBigUInt64LE(0).toString(),ids[destination]);
    const probe=JSON.parse(execFileSync(path.resolve('native/VOOL.Input.exe'),['--inspect-overlay',targetHandle],{encoding:'utf8'}));
    assert.equal(probe.foreground,targetHandle,'The test destination is not the actual foreground window');
    assert.equal(await targets[destination].evaluate(()=>document.activeElement?.tagName),'TEXTAREA');
    await overlay.evaluate(()=>window.vool.stop());

    await waitState(main,s=>s.recordings.filter(r=>r.status==='completed'&&r.pasted).length===index+1,15000);

    await expect(targets[destination].locator('textarea')).toHaveValue(expected);
    if(index===2) {
      assert.equal(await app.evaluate(()=>globalThis.lastDestinationHint),'search');
      assert.equal(await main.evaluate(()=>window.vool.snapshot().then(s=>s.recordings[0].destinationKind)),'search');
    }
    for(const target of targets) await target.locator('textarea').fill('');

  }

  // A switch after Stop must not redirect a result into another app, even on return.

  await focus(0); await start();

  const overlay=app.windows().find(p=>p.url().includes('overlay=1'));

  await overlay.evaluate(()=>window.vool.stop());

  await waitState(main,s=>s.capture==='idle');

  await focus(1); await focus(0);

  await waitState(main,s=>s.recordings.length===4&&s.recordings.every(r=>r.status==='completed'));

  await main.waitForTimeout(300);

  const records=await main.evaluate(()=>window.vool.snapshot().then(s=>s.recordings));

  assert.equal(records.filter(r=>r.pasted).length,3);

  assert.ok(records.every(r=>r.hasAudio===false&&r.cleanupState==='cleaned'));

  assert.equal(fs.readdirSync(path.join(data,'VOOL','recordings')).filter(name=>name.endsWith('.wav')).length,0);

  assert.equal(await targets[0].locator('textarea').inputValue(),'');

  assert.equal(await targets[1].locator('textarea').inputValue(),'');

  console.log('PASS: leave/return while recording, different stop-time window, app-started capture, real native Ctrl+V, dictionary + all layouts; changing destination after Stop prevents late insertion. No paid API request.');

} finally {

  if(app) await app.close();

  fs.rmSync(data,{recursive:true,force:true});

}
