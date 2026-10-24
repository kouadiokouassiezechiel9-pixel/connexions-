'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';
const ALLOW_FAKE_PAYMENT = process.env.ALLOW_FAKE_PAYMENT === '1';
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 100 * 1024; // S-07
const SESSION_TTL = 7 * 24 * 3600 * 1000; // RG-11
const HISTORY_MAX = 200, HISTORY_RETURN = 30; // RG-09
const TICK_LIMIT = 50; // RG-06

const TIERS = {
  free: { name: 'Gratuit', capacityMb: 500,   price: '0 €' },
  plus: { name: 'Plus',    capacityMb: 2048,  price: '2 € / mois' },
  pro:  { name: 'Pro',     capacityMb: 10240, price: '6 € / mois' },
  max:  { name: 'Max',     capacityMb: 51200, price: '15 € / mois' }
};

/* ---------- Stockage (R-01, R-02) ---------- */
let db = { users: {}, sessions: {}, sessionTimes: {} };

function loadDb() {
  try {
    if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    try {
      fs.renameSync(DATA_FILE, DATA_FILE + '.corrupt-' + Date.now());
    } catch (_) {}
    db = { users: {}, sessions: {}, sessionTimes: {} };
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error('Save error:', e.message); }
  }, 50);
}

/* ---------- Crypto (S-01) ---------- */
const scrypt = (pw, salt) =>
  crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32).toString('hex');

/* ---------- Utilitaires ---------- */
const round2 = n => Math.round(n * 100) / 100;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function publicUser(u) { // S-04 : aucune donnée sensible
  const t = TIERS[u.tier];
  return {
    email: u.email, tier: u.tier, tierName: t.name,
    capacityMb: t.capacityMb, stockMb: round2(u.stockMb), ratio: u.ratio,
    history: u.history.slice(-HISTORY_RETURN).reverse(),
    tiers: Object.entries(TIERS).map(([key, o]) => ({ key, ...o }))
  };
}

function pushHistory(u, type, label, mb) {
  const now = Date.now();
  const last = u.history[u.history.length - 1];
  // RG-08 : regroupement si < 60 s et même type
  if (last && last.type === type &&
      (now - new Date(last.at).getTime()) < 60000) {
    last.mb = round2(last.mb + mb);
    last.at = new Date(now).toISOString();
  } else {
    u.history.push({ at: new Date(now).toISOString(), type, label, mb: round2(mb) });
  }
  if (u.history.length > HISTORY_MAX) u.history = u.history.slice(-HISTORY_MAX);
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}

function readBody(req) {
  return new Promise(resolve => {
    let size = 0; const chunks = [];
    const done = v => { req.removeAllListeners('data'); req.removeAllListeners('end'); resolve(v); }; // R-05
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) return done(null);
      chunks.push(c);
    });
    req.on('end', () => {
      try { done(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch (_) { done(null); }
    });
    req.on('error', () => done(null));
  });
}

function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

/* ---------- Sessions ---------- */
function createSession(res, email) {
  const token = crypto.randomBytes(24).toString('hex'); // S-02
  db.sessions[token] = email;
  db.sessionTimes[token] = Date.now();
  save();
  const opts = ['HttpOnly', 'SameSite=Strict', 'Path=/',
    'Max-Age=' + (SESSION_TTL / 1000)];
  if (PROD) opts.push('Secure');
  res.setHeader('Set-Cookie', `token=token;{token};token;{opts.join('; ')}`);
}

