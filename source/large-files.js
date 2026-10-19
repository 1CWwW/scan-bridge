/* Scan Bridge large-file protocol and bounded-memory readers. MIT License. */
(function (root) {
  'use strict';
  const MiB=1024*1024, PART_SIZE=8*MiB, DIRECT_SIZE=8*MiB, READ_SIZE=MiB;
  const magic=new TextEncoder().encode('SCANBRIDGE-PART-1\n');
  const digest=value=>/^[a-f0-9]{64}$/.test(value);
  const check=valid=>{if(valid&&!valid())throw new Error('操作已取消。');};
  function plan(size){
    if(!Number.isSafeInteger(size)||size<0)throw new Error('文件大小无效。');
    return {size,count:size>DIRECT_SIZE?Math.ceil(size/PART_SIZE):1,partSize:PART_SIZE,split:size>DIRECT_SIZE};
  }
  async function eachBlock(blob,callback,valid){
    for(let offset=0;offset<blob.size;offset+=READ_SIZE){
      check(valid);
      const block=new Uint8Array(await blob.slice(offset,Math.min(offset+READ_SIZE,blob.size)).arrayBuffer());
      check(valid);await callback(block,offset+block.length);
    }
    check(valid);
  }
  async function hashBlob(blob,progress,valid){
    const hash=sha256.create();
    await eachBlock(blob,(block,done)=>{hash.update(block);if(progress)progress(done,blob.size);},valid);
    return hash.hex();
  }
  async function makePart(blob,info,index,valid){
    const p=plan(blob.size);
    if(!p.split)return new File([blob],info.name,{type:info.mime});
    if(!Number.isInteger(index)||index<0||index>=p.count)throw new Error('卷号超出范围。');
    const offset=index*PART_SIZE;
    const data=new Uint8Array(await blob.slice(offset,Math.min(offset+PART_SIZE,blob.size)).arrayBuffer());
    check(valid);
    const header={format:'scanbridge-part-1',name:info.name,mime:info.mime||'application/octet-stream',
      totalBytes:blob.size,wholeSha256:info.sha256,partIndex:index+1,partCount:p.count,
      partSize:PART_SIZE,offset,bytes:data.length,sha256:sha256(data)};
    const json=new TextEncoder().encode(JSON.stringify(header)),length=new Uint8Array(4);
    new DataView(length.buffer).setUint32(0,json.length,true);
    const number=String(index+1).padStart(String(p.count).length,'0');
    // A compact ASCII envelope name also works with upstream filename limits.
    return new File([magic,length,json,data],`sb-${info.sha256.slice(0,12)}-${number}-of-${p.count}.sbpart`,{type:'application/octet-stream'});
  }
  function safeName(name){
    return typeof name==='string'&&name.length>0&&name!=='.'&&name!=='..'&&!/[\\/\x00-\x1f:]/.test(name);
  }
  async function readHeader(file){
    const prefix=new Uint8Array(await file.slice(0,magic.length+4).arrayBuffer());
    if(prefix.length!==magic.length+4||!magic.every((v,i)=>prefix[i]===v))throw new Error('不是扫码桥分卷：'+file.name);
    const length=new DataView(prefix.buffer).getUint32(magic.length,true);
    if(length<2||length>16384||file.size<magic.length+4+length)throw new Error('分卷头损坏：'+file.name);
    let h;
    try{h=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.slice(magic.length+4,magic.length+4+length).arrayBuffer()));}
    catch{throw new Error('分卷信息损坏：'+file.name);}
    validateHeader(h);
    const dataOffset=magic.length+4+length;
    if(file.size-dataOffset!==h.bytes)throw new Error('分卷长度不完整：'+file.name);
    return {file,header:h,dataOffset};
  }
  function validateHeader(h){
    const numbers=['totalBytes','partIndex','partCount','partSize','offset','bytes'];
    if(!h||h.format!=='scanbridge-part-1'||!safeName(h.name)||!digest(h.wholeSha256)||!digest(h.sha256)||
       numbers.some(k=>!Number.isSafeInteger(h[k])||h[k]<0)||h.partSize!==PART_SIZE||h.totalBytes<=DIRECT_SIZE||
       h.partIndex<1||h.partCount!==Math.ceil(h.totalBytes/PART_SIZE)||h.partIndex>h.partCount||
       h.offset!==(h.partIndex-1)*PART_SIZE||h.bytes!==Math.min(PART_SIZE,h.totalBytes-h.offset))throw new Error('数据块信息不合法。');
    if(h.mime!==undefined&&(typeof h.mime!=='string'||h.mime.length>255))throw new Error('文件类型信息不合法。');
    return h;
  }
  async function inspectParts(files){
    if(!files.length)throw new Error('请选择全部 .sbpart 分卷。');
    const parts=[],indices=new Set();let first;
    for(const file of files){
      const part=await readHeader(file),h=part.header;
      if(!first)first=h;
      for(const key of ['name','totalBytes','wholeSha256','partCount','partSize'])
        if(h[key]!==first[key])throw new Error('选中了不同文件的分卷，请分开还原。');
      if(indices.has(h.partIndex))throw new Error('卷号重复：'+h.partIndex+'，每卷只选择一份。');
      indices.add(h.partIndex);parts.push(part);
    }
    if(parts.length!==first.partCount){
      const missing=[];for(let i=1;i<=first.partCount&&missing.length<20;i++)if(!indices.has(i))missing.push(i);
      throw new Error('分卷不齐，缺少卷号：'+missing.join('、')+(first.partCount-parts.length>20?' 等':''));
    }
    return parts.sort((a,b)=>a.header.partIndex-b.header.partIndex);
  }
  async function mergeParts(parts,writer,progress,valid){
    const whole=sha256.create();let done=0;
    for(const part of parts){
      check(valid);
      const data=new Uint8Array(await part.file.slice(part.dataOffset).arrayBuffer());
      check(valid);
      if(sha256(data)!==part.header.sha256)throw new Error('第 '+part.header.partIndex+' 卷校验失败，请重新接收。');
      whole.update(data);await writer.write(data);done+=data.length;
      if(progress)progress(done,parts[0].header.totalBytes);
    }
    check(valid);
    if(whole.hex()!==parts[0].header.wholeSha256)throw new Error('整文件校验失败，未提交合并结果。');
    return whole.hex();
  }
  const pad=size=>new Uint8Array((512-size%512)%512);
  function tarHeader(name,size,type='0'){
    const h=new Uint8Array(512),encoder=new TextEncoder();
    const put=(offset,text)=>h.set(encoder.encode(text),offset);
    put(0,name);put(100,'0000644\0');put(108,'0000000\0');put(116,'0000000\0');
    put(124,Math.min(size,8589934591).toString(8).padStart(11,'0')+'\0');
    put(136,'00000000000\0');h.fill(32,148,156);put(156,type);put(257,'ustar\0');put(263,'00');
    const sum=h.reduce((a,b)=>a+b,0);put(148,sum.toString(8).padStart(6,'0')+'\0 ');
    return h;
  }
  function paxLine(key,value){
    const body=key+'='+value+'\n';let length=new TextEncoder().encode(body).length+2;
    while(true){const line=length+' '+body,n=new TextEncoder().encode(line).length;if(n===length)return line;length=n;}
  }
  async function tarFiles(entries,progress,valid){
    const chunks=[],whole=sha256.create(),manifest=[];let done=0,index=0;
    const total=entries.reduce((sum,entry)=>sum+entry.file.size,0);
    const push=bytes=>{chunks.push(bytes);whole.update(bytes);};
    async function add(name,file,record){
      const pax=new TextEncoder().encode(paxLine('path',name)+paxLine('size',file.size));
      push(tarHeader('PaxHeaders/'+index,pax.length,'x'));push(pax);push(pad(pax.length));
      push(tarHeader('file-'+index++,file.size));chunks.push(file);
      const hash=sha256.create();
      await eachBlock(file,block=>{hash.update(block);whole.update(block);done+=block.length;if(progress)progress(done,total);},valid);
      push(pad(file.size));
      if(record)manifest.push({path:name,bytes:file.size,sha256:hash.hex()});
    }
    for(const entry of entries)await add(entry.path,entry.file,true);
    const data=JSON.stringify({format:'scanbridge-1',files:manifest},null,2);
    await add('__scanbridge__/manifest.json',new Blob([data]),false);
    push(new Uint8Array(1024));check(valid);
    return {blob:new Blob(chunks,{type:'application/x-tar'}),sha256:whole.hex(),fileCount:manifest.length};
  }
  root.ScanLarge={MiB,PART_SIZE,DIRECT_SIZE,READ_SIZE,magic,plan,hashBlob,makePart,readHeader,validateHeader,inspectParts,mergeParts,tarFiles,safeName};
})(globalThis);
