/* Scan Bridge receiver UI. MIT License. */
'use strict';
const $=id=>document.getElementById(id),requests=new Map();
let store=null,storeBootError=null;
try{store=new Worker('receiver-store.js');}catch(error){storeBootError=error;}
let requestId=0,current=null,initialized=false,working=false,decoder=null,decoderReady=false,frameBusy=false,stream=null,timer=null,wake=null,downloadURL=null,directURL=null;
let videoCallback=null,cameraEpoch=0,cameraPending=false,latestFrame=null,capturedFrame=null,opticalRatio=0,statsTimer=null,scanStarted=0,samples=[];
let watchdog=null,frameDeadline=null,frameStarted=0,frameSerial=0,lastVideoAdvance=0,lastMetadata=null,captureMode='idle',submitted=0,completed=0,cameraSamples=[];
let lastReplyAt=0,lastProgressAt=0;
let lastStorageActivity=performance.now();
const size=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GiB':(n/1024**2).toFixed(1)+' MiB';
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);if(error)$('scan-hint').textContent=message;}
function render(state){
  current=state;
  const h=state.session;
  $('session').textContent=h?h.name+'\n'+state.received+' / '+h.partCount+' 块 · '+size(state.receivedBytes)+' / '+size(h.totalBytes):'等待接收文件。支持数百 MB 或更大的逻辑文件。';
  $('progress').value=h?state.receivedBytes/h.totalBytes*100:0;
  $('committed').textContent=h?'已校验写盘 '+(state.receivedBytes/h.totalBytes*100).toFixed(1)+'%；只在一整块收齐后增加。':'首个数据块收齐后显示整文件进度；当前块进度见上方。';
  $('missing').textContent=h&&!state.ready?'待接收块号：'+state.missing.join('、')+(h.partCount-state.received>state.missing.length?' 等':''):state.ready?'整文件 SHA-256 已通过校验。':'';
  $('save').disabled=!state.ready||working;
}
if(store)store.onmessage=event=>{
  lastStorageActivity=performance.now();
  const data=event.data;
  if(data.progress){const p=data.progress;status(p.phase+'：'+Math.floor(p.done/p.total*100)+'%');return;}
  const pending=requests.get(data.id);if(!pending)return;requests.delete(data.id);
  if(data.error){if(data.state)render(data.state);pending.reject(Object.assign(new Error(data.error.message),{name:data.error.name}));}
  else pending.resolve(data.result);
};
if(store)store.onerror=error=>storageUnavailable(new Error(error.message||'接收存储后台运行失败。'));
function call(type,extra={}){return new Promise((resolve,reject)=>{if(!store){reject(storeBootError||new Error('无法创建接收存储后台。'));return;}const id=++requestId;requests.set(id,{resolve,reject});store.postMessage({id,type,...extra});});}
function storageUnavailable(error){
  initialized=false;for(const r of requests.values())r.reject(error);requests.clear();store?.terminate();store=null;
  busy(false);stopCamera(true);$('retry-storage').hidden=false;
  $('storage-state').textContent='接收存储未就绪，相机尚未启用。请使用普通浏览模式，关闭其他接收标签页后重新检测。';
  status('接收存储初始化或运行失败（'+(error.name||'Error')+'）：'+error.message,true);
}
function busy(value){working=value;for(const id of ['clear','import','persist'])$(id).disabled=value||!initialized;$('save').disabled=value||!initialized||!current?.ready;}
async function storageInfo(){
  try{const e=await navigator.storage.estimate();$('storage').textContent='浏览器存储：已用 '+size(e.usage||0)+'，配额约 '+size(e.quota||0)+'。实际写入还受设备剩余空间限制。';}catch{}
}
async function receive(file){
  if(working)throw new Error('正在写入或校验，请稍候。');
  busy(true);
  try{
    const prefix=new TextDecoder().decode(await file.slice(0,18).arrayBuffer());
    if(prefix.startsWith('SCANBRIDGE-PART-1\n')){
      const state=await call('accept',{file});render(state);
      status(state.ready?'文件已收齐并通过 SHA-256 校验，可以保存完整文件。':(state.duplicate?'此块已接收，已跳过。':'数据块已校验并写入。')+' 请切换下一块或补扫缺块。');
      if(state.ready)stopCamera(true);
    }else{
      if(file.size>16*1024**2)throw new Error('单次文件过大，请用扫码桥准备为数据块后发送。');
      if(directURL)URL.revokeObjectURL(directURL);directURL=URL.createObjectURL(file);
      $('direct').href=directURL;$('direct').download=file.name;$('direct').hidden=false;
      $('direct').textContent='保存：'+file.name;
      if(!current?.session){$('session').textContent=file.name+'\n'+size(file.size)+' · 小文件已接收';$('progress').value=100;$('committed').textContent='已收到完整小文件，请点击下方保存。';}
      status('小文件已接收，请点击保存。');stopCamera(true);
    }
    await storageInfo();
  }catch(error){status(error.name==='QuotaExceededError'?'存储空间不足，已完成的数据块会保留。请释放空间后重扫当前块。':error.message,true);throw error;}
  finally{busy(false);capture();}
}
function updateOptical(report){
  const previous=opticalRatio;
  const values=Array.isArray(report)?report.filter(n=>Number.isFinite(n)&&n>=0).map(n=>Math.min(1,n)):[];
  // Failed extraction has no new fountain report; it must not erase progress.
  if(values.length)opticalRatio=Math.max(...values);
  const advanced=opticalRatio>previous+1e-9;if(advanced)lastProgressAt=performance.now();
  $('optical-progress').value=opticalRatio*100;
  $('optical-percent').textContent='当前数据块（解码器估计）：'+(opticalRatio*100).toFixed(1)+'%';
  return advanced;
}
function diagnostics(){
  const now=performance.now();samples=samples.filter(s=>now-s.time<3000);cameraSamples=cameraSamples.filter(t=>now-t<3000);
  const elapsed=Math.max(.25,Math.min(3,(now-scanStarted)/1000)),count=samples.length;
  return {fps:count/elapsed,captureFps:cameraSamples.length/elapsed,submitted,completed,mode:captureMode,waitingMs:frameBusy?now-frameStarted:0,resultAgeMs:now-(lastReplyAt||scanStarted),stalledMs:now-lastProgressAt,decodedRatio:count?samples.filter(s=>s.decoded).length/count:0,decodeMs:count?samples.reduce((s,x)=>s+x.ms,0)/count:0,frames:count,width:canvas.width,height:canvas.height};
}
function showDiagnostics(){
  if(!stream)return;
  const d=diagnostics();
  $('diagnostics').textContent=(d.mode==='compat'?'兼容采集':'自动采集')+' '+d.captureFps.toFixed(1)+' 帧/秒 · 处理 '+d.fps.toFixed(1)+' 帧/秒 · 已提交 '+d.submitted+' / 已返回 '+d.completed+' · 有码帧 '+Math.round(d.decodedRatio*100)+'% · 解码 '+Math.round(d.decodeMs)+' 毫秒/帧 · '+d.width+' × '+d.height;
  if(performance.now()-scanStarted<4000)return;
  if(working){$('scan-hint').textContent='正在校验或写入当前块，暂时停止取帧，请稍候。';return;}
  if(d.resultAgeMs>3000)$('optical').textContent='最近 '+Math.floor(d.resultAgeMs/1000)+' 秒没有新的解码结果；上次识别成功不代表仍在接收。';
  if(!decoderReady){$('scan-hint').textContent='正在加载解码器，暂不采集画面。';return;}
  if(d.waitingMs>3000){$('scan-hint').textContent='画面已提交，正在等待解码器返回（'+Math.floor(d.waitingMs/1000)+' 秒）。超过 30 秒会停止并提示重扫当前块。';return;}
  if(!d.frames){$('scan-hint').textContent='尚未收到处理结果；请检查相机预览，或切换“兼容采集”后暂停并重新开启相机。';return;}
  if(d.stalledMs>15000&&d.decodedRatio>=.25){$('scan-hint').textContent='画面可以识别，但最近 '+Math.floor(d.stalledMs/1000)+' 秒未看到新增恢复进度。检查电脑动画是否继续变化、云桌面画面是否冻结；关闭定时切块并保持同一块。识别到重复数据也会显示有码帧。';return;}
  $('scan-hint').textContent=d.frames&&d.decodedRatio<.25?'有效画面较少：把电脑彩色码全屏，保持四角完整、对焦清晰，调整距离；先用 5 FPS 确认稳定识别。':d.decodeMs>150?'手机解码耗时较高。保持页面前台，先用 5 FPS；提高电脑发送帧率未必会更快。':'画面已能识别，可试电脑 10 FPS；若有码帧比例明显下降，退回 5 FPS。保持当前块，收齐后再切换。';
}
function loadDecoder(){
  discardDecoder();
  opticalRatio=0;lastReplyAt=0;lastProgressAt=performance.now();updateOptical(null);
  const worker=decoder=new Worker('decoder-worker.js');
  const deadline=setTimeout(()=>{if(worker===decoder&&!decoderReady){status('解码器加载超时，请检查接收页资源是否完整。',true);stopCamera(true);}},20000);
  worker.onerror=error=>{clearTimeout(deadline);if(worker===decoder){status(error.message||'解码器运行失败。',true);stopCamera(true);}};
  worker.onmessage=async event=>{
    if(worker!==decoder)return;
    const data=event.data;
    if(data.ready){clearTimeout(deadline);decoderReady=true;capture();return;}
    if(data.error){clearTimeout(deadline);status(data.error,true);stopCamera(true);return;}
    if(data.frame){
      clearTimeout(frameDeadline);frameDeadline=null;completed++;lastReplyAt=performance.now();
      samples.push({time:performance.now(),decoded:!!data.decoded,ms:Number.isFinite(data.elapsedMs)?data.elapsedMs:0});
      const advanced=updateOptical(data.progress);
      $('optical').textContent=data.decoded?(advanced?'当前块已收到新增恢复数据。':'本次画面识别到编码数据，但块进度尚未增加，可能是重复数据。'):'本次画面未提取到编码数据，请保持四角完整并检查清晰度。';
      if(data.file){
        // Backpressure: finish durable storage before decoding another stream.
        try{await receive(data.file);}catch{stopCamera(true);return;}
        // Recreate the decoder after each stream. This also prevents 7-bit
        // upstream encode-id wraparound from suppressing blocks on large files.
        if(stream)loadDecoder();else discardDecoder();
      }else{frameBusy=false;capture();}
    }
  };
}
function discardDecoder(){
  clearTimeout(frameDeadline);frameDeadline=null;
  if(decoder)decoder.terminate();decoder=null;decoderReady=false;frameBusy=false;
}
function armFrameDeadline(){
  clearTimeout(frameDeadline);frameStarted=performance.now();
  frameDeadline=setTimeout(()=>{
    if(!stream||!frameBusy)return;
    stopCamera(true);status('解码器超过 30 秒没有返回，已停止扫描。已写盘的数据块保留；当前未完成块需要重扫。请重新开启相机，先用小文件检查。',true);
  },30000);
}
const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
function capture(){
  if(!stream||!decoderReady||frameBusy||working||latestFrame===null||latestFrame===capturedFrame)return;
  const video=$('video');
  if(decoderReady&&!frameBusy&&!working&&video.readyState>=2){
    try{
      const scale=Math.min(1,1920/Math.max(video.videoWidth,video.videoHeight));
      const width=Math.round(video.videoWidth*scale),height=Math.round(video.videoHeight*scale);
      if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
      context.drawImage(video,0,0,canvas.width,canvas.height);
      const image=context.getImageData(0,0,canvas.width,canvas.height);frameBusy=true;capturedFrame=latestFrame;submitted++;armFrameDeadline();
      decoder.postMessage({pixels:image.data,width:image.width,height:image.height},[image.data.buffer]);
    }catch(error){status(error.message,true);stopCamera(true);return;}
  }
}
function stopWatching(){
  clearTimeout(timer);timer=null;clearInterval(watchdog);watchdog=null;
  if(videoCallback!==null)$('video').cancelVideoFrameCallback?.(videoCallback);videoCallback=null;
}
function watchVideo(epoch){
  stopWatching();lastVideoAdvance=performance.now();lastMetadata=null;
  const video=$('video');
  const compatibility=()=>{
    stopWatching();captureMode='compat';
    // Some cameras expose a frame callback / counter that stops advancing.
    // Use independent sampling here, with the same one-frame backpressure.
    const poll=()=>{
      if(epoch!==cameraEpoch||!stream||captureMode!=='compat')return;
      latestFrame=++frameSerial;cameraSamples.push(performance.now());capture();timer=setTimeout(poll,67);
    };poll();
  };
  if($('capture-mode').value!=='compat'&&typeof video.requestVideoFrameCallback==='function'){
    captureMode='video';
    const onFrame=(now,metadata)=>{
      if(epoch!==cameraEpoch||!stream||captureMode!=='video')return;
      videoCallback=null;
      const key=metadata.presentedFrames>0?'frame:'+metadata.presentedFrames:metadata.mediaTime>0?'time:'+metadata.mediaTime:null;
      if(key===null||key!==lastMetadata){lastMetadata=key;lastVideoAdvance=performance.now();latestFrame=++frameSerial;cameraSamples.push(lastVideoAdvance);capture();}
      if(epoch===cameraEpoch&&stream)videoCallback=video.requestVideoFrameCallback(onFrame);
    };
    videoCallback=video.requestVideoFrameCallback(onFrame);
    watchdog=setInterval(()=>{if(epoch===cameraEpoch&&stream&&performance.now()-lastVideoAdvance>1200){compatibility();$('scan-hint').textContent='相机帧回调未持续更新，已自动切换兼容采集；当前块解码进度保留。';}},250);
  }else compatibility();
}
async function startCamera(){
  if(!initialized||stream||cameraPending)return;
  const epoch=++cameraEpoch;cameraPending=true;
  try{
    if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('相机需要 HTTPS 接收网址或本机 localhost。请在系统浏览器打开接收页。');
    $('camera').disabled=true;
    const candidate=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30}}});
    if(epoch!==cameraEpoch||document.hidden){candidate.getTracks().forEach(track=>track.stop());if(epoch===cameraEpoch)stopCamera();return;}
    stream=candidate;
    const video=$('video');video.hidden=false;video.srcObject=stream;await video.play();
    if(epoch!==cameraEpoch||!stream)return;
    scanStarted=lastProgressAt=performance.now();lastReplyAt=0;samples=[];cameraSamples=[];latestFrame=capturedFrame=null;
    $('pause').disabled=false;if(!decoder)loadDecoder();else if(frameBusy)armFrameDeadline();watchVideo(epoch);statsTimer=setInterval(showDiagnostics,1000);status('正在扫描。数据块会自动保存到本机。');
    try{const lock=await navigator.wakeLock?.request('screen');if(epoch===cameraEpoch)wake=lock;else await lock?.release();}catch{}
  }catch(error){if(epoch===cameraEpoch){stopCamera();status(error.message,true);}}
  finally{if(epoch===cameraEpoch)cameraPending=false;}
}
function stopCamera(discard=false){
  cameraEpoch++;cameraPending=false;
  stopWatching();captureMode='idle';clearTimeout(frameDeadline);frameDeadline=null;
  clearInterval(statsTimer);statsTimer=null;
  latestFrame=capturedFrame=null;
  if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;
  if(discard)discardDecoder();
  $('video').srcObject=null;$('video').hidden=true;$('camera').disabled=!initialized;$('pause').disabled=true;
  if(wake)wake.release().catch(()=>{});wake=null;
}
$('camera').onclick=startCamera;
$('pause').onclick=()=>{stopCamera();status('扫描已暂停，当前块解码进度保留。保持电脑发送同一块，再开启相机即可继续；刷新页面只恢复已写盘的完整块。');};
$('capture-mode').onchange=()=>{if(stream){watchVideo(cameraEpoch);status('采集方式已切换，当前块解码进度保留。');}};
$('save').onclick=async()=>{
  busy(true);
  try{
    // Invoke the native picker before awaiting worker replies (user activation).
    const target=typeof showSaveFilePicker==='function'?await showSaveFilePicker({suggestedName:current.session.name}):null;
    const {file}=await call('export');
    if(target){const writer=await target.createWritable();try{await file.stream().pipeTo(writer);}catch(error){await writer.abort().catch(()=>{});throw error;}}
    else{if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=URL.createObjectURL(file);const link=document.createElement('a');link.href=downloadURL;link.download=file.name;document.body.appendChild(link);link.click();link.remove();}
    status('已交给浏览器保存：'+file.name+'。确认文件已保存后，再清除当前任务。');
  }catch(error){status(error.name==='AbortError'?'已取消保存，接收文件仍保留。':error.message,true);}
  finally{busy(false);}
};
$('import').onchange=async()=>{stopCamera(true);try{for(const file of $('import').files)await receive(file);}catch{}finally{$('import').value='';}};
$('clear').onclick=async()=>{
  stopCamera(true);busy(true);
  try{render(await call('clear'));if(downloadURL)URL.revokeObjectURL(downloadURL);if(directURL)URL.revokeObjectURL(directURL);downloadURL=directURL=null;$('direct').hidden=true;status('当前任务和临时文件已清除。');await storageInfo();}
  catch(error){status(error.message,true);}finally{busy(false);}
};
$('persist').onclick=async()=>{try{const granted=await navigator.storage.persist();status(granted?'浏览器已允许持久保留接收存储。清除网站数据仍会删除进度。':'浏览器未允许持久保留。当前进度已写盘，但系统清理存储时可能删除。');}catch(error){status(error.message,true);}};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(stream||cameraPending)){stopCamera();status('页面进入后台，已暂停扫描。返回后开启相机，保持电脑发送同一块可继续；页面被系统重载时需重扫未完成块。');}});
window.addEventListener('pagehide',()=>stopCamera(true));
(async()=>{
  let deadline;
  try{
    lastStorageActivity=performance.now();
    const timeout=new Promise((resolve,reject)=>{deadline=setInterval(()=>{if(performance.now()-lastStorageActivity>20000)reject(new Error('接收存储连续 20 秒未响应。请使用普通浏览模式，并关闭其他接收标签页后重试。'));},1000);});
    render(await Promise.race([call('init'),timeout]));initialized=true;busy(false);$('camera').disabled=false;$('storage-state').textContent='接收存储已就绪，可以开启相机。';
    status(current.ready?'已恢复完整文件，可保存。':current.session?'已恢复接收进度，请补扫缺失块。':'接收存储已就绪。');await storageInfo();
  }catch(error){storageUnavailable(error);$('session').textContent='接收存储未就绪，请查看相机按钮下方的错误原因。';}
  finally{clearInterval(deadline);}
  if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)){
    try{
      const scope=new URL('./',location.href),registration=await navigator.serviceWorker.getRegistration(scope.href);
      const active=registration?.active&&new URL(registration.active.scriptURL);
      if(registration?.scope===scope.href&&active?.searchParams.get('v')==='__VERSION__')await registration.update();
      else await navigator.serviceWorker.register('sw.js?v=__VERSION__',{scope:scope.href,updateViaCache:'none'});
    }catch{}
  }
})();
// Used by integration tests and alternative optical adapters; no data is uploaded.
window.ScanReceiver={receive,call,getState:()=>current,getDiagnostics:diagnostics,stopCamera};
