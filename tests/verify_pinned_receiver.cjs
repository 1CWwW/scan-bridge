const {chromium}=require('playwright');
const {launchOptions}=require('./helpers.cjs');
const {startServer}=require('./receiver-server.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
  const repo=path.resolve(__dirname,'..'),pinned=path.join(repo,'dist/receiver-v1.5.2');
  // These hashes identify the released v1.5.2 code, independent of the current
  // receiver sources. A banner or copied version label cannot satisfy this.
  for(const [name,sha] of Object.entries({
    'receiver.js':'a53e53c6020c97c1c3cc2a3c8009d8c28d2abfa2c089622b18a534133e1b9dce',
    'decoder-worker.js':'cea0f36167a6a96185a087621d957fa0d9cf9b96bb3dbd3bf2d059b82979cbce',
    'receiver-store.js':'c0da809de1450e2fd231a54380cca06e11e8cc8d53f6ff9b517cd5ab80db73f7'
  }))assert.equal(digest(fs.readFileSync(path.join(pinned,name))),sha,name+' is not the released v1.5.2 code');
  const server=await startServer(),browser=await chromium.launch(launchOptions);
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const ready=async()=>{await page.waitForFunction(()=>!document.getElementById('camera').disabled);await page.waitForFunction(()=>navigator.serviceWorker.controller);};
    await page.goto(server.url+'/receiver/');await ready();
    const expected=await page.evaluate(async()=>{
      (0,eval)(await fetch('sha256.js').then(r=>r.text()));(0,eval)(await fetch('protocol.js').then(r=>r.text()));
      const bytes=new Uint8Array(9*1024**2);bytes.fill(117);const file=new File([bytes],'shared-progress.bin'),hash=sha256(bytes);
      await ScanReceiver.receive(await ScanLarge.makePart(file,{name:file.name,mime:'application/octet-stream',sha256:hash},0));return hash;
    });
    await page.goto(server.url+'/receiver-v1.5.2/');await ready();
    assert((await page.locator('main').textContent()).includes('SCAN BRIDGE · 1.5.2'));
    assert.equal(await page.evaluate(()=>ScanReceiver.getState().received),1,'Pinned page lost the default page block');
    let keys=await page.evaluate(()=>caches.keys());assert(keys.some(k=>k.startsWith('scan-bridge-receiver-')));assert(keys.some(k=>k.startsWith('scan-bridge-pinned-1.5.2-')));
    const actual=await page.evaluate(async hash=>{
      (0,eval)(await fetch('sha256.js').then(r=>r.text()));(0,eval)(await fetch('protocol.js').then(r=>r.text()));
      const bytes=new Uint8Array(9*1024**2);bytes.fill(117);const file=new File([bytes],'shared-progress.bin');
      await ScanReceiver.receive(await ScanLarge.makePart(file,{name:file.name,mime:'application/octet-stream',sha256:hash},1));
      const {file:out}=await ScanReceiver.call('export');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await out.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
    },expected);assert.equal(actual,expected);
    await page.context().setOffline(true);await page.reload();await ready();assert.equal(await page.evaluate(()=>ScanReceiver.getState().ready),true);
    assert((await page.locator('main').textContent()).includes('SCAN BRIDGE · 1.5.2'));
    await page.context().setOffline(false);await page.goto(server.url+'/receiver/');await ready();
    // Reinstall the default worker so its cache cleanup actually runs again.
    await page.evaluate(async()=>{
      const previous=navigator.serviceWorker.controller;
      const changed=new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
      await navigator.serviceWorker.register('sw.js?cache-isolation='+Date.now(),{scope:'./',updateViaCache:'none'});
      if(navigator.serviceWorker.controller===previous)await changed;
    });
    keys=await page.evaluate(()=>caches.keys());assert(keys.some(k=>k.startsWith('scan-bridge-pinned-1.5.2-')),'Default receiver deleted the pinned cache');
    await page.goto(server.url+'/receiver-v1.5.2/');await ready();assert.equal(await page.evaluate(()=>ScanReceiver.getState().ready),true);
    assert.deepEqual(errors,[]);
    console.log('PASS: released v1.5.2 scanner/decoder/store hashes; shared real 9 MiB receive session and SHA-256 across versions; independent cache cleanup and pinned offline reload.');
  }finally{await browser.close();await server.close();}
  // The old receiver also traverses the real camera-button/video/WASM/OPFS
  // optical fixture, rather than only receiving envelopes through the API.
  execFileSync(process.execPath,[path.join(__dirname,'verify_optical_receiver.cjs')],{stdio:'inherit',env:{...process.env,SCANBRIDGE_RECEIVER_PATH:'/receiver-v1.5.2/'}});
})().catch(error=>{console.error(error);process.exit(1);});
