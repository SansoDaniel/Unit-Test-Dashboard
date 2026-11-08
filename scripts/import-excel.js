// Import del file Excel "MyoLogic Pro – Unit Test" nel database.
//   npm run import -- <file.xlsx>           prova a secco: scrive docs/import-report.md, non tocca il database
//   npm run import -- <file.xlsx> --apply   import vero (serve DATABASE_URL)
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../src/db.js';
import { NOT_INCLUDED } from '../src/export.js';

const CATALOG = 'Unit Test';
const COVER = 'Cover&History';
const SUMMARY = 'Esito Test';
const CATALOG_COLS = ['A', 'B', 'C', 'E', 'G', 'J', 'K'];
const UNUSED_COLS = { from: 18, to: 31 }; // R–AE: vuote nel file, non migrate
const REPORT = fileURLToPath(new URL('../docs/import-report.md', import.meta.url));

// Decisione 5: unità con nomi quasi uguali, da confermare nel report di import.
export const UNIT_MERGES = {
  'Gestione Account TO': 'Gestione account (TO)',
  'Gestione Dispostiivi': 'Gestione Dispositivi',
  'Gestione account Distributore': 'Gestione account (DIS)',
};

const OUTCOMES = {
  'PASSED': ['PASSED', false],
  'NOT PASSED': ['NOT PASSED', false],
  'NOT PASSED (LATO GRAFICO)': ['NOT PASSED', true],
  'NOT TESTED': ['NOT TESTED', false],
  'NOT AVAILABLE': ['NOT AVAILABLE', false],
};

const fail = (msg) => { throw new Error(msg); };
// cell.text di exceljs va in errore sulle celle unite con cella principale vuota: si legge il valore.
const txt = (cell) => {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v !== 'object' || v instanceof Date) return String(v);
  return v.richText ? v.richText.map((t) => t.text).join('') : String(v.result ?? v.text ?? '');
};
const str = (cell) => txt(cell).trim() || null;
const oneLine = (s) => s?.replace(/\s+/g, ' ').trim() || null;
const isoDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);

export function normalizeOutcome(raw) {
  const key = raw?.trim().toUpperCase();
  if (!key) return { outcome: 'NOT TESTED', graphicIssue: false };
  const hit = OUTCOMES[key] ?? fail(`Esito non riconosciuto: "${raw}"`);
  return { outcome: hit[0], graphicIssue: hit[1] };
}

