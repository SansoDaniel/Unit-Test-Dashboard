import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { setActor } from '../src/db.js';

// Quel che Supabase fornisce già e un Postgres normale no (auth.uid() come in Supabase).
const SUPABASE_STUBS = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon; create role authenticated; create role service_role;
`;

// Postgres in memoria con le migrazioni applicate, con la stessa interfaccia di createDb().
// skip: migrazioni da non applicare, per simulare un database non aggiornato.
export async function testDb({ skip = [] } = {}) {
  const pg = new PGlite();
  await pg.exec(SUPABASE_STUBS);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const f of readdirSync(dir).sort()) if (!skip.includes(f)) await pg.exec(readFileSync(new URL(f, dir), 'utf8'));
  return {
    query: (sql, params) => pg.query(sql, params),
    tx: (user, fn) => pg.transaction(async (t) => { await setActor(t, user); return fn(t); }),
    end: () => pg.close(),
  };
}
