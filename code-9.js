import { json, bad, getSessionEmail, R, pushHistory, publicUser } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return bad(res, 'Méthode interdite.', 405);
  const email = await getSessionEmail(req);
  if (!email) return bad(res, 'Session invalide.', 401);

  const user = JSON.parse(await R('GET', `user:${email}`));
  const ratio = +(req.body?.ratio);
  if (!(ratio >= 0.1 && ratio <= 0.9)) return bad(res, 'Ratio invalide (10–90 %).');

  user.ratio = ratio;
  pushHistory(user, 'ratio', `Ratio de mise en réserve : ${Math.round(ratio * 100)} %`);
  await R('SET', `user:${email}`, JSON.stringify(user));

  json(res, 200, { user: publicUser(user) });
}