// source: percorso del file oppure i suoi byte (Buffer), per esempio un export appena generato.
export async function parseWorkbook(source) {
  const wb = new ExcelJS.Workbook();
  await (Buffer.isBuffer(source) ? wb.xlsx.load(source) : wb.xlsx.readFile(source));
  const sheet = (name) => wb.getWorksheet(name) ?? fail(`Nel file manca il foglio "${name}"`);
  const log = { ids: [], merged: {}, rewritten: [], blanks: {}, noDevice: [], spacedDevices: 0, noName: [], people: [], longNames: [] };

  // Celle fuori dalle colonne migrate: se contengono qualcosa l'import si ferma, per non perderlo.
  const checkUnused = (ws) => {
    for (let r = 1; r <= ws.rowCount; r++) {
      for (let c = UNUSED_COLS.from; c <= UNUSED_COLS.to; c++) {
        const cell = ws.getRow(r).getCell(c);
        if (r > 1 && str(cell)) fail(`Il foglio "${ws.name}" ha dati in ${cell.address}, una colonna che l'import non migra`);
      }
    }
  };
  const checkHeader = (ws, cols) => {
    for (const [col, label] of cols) {
      if (str(ws.getCell(`${col}1`)) !== label) fail(`Il foglio "${ws.name}" non ha l'intestazione attesa in ${col}1 ("${label}")`);
    }
  };
  const header = [['A', 'Unità del software'], ['B', 'Device'], ['C', "Casi d'uso"], ['E', 'ID Test'], ['G', 'Nome Test']];

  // --- Catalogo ---
  const cat = sheet(CATALOG);
  checkHeader(cat, header);
  checkUnused(cat);
  const rows = [];
  let unit = null;
  let useCase = null;
  for (let r = 2; r <= cat.rowCount; r++) {
    const c = (col) => cat.getCell(`${col}${r}`);
    if (CATALOG_COLS.every((col) => !str(c(col)))) continue;
    const a = oneLine(str(c('A')));
    if (a && (UNIT_MERGES[a] ?? a) !== unit) {
      unit = UNIT_MERGES[a] ?? a;
      useCase = null; // nuova unità: il caso d'uso non si eredita da quella precedente
    }
    if (a && UNIT_MERGES[a]) log.merged[a] = (log.merged[a] ?? 0) + 1;
    useCase = oneLine(str(c('C'))) ?? useCase;
    if (!unit || !useCase) fail(`Riga ${r} del foglio "${CATALOG}": manca l'unità o il caso d'uso`);

    const code = c('E').value;
    if (code != null && !Number.isInteger(code)) fail(`Riga ${r} del foglio "${CATALOG}": l'ID test "${code}" non è un numero intero`);
    const rawDevices = (txt(c('B'))).split('/');
    if (rawDevices.some((d) => d && d !== d.trim())) log.spacedDevices++;
    const devices = rawDevices.map((d) => d.trim()).filter(Boolean);
    const name = str(c('G'));
    if (!devices.length) log.noDevice.push(r);
    if (!name) log.noName.push(r);
    rows.push({ r, unit, useCase, code, devices, name: name ?? useCase, description: str(c('J')), operations: str(c('K')) });
  }
  if (!rows.length) fail(`Il foglio "${CATALOG}" non contiene test`);

  // Decisione 4: si tengono gli ID esistenti; mancanti e ripetuti ricevono un ID nuovo dopo il massimo.
  const used = new Set();
  let next = Math.max(0, ...rows.map((t) => t.code ?? 0)) + 1;
  for (const t of rows) {
    if (t.code != null && !used.has(t.code)) { used.add(t.code); continue; }
    log.ids.push({ r: t.r, code: next, was: t.code, name: t.name });
    t.code = next++;
  }

  const units = [], useCases = [], unitId = new Map(), useCaseId = new Map(), deviceId = new Map();
  for (const t of rows) {
    if (!unitId.has(t.unit)) {
      unitId.set(t.unit, randomUUID());
      units.push({ id: unitId.get(t.unit), name: t.unit, position: units.length + 1 });
    }
    const key = `${t.unit}\n${t.useCase}`;
    if (!useCaseId.has(key)) {
      useCaseId.set(key, randomUUID());
      useCases.push({ id: useCaseId.get(key), unit_id: unitId.get(t.unit), name: t.useCase, position: useCases.length + 1 });
    }
    t.id = randomUUID();
    t.useCaseId = useCaseId.get(key);
    for (const d of t.devices) if (!deviceId.has(d)) deviceId.set(d, randomUUID());
  }

  // --- Persone, revisioni e firme (Cover&History) ---
  const people = new Map();
  const person = (fullName, title = null) => {
    if (!people.has(fullName)) people.set(fullName, { id: randomUUID(), full_name: fullName, title });
    return people.get(fullName);
  };
  const cover = sheet(COVER);
  const signatures = [], revisions = [];
  let mode = null;
  for (let r = 1; r <= cover.rowCount; r++) {
    const b = str(cover.getCell(`B${r}`));
    if (!b) continue;
    if (b === 'AUTORE') { mode = 'author'; continue; }
    if (b === 'APPROVATORI') { mode = 'approver'; continue; }
    if (b === 'REVISION HISTORY') { mode = 'history'; continue; }
    if (b === 'Name' || b === 'Version') continue;
    const [c, d, e] = ['C', 'D', 'E'].map((col) => cover.getCell(`${col}${r}`));
    if (mode === 'author' || mode === 'approver') signatures.push({ role: mode, person: person(b, str(c)), signed_on: isoDate(e.value) });
    else if (mode === 'history') revisions.push({ version: b, released_on: isoDate(c.value), author: str(d), changes: str(e) });
  }
  if (!revisions.length) fail(`Nel foglio "${COVER}" manca la Revision History`);
  const versions = revisions.map((v) => v.version);
  const dup = versions.find((v, i) => versions.indexOf(v) !== i);
  if (dup) fail(`Nel foglio "${COVER}" la versione ${dup} compare due volte`);

  // --- Riepilogo (Esito Test) ---
  const sum = sheet(SUMMARY);
  if (str(sum.getCell('B3')) !== 'Data Test:' || str(sum.getCell('B13')) !== 'Risultato finale:') {
    fail(`Il foglio "${SUMMARY}" non ha il layout atteso (B3 "Data Test:", B13 "Risultato finale:")`);
  }
  const finalOutcome = str(sum.getCell('F13'))?.toUpperCase() ?? null;
  if (finalOutcome && !['PASSED', 'NOT PASSED'].includes(finalOutcome)) fail(`Esito finale non riconosciuto in "${SUMMARY}"!F13: "${finalOutcome}"`);
  const testerName = str(sum.getCell('G3'));
  const tester = testerName ? person(testerName) : null;
  const testDate = isoDate(sum.getCell('D3').value);
  // Righe aggiunte dall'export dell'app: motivazione del risultato finale e stato del report.
  const finalReason = str(sum.getCell('B14')) === 'Motivazione:' ? str(sum.getCell('D14')) : null;
  const REPORT_STATUS = { 'BOZZA': 'draft', 'DA APPROVARE': 'pending_approval', 'APPROVATO': 'approved' };
  const reportStatus = str(sum.getCell('B15')) === 'Stato del report:' ? REPORT_STATUS[str(sum.getCell('D15'))] : null;

  // "G. D'Amico" → la persona della copertina con quell'iniziale e quel cognome
  const byShortName = (short) => {
    if (!short) return null;
    const m = short.match(/^(\p{L})\.\s*(.+)$/u);
    const full = m && [...people.values()].find((p) => p.full_name.startsWith(m[1]) && p.full_name.endsWith(` ${m[2]}`));
    if (!log.people.some((x) => x.short === short)) log.people.push({ short, full: full?.full_name ?? null });
    return full ?? person(short);
  };
  const releases = revisions.map((v, i) => ({
    id: randomUUID(), version: v.version, released_on: v.released_on, author_id: byShortName(v.author)?.id ?? null, changes: v.changes, position: i + 1,
  }));
  const latest = releases.at(-1);

  // --- Sessioni: un foglio di configurazione = una sessione della release più recente ---
  const configSheets = wb.worksheets.filter((ws) => ![COVER, CATALOG, SUMMARY].includes(ws.name));
  if (!configSheets.length) fail('Nel file non ci sono fogli di configurazione con gli esiti');
  const catalogRows = new Set(rows.map((t) => t.r));
  const configurations = [], sessions = [], results = [];
  const tally = { 'PASSED': 0, 'NOT PASSED': 0, 'NOT TESTED': 0, 'NOT AVAILABLE': 0 };
  for (const ws of configSheets) {
    checkHeader(ws, [...header, ['P', 'ESITO'], ['Q', 'NOTE']]);
    checkUnused(ws);
    for (let r = 2; r <= ws.rowCount; r++) {
      const has = (col) => str(ws.getCell(`${col}${r}`));
      if (!catalogRows.has(r) && (has('P') || has('Q'))) fail(`Il foglio "${ws.name}" ha un esito in riga ${r}, dove il catalogo non ha test`);
    }
    for (const t of rows) {
      for (const col of CATALOG_COLS) {
        if (txt(ws.getCell(`${col}${t.r}`)) !== txt(cat.getCell(`${col}${t.r}`))) {
          fail(`Il foglio "${ws.name}" differisce dal catalogo in ${col}${t.r}: allinea i fogli prima dell'import`);
        }
      }
    }
    if (ws.name.length >= 31) log.longNames.push(ws.name);
    const configuration = { id: randomUUID(), name: ws.name };
    const session = { id: randomUUID(), release_id: latest.id, configuration_id: configuration.id, tester_id: tester?.id ?? null, started_on: testDate, status: 'closed' };
    configurations.push(configuration);
    sessions.push(session);
    log.blanks[ws.name] = [];
    for (const t of rows) {
      const raw = txt(ws.getCell(`P${t.r}`));
      if (raw.trim().toUpperCase() === NOT_INCLUDED) continue; // il test non fa parte di questa sessione
      const { outcome, graphicIssue } = normalizeOutcome(raw);
      if (!raw.trim()) log.blanks[ws.name].push(t.code);
      else if (raw !== outcome) log.rewritten.push({ sheet: ws.name, r: t.r, code: t.code, raw, outcome });
      tally[outcome]++;
      results.push({ session_id: session.id, test_id: t.id, outcome, note: str(ws.getCell(`Q${t.r}`)), graphic_issue: graphicIssue });
    }
  }

  const payload = {
    people: [...people.values()],
    units,
    use_cases: useCases,
    devices: [...deviceId].map(([name, id]) => ({ id, name })),
    tests: rows.map((t) => ({ id: t.id, code: t.code, use_case_id: t.useCaseId, name: t.name, description: t.description, operations: t.operations, position: t.r })),
    test_devices: rows.flatMap((t) => t.devices.map((d) => ({ test_id: t.id, device_id: deviceId.get(d) }))),
    configurations,
    releases,
    release_signatures: signatures.map((s) => ({ release_id: latest.id, person_id: s.person.id, role: s.role, signed_on: s.signed_on })),
    sessions,
    results,
    reports: [{
      release_id: latest.id, test_date: testDate, executed_by: tester?.id ?? null, motivation: str(sum.getCell('B6')),
      next_actions: str(sum.getCell('B12')), final_outcome: finalOutcome, final_reason: finalReason,
      status: reportStatus ?? (finalOutcome ? 'approved' : 'draft'),
    }],
  };
  const summary = {
    latestVersion: latest.version, summaryVersion: str(sum.getCell('D4')), summaryResult: str(sum.getCell('B10')),
    tester: tester?.full_name ?? null, testDate, finalOutcome, finalReason, reportStatus, signedOn: signatures.map((s) => s.signed_on),
  };
  return { payload, log, summary, tally, rows };
}

