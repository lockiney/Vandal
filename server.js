process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.UV_THREADPOOL_SIZE = '128';
const express = require('express');
const { createServer } = require('node:http');
const { uvPath } = require('@titaniumnetwork-dev/ultraviolet');
const { createBareServer } = require('bare-server-node');
const wisp = require('@mercuryworkshop/wisp-js');
const path = require('node:path');

const app = express();
const https = require('https');
const bareServer = createBareServer('/bare/', {
    logErrors: false,
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
});
const PORT = 8080;

// Serve public folder first
app.use(express.static(path.join(__dirname, 'public')));

// Override uv.config.js with your custom one
app.get('/uv/uv.config.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'uv.config.js'));
});
const epoxyPath = path.join(require.resolve('@mercuryworkshop/epoxy-transport'), '..');
const bareMuxPath = path.join(require.resolve('@mercuryworkshop/bare-mux'), '..');

app.use('/epoxy/', express.static(epoxyPath));
app.use('/baremux/', express.static(bareMuxPath));

// Serve UV files
app.use('/uv/', express.static(uvPath));

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 fallback
// Replace your current 404 fallback with this:
app.use((req, res) => {
    if (req.url.startsWith('/uv/service/')) {
        res.status(404).send('Not found');
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

const server = createServer((req, res) => {
    if (bareServer.shouldRoute(req)) {
        bareServer.routeRequest(req, res);
    } else {
        app(req, res);
    }
});

// Wisp
server.on('upgrade', (req, socket, head) => {
    console.log('Upgrade request:', req.url);
    if (req.url.startsWith('/wisp/')) {
        wisp.server.routeRequest(req, socket, head);
    } else {
        socket.destroy();
    }
});

server.listen(PORT, () => {
    console.log(`🚀 VANDAL is live at http://localhost:${PORT}`);
});