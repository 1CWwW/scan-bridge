const {chromium}=require('playwright');
const {launchOptions}=require('./helpers.cjs');
const {startServer}=require('./receiver-server.cjs');
const assert=require('node:assert/strict');
(async()=>{
  const server=await startServer(),browser=await chromium.launch(launchOptions);
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(90000);
    await page.goto(server.url+'/receiver/');await page.waitForFunction(()=>!document.getElementById('camera').disabled);
    await page.evaluate(url=>{const f=document.createElement('iframe');f.id='sender-test';f.src=url+'/scan-bridge.html';f.width=1400;f.height=1000;document.body.appendChild(f);},server.url);
    const sender=page.frameLocator('#sender-test');await sender.locator('#mode').selectOption('files');
    await page.waitForFunction(()=>document.getElementById('sender-test').contentWindow.eval('engineReady'));
    // Exercise the largest transport block with actual incompressible bytes.
    await page.evaluate(()=>{
      const w=document.getElementById('sender-test').contentWindow;
      const bytes=new Uint8Array(17*1024**2);for(let i=0;i<bytes.length;i+=65536)crypto.getRandomValues(bytes.subarray(i,i+65536));
      w.ScanBridge.addFiles([{file:new File([bytes],'random-17mib.bin')}]);
      const engine=w.document.getElementById('engine').contentWindow,encode=engine.Module._cimbare_encode;
      window.codes=[];engine.Module._cimbare_encode=(...args)=>{const code=encode(...args);codes.push(code);return code;};
    });
    await sender.locator('#prepare').click();await page.waitForFunction(()=>document.getElementById('sender-test').contentWindow.ScanBridge.getActivePayload());
    await sender.locator('#start').click();await page.waitForFunction(()=>codes.includes(0));assert.equal(await page.evaluate(()=>codes.includes(-3)),false);
    await sender.locator('#stop').click();await sender.locator('#clear').click();
    // A complete 17 MiB logical file traverses actual encoder frames, the actual
    // extractor/fountain/zstd decoder WASM, and the durable receiver. Repetitive
    // fixture bytes keep this optical integration test fast; they are not a speed benchmark.
    await page.evaluate(()=>{
      const w=document.getElementById('sender-test').contentWindow,bytes=new Uint8Array(17*1024**2+91);
      for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(i/1024**2)%251;
      window.expectedOptical=w.sha256(bytes);
      w.ScanBridge.addFiles([{file:new File([bytes],'光学测试.bin')}]);
      window.frameCanvas=document.createElement('canvas');window.frameContext=frameCanvas.getContext('2d');
    });
    await sender.locator('#prepare').click();await page.waitForFunction(()=>document.getElementById('sender-test').contentWindow.ScanBridge.getActivePayload());
    await page.evaluate(()=>{
      const e=document.getElementById('sender-test').contentWindow.document.getElementById('engine').contentWindow,c=e.document.getElementById('canvas');
      frameCanvas.width=c.width+96;frameCanvas.height=c.height+96;
      navigator.mediaDevices.getUserMedia=async()=>frameCanvas.captureStream(10);
      window.drawCameraFrame=()=>{
        e.Module._cimbare_next_frame(0);e.Module._cimbare_render();
        frameContext.fillStyle='white';frameContext.fillRect(0,0,frameCanvas.width,frameCanvas.height);frameContext.drawImage(c,48,48);
      };
      window.cameraFixture=setInterval(drawCameraFrame,100);
    });
    for(let index=0;index<3;index++){
      await page.evaluate(async index=>{
        const w=document.getElementById('sender-test').contentWindow;await w.ScanBridge.selectVolume(index);window.codes=[];
      },index);
      await sender.locator('#start').click();await page.waitForFunction(()=>codes.includes(0));
      if(index===0)await page.locator('#camera').click();
      try{await page.waitForFunction(count=>ScanReceiver.getState()?.received===count,index+1);}
      catch(error){console.log('Camera pipeline:',await page.locator('#status').textContent(),await page.locator('#optical').textContent());throw error;}
      await sender.locator('#stop').click();
    }
    await page.evaluate(()=>clearInterval(cameraFixture));
    const complete=await page.evaluate(async()=>{const state=ScanReceiver.getState(),exported=await ScanReceiver.call('export');return {state,hash:await document.getElementById('sender-test').contentWindow.ScanLarge.hashBlob(exported.file),expected:expectedOptical};});
    assert(complete.state.ready);assert.equal(complete.hash,complete.expected);assert.deepEqual(errors,[]);
    await page.evaluate(()=>document.getElementById('sender-test').contentWindow.ScanBridge.selectVolume(0));
    await sender.locator('#auto-cycle').check();await page.clock.install();
    await sender.locator('#start').click();await page.clock.fastForward(180000);
    await page.waitForFunction(()=>document.getElementById('sender-test').contentWindow.eval('volumeIndex')===1);
    await sender.locator('#stop').click();await page.clock.fastForward(360000);
    assert.equal(await page.evaluate(()=>document.getElementById('sender-test').contentWindow.eval('volumeIndex')),1,'Stopped carousel continued changing blocks');
    console.log('PASS: 8 MiB incompressible encoding; camera-button/video/capture pipeline: 17 MiB +91-byte real CIMBAR frames -> extractor/fountain/zstd WASM -> OPFS -> whole-file digest; timed carousel + stop. Canvas video replaces the physical camera.');
  }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
