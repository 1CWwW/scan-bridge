const {chromium}=require('playwright');
const {launchOptions}=require('./helpers.cjs');
const {startServer}=require('./receiver-server.cjs');
const assert=require('node:assert/strict');
(async()=>{
  const server=await startServer(),browser=await chromium.launch(launchOptions);
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(240000);
    await page.goto(server.url+'/receiver/');
    await page.evaluate(url=>{const f=document.createElement('iframe');f.id='sender-test';f.src=url+'/scan-bridge.html';f.width=1400;f.height=1000;document.body.appendChild(f);},server.url);
    const sender=page.frameLocator('#sender-test');await sender.locator('#mode').selectOption('files');
    await page.waitForFunction(()=>document.getElementById('sender-test').contentWindow.eval('engineReady'));
    await page.evaluate(()=>{
      const w=document.getElementById('sender-test').contentWindow,bytes=new Uint8Array(9*1024**2);
      for(let i=0;i<bytes.length;i+=65536)crypto.getRandomValues(bytes.subarray(i,i+65536));
      w.ScanBridge.addFiles([{file:new File([bytes],'dense.bin')}]);
      const e=w.document.getElementById('engine').contentWindow,encode=e.Module._cimbare_encode;
      window.encoded=false;e.Module._cimbare_encode=(...args)=>{const n=encode(...args);if(n===0)encoded=true;return n;};
    });
    await sender.locator('#prepare').click();await page.waitForFunction(()=>document.getElementById('sender-test').contentWindow.ScanBridge.getActivePayload());
    await sender.locator('#start').click();await page.waitForFunction(()=>encoded);
    await page.evaluate(async()=>{
      window.testWorker=new Worker('/receiver/decoder-worker.js');
      await new Promise((resolve,reject)=>{testWorker.onerror=reject;testWorker.onmessage=e=>e.data.ready?resolve():e.data.error?reject(new Error(e.data.error)):null;});
      const e=document.getElementById('sender-test').contentWindow.document.getElementById('engine').contentWindow,c=e.document.getElementById('canvas');
      window.frameCanvas=document.createElement('canvas');frameCanvas.width=1080;frameCanvas.height=1920;window.frameContext=frameCanvas.getContext('2d');
      window.opticalStart=performance.now();window.timings=[];window.lastProgress=null;
    });
    let result;
    for(let batch=0;batch<50;batch++){
      result=await page.evaluate(async()=>{
        const w=document.getElementById('sender-test').contentWindow,e=w.document.getElementById('engine').contentWindow,c=e.document.getElementById('canvas');
        for(let i=0;i<50;i++){
          e.Module._cimbare_next_frame(0);e.Module._cimbare_render();
          frameContext.fillStyle='white';frameContext.fillRect(0,0,frameCanvas.width,frameCanvas.height);frameContext.drawImage(c,Math.floor((frameCanvas.width-c.width)/2),Math.floor((frameCanvas.height-c.height)/2));
          const image=frameContext.getImageData(0,0,frameCanvas.width,frameCanvas.height);
          const data=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Optical frame decode exceeded 30 seconds')),30000);testWorker.onmessage=ev=>{clearTimeout(timeout);ev.data.error?reject(new Error(ev.data.error)):resolve(ev.data);};testWorker.postMessage({pixels:image.data,width:image.width,height:image.height},[image.data.buffer]);});
          timings.push(data.elapsedMs);if(data.progress)lastProgress=data.progress;
          if(data.file){const hash=async file=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');const actual=await hash(data.file),expected=await hash(w.ScanBridge.getActivePayload());return {done:true,actual,expected,frames:timings.length,ms:performance.now()-opticalStart,width:frameCanvas.width,height:frameCanvas.height};}
        }
        return {done:false,frames:timings.length,progress:lastProgress,ms:performance.now()-opticalStart,width:frameCanvas.width,height:frameCanvas.height,decodeMs:timings.reduce((a,b)=>a+b,0)/timings.length};
      });
      console.log(JSON.stringify(result));if(result.done)break;
    }
    assert(result.done,'Full incompressible optical block did not complete');assert.equal(result.actual,result.expected);
    console.log('PASS: full incompressible 8 MiB envelope recovered through actual CIMBAR frames and decoder, exact SHA-256. Synthetic frames do not measure a physical camera.');
  }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
