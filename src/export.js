import ExcelJS from 'exceljs';
import { Router } from 'express';
import { COMPUTED, REPORT_STATUS, releaseSummary } from './summary.js';
import { UUID } from './util.js';

// Export di una release nel formato del file "MyoLogic Pro – Unit Test": Cover&History, Unit Test,
// un foglio per sessione, Esito Test. Lo stesso file si può reimportare con scripts/import-excel.js.
export const NOT_INCLUDED = 'NON INCLUSO'; // ESITO dei test che la sessione non contiene: l'import li salta
const DOC_TITLE = "FT01 - Adam's Hand";
const RESERVED = ['Cover&History', 'Unit Test', 'Esito Test'];
const CATALOG_HEADERS = { A: 'Unità del software', B: 'Device', C: "Casi d'uso", E: 'ID Test', G: 'Nome Test', J: 'Descrizione test', K: 'Descrizione operazioni' };
// R–W: intestazioni del file originale, sempre vuote, tenute per avere lo stesso layout.
const UNUSED_HEADERS = { R: 'Esito Test - (Demo con Rotatore+ AH02/AH03 + PRISM + Pulse)', S: 'NOTE', T: 'Note Test  ', U: 'Note Test  RUSSO', V: 'Note Test ITA', W: 'Note' };
const WIDTHS = { A: 24, B: 18, C: 22, D: 8, E: 7, F: 3, G: 26, H: 10, I: 4, J: 42, K: 30, L: 6, M: 6, N: 6, O: 6, P: 18, Q: 42, R: 18, S: 12, T: 12, U: 12, V: 12, W: 12 };
const OUTCOME_FILL = { 'PASSED': 'FF93C47D', 'NOT PASSED': 'FFEA9999', 'NOT AVAILABLE': 'FFFFE599' };
const GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin', color: { argb: 'FFB7B7B7' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const asDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const shortName = (full) => (full && full.includes(' ') ? `${full[0]}. ${full.split(' ').slice(1).join(' ')}` : full);

// Nomi di foglio validi per Excel: niente []:*?/\, al massimo 31 caratteri, senza doppioni.
function sheetName(name, used) {
  const base = name.replace(/[[\]:*?/\\]/g, '-').trim().slice(0, 31) || 'Sessione';
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 31 - ` (${i})`.length)} (${i})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

// Altezza di riga stimata: Excel non adatta da solo le righe con celle unite.
const rowHeight = (texts) => Math.min(409, Math.max(30, 15 * Math.max(...texts.map(([t, chars]) => (t ?? '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / chars)), 0)))));

function catalogSheet(wb, name, tests, extra) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 9, ySplit: 1 }] });
  for (const [col, width] of Object.entries(WIDTHS)) ws.getColumn(col).width = width;
  const headers = { ...CATALOG_HEADERS, ...(extra ? { P: 'ESITO', Q: 'NOTE', ...UNUSED_HEADERS } : {}) };
  for (const [col, label] of Object.entries(headers)) {
    Object.assign(ws.getCell(`${col}1`), { value: label, font: { bold: true, size: col === 'P' ? 17 : 12 }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: BORDER });
  }
  ws.mergeCells('C1:D1'); ws.mergeCells('E1:F1'); ws.mergeCells('G1:I1'); ws.mergeCells('K1:O1');
  ws.getRow(1).height = 45;
  const top = { vertical: 'top', wrapText: true };
  tests.forEach((t, i) => {
    const r = i + 2;
    const cells = { A: t.unit, B: t.devices.join('/') || null, C: t.use_case, E: t.code, G: t.name, J: t.description, K: t.operations };
    for (const [col, value] of Object.entries(cells)) Object.assign(ws.getCell(`${col}${r}`), { value, alignment: col === 'A' || col === 'C' ? { vertical: 'middle', horizontal: 'center', wrapText: true } : top, border: BORDER });
    ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`E${r}:F${r}`); ws.mergeCells(`G${r}:I${r}`); ws.mergeCells(`K${r}:O${r}`);
    if (extra) {
      const { value, note, outcome } = extra(t);
      Object.assign(ws.getCell(`P${r}`), { value, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: BORDER, font: { bold: true, color: { argb: outcome ? 'FF000000' : 'FF999999' } } });
      if (OUTCOME_FILL[outcome]) ws.getCell(`P${r}`).fill = fill(OUTCOME_FILL[outcome]);
      Object.assign(ws.getCell(`Q${r}`), { value: note, alignment: top, border: BORDER });
    }
    ws.getRow(r).height = rowHeight([[t.name, 30], [t.description, 40], [t.operations, 50], [extra?.(t).note, 40]]);
  });
  // Unità e casi d'uso uniti su più righe, come nel file originale.
  const mergeRuns = (key, from, to) => {
    let start = 0;
    tests.forEach((t, i) => {
      if (i + 1 === tests.length || tests[i + 1][key] !== t[key]) {
        if (to !== from || i > start) ws.mergeCells(`${from}${start + 2}:${to}${i + 2}`);
        start = i + 1;
      }
    });
  };
  mergeRuns('unit_id', 'A', 'A');
  mergeRuns('use_case_id', 'C', 'D');
  return ws;
}

