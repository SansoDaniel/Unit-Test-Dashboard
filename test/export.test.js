import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app.js';
import { apply, parseWorkbook } from '../scripts/import-excel.js';
import { testDb } from './helpers.js';

// Tutto ciò che il formato Excel porta con sé, senza gli id: due database con gli stessi dati danno lo stesso risultato.
async function snapshot(db) {
  const rows = async (sql) => (await db.query(sql)).rows;
  return {
    units: await rows('select name from units order by position'),
    tests: await rows(`select u.name as unit, uc.name as use_case, t.code, t.name, t.description, t.operations,
                              coalesce((select string_agg(d.name, '/' order by d.name) from test_devices td join devices d on d.id = td.device_id where td.test_id = t.id), '') as devices
                       from tests t join use_cases uc on uc.id = t.use_case_id join units u on u.id = uc.unit_id order by u.position, uc.position, t.position, t.code`),
    sessions: await rows(`select c.name, s.status, s.started_on::text, p.full_name as tester from sessions s join configurations c on c.id = s.configuration_id
                          left join people p on p.id = s.tester_id order by c.name`),
    results: await rows(`select c.name as configuration, t.code, x.outcome, x.note, x.graphic_issue from results x join sessions s on s.id = x.session_id
                         join configurations c on c.id = s.configuration_id join tests t on t.id = x.test_id order by c.name, t.code`),
    releases: await rows('select rl.version, rl.released_on::text, p.full_name as author, rl.changes from releases rl left join people p on p.id = rl.author_id order by rl.position'),
    signatures: await rows(`select rl.version, p.full_name, p.title, sg.role, sg.signed_on::text from release_signatures sg join releases rl on rl.id = sg.release_id
                            join people p on p.id = sg.person_id order by rl.version, p.full_name, sg.role`),
    reports: await rows(`select rl.version, rp.test_date::text, p.full_name as executed_by, rp.motivation, rp.next_actions, rp.final_outcome, rp.final_reason, rp.status
                         from reports rp join releases rl on rl.id = rp.release_id left join people p on p.id = rp.executed_by order by rl.version`),
  };
}

