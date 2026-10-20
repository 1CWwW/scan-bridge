/* Scan Bridge durable receiving session. MIT License. Runs in a dedicated worker. */
'use strict';
importScripts('sha256.js','protocol.js');
let directory,session=null,parts=new Map(),ready=false;
const same=(a,b)=>['name','mime','totalBytes','wholeSha256','partSize','partCount'].every(k=>a[k]===b[k]);
const emit=(phase,done,total)=>postMessage({progress:{phase,done,total}});
async function writeFile(name,bytes,offset=0,truncate=true){
  const file=await directory.getFileHandle(name,{create:true});
  const stream=await file.createSyncAccessHandle();
  try{
    if(truncate)await stream.truncate(0);
    let done=0;
    while(done<bytes.length){
      const n=await stream.write(bytes.subarray(done),{at:offset+done});
      if(!Number.isSafeInteger(n)||n<=0||n>bytes.length-done)
        throw new DOMException('浏览器写盘失败或存储配额不足，未提交此数据块。请退出无痕模式并检查可用空间。','QuotaExceededError');
      done+=n;
    }
    await stream.flush();
    if(await stream.getSize()<offset+bytes.length)throw new Error('磁盘文件长度不足，未提交此数据块。');
  }finally{await stream.close();}
}
async function payload(){return (await directory.getFileHandle('payload.bin')).getFile();}
function state(){
  const missing=[];
  if(session)for(let i=1;i<=session.partCount&&missing.length<30;i++)if(!parts.has(i))missing.push(i);
  return {session,received:parts.size,receivedBytes:[...parts.values()].reduce((s,h)=>s+h.bytes,0),missing,ready};
}
async function verifyComplete(){
  ready=false;
  if(!session||parts.size!==session.partCount)return;
  const file=await payload();
  if(file.size!==session.totalBytes)throw new Error('完整文件长度校验失败。请重新扫描缺失块。');
  const hash=await ScanLarge.hashBlob(file,(n,t)=>emit('整文件校验',n,t));
  if(hash!==session.wholeSha256)throw new Error('整文件 SHA-256 校验失败，请清除任务后重新发送。');
  ready=true;
}
async function resume(){
  session=null;parts.clear();ready=false;
  let file;
  try{file=await payload();}catch(e){if(e.name==='NotFoundError')return state();throw e;}
  // Journals are committed only after data is flushed. A torn or stale journal
  // is ignored; its block can be scanned again. Recheck bytes after every reload.
  for await(const [name,handle] of directory.entries()){
    if(!/^block-[1-9][0-9]*\.json$/.test(name)||handle.kind!=='file')continue;
    try{
      const record=await handle.getFile();if(record.size>16384)continue;
      const h=ScanLarge.validateHeader(JSON.parse(await record.text()));
      if(name!==`block-${h.partIndex}.json`||h.offset+h.bytes>file.size)continue;
      if(session&&!same(session,h))continue;
      const hash=await ScanLarge.hashBlob(file.slice(h.offset,h.offset+h.bytes));
      if(hash!==h.sha256)continue;
      if(!session)session=h;
      parts.set(h.partIndex,h);emit('恢复接收进度',parts.size,h.partCount);
    }catch(e){if(e.name==='QuotaExceededError'||e.name==='NotReadableError')throw e;}
  }
  await verifyComplete();return state();
}
async function accept(file){
  const part=await ScanLarge.readHeader(file),h=part.header;
  if(session&&!same(session,h))throw new Error('这是另一个文件。请先保存当前文件，再清除当前接收任务。');
  const data=new Uint8Array(await file.slice(part.dataOffset).arrayBuffer());
  if(sha256(data)!==h.sha256)throw new Error('第 '+h.partIndex+' 块校验失败，请重扫此块。');
  if(parts.has(h.partIndex)){
    if(parts.get(h.partIndex).sha256!==h.sha256)throw new Error('同一块的校验信息冲突。');
    return {...state(),duplicate:true};
  }
  if(!session){
    const estimate=await navigator.storage.estimate();
    let orphanBytes=0;try{orphanBytes=(await payload()).size;}catch{}
    if(estimate.quota&&estimate.quota-(estimate.usage||0)+orphanBytes<h.totalBytes+ScanLarge.PART_SIZE)
      throw new Error('浏览器可用存储不足，请释放空间或换用其他接收设备。');
  }
  await writeFile('payload.bin',data,h.offset,!session);
  if(await ScanLarge.hashBlob((await payload()).slice(h.offset,h.offset+h.bytes))!==h.sha256)
    throw new Error('写入磁盘后的数据块校验失败，请重扫此块。');
  // Persist only a small header after committing the corresponding file bytes.
  await writeFile(`block-${h.partIndex}.json`,new TextEncoder().encode(JSON.stringify(h)));
  if(!session)session=h;
  parts.set(h.partIndex,h);
  await verifyComplete();return state();
}
async function run(message){
  if(message.type==='init')return resume();
  if(message.type==='accept')return accept(message.file);
  if(message.type==='export'){
    if(!ready||!session)throw new Error('文件尚未收齐或校验未完成。');
    return {file:new File([await payload()],session.name,{type:session.mime||'application/octet-stream'}),...state()};
  }
  if(message.type==='clear'){
    for await(const [name] of directory.entries())await directory.removeEntry(name,{recursive:true});
    session=null;parts.clear();ready=false;return state();
  }
  throw new Error('不支持的接收操作。');
}
let queue=Promise.resolve(),bootError=null;
const boot=new Promise((resolve,reject)=>{
  if(!navigator.storage?.getDirectory||!navigator.locks){reject(new Error('此浏览器缺少持久写盘能力，请使用新版 Safari、Chrome、Edge 或 Firefox。'));return;}
  navigator.locks.request('scan-bridge-receiver-v1',{ifAvailable:true},async lock=>{
    if(!lock){reject(new Error('已有一个接收页正在使用此存储，请关闭其他接收页后重试。'));return;}
    try{
      directory=await (await navigator.storage.getDirectory()).getDirectoryHandle('scan-bridge-recv-v1',{create:true});
      // Probe the actual write API, including Safari's worker-only sync handle.
      await writeFile('.probe',new Uint8Array());await directory.removeEntry('.probe');resolve();
      await new Promise(()=>{}); // Keep the origin lock until this worker stops.
    }catch(error){reject(error);}
  }).catch(reject);
});
boot.catch(error=>{bootError=error;});
self.onmessage=event=>{
  const {id,...message}=event.data;
  queue=queue.then(async()=>{
    try{await boot;if(bootError)throw bootError;postMessage({id,result:await run(message)});}
    catch(error){postMessage({id,error:{name:error.name,message:error.message},state:state()});}
  });
};