export async function buildWorkbook(db, releaseId) {
  const all = async (sql, params) => (await db.query(sql, params)).rows;
  const [[rel], history, signatures, tests, results, summary, [report]] = await Promise.all([
    all('select id, version, position from releases where id = $1', [releaseId]),
    all(`select rl.version, rl.released_on::text, rl.changes, p.full_name as author from releases rl left join people p on p.id = rl.author_id
         where rl.position <= (select position from releases where id = $1) order by rl.position`, [releaseId]),
    all(`select sg.role, sg.signed_on::text, p.full_name, p.title from release_signatures sg join people p on p.id = sg.person_id
         where sg.release_id = $1 order by p.full_name`, [releaseId]),
    // Catalogo: i test attivi più gli archiviati che hanno esiti in questa release.
    all(`select t.id, t.code, t.name, t.description, t.operations, uc.id as use_case_id, uc.name as use_case, u.id as unit_id, u.name as unit,
                coalesce((select jsonb_agg(d.name order by d.name) from test_devices td join devices d on d.id = td.device_id where td.test_id = t.id), '[]') as devices
         from tests t join use_cases uc on uc.id = t.use_case_id join units u on u.id = uc.unit_id
         where not t.archived or exists (select 1 from results x join sessions s on s.id = x.session_id where x.test_id = t.id and s.release_id = $1)
         order by u.position, uc.position, t.position, t.code`, [releaseId]),
    all(`select x.session_id, x.test_id, x.outcome, x.note, x.graphic_issue from results x join sessions s on s.id = x.session_id where s.release_id = $1`, [releaseId]),
    releaseSummary(db, releaseId),
    all(`select rp.test_date::text, rp.motivation, rp.next_actions, rp.final_outcome, rp.final_reason, rp.status, p.full_name as executed_by
         from reports rp left join people p on p.id = rp.executed_by where rp.release_id = $1`, [releaseId]),
  ]);
  if (!rel) return null;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MyoLogic Test Manager';

  // ---------- Cover&History ----------
  const cover = wb.addWorksheet('Cover&History');
  Object.entries({ A: 4, B: 22, C: 27, D: 26, E: 110 }).forEach(([col, width]) => { cover.getColumn(col).width = width; });
  Object.assign(cover.getCell('B4'), { value: `${DOC_TITLE}\n\nSoftware validation\n\nUNIT TESTs\n\nMyoLogic Pro ${rel.version}`, font: { size: 14 }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
  cover.mergeCells('B4:E4');
  cover.getRow(4).height = 130;
  let row = 7;
  const section = (title, header, rows) => {
    Object.assign(cover.getCell(`B${row}`), { value: title, font: { bold: true, size: 12 }, alignment: { horizontal: 'center' } });
    cover.mergeCells(`B${row}:E${row}`);
    row += 2;
    header.forEach((h, i) => Object.assign(cover.getRow(row).getCell(i + 2), { value: h, font: { bold: true }, fill: GREY, border: BORDER, alignment: { horizontal: 'center' } }));
    for (const values of rows) {
      row++;
      values.forEach((v, i) => Object.assign(cover.getRow(row).getCell(i + 2), { value: v, border: BORDER, alignment: { vertical: 'top', wrapText: true, horizontal: i === 3 && header[0] !== 'Version' ? 'center' : undefined } }));
      if (header[0] === 'Version') cover.getRow(row).height = rowHeight([[values[3], 100]]);
      if (values[1] instanceof Date) cover.getRow(row).getCell(3).numFmt = 'dd/mm/yyyy';
      if (values[3] instanceof Date) cover.getRow(row).getCell(5).numFmt = 'dd/mm/yyyy';
    }
    row += 4;
  };
  const people = (role) => signatures.filter((s) => s.role === role).map((s) => [s.full_name, s.title, s.full_name, asDate(s.signed_on)]);
  section('AUTORE', ['Name', 'Title', 'Signature', 'Date'], people('author'));
  section('APPROVATORI', ['Name', 'Title', 'Signature', 'Date'], people('approver'));
  section('REVISION HISTORY', ['Version', 'Date', 'Author', 'Description of Change'], history.map((v) => [v.version, asDate(v.released_on), shortName(v.author), v.changes]));

  // ---------- Unit Test e un foglio per sessione ----------
  catalogSheet(wb, 'Unit Test', tests, null);
  const byKey = new Map(results.map((x) => [`${x.session_id} ${x.test_id}`, x]));
  const used = new Set(RESERVED.map((n) => n.toLowerCase()));
  for (const s of summary.sessions) {
    catalogSheet(wb, sheetName(s.configuration, used), tests, (t) => {
      const x = byKey.get(`${s.id} ${t.id}`);
      if (!x) return { value: NOT_INCLUDED, note: null, outcome: null };
      return { value: x.outcome === 'NOT PASSED' && x.graphic_issue ? 'NOT PASSED (lato grafico)' : x.outcome, note: x.note, outcome: x.outcome };
    });
  }

  // ---------- Esito Test ----------
  const es = wb.addWorksheet('Esito Test');
  es.getColumn('A').width = 4;
  for (const col of 'BCDEFGH') es.getColumn(col).width = 17;
  const put = (range, value, style = {}) => {
    const [first] = range.split(':');
    const cell = Object.assign(es.getCell(first), { value, alignment: { vertical: 'middle', wrapText: true, ...style.alignment }, border: BORDER });
    if (style.font) cell.font = style.font;
    if (style.fill) cell.fill = style.fill;
    if (range.includes(':')) es.mergeCells(range);
  };
  const label = { font: { bold: true }, fill: GREY };
  const t = summary.totals;
  put('B2:H2', '\nRisultati dei Test', { font: { bold: true, size: 16 }, alignment: { horizontal: 'center' } });
  put('B3:C3', 'Data Test:', label); put('D3', asDate(report?.test_date)); put('E3:F3', 'Effettuata da:', label); put('G3:H3', report?.executed_by ?? null);
  es.getCell('D3').numFmt = 'dd/mm/yyyy';
  put('B4:C4', 'Versione software:', label); put('D4', rel.version); put('E4:F4', 'Unit Test verificati:', label);
  put('G4:H4', `${summary.sessions.length} ${summary.sessions.length === 1 ? 'sessione' : 'sessioni'} · ${summary.tests} test`);
  put('B5:H5', 'Motivazione degli Unit Test', label); put('B6:H8', report?.motivation ?? null, { alignment: { vertical: 'top' } });
  put('B9:H9', 'Risultato degli Unit Test', label);
  put('B10:H10', `Esito calcolato ${COMPUTED[summary.computed].label}: ${t.PASSED} PASSED, ${t['NOT PASSED']} NOT PASSED, ${t['NOT AVAILABLE']} NOT AVAILABLE, ${t['NOT TESTED']} NOT TESTED su ${summary.sessions.length} sessioni.`);
  put('B11:H11', 'Prossime azioni', label); put('B12:H12', report?.next_actions ?? null);
  put('B13:E13', 'Risultato finale:', label);
  put('F13:H13', report?.final_outcome ?? null, { font: { bold: true }, alignment: { horizontal: 'center' }, fill: report?.final_outcome ? fill(OUTCOME_FILL[report.final_outcome]) : undefined });
  put('B14:C14', 'Motivazione:', label); put('D14:H14', report?.final_reason ?? null);
  put('B15:C15', 'Stato del report:', label); put('D15:H15', REPORT_STATUS[report?.status ?? 'draft'].label);
  es.getRow(2).height = 40;
  es.getRow(14).height = rowHeight([[report?.final_reason, 85]]);
  return { wb, version: rel.version };
}

export function exporter(db) {
  const r = Router();
  r.get('/release/:id/export.xlsx', async (req, res) => {
    const built = UUID.test(req.params.id) ? await buildWorkbook(db, req.params.id) : null;
    if (!built) return res.status(404).render('message', { title: 'Release non trovata', text: 'Potrebbe essere stata eliminata.', nav: 'rel' });
    res.attachment(`MyoLogic Pro - Unit Test ${built.version}.xlsx`);
    await built.wb.xlsx.write(res);
    res.end();
  });
  return r;
}
