import express from 'express';
import { fileURLToPath } from 'node:url';
import { catalog } from './catalog.js';
import { dashboard } from './dashboard.js';
import { exporter } from './export.js';
import { notifications } from './notifications.js';
import { report } from './report.js';
import { releases } from './releases.js';
import { sessions } from './sessions.js';
import { settings } from './settings.js';
import { fmtDay } from './util.js';

// Messaggi dopo un redirect: /pagina?ok=salvato
const OK = {
  creato: 'Creato.',
  salvato: 'Modifiche salvate.',
  eliminato: 'Eliminato.',
  archiviato: 'Test archiviato: resta nei report delle release passate ma non entra nelle nuove sessioni.',
  ripristinato: 'Test ripristinato.',
  duplicato: 'Test duplicato: questa è la copia, puoi modificarla.',
  usata: 'Release selezionata: catalogo e sessioni mostrano i suoi esiti.',
  chiusa: 'Sessione chiusa: gli esiti non si possono più modificare.',
  riaperta: 'Sessione riaperta.',
  aggiunto: 'Test aggiunto alla sessione.',
  tolto: 'Test tolto dalla sessione.',
  inviato: 'Report inviato agli approvatori.',
  approvato: 'Report approvato.',
  bozza: 'Modifiche salvate: il report è tornato in bozza e va inviato di nuovo agli approvatori.',
};

export function createApp({ db, supabaseFor }) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.fmtDay = fmtDay;
  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('views', import.meta.url)));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.supabase = supabaseFor(req, res);
    next();
  });

  app.get('/login', (req, res) => res.render('login', { email: '', error: null }));

  app.post('/login', async (req, res) => {
    const email = String(req.body.email ?? '').trim();
    const password = String(req.body.password ?? '');
    const { error } = await req.supabase.auth.signInWithPassword({ email, password });
    if (!error) return res.redirect('/');
    const message = error.code === 'invalid_credentials' ? 'Email o password non corretti.'
      : error.name === 'AuthRetryableFetchError' ? 'Il servizio di accesso non risponde. Riprova tra poco; se continua, controlla SUPABASE_URL.'
      : `Accesso non riuscito: ${error.message}`;
    res.status(401).render('login', { email, error: message });
  });

  // Da qui in poi serve il login.
  app.use(async (req, res, next) => {
    const { data: { user } } = await req.supabase.auth.getUser();
    if (!user) return res.redirect('/login');
    req.user = res.locals.user = user;
    res.locals.ok = OK[req.query.ok] ?? null;
    // Release scelta (cookie), altrimenti la più recente.
    const chosen = /(?:^|;\s*)release=([0-9a-f-]{36})(?:;|$)/i.exec(req.headers.cookie ?? '')?.[1];
    const pick = async (sql, params) => (await db.query(sql, params)).rows[0] ?? null;
    res.locals.release = (chosen && await pick('select id, version from releases where id = $1', [chosen]))
      || await pick('select id, version from releases order by position desc limit 1');
    next();
  });

  app.post('/logout', async (req, res) => {
    await req.supabase.auth.signOut();
    res.redirect('/login');
  });

  app.use(notifications(db));
  app.use(dashboard(db));
  app.use(catalog(db));
  app.use(releases(db));
  app.use(report(db));
  app.use(exporter(db));
  app.use(sessions(db));
  app.use(settings(db));

  app.use((req, res) => res.status(404).render('message', { title: 'Pagina non trovata', text: "L'indirizzo non esiste o l'elemento è stato eliminato.", nav: null }));

  // Errori imprevisti: il dettaglio va nel log del server, all'utente un messaggio chiaro senza dati interni.
  app.use((err, req, res, next) => {
    console.error(`${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return next(err);
    const text = "L'operazione non è andata a buon fine e potrebbe non essere stata salvata. Riprova; se il problema continua, avvisa il responsabile del software.";
    if ((req.get('accept') ?? '').includes('application/json')) return res.status(500).json({ error: 'errore del server, riprova' });
    if (!res.locals.user) return res.status(500).type('text').send(text);
    res.status(500).render('message', { title: 'Errore del server', text, nav: null }, (renderErr, html) => (renderErr ? res.type('text').send(text) : res.send(html)));
  });
  return app;
}