/* ---------- Routes ---------- */
async function handleApi(req, res, pathname) {
  const cookies = parseCookies(req);
  const token = cookies.token;
  const email = token && db.sessions[token];
  const user = email && db.users[email];

  // Nettoyage des sessions expirées
  if (token && (!user || Date.now() - (db.sessionTimes[token] || 0) > SESSION_TTL)) {
    delete db.sessions[token]; delete db.sessionTimes[token]; save();
    return send(res, 401, { error: 'Session expirée.' });
  }

  const body = ['POST'].includes(req.method) ? await readBody(req) : null;
  if (req.method === 'POST' && body === null) return send(res, 400, { error: 'Requête invalide.' });

  /* --- Publiques --- */
  if (pathname === '/api/register' && req.method === 'POST') {
    let em = String(body.email || '').trim().toLowerCase(); // RG-01
    const pw = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return send(res, 400, { error: 'E-mail invalide.' });
    if (pw.length < 6) return send(res, 400, { error: 'Mot de passe : 6 caractères minimum.' }); // RG-02
    if (db.users[em]) return send(res, 409, { error: 'Compte déjà existant.' });
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[em] = {
      email: em, salt, hash: scrypt(pw, salt),
      tier: 'free', stockMb: 0, ratio: 0.5, history: [] // RG-03
    };
    createSession(res, em);
    return send(res, 200, { ok: true, user: publicUser(db.users[em]) });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    const em = String(body.email || '').trim().toLowerCase();
    const u = db.users[em];
    const expected = u && scrypt(String(body.password || ''), u.salt);
    if (!u || expected !== u.hash) return send(res, 401, { error: 'Identifiants incorrects.' });
    createSession(res, em);
    return send(res, 200, { ok: true, user: publicUser(u) });
  }

  /* --- Protégées (S-08) --- */
  if (!user) return send(res, 401, { error: 'Non authentifié.' });

  if (pathname === '/api/me' && req.method === 'GET')
    return send(res, 200, publicUser(user));

  if (pathname === '/api/logout' && req.method === 'POST') {
    delete db.sessions[token]; delete db.sessionTimes[token]; save();
    res.setHeader('Set-Cookie', 'token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/wifi/tick' && req.method === 'POST') { // RG-04
    const traffic = clamp(Number(body.mb) || 0, 0, TICK_LIMIT);
    const cap = TIERS[user.tier].capacityMb;
    const stored = round2(Math.min(traffic * user.ratio, Math.max(0, cap - user.stockMb)));
    const live = round2(traffic - stored);
    const before = user.stockMb;
    user.stockMb = round2(user.stockMb + stored);
    if (stored > 0) pushHistory(user, 'deposit', 'Dépôt Wi-Fi', stored);
    save();
    return send(res, 200, {
      ...publicUser(user),
      tick: { total: round2(traffic), stored, live, full: user.stockMb >= cap, deposited: round2(user.stockMb - before) }
    });
  }

  if (pathname === '/api/stock/use' && req.method === 'POST') { // RG-05
    const traffic = clamp(Number(body.mb) || 0, 0, TICK_LIMIT);
    if (user.stockMb <= 0) return send(res, 402, { error: 'Réserve vide.' });
    const used = round2(Math.min(traffic, user.stockMb));
    user.stockMb = round2(user.stockMb - used);
    pushHistory(user, 'withdraw', 'Utilisation mobile', used);
    save();
    return send(res, 200, { ...publicUser(user), tick: { used, empty: user.stockMb <= 0 } });
  }

  if (pathname === '/api/settings' && req.method === 'POST') { // RG-07
    const r = Number(body.ratio);
    if (!(r >= 0.1 && r <= 0.9)) return send(res, 400, { error: 'Ratio hors limites (10 % – 90 %).' });
    user.ratio = r;
    save();
    return send(res, 200, publicUser(user));
  }

  if (pathname === '/api/upgrade' && req.method === 'POST') { // RG-13
    if (PROD && !ALLOW_FAKE_PAYMENT) return send(res, 403, { error: 'Paiement réel requis (simulation bloquée).' });
    const t = body.tier;
    if (!TIERS[t]) return send(res, 400, { error: 'Offre inconnue.' });
    if (user.tier !== t) {
      user.tier = t; // RG-12 : réserve conservée même si > capacité
      pushHistory(user, 'upgrade', `Passage à l'offre ${TIERS[t].name}`, 0);
      save();
    }
    return send(res, 200, publicUser(user));
  }

  send(res, 404, { error: 'Route inconnue.' });
}

/* ---------- Fichiers statiques (S-06) ---------- */
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveStatic(res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  const full = path.normalize(path.join(PUBLIC_DIR, file));
    if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory())
    return send(res, 404, { error: 'Introuvable.' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  res.end(fs.readFileSync(full));
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  serveStatic(res, pathname);
});

loadDb();
server.listen(PORT, () => console.log(`Connexion Bank v0.1.0 → http://localhost:${PORT}`));
