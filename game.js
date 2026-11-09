// Spiellogik für Pik-König. Läuft nur auf dem Server; Clients sehen nur ihre eigene Hand.
const crypto = require('crypto');

const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RLABEL = { J: 'B', Q: 'D', K: 'K', A: 'A' };
const MAX_PLAYERS = 6;

const rankOf = c => c.slice(0, -1);
const suitOf = c => c.slice(-1);
const label = c => (RLABEL[rankOf(c)] || rankOf(c)) + SUITS[suitOf(c)];
const randInt = n => crypto.randomInt(n);
const newId = () => crypto.randomBytes(4).toString('hex');

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cleanName(s) {
  return String(s || '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .trim()
    .slice(0, 16);
}

function newState() {
  return { phase: 'lobby', round: 0, players: [], ack: {}, pile: [], turn: -1, finish: [], loser: null, lastDraw: null, log: [], k: 0 };
}

// Deck: normales 52er-Deck ohne Herz-, Karo- und Kreuz-König = 49 Karten.
function buildDeck() {
  const deck = [];
  for (const s of 'SHDC') for (const r of RANKS) {
    if (r === 'K' && s !== 'S') continue;
    deck.push(r + s);
  }
  return deck;
}

function addLog(st, m) {
  st.log.push(m);
  st.log = st.log.slice(-6);
}

function nextWith(st, i) {
  const n = st.players.length;
  for (let k = 1; k < n; k++) {
    const j = (i + k) % n;
    if (st.players[j].hand.length) return j;
  }
  return -1;
}

function deal(st) {
  const deck = shuffle(buildDeck());
  const n = st.players.length;
  const off = randInt(n); // wer die Extra-Karten bekommt, ist zufällig
  st.players.forEach(p => { p.hand = []; p.ready = false; });
  deck.forEach((c, i) => st.players[(off + i) % n].hand.push(c));
  Object.assign(st, { pile: [], finish: [], loser: null, lastDraw: null, turn: -1, phase: 'discard', round: st.round + 1 });
  addLog(st, `Runde ${st.round}: ${deck.length} Karten verteilt`);
}

function checkEnd(st) {
  const w = st.players.map((p, i) => (p.hand.length ? i : -1)).filter(i => i >= 0);
  if (w.length > 1) return false;
  st.phase = 'end';
  st.turn = -1;
  st.loser = w.length ? st.players[w[0]].sid : null;
  if (w.length) addLog(st, `${st.players[w[0]].name} bleibt auf dem Pik-König sitzen`);
  return true;
}

function maybeStartPlay(st) {
  if (!st.players.every(p => p.ready || !p.hand.length)) return;
  st.phase = 'play';
  if (checkEnd(st)) return;
  const w = st.players.map((p, i) => (p.hand.length ? i : -1)).filter(i => i >= 0);
  st.turn = w[randInt(w.length)];
  addLog(st, `${st.players[st.turn].name} beginnt`);
}

function markOut(st, P) {
  if (!P.hand.length && !st.finish.includes(P.sid)) {
    st.finish.push(P.sid);
    addLog(st, `${P.name} hat keine Karten mehr`);
  }
}

function afterHand(st, i) {
  markOut(st, st.players[i]);
  if (st.phase === 'discard') maybeStartPlay(st);
  else if (st.phase === 'play' && !checkEnd(st) && !st.players[st.turn].hand.length) st.turn = nextWith(st, st.turn);
}

function doDraw(st, i, k) {
  const t = nextWith(st, i);
  if (t < 0) { checkEnd(st); return; }
  const P = st.players[i];
  const T = st.players[t];
  const j = Number.isInteger(k) && k >= 0 ? Math.min(k, T.hand.length - 1) : randInt(T.hand.length);
  const c = T.hand.splice(j, 1)[0];
  P.hand.push(c);
  st.lastDraw = { by: P.sid, from: T.sid, card: c, k: Date.now() };
  addLog(st, `${P.name} zieht bei ${T.name}`);
  markOut(st, T);
  if (checkEnd(st)) return;
  st.turn = nextWith(st, i);
}

function toLobby(st) {
  st.players.forEach(p => { p.hand = []; p.ready = false; });
  Object.assign(st, { phase: 'lobby', pile: [], finish: [], loser: null, lastDraw: null, turn: -1 });
  addLog(st, 'Zurück am Tisch');
}

// Wendet eine Aktion an. ctx = { isHost, online: Set<pid> }. Gibt true zurück, wenn sich etwas geändert hat.
function apply(st, pid, m, ctx) {
  const idx = st.players.findIndex(p => p.pid === pid);
  const P = idx >= 0 ? st.players[idx] : null;
  const before = JSON.stringify(st);
  switch (m.t) {
    case 'join': {
      const nm = cleanName(m.name);
      if (!nm) break;
      if (P) { P.name = nm; break; }
      if (st.phase !== 'lobby' || st.players.length >= MAX_PLAYERS) break;
      st.players.push({ sid: newId(), pid, name: nm, hand: [], ready: false });
      addLog(st, `${nm} hat sich hingesetzt`);
      break;
    }
    case 'leave':
      if (P && st.phase === 'lobby') { st.players.splice(idx, 1); addLog(st, `${P.name} ist aufgestanden`); }
      break;
    case 'claim': {
      if (P) break;
      const j = st.players.findIndex(p => p.sid === m.sid);
      if (j < 0 || ctx.online.has(st.players[j].pid)) break;
      st.players[j].pid = pid;
      addLog(st, `${st.players[j].name} ist wieder da`);
      break;
    }
    case 'kick': {
      if (!ctx.isHost || st.phase !== 'lobby') break;
      const j = st.players.findIndex(p => p.sid === m.sid);
      if (j >= 0) { addLog(st, `${st.players[j].name} wurde vom Tisch genommen`); st.players.splice(j, 1); }
      break;
    }
    case 'start':
      if (ctx.isHost && st.phase === 'lobby' && st.players.length >= 2) deal(st);
      break;
    case 'again':
      if (ctx.isHost && st.phase === 'end') deal(st);
      break;
    case 'tolobby':
      if (ctx.isHost && st.phase !== 'lobby') toLobby(st);
      break;
    case 'ready':
      if (P && st.phase === 'discard') { P.ready = !!m.on; maybeStartPlay(st); }
      break;
    case 'pair': {
      if (!P || (st.phase !== 'discard' && st.phase !== 'play')) break;
      const x = m.a, y = m.b;
      if (typeof x !== 'string' || typeof y !== 'string' || x === y) break;
      if (!P.hand.includes(x) || !P.hand.includes(y) || rankOf(x) !== rankOf(y)) break;
      P.hand = P.hand.filter(c => c !== x && c !== y);
      st.pile.push(x, y);
      addLog(st, `${P.name} legt ${label(x)} + ${label(y)} ab`);
      afterHand(st, idx);
      break;
    }
    case 'order': {
      if (!P || !Array.isArray(m.o)) break;
      const have = new Set(P.hand), seen = new Set(), o = [];
      for (const c of m.o) if (have.has(c) && !seen.has(c)) { o.push(c); seen.add(c); }
      for (const c of P.hand) if (!seen.has(c)) o.push(c);
      P.hand = o;
      break;
    }
    case 'draw':
      if (P && st.phase === 'play' && idx === st.turn) doDraw(st, idx, m.i);
      break;
    case 'force':
      if (ctx.isHost && st.phase === 'play' && st.turn >= 0 && !ctx.online.has(st.players[st.turn].pid)) doDraw(st, st.turn, -1);
      break;
  }
  if (typeof m.n === 'number' && m.n > (st.ack[pid] || 0)) st.ack[pid] = m.n;
  const changed = JSON.stringify(st) !== before;
  if (changed) st.k++;
  return changed;
}

// Was ein bestimmter Spieler sehen darf.
function view(st, pid, extra) {
  const meIdx = st.players.findIndex(p => p.pid === pid);
  const mine = meIdx >= 0 ? st.players[meIdx] : null;
  let lastDraw = null;
  if (st.lastDraw) {
    const ld = st.lastDraw;
    const involved = mine && (ld.by === mine.sid || ld.from === mine.sid);
    lastDraw = { by: ld.by, from: ld.from, k: ld.k, card: involved ? ld.card : null };
  }
  return {
    t: 'state',
    k: st.k,
    phase: st.phase,
    round: st.round,
    you: mine ? mine.sid : null,
    ack: st.ack[pid] || 0,
    players: st.players.map(p => ({ sid: p.sid, name: p.name, count: p.hand.length, ready: p.ready, online: extra.online.has(p.pid), host: p.pid === extra.hostPid })),
    hand: mine ? mine.hand : [],
    turn: st.turn,
    pairs: st.pile.length / 2,
    top: st.pile.slice(-2),
    finish: st.finish,
    loser: st.loser,
    lastDraw,
    log: st.log,
    ...extra.public,
  };
}

module.exports = { newState, apply, view, buildDeck, rankOf, MAX_PLAYERS };
