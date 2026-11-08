import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { createApp } from './app.js';
import { createDb } from './db.js';

const { SUPABASE_URL, SUPABASE_ANON_KEY, PORT = 3000, NODE_ENV } = process.env;

try {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Mancano SUPABASE_URL e SUPABASE_ANON_KEY: copia .env.example in .env e compilalo.');
  const db = createDb();

  // Un client Supabase Auth per richiesta, con la sessione in cookie httpOnly: il browser non parla mai con Supabase.
  const supabaseFor = (req, res) => createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: NODE_ENV === 'production' },
    cookies: {
      getAll: () => parseCookieHeader(req.headers.cookie ?? '').map(({ name, value }) => ({ name, value: value ?? '' })),
      setAll: (cookies) => cookies.forEach(({ name, value, options }) => res.append('Set-Cookie', serializeCookieHeader(name, value, options))),
    },
  });

  createApp({ db, supabaseFor }).listen(PORT, () => console.log(`MyoLogic Test Manager: http://localhost:${PORT}`));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
