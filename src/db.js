import pg from 'pg';
import { readFileSync } from 'node:fs';

// Le scritture passano da tx(): l'utente finisce nelle impostazioni lette da auth.uid() e dallo storico modifiche.
export const setActor = (q, user) =>
  q.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.email', $2, true)", [user.id, user.email ?? '']);

export function createDb() {
  const { DATABASE_URL, DATABASE_SSL_CA, NODE_ENV } = process.env;
  if (!DATABASE_URL) throw new Error('Manca DATABASE_URL: copia .env.example in .env e compilalo.');
  if (!DATABASE_SSL_CA && NODE_ENV === 'production') throw new Error('In produzione serve DATABASE_SSL_CA, il certificato del database Supabase.');
  // Il certificato si passa come percorso del file oppure come testo (comodo sui servizi di hosting).
  const ca = DATABASE_SSL_CA?.includes('-----BEGIN') ? DATABASE_SSL_CA.replaceAll('\\n', '\n') : DATABASE_SSL_CA && readFileSync(DATABASE_SSL_CA, 'utf8');
  // shortcut: senza DATABASE_SSL_CA la connessione è cifrata ma il certificato non viene verificato; va bene solo in sviluppo
  const ssl = ca ? { ca } : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl });
  // Una connessione inattiva chiusa da Supabase non deve far cadere l'app: il pool ne apre un'altra alla richiesta successiva.
  pool.on('error', (err) => console.error('Connessione al database chiusa:', err.message));
  return {
    query: (sql, params) => pool.query(sql, params),
    async tx(user, fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await setActor(client, user);
        const out = await fn(client);
        await client.query('commit');
        return out;
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}
