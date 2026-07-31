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
app.get('/suggestion', (req, res) => res.sendFile(path.join(__dirname, 'public', 'suggestion.html')));
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

// ---- Referral system ----
const REFERRAL_STAGES = 5; // each referral fills one stage (20% each)

function genReferralCode() {
    // short, unambiguous code (no confusing chars)
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    } while (users.some(u => u.referralCode === code));
    return code;
}

// Backfill missing referral fields for existing accounts (runs once at boot)
let _refBackfill = false;
users.forEach(u => {
    if (!u.referralCode) { u.referralCode = genReferralCode(); _refBackfill = true; }
    if (typeof u.referralCount !== 'number') { u.referralCount = 0; _refBackfill = true; }
    if (!('referredBy' in u)) { u.referredBy = null; _refBackfill = true; }
    if (!u.equippedTitle) { u.equippedTitle = null; _refBackfill = true; }
    if (!u.searchLine) { u.searchLine = ''; _refBackfill = true; }
});
if (_refBackfill) saveUsers();

// What each stage unlocks (kept in sync with the client)
const REFERRAL_REWARDS = [
    { stage: 1, id: 'refer_color',  label: 'Referral Color' },
    { stage: 2, id: 'refer_tag',    label: 'Exclusive Tag' },
    { stage: 3, id: 'refer_discord',label: 'Discord Role' },
    { stage: 4, id: 'refer_search', label: 'Custom Search Line' },
    { stage: 5, id: 'refer_title',  label: 'Glowing Title' }
];

app.post('/api/auth/signup', express.json(), async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: 'Username already taken' });
    if (users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);

    // optional referral code -> credit the code's OWNER (the referrer)
    let referrer = null;
    const rawCode = (req.body.referralCode || '').trim().toUpperCase();
    if (rawCode) {
        referrer = users.find(u => u.referralCode === rawCode);
        if (!referrer) return res.status(400).json({ error: 'Invalid referral code' });
    }

    const user = {
        id: Date.now().toString(),
        username,
        email,
        password: hashed,
        unlockedColors: [],
        timeSeconds: 0,
        usedColors: [],
        createdAt: Date.now(),
        verified: true,
        referralCode: genReferralCode(),
        referredBy: referrer ? referrer.referralCode : null,
        referralCount: 0,
        equippedTitle: null,
        searchLine: ''
    };
    users.push(user);

    // credit the referrer (cap at 5 stages), and auto-grant their referral color at stage 1
    if (referrer) {
        referrer.referralCount = Math.min(REFERRAL_STAGES, (referrer.referralCount || 0) + 1);
        if (referrer.referralCount >= 1) {
            referrer.unlockedColors = referrer.unlockedColors || [];
            if (!referrer.unlockedColors.includes('refer_color')) referrer.unlockedColors.push('refer_color');
        }
    }
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
        res.json({
            username: user.username,
            unlockedColors: user.unlockedColors || [],
            timeSeconds: user.timeSeconds || 0,
            usedColors: user.usedColors || [],
            referralCode: user.referralCode || null,
            referralCount: user.referralCount || 0,
            equippedTitle: user.equippedTitle || null,
            searchLine: user.searchLine || ''
        });
    } catch(e) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// --- REFERRAL API ---
// Progress + code for the logged-in user
app.get('/api/referral/me', (req, res) => {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    res.json({
        referralCode: user.referralCode,
        referralCount: user.referralCount || 0,
        stages: REFERRAL_STAGES,
        rewards: REFERRAL_REWARDS,
        equippedTitle: user.equippedTitle || null,
        searchLine: user.searchLine || ''
    });
});

// Equip / unequip a referral title (tag = stage 2, glow title = stage 5)
app.post('/api/referral/title', express.json(), (req, res) => {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    const which = req.body.title; // 'tag' | 'glow' | null
    const count = user.referralCount || 0;
    if (which === null || which === '') {
        user.equippedTitle = null;
    } else if (which === 'tag') {
        if (count < 2) return res.status(403).json({ error: 'Not unlocked' });
        user.equippedTitle = 'tag';
    } else if (which === 'glow') {
        if (count < 5) return res.status(403).json({ error: 'Not unlocked' });
        user.equippedTitle = 'glow';
    } else {
        return res.status(400).json({ error: 'Invalid title' });
    }
    saveUsers();
    res.json({ equippedTitle: user.equippedTitle });
});

