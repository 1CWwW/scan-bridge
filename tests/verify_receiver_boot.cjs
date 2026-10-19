const {chromium}=require('playwright');
const {launchOptions}=require('./helpers.cjs');
const {startServer}=require('./receiver-server.cjs');
const assert=require('node:assert/strict');
(async()=>{
  const server=await startServer(),browser=await chromium.launch(launchOptions);
  try{
    for(const mode of ['constructor','private-storage','timeout','progress']){
      const page=await browser.newPage({serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.clock.install();
      await page.addInitScript(mode=>{
        const NativeWorker=Worker;window.cameraRequests=0;window.storageStopped=false;
        navigator.mediaDevices.getUserMedia=()=>{cameraRequests++;throw new Error('Camera permission should not have been requested');};
        window.Worker=class{
          constructor(url,options){
            if(!String(url).endsWith('receiver-store.js'))return new NativeWorker(url,options);
            if(mode==='constructor')throw new DOMException('Worker is not available in this context','SecurityError');
          }
          postMessage({id}){
            if(mode==='private-storage')queueMicrotask(()=>this.onmessage({data:{id,error:{name:'SecurityError',message:'Storage is not allowed in this context'}}}));
            if(mode==='progress'){
              setInterval(()=>this.onmessage({data:{progress:{phase:'恢复接收进度',done:1,total:10}}}),5000);
              setTimeout(()=>this.onmessage({data:{id,result:{session:null,received:0,receivedBytes:0,missing:[],ready:false}}}),60000);
            }
          }
          terminate(){storageStopped=true;}
        };
      },mode);
      await page.goto(server.url+'/receiver/');
      if(mode==='timeout')await page.clock.fastForward(21000);
      if(mode==='progress'){
        // A large task may legitimately take more than 20 seconds to restore.
        for(let i=0;i<4;i++)await page.clock.fastForward(16000);
        await page.waitForFunction(()=>!document.getElementById('camera').disabled);
        assert(await page.locator('#retry-storage').isHidden());
      }else{
        await page.waitForFunction(()=>!document.getElementById('retry-storage').hidden);
        assert(await page.locator('#camera').isDisabled());
        assert((await page.locator('#storage-state').textContent()).includes('相机尚未启用'));
        assert((await page.locator('#scan-hint').textContent()).includes(mode==='timeout'?'20 秒':'SecurityError'));
      }
      assert.equal(await page.evaluate(()=>cameraRequests),0);assert.deepEqual(errors,[]);await page.close();
    }
    console.log('PASS: blocked Worker / private storage and stalled init explain disabled camera without requesting permission; active long restoration is not timed out.');
  }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
