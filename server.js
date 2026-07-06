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
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 8080;
const JWT_SECRET = 'vandal_secret_key_change_this';

const bareServer = createBareServer('/bare/', {
    logErrors: false,
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

// --- STATIC FILES ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/uv/uv.config.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'uv.config.js')));

const epoxyPath = path.join(require.resolve('@mercuryworkshop/epoxy-transport'), '../..');
const bareMuxPath = path.join(require.resolve('@mercuryworkshop/bare-mux'), '..');
const libcurlPath = path.join(require.resolve('@mercuryworkshop/libcurl-transport'), '../..');
app.use('/epoxy/', express.static(epoxyPath));
app.use('/libcurl/', express.static(libcurlPath));
app.use('/baremux/', express.static(bareMuxPath));
app.use('/uv/', express.static(uvPath));

// --- PAGE ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/games', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/music', (req, res) => res.sendFile(path.join(__dirname, 'public', 'music.html')));
app.get('/movies', (req, res) => res.sendFile(path.join(__dirname, 'public', 'movies.html')));
app.get('/giveaway', (req, res) => res.sendFile(path.join(__dirname, 'public', 'giveaway.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));

// --- CHAT API ---
let chatMessages = [];
const MAX_MESSAGES = 100;

app.get('/api/chat/messages', (req, res) => {
    res.json(chatMessages);
});

app.post('/api/chat/send', express.json({ limit: '2mb' }), (req, res) => {
    const { username, message } = req.body;
    if (!username) return res.status(400).json({ error: 'Missing username' });
    if (username.length > 20) return res.status(400).json({ error: 'Username too long' });
    if (message && message.length > 500) return res.status(400).json({ error: 'Message too long' });
    const msg = {
    id: Date.now(),
    username: username.trim(),
    message: message ? message.trim() : '',
    image: req.body.image || null,
    replyTo: req.body.replyTo || null, // { id, username, message }
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
};
chatMessages.push(msg);
    if (chatMessages.length > MAX_MESSAGES) chatMessages.shift();
    if (msg.replyTo && msg.replyTo.username) {
        chatNotifications[msg.replyTo.username] = (chatNotifications[msg.replyTo.username] || 0) + 1;
    }
    res.json(msg);
});

let chatNotifications = {};

app.get('/api/chat/notifications', (req, res) => {
    const username = req.query.username;
    res.json({ count: chatNotifications[username] || 0 });
});

app.post('/api/chat/notifications/clear', express.json(), (req, res) => {
    const { username } = req.body;
    chatNotifications[username] = 0;
    res.json({ success: true });
});

// --- STATS API ---
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

// --- AUTH API ---
const usersFile = path.join(__dirname, 'users.json');
let users = [];
try { users = JSON.parse(fs.readFileSync(usersFile)); } catch(e) { users = []; }

function saveUsers() {
    fs.writeFileSync(usersFile, JSON.stringify(users));
}

app.post('/api/auth/signup', express.json(), async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: 'Username already taken' });
    if (users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const user = {
        id: Date.now().toString(),
        username,
        email,
        password: hashed,
        unlockedColors: [],
        timeSeconds: 0,
        usedColors: [],
        createdAt: Date.now(),
        verified: true
    };
    users.push(user);
    saveUsers();
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, message: 'Account created!' });
});

app.post('/api/auth/login', express.json(), async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    const user = users.find(u =>
        u.username.toLowerCase() === username.toLowerCase() ||
        (u.email && u.email.toLowerCase() === username.toLowerCase())
    );
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid username or password' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, unlockedColors: user.unlockedColors || [], timeSeconds: user.timeSeconds || 0, usedColors: user.usedColors || [] });
});

app.post('/api/auth/sync', express.json(), (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Not logged in' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = users.find(u => u.id === decoded.id);
        if (!user) return res.status(401).json({ error: 'User not found' });
        const { unlockedColors, timeSeconds, usedColors } = req.body;
        if (unlockedColors) user.unlockedColors = unlockedColors;
        if (timeSeconds) user.timeSeconds = Math.max(user.timeSeconds || 0, timeSeconds);
        if (usedColors) user.usedColors = usedColors;
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
        res.json({ username: user.username, unlockedColors: user.unlockedColors || [], timeSeconds: user.timeSeconds || 0, usedColors: user.usedColors || [] });
    } catch(e) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// ---- Giveaways ----
const GIVEAWAYS_FILE = path.join(__dirname, 'giveaways.json');

function loadGiveaways() {
    try { return JSON.parse(fs.readFileSync(GIVEAWAYS_FILE, 'utf8')); }
    catch { return []; }
}
function saveGiveaways(list) {
    fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify(list, null, 2));
}
function getUserFromToken(req) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return users.find(u => u.id === decoded.id) || null;
    } catch {
        return null;
    }
}

