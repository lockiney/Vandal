"use strict";
const swAllowedHostnames = ["localhost", "127.0.0.1"];
async function registerSW() {
    if (location.protocol !== "https:" && !swAllowedHostnames.includes(location.hostname))
        throw new Error("Service workers cannot be registered without https.");
    if (!navigator.serviceWorker)
        throw new Error("Your browser doesn't support service workers.");
    const reg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/uv/service/',
    });
    if (reg.installing) {
        await new Promise(resolve => {
            reg.installing.addEventListener('statechange', e => {
                if (e.target.state === 'activated') resolve();
            });
        });
        location.reload();
    }
}
