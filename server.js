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

const epoxyPath = path.join(require.resolve('@mercuryworkshop/epoxy-transport'), '../..');
const bareMuxPath = path.join(require.resolve('@mercuryworkshop/bare-mux'), '..');
app.use('/epoxy/', express.static(epoxyPath));
app.use('/baremux/', express.static(bareMuxPath));
app.use('/uv/', express.static(uvPath));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get("/games", (req, res) => res.sendFile(path.join(__dirname, "public", "games.html")));
app.get("/music", (req, res) => res.sendFile(path.join(__dirname, "public", "music.html")));
app.get("/movies", (req, res) => res.sendFile(path.join(__dirname, "public", "movies.html")));
app.get("/chat", (req, res) => res.sendFile(path.join(__dirname, "public", "chat.html")));
app.get("/settings", (req, res) => res.sendFile(path.join(__dirname, "public", "settings.html")));

// Chat API
let chatMessages = [];
const MAX_MESSAGES = 100;

app.get('/api/chat/messages', (req, res) => {
    res.json(chatMessages);
});

app.post('/api/chat/send', express.json(), (req, res) => {
    const { username, message } = req.body;
    if (!username || !message) return res.status(400).json({ error: 'Missing fields' });
    if (username.length > 20 || message.length > 500) return res.status(400).json({ error: 'Too long' });
    const msg = {
        id: Date.now(),
        username: username.trim(),
        message: message.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    chatMessages.push(msg);
    if (chatMessages.length > MAX_MESSAGES) chatMessages.shift();
    res.json(msg);
});

// Stats
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = 'vandal_secret_key_change_this';
const usersFile = path.join(__dirname, 'users.json');
let users = [];
try { users = JSON.parse(fs.readFileSync(usersFile)); } catch(e) { users = []; }

function saveUsers() {
    fs.writeFileSync(usersFile, JSON.stringify(users));
}

// Auth routes
app.post('/api/auth/signup', express.json(), async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: 'Username already taken' });
    const hashed = await bcrypt.hash(password, 10);
    const user = { id: Date.now().toString(), username, password: hashed, unlockedColors: [], timeSeconds: 0, createdAt: Date.now() };
    users.push(user);
    saveUsers();
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username });
});

app.post('/api/auth/login', express.json(), async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid username or password' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, unlockedColors: user.unlockedColors || [], timeSeconds: user.timeSeconds || 0 });
});

app.post('/api/auth/sync', express.json(), (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Not logged in' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = users.find(u => u.id === decoded.id);
        if (!user) return res.status(401).json({ error: 'User not found' });
        const { unlockedColors, timeSeconds } = req.body;
        if (unlockedColors) user.unlockedColors = unlockedColors;
        if (timeSeconds) user.timeSeconds = Math.max(user.timeSeconds || 0, timeSeconds);
        saveUsers();
        res.json({ success: true, unlockedColors: user.unlockedColors, timeSeconds: user.timeSeconds });
    } catch(e) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

app.get('/api/auth/me', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Not logged in' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = users.find(u => u.id === decoded.id);
        if (!user) return res.status(401).json({ error: 'User not found' });
        res.json({ username: user.username, unlockedColors: user.unlockedColors || [], timeSeconds: user.timeSeconds || 0 });
    } catch(e) {
        res.status(401).json({ error: 'Invalid token' });
    }
});
const statsFile = path.join(__dirname, 'stats.json');
let stats = { visits: 0 };
try { stats = JSON.parse(fs.readFileSync(statsFile)); } catch(e) {}
let onlineUsers = 0;

app.get('/api/stats/visit', (req, res) => {
    stats.visits++;
    fs.writeFileSync(statsFile, JSON.stringify(stats));
    res.json({ visits: stats.visits });
});

app.get('/api/stats/online', (req, res) => {
    onlineUsers++;
    setTimeout(() => { onlineUsers = Math.max(0, onlineUsers - 1); }, 60000);
    res.json({ online: onlineUsers });
});

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