// Pick winners from unique participants (one entry per account)
function drawWinners(g) {
    const participants = [...new Set((g.messages || []).map(m => m.user))];
    for (let i = participants.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [participants[i], participants[j]] = [participants[j], participants[i]];
    }
    const n = Math.min(g.winnersCount || 1, participants.length);
    g.winners = participants.slice(0, n);
    g.drawn = true;
}

// Draw any ended-but-undrawn giveaways; returns true if anything changed
function processEnded(list) {
    const now = Date.now();
    let changed = false;
    list.forEach(g => {
        if (g.endsAt <= now && !g.drawn) {
            drawWinners(g);
            changed = true;
        }
    });
    return changed;
}

app.get('/api/giveaways', (req, res) => {
    const list = loadGiveaways();
    if (processEnded(list)) saveGiveaways(list);
    res.json(list);
});

app.post('/api/giveaways', express.json(), (req, res) => {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Login required' });

    const { name, prize, hours, description, winnersCount } = req.body;
    if (!name || !prize || !hours) return res.status(400).json({ error: 'Missing fields' });

    const list = loadGiveaways();

    // one giveaway per user per 24h
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = list.find(g => g.creator === user.username && g.createdAt > dayAgo);
    if (recent) return res.status(429).json({ error: 'You can only create one giveaway per day' });

    const h = Math.max(0.1, Math.min(parseFloat(hours), 720)); // cap at 30 days
    const wc = Math.max(1, Math.min(parseInt(winnersCount) || 1, 50));
    const giveaway = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name: String(name).slice(0, 80),
        prize: String(prize).slice(0, 120),
        description: String(description || '').slice(0, 1000),
        winnersCount: wc,
        creator: user.username,
        createdAt: Date.now(),
        endsAt: Date.now() + h * 60 * 60 * 1000,
        messages: [],
        winners: [],
        drawn: false
    };
    list.push(giveaway);
    saveGiveaways(list);
    res.json(giveaway);
});

app.delete('/api/giveaways/:id', (req, res) => {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    if (user.username !== 'lockiney') return res.status(403).json({ error: 'Not authorized' });

    const list = loadGiveaways();
    const filtered = list.filter(g => g.id !== req.params.id);
    saveGiveaways(filtered);
    res.json({ success: true });
});

// Get messages for a giveaway
app.get('/api/giveaways/:id/messages', (req, res) => {
    const list = loadGiveaways();
    if (processEnded(list)) saveGiveaways(list);
    const g = list.find(x => x.id === req.params.id);
    if (!g) return res.status(404).json({ error: 'Not found' });
    res.json({
        messages: g.messages || [],
        ended: g.endsAt <= Date.now(),
        drawn: !!g.drawn,
        winners: g.winners || [],
        name: g.name,
        prize: g.prize,
        winnersCount: g.winnersCount || 1
    });
});

// Post a message to a giveaway (login required, no posting after it ends)
app.post('/api/giveaways/:id/messages', express.json(), (req, res) => {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Login required' });

    const list = loadGiveaways();
    const g = list.find(x => x.id === req.params.id);
    if (!g) return res.status(404).json({ error: 'Not found' });
    if (g.endsAt <= Date.now()) return res.status(403).json({ error: 'Giveaway has ended' });

    const text = String(req.body.text || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: 'Empty message' });

    g.messages = g.messages || [];
    g.messages.push({ user: user.username, text, at: Date.now() });
    saveGiveaways(list);
    res.json({ success: true });
});

// Safety net: draw winners every 60s even if nobody opens the page
setInterval(() => {
    const list = loadGiveaways();
    if (processEnded(list)) saveGiveaways(list);
}, 60000);

// --- 404 FALLBACK ---
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- SERVER ---
const server = createServer((req, res) => {
    res.on('error', (err) => {
        console.error('Connection closed by client:', err.message);
    });
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
