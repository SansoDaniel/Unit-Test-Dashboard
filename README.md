# MyoLogic Test Manager

Applicazione web che sostituisce il file Excel degli Unit Test di MyoLogic Pro: un solo catalogo di test, sessioni per release e configurazione, esiti tracciati e report calcolato. Piano e mockup approvati: [docs/piano-e-mockup.html](docs/piano-e-mockup.html).

**Stato:** fasi 1–6 sviluppate; manca la prova completa sul progetto Supabase reale. Guida per chi esegue i test: [docs/GUIDA.md](docs/GUIDA.md).
- Fase 1: database, import dal file Excel, login.
- Fase 2: catalogo con albero, ricerca e filtri; creazione, modifica, duplicazione, archiviazione ed eliminazione di unità, casi d'uso, test e dispositivi; storico modifiche nella scheda test.
- Fase 3: release (storico revisioni, autore, firme, release in uso), configurazioni con i loro dispositivi, persone collegate agli account, sessioni di test ed esecuzione con esiti, note, tasti rapidi e salvataggio automatico.
- Fase 4: dashboard con esito calcolato, copertura per unità e NOT PASSED aperti; report di esito calcolato dalle sessioni, con invio e approvazione; notifiche nell'app.
- Fase 5: export Excel della release nel formato del file originale (reimportabile) e report stampabile in PDF.
- Fase 6: controllo della configurazione (`npm run check`), pagina d'errore sicura, istruzioni di pubblicazione e backup, guida per i tester.

## Requisiti

