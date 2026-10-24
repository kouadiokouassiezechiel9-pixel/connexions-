import { json, bad, getSessionEmail, R, deposit, pushHistory, publicUser } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return bad(res, 'Méthode interdite.', 405);
  const email = await getSessionEmail(req);
  if (!email) return bad(res, 'Session invalide.', 401);

  const user = JSON.parse(await R('GET', `user:${email}`));
  const mb = Math.min(50, Math.max(0.1, +(req.body?.mb) || 0));
  if (!mb) return bad(res, 'Quantité invalide.');

  const tick = deposit(user, mb);
  pushHistory(user, 'deposit',
    `Dépôt Wi-Fi (${tick.stored.toFixed(2)} Mo stockés)`, tick.stored);
  await R('SET', `user:${email}`, JSON.stringify(user));

  json(res, 200, { tick, user: publicUser(user) });
}
