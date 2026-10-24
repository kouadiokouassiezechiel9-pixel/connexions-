import { json, bad, getSessionEmail, R, withdraw, pushHistory, publicUser } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return bad(res, 'Méthode interdite.', 405);
  const email = await getSessionEmail(req);
  if (!email) return bad(res, 'Session invalide.', 401);

  const user = JSON.parse(await R('GET', `user:${email}`));
  const mb = Math.min(50, Math.max(0.1, +(req.body?.mb) || 0));
  if (user.stockMb <= 0) return bad(res, 'Réserve vide.', 400);

  const tick = withdraw(user, mb);
  pushHistory(user, 'withdraw', `Retrait mobile`, tick.used);
  await R('SET', `user:${email}`, JSON.stringify(user));

  json(res, 200, { tick, user: publicUser(user) });
}
