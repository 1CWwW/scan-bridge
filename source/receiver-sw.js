/* Scan Bridge offline receiver shell. MIT License. */
'use strict';
const CACHE='scan-bridge-receiver-__VERSION__';
const ASSETS=['./','index.html','receiver.js','receiver-store.js','decoder-worker.js','sha256.js','protocol.js','cimbar_js.js','cimbar_js.2026-08-21T2336.wasm'];
// A new shell must fetch the matching resources instead of reusing an older
// HTTP-cache entry with the same unversioned filename.
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(asset=>new Request(new URL(asset,self.registration.scope),{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('scan-bridge-receiver-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url),base=new URL(self.registration.scope);
  if(url.origin!==base.origin||!ASSETS.some(asset=>new URL(asset,base).pathname===url.pathname))return;
  event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request,{ignoreSearch:true}))||fetch(event.request)));
});
