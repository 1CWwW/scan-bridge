/* Scan Bridge receiver UI. MIT License. */
'use strict';
const $=id=>document.getElementById(id),requests=new Map();
const store=new Worker('receiver-store.js');
let requestId=0,current=null,initialized=false,working=false,decoder=null,decoderReady=false,frameBusy=false,stream=null,timer=null,wake=null,downloadURL=null,directURL=null;
const size=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GiB':(n/1024**2).toFixed(1)+' MiB';
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function render(state){
  current=state;
  const h=state.session;
  $('session').textContent=h?h.name+'\n'+state.received+' / '+h.partCount+' 块 · '+size(state.receivedBytes)+' / '+size(h.totalBytes):'等待接收文件。支持数百 MB 或更大的逻辑文件。';
  $('progress').value=h?state.received/h.partCount*100:0;
  $('missing').textContent=h&&!state.ready?'待接收块号：'+state.missing.join('、')+(h.partCount-state.received>state.missing.length?' 等':''):state.ready?'整文件 SHA-256 已通过校验。':'';
  $('save').disabled=!state.ready||working;
}
store.onmessage=event=>{
  const data=event.data;
  if(data.progress){const p=data.progress;status(p.phase+'：'+Math.floor(p.done/p.total*100)+'%');return;}
  const pending=requests.get(data.id);if(!pending)return;requests.delete(data.id);
  if(data.error){if(data.state)render(data.state);pending.reject(Object.assign(new Error(data.error.message),{name:data.error.name}));}
  else pending.resolve(data.result);
};
store.onerror=error=>{initialized=false;for(const r of requests.values())r.reject(new Error(error.message||'接收存储后台运行失败。'));requests.clear();busy(false);status('接收存储后台运行失败，请刷新页面。',true);stopCamera();};
function call(type,extra={}){return new Promise((resolve,reject)=>{const id=++requestId;requests.set(id,{resolve,reject});store.postMessage({id,type,...extra});});}
function busy(value){working=value;for(const id of ['clear','import','persist'])$(id).disabled=value||!initialized;$('save').disabled=value||!current?.ready;}
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
      if(state.ready)stopCamera();
    }else{
      if(file.size>16*1024**2)throw new Error('单次文件过大，请用扫码桥准备为数据块后发送。');
      if(directURL)URL.revokeObjectURL(directURL);directURL=URL.createObjectURL(file);
      $('direct').href=directURL;$('direct').download=file.name;$('direct').hidden=false;
      $('direct').textContent='保存：'+file.name;status('小文件已接收，请点击保存。');stopCamera();
    }
    await storageInfo();
  }catch(error){status(error.name==='QuotaExceededError'?'存储空间不足，已完成的数据块会保留。请释放空间后重扫当前块。':error.message,true);throw error;}
  finally{busy(false);}
}
function loadDecoder(){
  if(decoder)decoder.terminate();decoderReady=false;frameBusy=false;
  const worker=decoder=new Worker('decoder-worker.js');
  const deadline=setTimeout(()=>{if(worker===decoder&&!decoderReady){status('解码器加载超时，请检查接收页资源是否完整。',true);stopCamera();}},20000);
  worker.onerror=error=>{clearTimeout(deadline);if(worker===decoder){status(error.message||'解码器运行失败。',true);stopCamera();}};
  worker.onmessage=async event=>{
    if(worker!==decoder)return;
    const data=event.data;
    if(data.ready){clearTimeout(deadline);decoderReady=true;return;}
    if(data.error){status(data.error,true);stopCamera();return;}
    if(data.frame){
      const p=Array.isArray(data.progress)?Math.max(0,...data.progress):0;
      $('optical-progress').value=Math.min(100,p*100);
      $('optical').textContent=data.decoded?'已识别彩色码，正在恢复当前数据块。':'请保持完整彩色码在画面内，调整距离与屏幕亮度。';
      if(data.file){
        // Backpressure: finish durable storage before decoding another stream.
        try{await receive(data.file);}catch{stopCamera();return;}
        // Recreate the decoder after each stream. This also prevents 7-bit
        // upstream encode-id wraparound from suppressing blocks on large files.
        if(stream)loadDecoder();
      }else frameBusy=false;
    }
  };
}
const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
function capture(){
  if(!stream)return;
  const video=$('video');
  if(decoderReady&&!frameBusy&&!working&&video.readyState>=2){
    try{
      const scale=Math.min(1,1920/Math.max(video.videoWidth,video.videoHeight));
      canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      context.drawImage(video,0,0,canvas.width,canvas.height);
      const image=context.getImageData(0,0,canvas.width,canvas.height);frameBusy=true;
      decoder.postMessage({pixels:image.data,width:image.width,height:image.height},[image.data.buffer]);
    }catch(error){status(error.message,true);stopCamera();return;}
  }
  timer=setTimeout(capture,100);
}
async function startCamera(){
  if(!initialized||stream)return;
  try{
    if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('相机需要 HTTPS 接收网址或本机 localhost。请在系统浏览器打开接收页。');
    $('camera').disabled=true;
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
    const video=$('video');video.hidden=false;video.srcObject=stream;await video.play();
    $('pause').disabled=false;loadDecoder();capture();status('正在扫描。数据块会自动保存到本机。');
    try{wake=await navigator.wakeLock?.request('screen');}catch{}
  }catch(error){stopCamera();status(error.message,true);}
}
function stopCamera(){
  clearTimeout(timer);timer=null;
  if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;
  if(decoder)decoder.terminate();decoder=null;decoderReady=false;frameBusy=false;
  $('video').srcObject=null;$('video').hidden=true;$('camera').disabled=!initialized;$('pause').disabled=true;
  if(wake)wake.release().catch(()=>{});wake=null;
}
$('camera').onclick=startCamera;
$('pause').onclick=()=>{stopCamera();status('扫描已暂停，已写入的进度保留。');};
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
$('import').onchange=async()=>{stopCamera();try{for(const file of $('import').files)await receive(file);}catch{}finally{$('import').value='';}};
$('clear').onclick=async()=>{
  stopCamera();busy(true);
  try{render(await call('clear'));if(downloadURL)URL.revokeObjectURL(downloadURL);if(directURL)URL.revokeObjectURL(directURL);downloadURL=directURL=null;$('direct').hidden=true;status('当前任务和临时文件已清除。');await storageInfo();}
  catch(error){status(error.message,true);}finally{busy(false);}
};
$('persist').onclick=async()=>{try{const granted=await navigator.storage.persist();status(granted?'浏览器已允许持久保留接收存储。清除网站数据仍会删除进度。':'浏览器未允许持久保留。当前进度已写盘，但系统清理存储时可能删除。');}catch(error){status(error.message,true);}};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&stream){stopCamera();status('页面进入后台，已暂停扫描。返回后可继续。');}});
window.addEventListener('pagehide',stopCamera);
(async()=>{
  try{render(await call('init'));initialized=true;busy(false);$('camera').disabled=false;status(current.ready?'已恢复完整文件，可保存。':current.session?'已恢复接收进度，请补扫缺失块。':'接收存储已就绪。');await storageInfo();}
  catch(error){status('无法启用大文件接收：'+error.message,true);$('session').textContent='此设备暂不支持自动写盘接收。';}
  if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
// Used by integration tests and alternative optical adapters; no data is uploaded.
window.ScanReceiver={receive,call,getState:()=>current,stopCamera};
