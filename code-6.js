import { json, bad, getSessionEmail, R, publicUser } from './_lib.js';

export default async function handler(req, res) {
  const email = await getSessionEmail(req);
  if (!email) return bad(res, 'Session invalide.', 401);
  const user = JSON.parse(await R('GET', `user:${email}`));
  json(res, 200, { user: publicUser(user) });
}
