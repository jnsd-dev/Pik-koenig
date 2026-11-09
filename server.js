// Pik-König – kleiner Spielserver ohne Anmeldung.
// Start: npm install && npm start   →   http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const Game = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const ICON = fs.readFileSync(path.join(__dirname, 'public', 'icon.svg'));
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9]{4,8}$/;
const PID_RE = /^[a-f0-9]{16,40}$/;
const HOST_GRACE_MS = 20000;       // so lange behält ein kurz getrennter Gastgeber seine Rolle
const ROOM_IDLE_MS = 6 * 3600e3;   // leere Räume werden nach 6 h gelöscht
const MAX_ROOMS = 2000;

const rooms = new Map();

function newCode() {
  let c;
  do c = Array.from(crypto.randomBytes(5), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  while (rooms.has(c));
  return c;
}

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    if (rooms.size >= MAX_ROOMS) return null;
    r = { code, st: Game.newState(), conns: new Set(), hostPid: null, hostTimer: null, touched: Date.now() };
    rooms.set(code, r);
  }
  return r;
}

function onlinePids(r) {
  const s = new Set();
  for (const ws of r.conns) s.add(ws.pid);
  return s;
}

function pickNewHost(r) {
  const on = onlinePids(r);
  const seated = r.st.players.find(p => on.has(p.pid));
  r.hostPid = seated ? seated.pid : (on.values().next().value || null);
}

function broadcast(r) {
  const online = onlinePids(r);
  const seated = new Set(r.st.players.map(p => p.pid));
  const watchers = [...online].filter(p => !seated.has(p)).length;
  for (const ws of r.conns) {
    if (ws.readyState !== 1) continue;
    const v = Game.view(r.st, ws.pid, {
      online,
      hostPid: r.hostPid,
      public: { code: r.code, isHost: ws.pid === r.hostPid, watchers },
    });
    ws.send(JSON.stringify(v));
  }
}

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (p === '/new') {
    res.writeHead(302, { Location: '/r/' + newCode(), 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (p === '/health') { res.writeHead(200); return res.end('ok'); }
  if (p === '/icon.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    return res.end(ICON);
  }
  if (p === '/qr.svg') {
    const target = String(url.searchParams.get('u') || '').slice(0, 300);
    if (!/^https?:\/\//.test(target)) { res.writeHead(400); return res.end(); }
    try {
      const svg = await QRCode.toString(target, { type: 'svg', margin: 1, color: { dark: '#1c1b20', light: '#fbf7ee' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
      return res.end(svg);
    } catch (e) { res.writeHead(500); return res.end(); }
  }
  if (p === '/' || /^\/r\/[A-Za-z0-9]{4,8}\/?$/.test(p)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(INDEX);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Nicht gefunden');
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.tokens = 60;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', buf => {
    if (ws.tokens <= 0) return; // einfache Bremse gegen Spam
    ws.tokens--;
    let m;
    try { m = JSON.parse(buf); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(ws, m); } catch (e) { console.error(e); }
  });
  ws.on('close', () => leaveRoom(ws));
});

function handle(ws, m) {
  if (m.t === 'hello') {
    const code = String(m.room || '').toUpperCase();
    const pid = String(m.pid || '');
    if (!CODE_RE.test(code) || !PID_RE.test(pid)) return ws.send(JSON.stringify({ t: 'error', msg: 'Ungültiger Raum' }));
    if (ws.room) leaveRoom(ws);
    const r = getRoom(code);
    if (!r) return ws.send(JSON.stringify({ t: 'error', msg: 'Server ist voll, bitte später nochmal' }));
    ws.room = r;
    ws.pid = pid;
    r.conns.add(ws);
    r.touched = Date.now();
    if (!r.hostPid) r.hostPid = pid;
    if (r.hostPid === pid && r.hostTimer) { clearTimeout(r.hostTimer); r.hostTimer = null; }
    return broadcast(r);
  }
  const r = ws.room;
  if (!r) return;
  r.touched = Date.now();
  const online = onlinePids(r);
  const changed = Game.apply(r.st, ws.pid, m, { isHost: ws.pid === r.hostPid, online });
  if (changed) broadcast(r);
}

function leaveRoom(ws) {
  const r = ws.room;
  if (!r) return;
  r.conns.delete(ws);
  ws.room = null;
  r.touched = Date.now();
  const stillThere = [...r.conns].some(c => c.pid === ws.pid);
  if (!stillThere && ws.pid === r.hostPid && !r.hostTimer) {
    r.hostTimer = setTimeout(() => {
      r.hostTimer = null;
      if (!onlinePids(r).has(r.hostPid)) { pickNewHost(r); broadcast(r); }
    }, HOST_GRACE_MS);
  }
  broadcast(r);
}

// tote Verbindungen erkennen
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 25000);

// Nachrichten-Budget auffüllen
setInterval(() => { for (const ws of wss.clients) ws.tokens = Math.min(60, ws.tokens + 20); }, 1000);

// leere Räume aufräumen
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (!r.conns.size && now - r.touched > ROOM_IDLE_MS) rooms.delete(code);
}, 10 * 60e3);

server.listen(PORT, () => console.log(`Pik-König läuft auf http://localhost:${PORT}`));