// Set the custom search-bar line (stage 4)
app.post('/api/referral/searchline', express.json(), (req, res) => {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    if ((user.referralCount || 0) < 4) return res.status(403).json({ error: 'Not unlocked' });
    user.searchLine = String(req.body.line || '').slice(0, 60);
    saveUsers();
    res.json({ searchLine: user.searchLine });
});

// Public: look up a user's equipped title by username (chat uses this to render tags)
app.get('/api/referral/title-of', (req, res) => {
    const uname = (req.query.username || '').toLowerCase();
    const u = users.find(x => x.username.toLowerCase() === uname);
    if (!u) return res.json({ equippedTitle: null });
    res.json({ equippedTitle: u.equippedTitle || null, referralCount: u.referralCount || 0 });
});

// --- LEADERBOARD API ---
const EXCLUSIVE_COLORS = [
    { id: 'neon_pink',  label: 'Neon Pink',  gradient: ['#ff6ec7', '#ff2e73'] },
    { id: 'ocean_blue', label: 'Ocean Blue', gradient: ['#00f2ff', '#0070ff'] },
    { id: 'gold_rush',  label: 'Gold Rush',  gradient: ['#ffd700', '#ff8c00'] },
    { id: 'galaxy',     label: 'Galaxy',     gradient: ['#a78bfa', '#ec4899', '#f43f5e'] },
    { id: 'rainbow',    label: 'Rainbow',    gradient: ['#ff0000', '#ff8c00', '#ffff00', '#00ff00', '#00f2ff', '#7000ff', '#ff69b4'] },
    { id: 'sharks',     label: 'Shark Blue', gradient: ['#0d0d2b', '#008080', '#40e0d0', '#8b0000'] },
    { id: 'royalty',    label: 'Royalty',    gradient: ['#8b0000', '#ffd700', '#7000ff'] },
    { id: 'void_star',  label: 'Void',       gradient: ['#050308', '#6a3fd0', '#e8d8ff', '#1a0f2e'] }
];

app.get('/api/stats/leaderboard', (req, res) => {
    const timeLeaderboard = users
        .filter(u => (u.timeSeconds || 0) > 0)
        .sort((a, b) => (b.timeSeconds || 0) - (a.timeSeconds || 0))
        .slice(0, 25)
        .map(u => ({ username: u.username, timeSeconds: u.timeSeconds || 0 }));

    const colorsLeaderboard = users
        .filter(u => (u.unlockedColors || []).length > 0)
        .sort((a, b) => (b.unlockedColors || []).length - (a.unlockedColors || []).length)
        .slice(0, 25)
        .map(u => ({ username: u.username, count: (u.unlockedColors || []).length }));

    const colorOwners = EXCLUSIVE_COLORS.map(c => ({
        id: c.id,
        label: c.label,
        gradient: c.gradient,
        owners: users.filter(u => (u.unlockedColors || []).includes(c.id)).map(u => u.username)
    }));

    // referral progress leaderboard + who has unlocked stages 3 (discord) & 4 (search line)
    const referralLeaderboard = users
        .filter(u => (u.referralCount || 0) > 0)
        .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0))
        .slice(0, 25)
        .map(u => ({
            username: u.username,
            count: u.referralCount || 0,
            discord: (u.referralCount || 0) >= 3,
            searchLine: (u.referralCount || 0) >= 4 ? (u.searchLine || '') : ''
        }));

    res.json({ timeLeaderboard, colorsLeaderboard, colorOwners, referralLeaderboard, totalUsers: users.length });
});

// ---- Suggestions ----
const SUGGESTIONS_FILE = path.join(__dirname, 'suggestions.json');

function loadSuggestions() {
    try { return JSON.parse(fs.readFileSync(SUGGESTIONS_FILE, 'utf8')); }
    catch { return []; }
}
function saveSuggestions(list) {
    fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(list, null, 2));
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