async function exportRelease(db, version) {
  const user = { id: uuid(), email: 'tester@example.com' };
  const server = createApp({ db, supabaseFor: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }).listen(0);
  try {
    const { rows: [rel] } = await db.query('select id from releases where version = $1', [version]);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/release/${rel.id}/export.xlsx`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), new RegExp(`MyoLogic Pro - Unit Test ${version.replaceAll('.', '\\.')}\\.xlsx`));
    return Buffer.from(await res.arrayBuffer());
  } finally {
    server.close();
  }
}

async function roundTrip(db, version) {
  const file = await exportRelease(db, version);
  const again = await testDb();
  await apply(again, await parseWorkbook(file));
  const result = { before: await snapshot(db), after: await snapshot(again), file };
  await again.end();
  return result;
}

test('esportare e reimportare una release restituisce gli stessi dati', async () => {
  const id = Object.fromEntries(['gian', 'ang', 'u1', 'u2', 'c1', 'c2', 'c3', 'ah03', 'prism', 't1', 't2', 't3', 't4', 'cf1', 'cf2', 'old', 'rel', 's1', 's2'].map((k) => [k, uuid()]));
  const t = (key, code, uc, name, description, operations, position) => ({ id: id[key], code, use_case_id: id[uc], name, description, operations, position });
  const payload = {
    people: [{ id: id.gian, full_name: "Gianluca D'Amico", title: 'Head of Sw Dv. Dept.' }, { id: id.ang, full_name: 'Angelo Carrabba', title: 'AI Software Developer' }],
    units: [{ id: id.u1, name: 'Calibrazione e Test del dispositivo', position: 1 }, { id: id.u2, name: "Impostazioni Adam's Hand", position: 2 }],
    use_cases: [
      { id: id.c1, unit_id: id.u1, name: "Calibra Adam's Hand – DUAL SITE", position: 1 },
      { id: id.c2, unit_id: id.u1, name: 'Modalità Commutazione Polso', position: 2 },
      { id: id.c3, unit_id: id.u2, name: "Impostazioni Feedback Adam's Hand", position: 3 },
    ],
    devices: [{ id: id.ah03, name: 'AH03' }, { id: id.prism, name: 'PRISM' }],
    tests: [
      t('t1', 92, 'c1', "Calibra Adam's Hand - Dual Site", 'Calibrazione mediante procedura assistita', 'REST - CLOSE - OPEN\nPoi SALVA', 1),
      t('t2', 185, 'c1', "Calibra Adam's Hand - Dual Site con PRISM", null, null, 2),
      t('t3', 102, 'c2', 'Modalità Commutazione Rotatore POLSO', 'Descrizione', null, 3),
      t('t4', 163, 'c3', "Impostazioni Feedback Adam's Hand", 'Vibrazione, Buzzer, LED', 'Tre switch', 4),
    ],
    test_devices: [{ test_id: id.t1, device_id: id.ah03 }, { test_id: id.t2, device_id: id.prism }, { test_id: id.t3, device_id: id.ah03 }, { test_id: id.t3, device_id: id.prism }],
    configurations: [{ id: id.cf1, name: 'AH03 + rotatore + PRISM + Pulse' }, { id: id.cf2, name: 'Conn.Remota ProiOS-AH02AH03+rot' }],
    releases: [
      { id: id.old, version: 'v.2.0.1_rev00', released_on: '2026-09-11', author_id: id.gian, changes: 'Patch:\nOptimizations', position: 1 },
      { id: id.rel, version: 'v.2.1_rev00', released_on: null, author_id: id.ang, changes: 'Release:\n-Terza posizione del pollice', position: 2 },
    ],
    release_signatures: [
      { release_id: id.rel, person_id: id.ang, role: 'author', signed_on: '2026-08-04' },
      { release_id: id.rel, person_id: id.gian, role: 'approver', signed_on: '2026-08-04' },
    ],
    sessions: [
      { id: id.s1, release_id: id.rel, configuration_id: id.cf1, tester_id: id.gian, started_on: '2026-09-20', status: 'closed' },
      { id: id.s2, release_id: id.rel, configuration_id: id.cf2, tester_id: id.gian, started_on: '2026-09-20', status: 'closed' },
    ],
    results: [
      { session_id: id.s1, test_id: id.t1, outcome: 'PASSED', note: null, graphic_issue: false },
      { session_id: id.s1, test_id: id.t2, outcome: 'NOT PASSED', note: 'Seriale tagliato\nultima cifra', graphic_issue: false },
      { session_id: id.s1, test_id: id.t3, outcome: 'NOT AVAILABLE', note: null, graphic_issue: false },
      { session_id: id.s1, test_id: id.t4, outcome: 'NOT TESTED', note: null, graphic_issue: false },
      // la seconda sessione contiene solo due test: gli altri escono come "NON INCLUSO"
      { session_id: id.s2, test_id: id.t1, outcome: 'NOT PASSED', note: 'Quadrato blu sotto lo slider', graphic_issue: true },
      { session_id: id.s2, test_id: id.t4, outcome: 'PASSED', note: 'Ok', graphic_issue: false },
    ],
    reports: [{ release_id: id.rel, test_date: '2026-09-20', executed_by: id.gian, motivation: 'Test della versione v2.1', next_actions: 'Rilascio',
      final_outcome: 'PASSED', final_reason: 'Difetti grafici accettati', status: 'pending_approval' }],
  };
  const db = await testDb();
  await db.query('select import_workbook($1::jsonb)', [JSON.stringify(payload)]);

  const { before, after, file } = await roundTrip(db, 'v.2.1_rev00');
  assert.deepEqual(after, before);
  assert.equal(after.results.length, 6); // nessun esito in più per i test non inclusi

  // il file ha la struttura del documento originale
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file);
  assert.deepEqual(wb.worksheets.map((ws) => ws.name), ['Cover&History', 'Unit Test', 'AH03 + rotatore + PRISM + Pulse', 'Conn.Remota ProiOS-AH02AH03+rot', 'Esito Test']);
  const ios = wb.getWorksheet('Conn.Remota ProiOS-AH02AH03+rot');
  assert.deepEqual(['P1', 'P2', 'P3', 'P4', 'P5'].map((a) => ios.getCell(a).value), ['ESITO', 'NOT PASSED (lato grafico)', 'NON INCLUSO', 'NON INCLUSO', 'PASSED']);
  assert.equal(wb.getWorksheet('Esito Test').getCell('F13').value, 'PASSED');
  await db.end();
});

const xlsx = process.env.UT_XLSX;
test('il file originale passa da import → export → import senza differenze', { skip: !xlsx && 'imposta UT_XLSX con il percorso del file Excel' }, async () => {
  const db = await testDb();
  await apply(db, await parseWorkbook(xlsx));
  const { before, after } = await roundTrip(db, 'v.2.1_rev00');
  assert.equal(after.tests.length, 264);
  assert.equal(after.results.length, 1056);
  assert.deepEqual(after, before);
  await db.end();
});