const fmt = (n) => n.toLocaleString('it-IT');
const day = (iso) => iso?.split('-').reverse().join('/') ?? '—';

export function renderReport({ payload, log, summary, tally, rows }, file) {
  const p = payload;
  const byRow = new Map(rows.map((t) => [t.r, t]));
  const out = [
    '# Report di import',
    '',
    `File: \`${basename(file)}\` · generato il ${day(new Date().toISOString().slice(0, 10))}`,
    '',
    'Prova a secco: questo report descrive cosa entrerà nel database. Niente viene scritto finché non si esegue l\'import con `--apply`.',
    '',
    '## Cosa verrà importato',
    '',
    '| Elemento | Quantità |',
    '|---|---|',
    `| Unità del software | ${p.units.length} |`,
    `| Casi d'uso | ${p.use_cases.length} |`,
    `| Test | ${p.tests.length} |`,
    `| Dispositivi | ${p.devices.length} (${p.devices.map((d) => d.name).join(', ')}) |`,
    `| Configurazioni e sessioni | ${p.sessions.length} |`,
    `| Esiti | ${fmt(p.results.length)}: PASSED ${tally['PASSED']}, NOT PASSED ${tally['NOT PASSED']}, NOT AVAILABLE ${tally['NOT AVAILABLE']}, NOT TESTED ${tally['NOT TESTED']} |`,
    `| Release (storico revisioni) | ${p.releases.length}, da ${p.releases[0].version} a ${summary.latestVersion} |`,
    `| Persone | ${p.people.length} (${p.people.map((x) => x.full_name).join(', ')}) |`,
    '',
    '## Da confermare',
    '',
    '### Unità unite (decisione 5)',
    '',
    '| Nome nel file | Diventa | Test spostati |',
    '|---|---|---|',
    ...Object.entries(UNIT_MERGES).map(([from, to]) => `| ${from} | ${to} | ${log.merged[from] ?? 0} |`),
    '',
    'Se una di queste unioni non va bene, va tolta da `UNIT_MERGES` in `scripts/import-excel.js` prima dell\'import.',
    '',
    '### Report di esito e sessioni',
    '',
    `- Il foglio Esito Test indica la versione software **${summary.summaryVersion}**, ma la release più recente dello storico è **${summary.latestVersion}**. Report e sessioni vengono collegati a ${summary.latestVersion}.`,
    `- Il testo "${summary.summaryResult}" non viene importato: nel software il risultato si calcola dalle sessioni (${tally['NOT PASSED']} NOT PASSED).`,
    summary.finalOutcome
      ? `- L'esito finale del file è **${summary.finalOutcome}**${summary.finalOutcome !== 'NOT PASSED' && tally['NOT PASSED'] && !summary.finalReason ? ', diverso da quello calcolato, e non ha una motivazione: andrà scritta nel report' : ''}. Il report entra come ${summary.reportStatus === 'pending_approval' ? 'da approvare' : summary.reportStatus === 'draft' ? 'bozza' : 'approvato'}.`
      : "- Il file non indica un esito finale: il report entra come bozza.",
    `- Autore e approvatori della copertina (firme del ${[...new Set(summary.signedOn)].map(day).join(', ')}) vengono collegati a ${summary.latestVersion}.`,
    `- Le ${p.sessions.length} sessioni hanno tester ${summary.tester ?? 'non indicato'}, data ${day(summary.testDate)} e stato "chiusa".`,
    ...(log.longNames.length ? [`- Questi nomi di foglio sono lunghi 31 caratteri, il massimo di Excel, e potrebbero essere troncati: ${log.longNames.map((n) => `"${n}"`).join(', ')}. Si rinominano nell'app.`] : []),
    '- I dispositivi delle configurazioni non sono nel file: si indicano nell\'app (fase 3).',
    '',
    '### Persone',
    '',
    ...log.people.map((x) => `- "${x.short}" nello storico revisioni → ${x.full ?? '**nessuna corrispondenza**, creata come persona a sé'}`),
    '',
    '## Correzioni automatiche',
    '',
    `### ID assegnati (decisione 4): ${log.ids.length}`,
    '',
    '| Riga | Nuovo ID | Motivo | Test |',
    '|---|---|---|---|',
    ...log.ids.map((x) => `| ${x.r} | ${x.code} | ${x.was == null ? 'mancante' : `ID ${x.was} già usato`} | ${oneLine(x.name)} |`),
    '',
    `### Esiti riscritti: ${log.rewritten.length}`,
    '',
    '| Foglio | Riga | ID | Nel file | Diventa |',
    '|---|---|---|---|---|',
    ...log.rewritten.map((x) => `| ${x.sheet} | ${x.r} | ${x.code} | \`${JSON.stringify(x.raw)}\` | ${x.outcome}${x.outcome === 'NOT PASSED' && /grafico/i.test(x.raw) ? ' + "Problema grafico"' : ''} |`),
    '',
    `### Esiti vuoti, importati come NOT TESTED: ${Object.values(log.blanks).flat().length}`,
    '',
    ...Object.entries(log.blanks).filter(([, ids]) => ids.length).map(([s, ids]) => `- ${s}: ${ids.length} (ID ${ids.join(', ')})`),
    '',
    '### Dispositivi',
    '',
    `- ${log.spacedDevices} celle con spazi intorno ai nomi dei dispositivi, ripulite (es. " PRISM" → "PRISM").`,
    `- ${log.noDevice.length} test senza dispositivo indicato: ID ${log.noDevice.map((r) => byRow.get(r).code).join(', ')}.`,
    '',
    `### Test senza nome: ${log.noName.length}`,
    '',
    ...log.noName.map((r) => `- Riga ${r}, ID ${byRow.get(r).code}: usato il nome del caso d'uso, "${byRow.get(r).name}".`),
    '',
  ];
  return out.join('\n');
}

