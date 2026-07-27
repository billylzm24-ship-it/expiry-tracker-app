const STALE=['expiry-tracker-v1','expiry-tracker-v2','expiry-tracker-v3','expiry-tracker-v4'];
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>{
  e.waitUntil(
    Promise.all(STALE.map(n=>caches.delete(n)))
      .then(()=>self.clients.claim())
      .then(()=>self.clients.matchAll({type:'window',includeUncontrolled:true}))
      .then(cs=>cs.forEach(c=>c.navigate(c.url)))
  );
});
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request)));
