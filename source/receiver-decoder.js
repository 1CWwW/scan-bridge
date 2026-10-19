/* Scan Bridge camera adapter for the unmodified CIMBAR v0.6.8 API. MIT License. */
'use strict';
var Module={
  print:()=>{},printErr:()=>{},
  onAbort:reason=>postMessage({error:'解码器内存或运行错误：'+reason}),
  onRuntimeInitialized:()=>{
    Module._cimbard_configure_decode(68);
    postMessage({ready:true});
  }
};
importScripts('cimbar_js.js');
const buffers=new Map();
function alloc(name,size){
  const old=buffers.get(name);
  if(old&&old.size>=size)return old.ptr;
  if(old)Module._free(old.ptr);
  const ptr=Module._malloc(size);if(!ptr)throw new Error('解码缓冲区分配失败。');
  buffers.set(name,{ptr,size});return ptr;
}
function extractFile(id){
  const namePtr=alloc('name',1024),n=Module._cimbard_get_filename(id,namePtr,1024);
  if(n<0)throw new Error('文件名解码失败：'+n);
  const name=n?new TextDecoder().decode(Module.HEAPU8.subarray(namePtr,namePtr+n)):'received.bin';
  const size=Module._cimbard_get_decompress_bufsize(),ptr=alloc('decompress',size),chunks=[];
  let total=0;
  while(true){
    const count=Module._cimbard_decompress_read(id,ptr,size);
    // The upstream decompressor reports EOF as zero or -14 (stream no longer good).
    if(count===0||count===-14)break;
    if(count<0)throw new Error('文件解压失败：'+count);
    total+=count;
    if(total>17*1024*1024)throw new Error('此接收器每个光学数据块最多 17 MiB，请使用扫码桥的 8 MiB 数据块。');
    chunks.push(Module.HEAPU8.slice(ptr,ptr+count));
  }
  return new File(chunks,name,{type:'application/octet-stream'});
}
self.onmessage=event=>{
  try{
    const started=performance.now();
    const {pixels,width,height}=event.data;
    if(!(pixels instanceof Uint8ClampedArray)||width<1||height<1||width*height*4!==pixels.length||pixels.length>1920*1920*4)throw new Error('相机帧尺寸无效。');
    const img=alloc('image',pixels.length),size=Module._cimbard_get_bufsize(),out=alloc('fountain',size);
    Module.HEAPU8.set(pixels,img);
    const count=Module._cimbard_scan_extract_decode(img,width,height,4,out,size);
    let file=null,progress=null;
    if(count>0){
      const result=Module._cimbard_fountain_decode(out,count);
      if(result>0n)file=extractFile(Number(result&0xffffffffn));
      const report=alloc('report',4096),length=Module._cimbard_get_report(report,4096);
      try{progress=JSON.parse(new TextDecoder().decode(Module.HEAPU8.subarray(report,report+length)));}catch{}
    }
    postMessage({frame:true,decoded:count>0,progress,file,elapsedMs:performance.now()-started});
  }catch(error){postMessage({error:error.message});}
};
