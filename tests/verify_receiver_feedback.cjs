const {chromium}=require('playwright');
const {launchOptions}=require('./helpers.cjs');
const {startServer}=require('./receiver-server.cjs');
const assert=require('node:assert/strict');
(async()=>{
  const server=await startServer(),browser=await chromium.launch(launchOptions);
  try{
    const page=await browser.newPage({serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const NativeWorker=window.Worker;window.testDecoders=[];window.videoCallbacks=new Map();let serial=0;
      window.Worker=class{
        constructor(url,options){
          if(!String(url).endsWith('decoder-worker.js'))return new NativeWorker(url,options);
          this.messages=[];this.stopped=false;testDecoders.push(this);queueMicrotask(()=>this.onmessage?.({data:{ready:true}}));
        }
        postMessage(message){this.messages.push({width:message.width,height:message.height});}
        reply(data){this.onmessage({data:{frame:true,file:null,elapsedMs:125,...data}});}
        terminate(){this.stopped=true;}
      };
      HTMLVideoElement.prototype.requestVideoFrameCallback=function(callback){const id=++serial;videoCallbacks.set(id,callback);return id;};
      HTMLVideoElement.prototype.cancelVideoFrameCallback=id=>videoCallbacks.delete(id);
      window.nextCameraFrame=time=>{const next=videoCallbacks.entries().next().value;if(!next)throw new Error('No camera callback scheduled');videoCallbacks.delete(next[0]);next[1](performance.now(),{mediaTime:time});};
      window.canvasResizes=0;
      for(const property of ['width','height']){
        const descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,property);
        Object.defineProperty(HTMLCanvasElement.prototype,property,{...descriptor,set(value){if(this.id!=='test-camera')canvasResizes++;descriptor.set.call(this,value);}});
      }
    });
    await page.goto(server.url+'/receiver/');await page.waitForFunction(()=>!document.getElementById('camera').disabled);
    await page.evaluate(()=>{
      window.sourceCanvas=document.createElement('canvas');sourceCanvas.id='test-camera';sourceCanvas.width=sourceCanvas.height=128;
      sourceCanvas.getContext('2d').fillRect(0,0,128,128);
      setInterval(()=>sourceCanvas.getContext('2d').fillRect(0,0,128,128),33);
      navigator.mediaDevices.getUserMedia=async()=>sourceCanvas.captureStream(30);
    });
    await page.locator('#camera').click();await page.waitForFunction(()=>testDecoders.length&&videoCallbacks.size);
    await page.evaluate(()=>{nextCameraFrame(1);for(let t=2;t<=5;t++)nextCameraFrame(t);});
    assert.equal(await page.evaluate(()=>testDecoders[0].messages.length),1,'Camera frames queued behind a busy decoder');
    // A completed decode immediately consumes the latest waiting camera frame;
    // no timer advance is needed and intermediate frames are discarded.
    await page.evaluate(()=>testDecoders[0].reply({decoded:true,progress:[.4]}));
    assert.equal(await page.evaluate(()=>testDecoders[0].messages.length),2);
    await page.evaluate(()=>testDecoders[0].reply({decoded:false,progress:null}));
    assert.equal(await page.locator('#optical-progress').getAttribute('value'),'40');
    assert((await page.locator('#optical-percent').textContent()).includes('40.0%'));
    await page.evaluate(()=>nextCameraFrame(5));
    assert.equal(await page.evaluate(()=>testDecoders[0].messages.length),2,'Same video frame was decoded twice');
    await page.evaluate(()=>{nextCameraFrame(6);testDecoders[0].reply({decoded:false,progress:[]});});
    assert.equal(await page.locator('#optical-progress').getAttribute('value'),'40');
    assert.equal(await page.evaluate(()=>canvasResizes),2,'Capture canvas resized for unchanged dimensions');
    const stats=await page.evaluate(()=>ScanReceiver.getDiagnostics());assert.equal(stats.frames,3);assert.equal(stats.decodeMs,125);assert.equal(stats.decodedRatio,1/3);
    await page.locator('#pause').click();assert.equal(await page.evaluate(()=>videoCallbacks.size),0);
    // A permission result arriving after cancellation must not restart scanning.
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{window.resolveCamera=resolve;});});
    await page.locator('#camera').click();await page.evaluate(()=>ScanReceiver.stopCamera());
    await page.evaluate(()=>{window.lateStream=sourceCanvas.captureStream(30);resolveCamera(lateStream);});
    await page.waitForFunction(()=>lateStream.getTracks().every(t=>t.readyState==='ended'));
    assert(await page.locator('#video').isHidden());assert(await page.locator('#pause').isDisabled());
    // Older browsers retain a bounded fallback, with the same backpressure.
    await page.evaluate(()=>{HTMLVideoElement.prototype.requestVideoFrameCallback=undefined;window.fakeFrames=1;HTMLVideoElement.prototype.getVideoPlaybackQuality=()=>({totalVideoFrames:fakeFrames});navigator.mediaDevices.getUserMedia=async()=>sourceCanvas.captureStream(30);});
    await page.locator('#camera').click();await page.waitForFunction(()=>testDecoders.length===2&&testDecoders[1].messages.length===1);
    await page.evaluate(()=>{fakeFrames=2;});await page.waitForTimeout(70);
    assert.equal(await page.evaluate(()=>testDecoders[1].messages.length),1);
    await page.evaluate(()=>testDecoders[1].reply({decoded:true,progress:[.2]}));
    assert.equal(await page.evaluate(()=>testDecoders[1].messages.length),2);
    await page.locator('#pause').click();await page.waitForTimeout(70);assert.equal(await page.evaluate(()=>testDecoders[1].messages.length),2);
    await page.evaluate(()=>ScanReceiver.receive(new File(['small text'],'small.txt')));
    assert.equal(await page.locator('#progress').getAttribute('value'),'100');assert(await page.locator('#direct').isVisible());
    assert.deepEqual(errors,[]);
    console.log('PASS: latest-frame backpressure, immediate scheduling, failed/duplicate video frame handling, stable progress and canvas size, scan metrics, late-permission cancellation, fallback and direct-file feedback.');
  }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