// Turn the votes map into counts the client can render
function tallyVotes(s) {
    const votes = s.votes || {};
    let likes = 0, dislikes = 0;
    for (const k in votes) {
        if (votes[k] === 'like') likes++;
        else if (votes[k] === 'dislike') dislikes++;
    }
    return { likes, dislikes };
}

// Shape a suggestion for the client, including this user's own vote
function publicSuggestion(s, username) {
    const { likes, dislikes } = tallyVotes(s);
    return {
        id: s.id,
        title: s.title,
        description: s.description,
        creator: s.creator,
        createdAt: s.createdAt,
        likes,
        dislikes,
        score: likes - dislikes,
        myVote: (username && s.votes) ? (s.votes[username] || null) : null,
        messageCount: (s.messages || []).length
    };
}

app.get('/api/suggestions', (req, res) => {
    const user = getUserFromToken(req);
    const list = loadSuggestions();
    res.json(list.map(s => publicSuggestion(s, user ? user.username : null)));
});

app.post('/api/suggestions', express.json(), (req, res) => {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Login required' });

    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Missing title' });

    const list = loadSuggestions();

    // one suggestion per user per 24h
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = list.find(s => s.creator === user.username && s.createdAt > dayAgo);
    if (recent) return res.status(429).json({ error: 'You can only post one suggestion per day' });

    const suggestion = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: String(title).slice(0, 100),
        description: String(description || '').slice(0, 1000),
        creator: user.username,
        createdAt: Date.now(),
        votes: {},
        messages: []
    };
    list.push(suggestion);
    saveSuggestions(list);
    res.json(publicSuggestion(suggestion, user.username));
});

app.delete('/api/suggestions/:id', (req, res) => {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    if (user.username !== 'lockiney') return res.status(403).json({ error: 'Not authorized' });

    const list = loadSuggestions();
    const filtered = list.filter(s => s.id !== req.params.id);
    saveSuggestions(filtered);
    res.json({ success: true });
});

// Vote on a suggestion: like / dislike / undo (send same vote again to remove it)
app.post('/api/suggestions/:id/vote', express.json(), (req, res) => {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Login required' });

    const vote = req.body.vote;
    if (vote !== 'like' && vote !== 'dislike') return res.status(400).json({ error: 'Invalid vote' });

    const list = loadSuggestions();
    const s = list.find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });

    s.votes = s.votes || {};
    if (s.votes[user.username] === vote) {
        delete s.votes[user.username];      // clicking the same vote undoes it
    } else {
        s.votes[user.username] = vote;      // new vote, or switch sides
    }
    saveSuggestions(list);
    res.json(publicSuggestion(s, user.username));
});

// Get messages for a suggestion
app.get('/api/suggestions/:id/messages', (req, res) => {
    const list = loadSuggestions();
    const s = list.find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    res.json({
        messages: s.messages || [],
        title: s.title,
        creator: s.creator
    });
});

// Post a message to a suggestion (login required)
app.post('/api/suggestions/:id/messages', express.json(), (req, res) => {
    const user = getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Login required' });

    const list = loadSuggestions();
    const s = list.find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });

    const text = String(req.body.text || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: 'Empty message' });

    s.messages = s.messages || [];
    s.messages.push({ user: user.username, text, at: Date.now() });
    saveSuggestions(list);
    res.json({ success: true });
});

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

// Only allow wisp connections coming from our own domains.
// Stops strangers from routing their traffic through the droplet (bandwidth + IP reputation).
const ALLOWED_WISP_ORIGINS = [
    'https://vandal.mooo.com',
    'https://vandal.chickenkiller.com',
    'https://school.sucks.so.i.helped.making.it.better.speedinsure.hk'
];

server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/wisp/')) {
        const origin = req.headers.origin;
        const host = req.headers.host || '';
        const hostAllowed = host.startsWith('vandal.mooo.com')
            || host.startsWith('vandal.chickenkiller.com')
            || host.startsWith('school.sucks.so.i.helped.making.it.better.speedinsure.hk');
        const originAllowed = origin && ALLOWED_WISP_ORIGINS.includes(origin);
        if (originAllowed || (!origin && hostAllowed)) {
            wisp.server.routeRequest(req, socket, head);
        } else {
            socket.destroy();
        }
    } else {
        socket.end();
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VANDAL is live at http://0.0.0.0:${PORT}`);
});
