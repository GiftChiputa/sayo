import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
fs.mkdirSync('.test-artifacts',{recursive:true});
import os from 'node:os';
import { extractFile, listPackage } from '@electron/asar';
import { waitState } from './wait-state.mjs';
const archive=path.resolve('release/win-unpacked/resources/app.asar');
for(const file of ['main.cjs','preload.cjs','ui.js','ui.css','pcm-worklet.js','icon.png']) {
  assert.deepEqual(extractFile(archive,`dist/${file}`),fs.readFileSync(path.resolve('dist',file)),`Packaged ${file} differs from the validated build`);
}
assert.deepEqual(fs.readFileSync('release/win-unpacked/resources/VOOL.Input.exe'),fs.readFileSync('native/VOOL.Input.exe'));
assert.equal(listPackage(archive).some(file=>file.includes('.test.cjs')||file.includes('/research/')),false);
if(process.argv.includes('--bundle-only')) {
  console.log('PASS: packaged JavaScript, CSS, microphone worklet, icon, and native helper match the validated build; test and research files are excluded.');
  process.exit(0);
}
// Production checks use the established profile. Refuse to wake a paid retry job.
const stableProfile=path.join(os.homedir(),'.sayo');
const profile=fs.existsSync(path.join(stableProfile,'migration-complete.json'))?stableProfile:path.join(process.env.APPDATA,'VOOL');
if(fs.existsSync(path.join(profile,'groq-key.enc'))) {
  for(const file of fs.readdirSync(path.join(profile,'recordings')).filter(file=>file.endsWith('.json'))) {
    const record=JSON.parse(fs.readFileSync(path.join(profile,'recordings',file),'utf8'));
    assert.ok(['completed','blocked'].includes(record.status),'Finish or resolve pending jobs before the packaged startup check');
  }
}
const enableStartup=process.argv.includes('--enable-startup');
const version=JSON.parse(fs.readFileSync('package.json','utf8').replace(/^\uFEFF/, '')).version;
const installedFlag=process.argv.indexOf('--installed');
const executable=installedFlag>=0?path.resolve(process.argv[installedFlag+1]):path.resolve('release/win-unpacked/Sayo.exe');
if(installedFlag>=0){assert.deepEqual(fs.readFileSync(path.join(path.dirname(executable),'resources/app.asar')),fs.readFileSync(archive));}
const started=performance.now();
const app=await electron.launch({executablePath:executable,args:['--background'],env:{...process.env,PORTABLE_EXECUTABLE_FILE:''},timeout:120000});
try {
  const deadline=Date.now()+60000; let page;
  while(Date.now()<deadline) {
    page=app.windows().find(p=>p.url().includes('index.html')&&!p.url().includes('overlay=1'));
    if(page) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(page); await page.waitForSelector('nav');
  await waitState(page, s=>s.nativeReady);
  const readyMs=Math.round(performance.now()-started);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false,'Background launch should stay in the tray');
  console.log(`PASS: background app and shortcut ready in ${readyMs} ms; no extraction and no visible window.`);
  const environment=await app.evaluate(({app})=>({packaged:app.isPackaged,name:app.getName()}));
  assert.equal(environment.packaged,true); assert.equal(environment.name,'VOOL');
  assert.equal(await page.title(),'Sayo');
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),fs.realpathSync.native(stableProfile));
  const encryptedKeyFile=path.join(stableProfile,'groq-key.enc');
  const keyReadable=!fs.existsSync(encryptedKeyFile)||await app.evaluate(({safeStorage},cipher)=>{try{return safeStorage.decryptString(Buffer.from(cipher)).length>0;}catch{return false;}},[...fs.readFileSync(encryptedKeyFile)]);
  assert.equal(keyReadable,true,'Preserved encrypted credential is unreadable');
  assert.equal(await page.locator('.brand').textContent(),'Sayo');
  if(enableStartup) {
    await page.evaluate(async()=>{
      const state=await window.vool.snapshot();
      await window.vool.saveSettings({...state.settings,startAtLogin:true});
    });
    // Electron's Windows lookup parses path as a command line; spaces require quotes.
    const startup=await app.evaluate(({app},executable)=>app.getLoginItemSettings({path:`"${executable}"`,args:['--background']}),executable);
    assert.equal(startup.executableWillLaunchAtLogin,true,'Windows has not enabled Sayo at sign-in');
    console.log('PASS: Windows confirms the installed Sayo executable will launch at sign-in.');
  }
  await app.evaluate(({app})=>app.emit('second-instance',{},['Sayo.exe']));
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),true);
  await page.screenshot({path:path.resolve('.test-artifacts/vool-release.png')});
  console.log('PASS: packaged Sayo executable loads the UI and bundled native helper; package bytes match the validated source. No recording or API request triggered by this check.');
} finally { await app.close(); }
