import crypto from 'node:crypto';

/* ---------- Config ---------- */
const URL_ = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!URL_ || !TOKEN) throw new Error('Variables UPSTASH manquantes !');

export const SESSION_TTL = 60 * 60 * 24 * 7; // 7 jours

export const TIERS = {
  gratuit: { name: 'Gratuit', capacityMb: 1024, price: '0 €/mois' },
  plus:    { name: 'Plus',    capacityMb: 2048, price: '4,99 €/mois' },
  premium: { name: 'Premium', capacityMb: 10240, price: '9,99 €/mois' }
};

export const R = async (cmd, ...args) => {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify([cmd, ...args])
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
};
const get = k => R('GET', k).then(v => v ? JSON.parse(v) : null);
const set = (k, v) => R('SET', k, JSON.stringify(v));

/* ---------- Réponses HTTP ---------- */
export function json(res, status, data, cookies = []) {
  const headers = { 'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.status(status).json(data);
}
export const bad = (res, msg, status = 400) => json(res, status, { error: msg });

/* ---------- Sessions ---------- */
const hashPassword = (pw, salt) =>
  crypto.scryptSync(pw, salt, 64).toString('hex');

export async function createUser(email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail invalide.');
  if (typeof password !== 'string' || password.length < 6)
    throw new Error('Mot de passe trop court (6 caractères min.).');
  const key = `user:${email.toLowerCase()}`;
  if (await get(key)) throw new Error('Compte déjà existant.');
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    email: email.toLowerCase(),
    salt,
    hash: hashPassword(password, salt),
    stockMb: 0, tier: 'gratuit', ratio: 0.5, history: [], createdAt: Date.now()
  };
  await set(key, user);
  return user;
}

export async function verifyUser(email, password) {
  const u = await get(`user:${(email || '').toLowerCase()}`);
  if (!u) return null;
  const ok = crypto.timingSafeEqual(
    Buffer.from(u.hash, 'hex'),
    Buffer.from(hashPassword(password || '', u.salt), 'hex'));
  return ok ? u : null;
}

export async function createSession(email) {
  const token = crypto.randomBytes(32).toString('hex');
  await R('SET', `session:${token}`, email, 'EX', SESSION_TTL);
  return token;
}

export async function getSessionEmail(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)cb_session=([a-f0-9]+)/);
  if (!m) return null;
  return await R('GET', `session:${m[1]}`);
}

export async function destroySession(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)cb_session=([a-f0-9]+)/);
  if (m) await R('DEL', `session:${m[1]}`);
}

export const sessionCookie = (token, secure) =>
  `cb_session=token;Path=/;HttpOnly;SameSite=Lax;Max−Age={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=token;Path=/;HttpOnly;SameSite=Lax;Max−Age={SESSION_TTL}` +
  (secure ? '; Secure' : '');

export const clearCookie = 'cb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

/* ---------- Règles métier ---------- */
export function deposit(user, totalMb) {
  const cap = TIERS[user.tier].capacityMb;
  const space = cap - user.stockMb;
  const ratio = Math.min(0.9, Math.max(0.1, user.ratio ?? 0.5));
  const wanted = totalMb * ratio;
  const stored = Math.max(0, Math.min(wanted, space));
  const kept = totalMb - stored;
  user.stockMb = +(user.stockMb + stored).toFixed(3);
  return { stored, kept, total: totalMb, full: stored < wanted - 1e-9 };
}

export function withdraw(user, requestedMb) {
  const used = Math.max(0, Math.min(requestedMb, user.stockMb));
  user.stockMb = +(user.stockMb - used).toFixed(3);
  return { used, empty: user.stockMb <= 0 && requestedMb > 0 };
}

export function pushHistory(user, type, label, mb = 0) {
  user.history.unshift({ type, label, mb, at: new Date().toISOString() });
  if (user.history.length > 50) user.history.length = 50;
}

export const publicUser = u => ({
  email: u.email, stockMb: u.stockMb, tier: u.tier, ratio: u.ratio,
  tierName: TIERS[u.tier].name, capacityMb: TIERS[u.tier].capacityMb,
  history: u.history, tiers: Object.entries(TIERS).map(([key, t]) => ({ key, ...t }))
});
