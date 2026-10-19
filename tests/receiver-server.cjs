const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
exports.startServer=async()=>{
  const root=path.resolve(__dirname,'../dist');
  const server=http.createServer((request,response)=>{
    const file=path.resolve(root,'.'+decodeURIComponent(new URL(request.url,'http://localhost').pathname)+(request.url.split('?')[0].endsWith('/')?'index.html':''));
    if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.txt':'text/plain'};
    response.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    const input=fs.createReadStream(file);input.on('error',()=>response.writeHead(404).end());input.pipe(response);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
};
