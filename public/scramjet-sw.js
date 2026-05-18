importScripts("/scramjet/scramjet.all.js");
importScripts("/scramjet/scramjet.sync.js");

const sj = new ScramjetServiceWorker();

self.addEventListener("fetch", (event) => {
    if (sj.route(event)) {
        event.respondWith(sj.fetch(event));
    }
});
