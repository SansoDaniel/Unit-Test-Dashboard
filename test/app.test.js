import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { checkAuth, checkDatabase } from '../scripts/check.js';
import { testDb } from './helpers.js';

test('npm run check riconosce un database aggiornato e uno a cui manca una migrazione', async () => {
  const ok = await testDb();
  assert.deepEqual(await checkDatabase(ok), { problems: [], notes: ['Il catalogo è vuoto: importa il file Excel con npm run import -- <file.xlsx> --apply'] });
  await ok.end();
  const old = await testDb({ skip: ['20261026090000_notifications.sql', '20261027090000_import_final_reason.sql'] });
  assert.deepEqual((await checkDatabase(old)).problems, [
    'Migrazione non applicata: supabase/migrations/20261026090000_notifications.sql',
    'Migrazione non applicata: supabase/migrations/20261027090000_import_final_reason.sql',
  ]);
  await old.end();
});

test('npm run check segnala le registrazioni pubbliche attive e Supabase non raggiungibile', async () => {
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });
  const base = { url: 'https://progetto.supabase.co', key: 'chiave' };
  assert.match((await checkAuth({ ...base, fetchImpl: reply(200, { disable_signup: false }) })).problems[0], /registrazioni pubbliche sono attive/);
  assert.deepEqual(await checkAuth({ ...base, fetchImpl: reply(200, { disable_signup: true }) }), { problems: [], notes: ['Registrazioni pubbliche disattivate.'] });
  assert.match((await checkAuth({ ...base, fetchImpl: reply(401, {}) })).problems[0], /ha risposto 401/);
  assert.match((await checkAuth({ ...base, fetchImpl: async () => { throw new Error('fetch failed'); } })).problems[0], /non risponde/);
});

test('un errore imprevisto mostra un messaggio chiaro senza dettagli interni', async () => {
  const db = { query: async () => { throw new Error('password authentication failed for user "postgres"'); } };
  const user = { id: '00000000-0000-4000-8000-000000000001', email: 'tester@example.com' };
  const server = createApp({ db, supabaseFor: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/catalogo`;
  const original = console.error;
  console.error = () => {}; // l'errore finisce nel log del server: qui non serve vederlo
  try {
    const page = await fetch(url);
    assert.equal(page.status, 500);
    const body = await page.text();
    assert.match(body, /non è andata a buon fine/);
    assert.doesNotMatch(body, /password authentication/);
    assert.equal(page.headers.get('x-powered-by'), null);
    const json = await fetch(url, { headers: { Accept: 'application/json' } });
    assert.deepEqual(await json.json(), { error: 'errore del server, riprova' });
  } finally {
    console.error = original;
    server.close();
  }
});
