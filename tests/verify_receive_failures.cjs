const {chromium}=require('playwright');
const {launchOptions}=require('./helpers.cjs');
const {startServer}=require('./receiver-server.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const server=await startServer(),browser=await chromium.launch(launchOptions);
  const context=await browser.newContext({serviceWorkers:'block'});
  try{
    const workerSource=fs.readFileSync(path.resolve(__dirname,'../dist/receiver/receiver-store.js'),'utf8');
    // Reproduce Chromium's out-of-range write return on quota failure, after the
    // payload has flushed but before its journal commits. Exercise the real OPFS.
    await context.route('**/receiver-store.js',route=>route.fulfill({contentType:'text/javascript',body:workerSource.replace('let directory,session=', 'let faultUsed=false;\nlet directory,session=').replace('const stream=await file.createSyncAccessHandle();',`const stream=await file.createSyncAccessHandle();
      const originalWrite=stream.write.bind(stream);stream.write=(...args)=>{if(name.startsWith('block-')&&!faultUsed){faultUsed=true;return 4294967288;}return originalWrite(...args);};`)}));
    const page=await context.newPage();await page.goto(server.url+'/receiver/');await page.waitForFunction(()=>!document.getElementById('camera').disabled);
    const fixture=async()=>page.evaluate(async()=>{
      (0,eval)(await fetch('sha256.js').then(r=>r.text()));(0,eval)(await fetch('protocol.js').then(r=>r.text()));
      window.file=new File([new Uint8Array(17*1024**2+1)],'fault.bin');window.info={name:file.name,mime:'application/octet-stream',sha256:await ScanLarge.hashBlob(file)};
    });await fixture();
    assert.equal(await page.evaluate(async()=>{try{await ScanReceiver.receive(await ScanLarge.makePart(file,info,0));return false;}catch(e){return e.name==='QuotaExceededError';}}),true);
    assert.equal((await page.evaluate(()=>ScanReceiver.getState())).received,0);
    await context.unroute('**/receiver-store.js');await page.reload();await page.waitForFunction(()=>!document.getElementById('camera').disabled);
    assert.equal((await page.evaluate(()=>ScanReceiver.getState())).received,0,'Uncommitted block survived as received');await fixture();
    await page.evaluate(async()=>{for(let i=0;i<3;i++)await ScanReceiver.receive(await ScanLarge.makePart(file,info,i));});
    assert.equal((await page.evaluate(()=>ScanReceiver.getState())).ready,true,'Retry failed after orphan data');
    await page.locator('#clear').click();await page.waitForFunction(()=>!ScanReceiver.getState()?.session);
    assert.equal(await page.evaluate(async()=>{
      const wrong={...info,sha256:'0'.repeat(64)};
      for(let i=0;i<2;i++)await ScanReceiver.receive(await ScanLarge.makePart(file,wrong,i));
      let rejected=false;try{await ScanReceiver.receive(await ScanLarge.makePart(file,wrong,2));}catch{rejected=true;}
      try{await ScanReceiver.call('export');return false;}catch{return rejected&&!ScanReceiver.getState().ready;}
    }),true,'Wrong whole-file hash was exported');
    assert(await page.locator('#save').isDisabled());
    console.log('PASS: quota anomaly during journal commit leaves no completed block; reload + retry recovers; wrong whole-file hash disables export.');
  }finally{await context.close();await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
