// Controllo della configurazione: npm run check
// Verifica database, migrazioni applicate, dati e impostazioni di Supabase Auth. Non modifica nulla.
import { fileURLToPath } from 'node:url';
import { createDb } from '../src/db.js';

// Ogni migrazione e qualcosa che esiste solo dopo averla applicata.
const MIGRATIONS = [
  ['20261023120000_schema.sql', "select to_regclass('public.results') is not null as ok"],
  ['20261023120100_audit.sql', "select to_regclass('public.audit_log') is not null as ok"],
  ['20261023120200_import.sql', "select to_regprocedure('public.import_workbook(jsonb)') is not null as ok"],
  ['20261024090000_audit_email.sql', "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_log' and column_name = 'actor_email') as ok"],
  ['20261025090000_configuration_devices.sql', "select to_regclass('public.configuration_devices') is not null as ok"],
  ['20261026090000_notifications.sql', "select to_regclass('public.notifications') is not null as ok"],
  ['20261027090000_import_final_reason.sql', "select coalesce(pg_get_functiondef(to_regprocedure('public.import_workbook(jsonb)')) like '%final_reason%', false) as ok"],
];

// Restituisce { problems, notes }: problems blocca l'uso dell'app, notes sono passi consigliati.
export async function checkDatabase(db) {
  const problems = [];
  const notes = [];
  for (const [file, sql] of MIGRATIONS) {
    if (!(await db.query(sql)).rows[0].ok) problems.push(`Migrazione non applicata: supabase/migrations/${file}`);
  }
  if (problems.length) return { problems, notes };
  const { rows: [c] } = await db.query(`select (select count(*)::int from tests) as tests, (select count(*)::int from releases) as releases,
    (select count(*)::int from people where user_id is not null) as linked,
    (select count(*)::int from configurations c where not exists (select 1 from configuration_devices cd where cd.configuration_id = c.id)) as bare_configs`);
  if (!c.tests) notes.push('Il catalogo è vuoto: importa il file Excel con npm run import -- <file.xlsx> --apply');
  else notes.push(`Catalogo: ${c.tests} test, ${c.releases} release.`);
  if (c.tests && !c.linked) notes.push('Nessuna persona è collegata a un account: fallo in Impostazioni → Persone.');
  if (c.bare_configs) notes.push(`${c.bare_configs} configurazioni senza dispositivi: una nuova sessione su di esse include tutti i test (Impostazioni → Configurazioni).`);
  return { problems, notes };
}

// Le impostazioni pubbliche di Supabase Auth dicono se chiunque può registrarsi.
export async function checkAuth({ url, key, fetchImpl = fetch }) {
  if (!url || !key) return { problems: ['Mancano SUPABASE_URL e SUPABASE_ANON_KEY nel file .env.'], notes: [] };
  let res;
  try {
    res = await fetchImpl(`${url.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: key } });
  } catch (err) {
    return { problems: [`Supabase Auth non risponde (${err.message}): controlla SUPABASE_URL.`], notes: [] };
  }
  if (!res.ok) return { problems: [`Supabase Auth ha risposto ${res.status}: controlla SUPABASE_URL e SUPABASE_ANON_KEY.`], notes: [] };
  const settings = await res.json();
  return settings.disable_signup
    ? { problems: [], notes: ['Registrazioni pubbliche disattivate.'] }
    : { problems: ["Le registrazioni pubbliche sono attive: chiunque conosca l'indirizzo può crearsi un account. Disattivale in Authentication → Sign In / Providers."], notes: [] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = [];
  let db;
  try {
    db = createDb();
    await db.query('select 1');
    results.push({ problems: [], notes: ['Connessione al database riuscita.'] }, await checkDatabase(db));
  } catch (err) {
    results.push({ problems: [`Database non raggiungibile: ${err.message}`], notes: [] });
  } finally {
    await db?.end();
  }
  results.push(await checkAuth({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY }));
  const problems = results.flatMap((r) => r.problems);
  for (const n of results.flatMap((r) => r.notes)) console.log(`✔ ${n}`);
  for (const p of problems) console.log(`✖ ${p}`);
  console.log(problems.length ? `\n${problems.length} problemi da risolvere prima di usare l'app.` : '\nConfigurazione a posto.');
  process.exitCode = problems.length ? 1 : 0;
}
