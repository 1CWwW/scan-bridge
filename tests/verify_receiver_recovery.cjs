const {chromium}=require('playwright');
const {launchOptions,results}=require('./helpers.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  let phase='old';
  const root=path.resolve(__dirname,'../dist'),version=require('../package.json').version;
  const oldSW=fs.readFileSync(path.join(__dirname,'fixtures/receiver-sw-1.5.1.js'),'utf8');
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost'),name=url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname;
    const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
    res.setHeader('Cache-Control',name.endsWith('sw.js')||name.includes('version.json')?'no-cache':'public, max-age=31536000');
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.wasm')?'application/wasm':name.endsWith('.json')?'application/json':'text/html; charset=utf-8');
    if(name==='/receiver/sw.js'&&!url.searchParams.has('build')){res.end(oldSW);return;}
    if(phase==='broken'&&name==='/receiver/receiver.js'){res.writeHead(503).end();return;}
    try{
      let data=fs.readFileSync(file);
      if(phase==='old'&&name==='/receiver/index.html')data=Buffer.from(data.toString('utf8').replaceAll(version,'1.5.1'));
      res.end(data);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch(launchOptions),base=`http://127.0.0.1:${server.address().port}`;
  try{
    const context=await browser.newContext(),old=await context.newPage(),errors=[];
    old.on('pageerror',e=>errors.push(e.message));
    await old.goto(base+'/receiver/');await old.waitForFunction(()=>!document.getElementById('camera').disabled);
    await old.waitForFunction(()=>navigator.serviceWorker.controller);
    const before=await old.evaluate(async()=>{
      (0,eval)(await fetch('sha256.js').then(r=>r.text()));(0,eval)(await fetch('protocol.js').then(r=>r.text()));
      const bytes=new Uint8Array(9*1024**2);bytes.fill(73);const file=new File([bytes],'preserved.bin');
      const part=await ScanLarge.makePart(file,{name:file.name,mime:'application/octet-stream',sha256:sha256(bytes)},0);
      await ScanReceiver.receive(part);
      localStorage.setItem('unrelated-state','keep');const cache=await caches.open('unrelated-app');await cache.put('/canary',new Response('keep'));
      const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('scan-bridge-recv-v1');
      return {sha256:(await ScanLarge.readHeader(part)).header.sha256,journal:await(await(await dir.getFileHandle('block-1.json')).getFile()).text()};
    });
    phase='new';await old.goto(base+'/receiver/?refresh=force');await old.waitForFunction(()=>!document.getElementById('camera').disabled);
    assert((await old.locator('main').textContent()).includes('SCAN BRIDGE · 1.5.1'),'Old cache did not reproduce stale navigation');
    const update=await context.newPage();update.on('pageerror',e=>errors.push(e.message));
    await update.goto(base+'/update-receiver.html');
    assert.equal(await update.evaluate(()=>navigator.serviceWorker.controller),null,'Recovery entry was controlled by old receiver worker');
    // A failed download must leave the previous usable shell and real OPFS
    // bytes intact. Retrying the same build must succeed once online.
    phase='broken';await update.locator('#update').click();
    await update.waitForFunction(()=>document.getElementById('status').classList.contains('error'));
    assert(await update.locator('#open').isDisabled());
    assert(await update.evaluate(()=>caches.has('scan-bridge-receiver-1.5.1')));
    phase='new';await update.locator('#update').click();await update.waitForFunction(()=>!document.getElementById('open').disabled);
    await update.locator('#open').click();
    await update.waitForFunction(()=>document.getElementById('status').textContent.includes('另一个接收标签页'));
    assert(update.url().includes('update-receiver.html'));
    await old.close();await update.locator('#open').click();await update.waitForURL(base+'/receiver/');
    await update.waitForFunction(()=>!document.getElementById('camera').disabled);
    assert((await update.locator('main').textContent()).includes('SCAN BRIDGE · '+version));
    assert.equal(await update.evaluate(()=>ScanReceiver.getState().received),1);
    const after=await update.evaluate(async()=>{
      const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('scan-bridge-recv-v1');
      const bytes=await(await(await dir.getFileHandle('payload.bin')).getFile()).arrayBuffer();
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      return {sha256,journal:await(await(await dir.getFileHandle('block-1.json')).getFile()).text(),local:localStorage.getItem('unrelated-state'),cache:await(await(await caches.open('unrelated-app')).match('/canary')).text()};
    });
    assert.equal(after.sha256,before.sha256);assert.equal(after.journal,before.journal);assert.equal(after.local,'keep');assert.equal(after.cache,'keep');
    await context.setOffline(true);await update.reload();await update.waitForFunction(()=>ScanReceiver.getState()?.received===1);
    assert((await update.locator('main').textContent()).includes('SCAN BRIDGE · '+version));assert.deepEqual(errors,[]);
    fs.mkdirSync(results,{recursive:true});await update.screenshot({path:path.join(results,'receiver-recovered.png'),fullPage:true});
    console.log('PASS: exact v1.5.1 worker traps refresh; outside-scope updater survives failed install, retries, checks active build, prevents duplicate tab lock, preserves actual 8 MiB payload/journal and unrelated data; new page resumes offline.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1);});
