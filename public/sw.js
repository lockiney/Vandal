importScripts('/uv/uv.bundle.js');
importScripts('/uv/uv.config.js');
importScripts('/uv/uv.sw.js');

const sw = new UVServiceWorker();

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    // Only skip local API calls, not UV proxy routes
    if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
    if (sw.route(event)) {
        event.respondWith(sw.fetch(event));
    }
});
