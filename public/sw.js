const CACHE='nyeocare-static-v3',APP_SHELL='/',STATIC_PREFIXES=['/_next/static/','/icons/'],OFFLINE_PATHS=['/offline.html','/manifest.json'];
self.addEventListener('install',event=>{event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll([...OFFLINE_PATHS,APP_SHELL]);await self.skipWaiting()})())});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));await self.clients.claim()})())});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
 if(event.request.mode==='navigate'){
  event.respondWith((async()=>{
   try{
    const response=await fetch(event.request);
    if(response.ok&&url.pathname==='/'){const cache=await caches.open(CACHE);await cache.put(APP_SHELL,response.clone())}
    return response;
   }catch{
    const shell=await caches.match(APP_SHELL);if(shell)return shell;
    return caches.match('/offline.html');
   }
  })());
  return;
}
 if(url.pathname==='/manifest.json'||STATIC_PREFIXES.some(prefix=>url.pathname.startsWith(prefix))){
  event.respondWith((async()=>{const cache=await caches.open(CACHE),cached=await cache.match(event.request);if(cached)return cached;const response=await fetch(event.request);if(response.ok)cache.put(event.request,response.clone());return response})());
 }
});