const {chromium}=require('playwright');
const {launchOptions}=require('./helpers.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  let phase='old';
  const root=path.resolve(__dirname,'../dist/receiver'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const currentCache=/const CACHE='([^']+)'/.exec(sw)[1];
  const server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname.split('/').pop()||'index.html';
    if(!/^[a-zA-Z0-9_.-]+$/.test(name)){res.writeHead(404).end();return;}
    res.setHeader('Cache-Control',name==='sw.js'?'no-cache':'public, max-age=31536000');
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.wasm')?'application/wasm':'text/html');
    if(name==='index.html')res.end('<script src="receiver.js"></script><script>navigator.serviceWorker.register("sw.js")</script>');
    else if(name==='receiver.js')res.end('window.receiverBuildMarker='+JSON.stringify(phase));
    else if(name==='sw.js')res.end(phase==='old'?sw.replace(currentCache,'scan-bridge-receiver-upgrade-test-old'):sw);
    else{try{res.end(fs.readFileSync(path.join(root,name)));}catch{res.writeHead(404).end();}}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch(launchOptions);
  try{
    const page=await browser.newPage(),url=`http://127.0.0.1:${server.address().port}/receiver/`;
    await page.goto(url);await page.waitForFunction(()=>navigator.serviceWorker.controller);
    assert.equal(await page.evaluate(()=>receiverBuildMarker),'old');
    // Both HTML and JS are fresh in the browser's HTTP cache for one year.
    // A new SW must explicitly re-fetch them to install a coherent shell.
    phase='new';await page.evaluate(async()=>{window.previousController=navigator.serviceWorker.controller;const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
    await page.waitForFunction(async cache=>(await caches.keys()).includes(cache),currentCache);
    await page.waitForFunction(async()=>!(await caches.keys()).includes('scan-bridge-receiver-upgrade-test-old'));
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==previousController);
    await page.reload();assert.equal(await page.evaluate(()=>receiverBuildMarker),'new');
    await page.context().setOffline(true);await page.reload();assert.equal(await page.evaluate(()=>receiverBuildMarker),'new');
    console.log('PASS: new receiver cache fetches coherent HTML/JS despite fresh old HTTP entries; new shell reloads offline.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exit(1);});
