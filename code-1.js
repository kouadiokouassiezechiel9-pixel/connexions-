import { json, bad, getSessionEmail, R, TIERS, pushHistory, publicUser } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return bad(res, 'Méthode interdite.', 405);
  const email = await getSessionEmail(req);
  if (!email) return bad(res, 'Session invalide.', 401);

  const user = JSON.parse(await R('GET', `user:${email}`));
  const tier = req.body?.tier;
  if (!TIERS[tier]) return bad(res, 'Offre inconnue.', 400);

  // RG-13 : en production, seul un vrai paiement est accepté.
  const prod = process.env.NODE_ENV === 'production';
  const fakeAllowed = process.env.ALLOW_FAKE_PAYMENT === '1';
  if (prod && !fakeAllowed)
    return bad(res, 'Paiement réel requis (RG-13). Simulation désactivée.', 402);

  user.tier = tier;
  pushHistory(user, 'upgrade', `Abonnement ${TIERS[tier].name} activé`);
  await R('SET', `user:${email}`, JSON.stringify(user));

  json(res, 200, { user: publicUser(user) });
}
