// --- PREVENT STARTUP LOOPS ---
if (process.env.ALREADY_STARTED) {
    process.exit(0);
}
process.env.ALREADY_STARTED = 'true';

console.log("DEBUG: Initializing VANDAL...");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.UV_THREADPOOL_SIZE = '128';

const express = require('express');
const { createServer } = require('node:http');
const { uvPath } = require('@titaniumnetwork-dev/ultraviolet');
const { createBareServer } = require('bare-server-node');
const wisp = require('@mercuryworkshop/wisp-js');
const path = require('node:path');
const https = require('https');

const app = express();
const PORT = 8080;

const bareServer = createBareServer('/bare/', {
    logErrors: false,
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

// --- MIDDLEWARE & ROUTES ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/uv/uv.config.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'uv.config.js')));

const epoxyPath = path.join(require.resolve('@mercuryworkshop/epoxy-transport'), '..');
const bareMuxPath = path.join(require.resolve('@mercuryworkshop/bare-mux'), '..');
app.use('/epoxy/', express.static(epoxyPath));
app.use('/baremux/', express.static(bareMuxPath));
app.use('/uv/', express.static(uvPath));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- SERVER INSTANCE ---
const server = createServer((req, res) => {
    // 1. Add this listener to prevent crashing when the browser drops connection
    res.on('error', (err) => {
        console.error('Connection closed by client:', err.message);
    });

    // 2. Logic to safely route the request
    try {
        if (bareServer.shouldRoute(req)) {
            bareServer.routeRequest(req, res);
        } else {
            app(req, res);
        }
    } catch (err) {
        console.error('Proxy routing error:', err);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end();
        }
    }
});

server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/wisp/')) {
        wisp.server.routeRequest(req, socket, head);
    } else {
        socket.end();
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VANDAL is live at http://0.0.0.0:${PORT}`);
});