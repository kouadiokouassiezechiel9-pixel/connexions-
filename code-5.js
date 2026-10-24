import { json, bad, createUser, verifyUser, createSession,
         sessionCookie, destroySession, clearCookie, publicUser,
         getSessionEmail } from './_lib.js';

const secure = process.env.NODE_ENV === 'production';

export default async function handler(req, res) {
  const action = req.query.action; // register | login | logout

  if (action === 'logout' && req.method === 'POST') {
    await destroySession(req);
    return json(res, 200, { ok: true }, [clearCookie]);
  }

  if (req.method !== 'POST') return bad(res, 'Méthode interdite.', 405);
  const { email, password } = req.body || {};

  try {
    if (action === 'register') {
      const user = await createUser(email, password);
      const token = await createSession(user.email);
      return json(res, 200, { user: publicUser(user) },
        [sessionCookie(token, secure)]);
    }
    if (action === 'login') {
      const user = await verifyUser(email, password);
      if (!user) return bad(res, 'Identifiants incorrects.', 401);
      const token = await createSession(user.email);
      return json(res, 200, { user: publicUser(user) },
        [sessionCookie(token, secure)]);
    }
    bad(res, 'Action inconnue.', 404);
  } catch (e) { bad(res, e.message); }
}

export { getSessionEmail };