export async function apply(db, { payload, tally }) {
  try {
    await db.query('select import_workbook($1::jsonb)', [JSON.stringify(payload)]);
  } catch (err) {
    fail(`Import non riuscito: ${err.message}. Riprovare è sicuro: l'import entra tutto o niente, e se fosse già entrato il database lo rifiuta.`);
  }
  const { rows: [c] } = await db.query(`select (select count(*)::int from units) as units, (select count(*)::int from use_cases) as use_cases,
    (select count(*)::int from tests) as tests, (select count(*)::int from releases) as releases, (select count(*)::int from sessions) as sessions,
    (select coalesce(jsonb_object_agg(outcome, n), '{}') from (select outcome, count(*)::int as n from results group by outcome) x) as outcomes`);
  const wrong = [
    ...['units', 'use_cases', 'tests', 'releases', 'sessions'].filter((k) => c[k] !== payload[k].length).map((k) => `${k}: attesi ${payload[k].length}, trovati ${c[k]}`),
    ...Object.entries(tally).filter(([o, n]) => (c.outcomes[o] ?? 0) !== n).map(([o, n]) => `esiti ${o}: attesi ${n}, trovati ${c.outcomes[o] ?? 0}`),
  ];
  if (wrong.length) fail(`Import eseguito ma i conteggi non tornano:\n${wrong.join('\n')}`);
  console.log('Import completato. Conteggi verificati nel database.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [file, flag] = process.argv.slice(2);
    if (!file) fail('Uso: npm run import -- <file.xlsx> [--apply]');
    if (flag && flag !== '--apply') fail(`Opzione sconosciuta: ${flag}`);
    const parsed = await parseWorkbook(file);
    writeFileSync(REPORT, renderReport(parsed, file));
    const { payload: p, tally } = parsed;
    console.log(`${p.tests.length} test, ${p.units.length} unità, ${p.use_cases.length} casi d'uso, ${p.sessions.length} sessioni, ${p.releases.length} release.`);
    console.log(`Esiti: ${Object.entries(tally).map(([o, n]) => `${o} ${n}`).join(', ')}.`);
    console.log(`Report scritto in ${REPORT}`);
    if (flag === '--apply') {
      const db = createDb();
      try { await apply(db, parsed); } finally { await db.end(); }
    } else console.log('Prova a secco: il database non è stato toccato. Controlla il report, poi riesegui con --apply.');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