- Node.js 22.9 o successivo
- Un progetto [Supabase](https://supabase.com)

## 1. Progetto Supabase

1. Crea il progetto scegliendo una regione UE (per esempio Frankfurt).
2. Disattiva le registrazioni pubbliche: *Authentication → Sign In / Providers*, spegni "Allow new users to sign up". Senza questo passo chiunque conosca l'indirizzo potrebbe crearsi un account.
3. Applica le migrazioni di `supabase/migrations`, nell'ordine dei nomi:
   - dal pannello: *SQL Editor*, incolla ed esegui un file alla volta;
   - oppure da terminale: `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`.
4. Crea gli utenti: *Authentication → Users → Add user*, con email e password.

## 2. Configurazione

Copia `.env.example` in `.env` e compila i valori: ogni riga dice dove trovarli nel pannello Supabase.

- `SUPABASE_URL` e `SUPABASE_ANON_KEY` servono al login.
- `DATABASE_URL` è la stringa di connessione "Session pooler": il server legge e scrive i dati direttamente in Postgres. È un segreto. Se la password del database contiene caratteri come `@`, `:` o `/`, vanno scritti codificati (`@` → `%40`), oppure scegli una password solo con lettere e numeri.
- `DATABASE_SSL_CA` è il certificato del database: il percorso del file scaricato, oppure il suo contenuto (da `-----BEGIN CERTIFICATE-----` in poi). Senza, la connessione resta cifrata ma il server non verifica il certificato: va bene solo in sviluppo, e in produzione l'app non parte.

Poi controlla che sia tutto a posto:

```bash
npm run check
```

Il comando non modifica nulla. Verifica la connessione al database, che tutte le migrazioni siano applicate (dice quale file manca), lo stato del catalogo e che in Supabase Auth le registrazioni pubbliche siano disattivate.

Il browser non parla mai direttamente con il database né con Supabase: lo fa solo il server.

## 3. Import del file Excel

```bash
npm install
npm run import -- "/percorso/MyoLogic Pro - Unit Test v.2.1_rev00.xlsx"
```

È una prova a secco: controlla che i fogli siano coerenti e scrive [docs/import-report.md](docs/import-report.md) con tutto ciò che verrà importato e corretto. Il database non viene toccato. Dopo aver controllato il report:

```bash
npm run import -- "/percorso/MyoLogic Pro - Unit Test v.2.1_rev00.xlsx" --apply
```

L'import entra tutto o niente, si esegue una sola volta su un database vuoto e alla fine confronta i conteggi del database con quelli del file. Si ferma senza scrivere nulla se trova dati che andrebbero persi: un esito senza test, celle piene nelle colonne R–AE, fogli di configurazione diversi dal catalogo.

## 4. Avvio

```bash
npm start
```

L'app è su http://localhost:3000.

## Pubblicazione

Su un servizio di hosting per Node.js (decisione 1 del piano), per esempio Render, Railway o Fly.io, nella regione UE:

1. Collega il repository e imposta il comando di avvio `npm start`, con Node 22 o successivo.
2. Imposta le variabili d'ambiente: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`, `DATABASE_SSL_CA` (il contenuto del certificato) e `NODE_ENV=production`. Il servizio fornisce `PORT`.
3. Con `NODE_ENV=production` i cookie di accesso sono inviati solo su HTTPS e l'app non parte senza certificato del database.
4. In Supabase, *Authentication → URL Configuration*: inserisci l'indirizzo pubblicato come Site URL.
5. Esegui `npm run check` con le stesse variabili, poi l'import con `--apply` se non l'hai già fatto.

Il file `.env` non va mai caricato nel repository: è già in `.gitignore`.

## Backup

- **Database**: dal piano Pro Supabase fa un backup giornaliero, ripristinabile da *Database → Backups*. In più, una copia completa si fa con `pg_dump "$DATABASE_URL" > backup.sql` (richiede gli strumenti di PostgreSQL).
- **Documento**: per ogni release chiusa, scarica l'export Excel e il PDF del report e archiviali insieme alla documentazione di validazione. L'export si può reimportare in un database vuoto.
- Gli account di accesso stanno in Supabase Auth e non compaiono nell'export: dopo un ripristino da Excel vanno ricreati e ricollegati in *Impostazioni → Persone*.

## Primo utilizzo dopo l'import

1. *Impostazioni → Persone*: collega ogni persona al suo account. Gli esiti che registra porteranno il suo nome e la nuova sessione la propone come tester.
2. *Impostazioni → Configurazioni*: indica i dispositivi delle 4 configurazioni importate (il file non li contiene). Una configurazione senza dispositivi include tutti i test in una nuova sessione.
3. *Release → Nuova release* per la prossima versione, poi *Sessioni → Nuova sessione*.

## Esecuzione di una sessione

Ogni test ha i pulsanti PASSED, NOT PASSED, NOT TESTED e N/A. Da tastiera: ↓ e ↑ scorrono i test, P, F, N e A impostano l'esito e passano al test successivo, Invio apre descrizione, operazioni e nota. Gli esiti si salvano subito e in ordine; se un salvataggio non riesce, la barra in basso lo dice con il numero del test. Nota e "Problema grafico" si salvano all'uscita dal campo. Una sessione chiusa è in sola lettura finché non viene riaperta.

## Report e notifiche

- **Esito calcolato** della release: NOT PASSED se c'è almeno un NOT PASSED, DA COMPLETARE se restano test NOT TESTED, altrimenti PASSED.
- Il **report** (*Release → Report di esito*) prende versione e conteggi dalle sessioni. Data, persona, motivazione, prossime azioni e risultato finale si scrivono a mano. Se il risultato finale è diverso da quello calcolato serve una motivazione.
- **Invia agli approvatori** porta il report in "da approvare"; lo approva solo un approvatore della release collegato al proprio account. Ogni modifica salvata riporta il report in bozza.
- Le **notifiche** le crea il database: un nuovo NOT PASSED e una sessione chiusa avvisano autore e approvatori della release, un report da approvare avvisa gli approvatori. Chi compie l'azione non riceve la propria notifica. Arrivano alle persone collegate a un account; ognuno vede ed elimina solo le proprie.

## Export

- *Release → Esporta Excel* (o dal report) scarica `MyoLogic Pro - Unit Test <versione>.xlsx`: Cover&History con lo storico fino a quella release, Unit Test, un foglio per sessione, Esito Test. I test non inclusi in una sessione hanno ESITO "NON INCLUSO".
- Il file si reimporta con `npm run import`: esportare e reimportare restituisce gli stessi dati. Non viaggiano nel file: tester e data di ogni singola sessione (si usano quelli di Esito Test), dispositivi delle configurazioni, account collegati, stato archiviato dei test.
- *Report → Esporta PDF* apre la versione A4 del report: usa "Stampa o salva come PDF" del browser.

## Regole di cancellazione

- Un **test** con esiti registrati viene archiviato: esce dal catalogo e dalle nuove sessioni ma resta nei report. Si ripristina dalla sua scheda. Un test senza esiti viene eliminato.
- Un'**unità** si elimina solo se non ha casi d'uso, un **caso d'uso** solo se non ha test (archiviati compresi), un **dispositivo** solo se nessun test e nessuna configurazione lo usano. Il database applica le stesse regole anche se l'app venisse aggirata.
- Una **release** o una **configurazione** si eliminano solo se non hanno sessioni; una **persona** solo se non è tester, autore o firmataria.
- Una **sessione** si elimina con i suoi esiti: la conferma dice quanti ne sono già stati registrati. Da una sessione si tolgono solo i test ancora NOT TESTED e senza nota.
- Ogni eliminazione passa da una pagina di conferma. Ogni modifica finisce nello storico con l'email di chi l'ha fatta.

## Test

```bash
npm test
```

Coprono import, catalogo, sessioni ed esecuzione, report e notifiche, export con reimport, controllo della configurazione e pagina d'errore.

I test applicano le migrazioni a un Postgres in memoria (PGlite) e provano le pagine dell'app con un utente finto. Con `UT_XLSX` impostato sul percorso del file Excel provano anche l'import completo:

```bash
UT_XLSX="/percorso/MyoLogic Pro - Unit Test v.2.1_rev00.xlsx" npm test
```

## Struttura

| Percorso | Contenuto |
|---|---|
| `src/server.js` | Avvio: database, Supabase Auth, porta |
| `src/app.js` | Login, protezione delle pagine, panoramica |
| `src/catalog.js` | Catalogo: unità, casi d'uso, test, dispositivi |
| `src/dashboard.js` | Dashboard della release |
| `src/report.js` | Report di esito: calcolo, invio, approvazione |
| `src/notifications.js` | Campanella e pagina delle notifiche |
| `src/summary.js` | Esiti ed esito calcolato di una release |
| `src/releases.js` | Release, firme, release in uso |
| `src/sessions.js` | Sessioni ed esecuzione dei test |
| `src/settings.js` | Configurazioni e persone |
| `src/util.js` | Validazione e messaggi d'errore comuni |
| `src/db.js` | Connessione a Postgres; le scritture registrano l'utente nello storico |
| `src/views/` | Pagine EJS |
| `public/app.css` | Stile, con i token dei mockup |
| `public/session.js` | Esecuzione: salvataggio senza ricaricare e tasti rapidi |
| `public/app.js` | Blocca i pulsanti di un form già inviato, contro i doppi clic |
| `scripts/import-excel.js` | Import del file Excel e report |
| `scripts/check.js` | Controllo della configurazione (`npm run check`) |
| `src/export.js` | Export Excel della release |
| `supabase/migrations/` | Schema, storico modifiche, funzione di import |
| `test/` | Test con `node:test` |
| `PRODUCT.md` | Profilo del prodotto per il lavoro di design |
