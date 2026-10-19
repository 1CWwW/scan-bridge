const {chromium}=require('playwright');
const {launchOptions,results}=require('./helpers.cjs');
const {startServer}=require('./receiver-server.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const MiB=1024*1024;
(async()=>{
  const bigTest=process.env.SCANBRIDGE_RECEIVE_GIB_TEST==='1';
  const root=path.join(results,bigTest?'receiver-gib':'receiver');fs.mkdirSync(root,{recursive:true});
  const profile=bigTest?fs.mkdtempSync(path.join(root,'profile-')):null;
  const server=await startServer(),browser=profile?null:await chromium.launch(launchOptions);
  const context=profile?await chromium.launchPersistentContext(profile,launchOptions):await browser.newContext();
  try{
    const page=await context.newPage(),errors=[],uploads=[];
    page.setDefaultTimeout(240000);
    page.on('pageerror',error=>errors.push(error.message));
    context.on('request',request=>{if(/^https?:/.test(request.url())&&(request.method()!=='GET'||!request.url().startsWith(server.url)))uploads.push(request.url());});
    await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined}));
    await page.goto(server.url+'/receiver/');await page.waitForFunction(()=>!document.getElementById('camera').disabled);
    await page.evaluate(async()=>{window.protocol=await fetch('protocol.js').then(r=>r.text());window.hashlib=await fetch('sha256.js').then(r=>r.text());});
    // Build real envelopes with 201 MiB + 123 bytes. All data is generated, hashed,
    // received and exported in bounded slices; no whole-file ArrayBuffer.
    const sourceMiB=bigTest?2048:201,tailSize=sourceMiB===2048?129:123,targetName=`办公资料-${sourceMiB}MiB.bin`;
    const lastIndex=Math.floor(sourceMiB/8),partCount=lastIndex+1;
    const source=path.join(root,'source.bin'),fd=fs.openSync(source,'w'),block=crypto.randomBytes(MiB),hash=crypto.createHash('sha256');
    for(let i=0;i<sourceMiB;i++){fs.writeSync(fd,block);hash.update(block);}const tail=crypto.randomBytes(tailSize);fs.writeSync(fd,tail);hash.update(tail);fs.closeSync(fd);
    const expected=hash.digest('hex');
    await page.evaluate(()=>{(0,eval)(hashlib);(0,eval)(protocol);});
    const upload=await page.evaluateHandle(()=>{const input=document.createElement('input');input.type='file';input.id='test-source';document.body.appendChild(input);return input;});
    await page.locator('#test-source').setInputFiles(source);
    await page.evaluate(name=>{window.sourceFile=document.getElementById('test-source').files[0];window.info={name,mime:'application/octet-stream'};},targetName);
    await page.evaluate(expected=>{info.sha256=expected;},expected);
    const send=async index=>page.evaluate(async i=>{const part=await ScanLarge.makePart(sourceFile,info,i);return ScanReceiver.receive(part).then(()=>ScanReceiver.getState());},index);
    const first=await send(lastIndex);assert.equal(first.received,1);assert.equal(first.session.partCount,partCount);
    assert.equal((await send(lastIndex)).received,1,'Duplicate block changed progress');
    const failures=await page.evaluate(async()=>{
      const p=await ScanLarge.makePart(sourceFile,info,0),h=await ScanLarge.readHeader(p),answers=[];
      const corrupt=new File([p.slice(0,-1),new Uint8Array([255^new Uint8Array(await p.slice(-1).arrayBuffer())[0]])],p.name);
      try{await ScanReceiver.receive(corrupt);answers.push(false);}catch{answers.push(true);}
      h.header.name='other.bin';const json=new TextEncoder().encode(JSON.stringify(h.header)),length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,json.length,true);
      try{await ScanReceiver.receive(new File([ScanLarge.magic,length,json,p.slice(h.dataOffset)],'other.sbpart'));answers.push(false);}catch{answers.push(true);}
      return answers;
    });assert(failures.every(Boolean));assert.equal((await page.evaluate(()=>ScanReceiver.getState())).received,1);
    // A second tab must not write into the first tab's active session.
    const second=await context.newPage();await second.goto(server.url+'/receiver/');
    await second.waitForFunction(()=>document.getElementById('status').textContent.includes('已有一个接收页'));
    assert(await second.locator('#camera').isDisabled());await second.close();
    for(const i of [0,2,1])await send(i);
    // Simulate a torn journal and post-write disk corruption in actual OPFS.
    await page.evaluate(async()=>{
      const worker=new Worker(URL.createObjectURL(new Blob([`onmessage=async()=>{try{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('scan-bridge-recv-v1');const journal=await(await dir.getFileHandle('block-1.json')).createSyncAccessHandle();journal.truncate(1);journal.flush();journal.close();const data=await(await dir.getFileHandle('payload.bin')).createSyncAccessHandle(),byte=new Uint8Array(1);data.read(byte,{at:8*1024**2});byte[0]^=255;data.write(byte,{at:8*1024**2});data.flush();data.close();postMessage('ok');}catch(e){postMessage(e.message);}}`],{type:'application/javascript'})));
      await new Promise((resolve,reject)=>{worker.onmessage=e=>e.data==='ok'?resolve():reject(new Error(e.data));worker.postMessage(0);});worker.terminate();
    });
    await page.reload();await page.waitForFunction(()=>!document.getElementById('camera').disabled);
    assert.equal((await page.evaluate(()=>ScanReceiver.getState())).received,2,'Reload trusted corrupt data or torn journal');
    // Recover browser-side source references after reload without reopening storage.
    await page.evaluate(async()=>{(0,eval)(await fetch('sha256.js').then(r=>r.text()));(0,eval)(await fetch('protocol.js').then(r=>r.text()));const input=document.createElement('input');input.type='file';input.id='test-source';document.body.appendChild(input);});
    await page.locator('#test-source').setInputFiles(source);
    await page.evaluate(({expected,name})=>{window.sourceFile=document.getElementById('test-source').files[0];window.info={name,mime:'application/octet-stream',sha256:expected};},{expected,name:targetName});
    for(const i of [0,1])await send(i);
    for(let i=lastIndex-1;i>=3;i--)await send(i);
    const state=await page.evaluate(()=>ScanReceiver.getState());assert.equal(state.ready,true);assert.equal(state.received,partCount);
    const pending=page.waitForEvent('download');await page.locator('#save').click();const download=await pending;
    assert.equal(download.suggestedFilename(),targetName);const restored=path.join(root,'restored.bin');await download.saveAs(restored);
    const actual=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(restored))actual.update(bytes);
    assert.equal(actual.digest('hex'),expected,'Disk-backed export changed bytes');
    // Cached shell and OPFS session continue to work with the network disabled.
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
    await context.setOffline(true);await page.reload();await page.waitForFunction(()=>ScanReceiver.getState()?.ready);
    await page.screenshot({path:path.join(root,'receiver-complete.png'),fullPage:true});
    await page.locator('#clear').click();await page.waitForFunction(()=>ScanReceiver.getState()?.session===null);
    assert.equal(await page.locator('#save').isDisabled(),true);
    assert.deepEqual(errors,[]);assert.deepEqual(uploads,[]);
    console.log(`PASS: real ${sourceMiB} MiB +${tailSize}-byte OPFS receive/export, out-of-order blocks, duplicate/corrupt/mixed rejection, torn-journal and corrupt-data recovery, single-writer lock, offline cache; no uploads.`);
    fs.unlinkSync(source);fs.unlinkSync(restored);
  }finally{
    await context.close();if(browser)await browser.close();await server.close();
    if(profile&&path.dirname(path.resolve(profile))===path.resolve(root))fs.rmSync(profile,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exit(1);});
