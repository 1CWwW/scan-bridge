const { chromium } = require('playwright');
const { appUrl, launchOptions, results } = require('./helpers.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const MiB=1024*1024;

(async()=>{
  const root=path.join(results,'large-files');fs.mkdirSync(root,{recursive:true});
  const fixture=path.join(root,'source.bin'),big=path.join(root,'over-2gib.bin');
  const block=crypto.randomBytes(MiB),tail=Buffer.from('TAIL: verify the final partial block.');
  const fd=fs.openSync(fixture,'w'),hash=crypto.createHash('sha256');
  for(let i=0;i<35;i++){fs.writeSync(fd,block);hash.update(block);}fs.writeSync(fd,tail);hash.update(tail);fs.closeSync(fd);
  const expected=hash.digest('hex');
  const browser=await chromium.launch(launchOptions);
  try{
    const page=await browser.newPage();page.setDefaultTimeout(240000);
    const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
    await page.addInitScript(()=>{const original=Blob.prototype.arrayBuffer;window.maxBlobRead=0;Blob.prototype.arrayBuffer=function(){window.maxBlobRead=Math.max(window.maxBlobRead,this.size);return original.call(this);};});
    await page.goto(appUrl);await page.locator('#mode').selectOption('files');await page.waitForFunction(()=>engineReady);
    await page.locator('#filepicker').setInputFiles(fixture);await page.locator('#prepare').click();
    await page.waitForFunction(()=>ScanBridge.getActivePayload()!==null,{timeout:240000});
    assert.equal(await page.evaluate(()=>ScanBridge.getPackage().sha256),expected);
    assert.equal(await page.evaluate(()=>ScanBridge.getPackage().bytes),null);
    const count=await page.evaluate(()=>ScanBridge.getPackage().plan.count);assert.equal(count,5);
    const parts=[];
    for(let i=0;i<count;i++){
      await page.evaluate(i=>ScanBridge.selectVolume(i),i);
      const pending=page.waitForEvent('download');await page.locator('#save-volume').click();const download=await pending;
      const target=path.join(root,download.suggestedFilename());await download.saveAs(target);parts.push(target);
      assert(fs.statSync(target).size<8*MiB+16384);
    }
    assert((await page.evaluate(()=>maxBlobRead))<=8*MiB);
    // Missing, duplicate, mixed and corrupted volumes must never produce output.
    const merge=await browser.newPage();await merge.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined}));
    await merge.goto(pathToFileURL(path.resolve(__dirname,'../dist/merge-parts.html')).href);
    await merge.locator('#parts').setInputFiles(parts.slice().reverse());await merge.locator('#merge').waitFor({state:'visible'});
    await merge.waitForFunction(()=>!document.getElementById('merge').disabled);
    const rejected=await merge.evaluate(async()=>{
      const files=Array.from(document.getElementById('parts').files),answers=[];
      for(const list of [files.slice(1),files.concat(files[0])]){try{await ScanLarge.inspectParts(list);answers.push(false);}catch{answers.push(true);}}
      const first=files[0],last=new Uint8Array(await first.slice(-1).arrayBuffer());last[0]^=1;
      const corrupt=new File([first.slice(0,-1),last],first.name);
      try{const p=await ScanLarge.inspectParts([corrupt,...files.slice(1)]);await ScanLarge.mergeParts(p,{write:async()=>{}});answers.push(false);}catch{answers.push(true);}
      const header=await ScanLarge.readHeader(first);header.header.name='other.bin';const json=new TextEncoder().encode(JSON.stringify(header.header)),size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,json.length,true);
      const other=new File([ScanLarge.magic,size,json,first.slice(header.dataOffset)],'other.sbpart');
      try{await ScanLarge.inspectParts([other,...files.slice(1)]);answers.push(false);}catch{answers.push(true);}
      return answers;
    });assert(rejected.every(Boolean));
    const received=merge.waitForEvent('download');await merge.locator('#merge').click();const download=await received;await download.saveAs(path.join(root,'browser-restored.bin'));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'browser-restored.bin'))).digest('hex'),expected);
    // Verify the streaming UI writer lifecycle without invoking a native dialog.
    const disk=await browser.newPage();
    await disk.addInitScript(()=>{window.diskWrites={bytes:0,closed:false,aborted:false};window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async data=>{window.diskWrites.bytes+=data.length;},close:async()=>{window.diskWrites.closed=true;},abort:async()=>{window.diskWrites.aborted=true;}})});});
    await disk.goto(pathToFileURL(path.resolve(__dirname,'../dist/merge-parts.html')).href);
    await disk.locator('#parts').setInputFiles(parts);
    await disk.waitForFunction(()=>!document.getElementById('merge').disabled);
    await disk.locator('#merge').click();await disk.waitForFunction(()=>diskWrites.closed);
    assert.deepEqual(await disk.evaluate(()=>diskWrites),{bytes:35*MiB+tail.length,closed:true,aborted:false});
    await disk.evaluate(()=>{window.diskWrites={closed:false,aborted:false};window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async()=>{throw new Error('Simulated disk full');},close:async()=>{diskWrites.closed=true;},abort:async()=>{diskWrites.aborted=true;}})});});
    await disk.locator('#merge').click();await disk.waitForFunction(()=>diskWrites.aborted);
    assert.equal(await disk.evaluate(()=>diskWrites.closed),false);
    // Two large sources choose TAR automatically; original Unicode paths survive.
    await page.locator('#clear').click();
    await page.locator('#filepicker').setInputFiles(fixture);
    await page.evaluate(()=>{const file=Array.from(selected.values())[0];ScanBridge.addFiles([{path:'办公资料/build/备份.bin',file}]);});
    await page.locator('#prepare').click();await page.waitForFunction(()=>ScanBridge.getActivePayload()!==null,{timeout:240000});
    assert.equal(await page.evaluate(()=>ScanBridge.getPackage().fileName),'scan-package.tar');
    const tarSha256=await page.evaluate(()=>ScanBridge.getPackage().sha256);
    const tarReady=page.waitForEvent('download');await page.locator('#download').click();await (await tarReady).saveAs(path.join(root,'large-package.tar'));
    // A real file larger than 2 GiB: read/hash the complete file in bounded slices,
    // verify its independent Node digest, then prepare its first and final volumes.
    const bigSize=2*1024*MiB+129,bigFd=fs.openSync(big,'w');fs.ftruncateSync(bigFd,bigSize);fs.writeSync(bigFd,tail,0,tail.length,bigSize-tail.length);fs.closeSync(bigFd);
    const independent=crypto.createHash('sha256');for await(const data of fs.createReadStream(big,{highWaterMark:8*MiB}))independent.update(data);
    const bigExpected=independent.digest('hex');
    await page.locator('#clear').click();await page.locator('#filepicker').setInputFiles(big);await page.locator('#prepare').click();
    await page.waitForFunction(()=>busy&&document.getElementById('progress').value>0);
    await page.locator('#cancel-prepare').click();await page.waitForFunction(()=>!busy);
    assert.equal(await page.evaluate(()=>ScanBridge.getPackage()),null);
    await page.locator('#prepare').click();
    await page.waitForFunction(()=>ScanBridge.getActivePayload()!==null,{timeout:240000});
    const actual=await page.evaluate(()=>({hash:ScanBridge.getPackage().sha256,size:ScanBridge.getPackage().blob.size,count:ScanBridge.getPackage().plan.count,largestRead:maxBlobRead}));
    assert.equal(actual.size,bigSize);assert.equal(actual.hash,bigExpected);assert.equal(actual.count,257);assert(actual.largestRead<=8*MiB);
    await page.evaluate(()=>ScanBridge.selectVolume(256));
    const end=await page.evaluate(async()=>{const p=ScanBridge.getActivePayload(),h=await ScanLarge.readHeader(p);return {h:h.header,data:Array.from(new Uint8Array(await p.slice(h.dataOffset).arrayBuffer()))};});
    assert.equal(end.h.offset,2*1024*MiB);assert.equal(end.h.bytes,129);assert(Buffer.from(end.data).subarray(-tail.length).equals(tail));
    const over4g=await page.evaluate(async()=>{const size=5*1024*1024*1024+3,blob={size,slice:()=>new Blob([new Uint8Array([1,2,3])])};const file=await ScanLarge.makePart(blob,{name:'five.bin',mime:'application/octet-stream',sha256:'a'.repeat(64)},640);return (await ScanLarge.readHeader(file)).header;});
    assert.equal(over4g.offset,5*1024*MiB);
    fs.writeFileSync(path.join(root,'expected.json'),JSON.stringify({sha256:expected,tarSha256,parts:parts.map(p=>path.basename(p)),largeSize:bigSize,largeSha256:bigExpected}));
    await page.screenshot({path:path.join(root,'large-file.png'),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
    console.log('PASS: real >2 GiB file full streaming hash and final volume, 5 GiB offset arithmetic, 35 MiB complete browser restoration, TAR, corruption/missing/duplicate/mixed detection; all reads <=8 MiB.');
  }finally{await browser.close();if(fs.existsSync(big))fs.unlinkSync(big);}
})().catch(error=>{console.error(error);process.exit(1);});
