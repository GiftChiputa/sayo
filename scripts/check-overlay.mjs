import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
fs.mkdirSync('.test-artifacts',{recursive:true});
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { waitState } from './wait-state.mjs';

const data=fs.mkdtempSync(path.join(os.tmpdir(),'vool-overlay-test-'));
const nativeClick=process.argv.includes('--native-click');
const position=process.argv.find(value=>value.startsWith('--position='))?.split('=')[1]??'bottom';
let app;
try {
  app=await electron.launch({args:['.'],env:{...process.env,VOOL_TEST_DATA:data},timeout:120000});
  const deadline=Date.now()+60000;
  let main;
  while(Date.now()<deadline) {
    main=app.windows().find(p=>p.url().includes('index.html')&&!p.url().includes('overlay=1'));
    if(main) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(main); await main.waitForSelector('nav');
  await main.evaluate(async position=>{
    const state=await window.vool.snapshot();
    await window.vool.saveSettings({...state.settings,overlayPosition:position});
  },position);
  const targetId=await app.evaluate(async ({BrowserWindow})=>{
    const target=new BrowserWindow({width:1000,height:720,title:'VOOL overlay verification',backgroundColor:'#f7f4ee'});
    await target.loadURL('data:text/html,<title>VOOL overlay verification</title><body style="background:%23f7f4ee;font-family:Segoe UI;padding:50px"><h1>Recording bar verification</h1><p>The VOOL bar should float above this maximized application.</p><textarea autofocus style="width:80%;height:160px;font-size:20px;padding:20px">This text field keeps its focus when you stop recording.</textarea></body>');
    target.maximize(); target.focus(); return target.id;
  });
  await app.evaluate(({app})=>app.emit('vool-test-start'));
  await waitState(main, s=>s.capture==='recording');
  const overlay=app.windows().find(p=>p.url().includes('overlay=1')); assert.ok(overlay);
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).focus(),targetId);
  await overlay.waitForTimeout(650);
  const info=await app.evaluate(({BrowserWindow})=>{
    const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('overlay=1'));
    return {hwnd:win.getNativeWindowHandle().readBigUInt64LE(0).toString(),bounds:win.getBounds(),focusable:win.isFocusable(),visible:win.isVisible(),topmost:win.isAlwaysOnTop()};
  });
  const inspect=()=>JSON.parse(execFileSync(path.resolve('native/VOOL.Input.exe'),['--inspect-overlay',info.hwnd],{encoding:'utf8'}));
  const before=inspect();
  assert.equal(before.topmost,true); assert.equal(before.noActivate,true); assert.equal(before.clickThrough,false); assert.equal(before.aboveForeground,true);
  // Windows rounds transparent-window bounds at fractional display scales.
  const vertical=position==='left'||position==='right';
  assert.ok(info.bounds.width>=(vertical?88:300) && info.bounds.width<=(vertical?92:304)); assert.ok(info.bounds.height>=(vertical?242:68) && info.bounds.height<=(vertical?246:72)); assert.equal(info.focusable,false);
  const area=await app.evaluate(({screen})=>screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea);
  assert.ok(info.bounds.x>=area.x&&info.bounds.y>=area.y&&info.bounds.x+info.bounds.width<=area.x+area.width&&info.bounds.y+info.bounds.height<=area.y+area.height);
  if(position==='top') assert.ok(info.bounds.y<area.y+80);
  if(position==='left') assert.ok(info.bounds.x<area.x+80);
  if(position==='right') assert.ok(info.bounds.x>area.x+area.width-180);
  await overlay.screenshot({path:path.resolve(`.test-artifacts/sayo-recording-${position}.png`)});
  console.log(JSON.stringify({overlay:info,native:before}));
  if(nativeClick) {
    console.log('READY FOR NATIVE STOP CLICK: use the visible VOOL recording bar.');
    await waitState(main, s=>s.capture==='idle',120000);
  } else {
    await overlay.waitForTimeout(2200);
    await overlay.getByRole('button',{name:'Stop recording',exact:true}).click();
    await waitState(main, s=>s.capture==='idle',15000);
  }
  const snapshot=await main.evaluate(()=>window.vool.snapshot());
  assert.equal(snapshot.recordings.length,1); assert.ok(snapshot.recordings[0].duration>1); assert.equal(snapshot.recordings[0].status,'queued');
  assert.notEqual(inspect().foreground,info.hwnd, 'The recording bar took foreground focus');
  assert.ok((await overlay.getByRole('status').textContent()).startsWith('Audio saved'));
  await overlay.screenshot({path:path.resolve('.test-artifacts/vool-recording-saved.png')});
  await main.waitForTimeout(3300);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('overlay=1')).isVisible()),false);
  console.log('PASS: native topmost above maximized target, no click-through, preserved target focus, clickable Stop -> durable queued audio, saved feedback, automatic dismissal.');
} finally {
  if(app) await app.close(); fs.rmSync(data,{recursive:true,force:true});
}
