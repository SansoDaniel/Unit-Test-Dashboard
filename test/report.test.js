import { after, before, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import { createApp } from '../src/app.js';
import { semicircle } from '../src/dashboard.js';
import { apply, parseWorkbook } from '../scripts/import-excel.js';
import { testDb } from './helpers.js';

const ALICE = { id: uuid(), email: 'alice@example.com' }; // autrice della release
const BRUNO = { id: uuid(), email: 'bruno@example.com' }; // approvatore
const id = Object.fromEntries(['alice', 'bruno', 'carla', 'unit', 'uc', 't1', 't2', 'conf', 'rel', 'bare', 'ses'].map((k) => [k, uuid()]));

const payload = {
  people: [{ id: id.alice, full_name: 'Alice Autrice', title: null }, { id: id.bruno, full_name: 'Bruno Approvatore', title: 'CRO' }, { id: id.carla, full_name: 'Carla Approvatrice', title: null }],
  units: [{ id: id.unit, name: 'Calibrazione e Test del dispositivo', position: 1 }],
  use_cases: [{ id: id.uc, unit_id: id.unit, name: 'Dual site', position: 1 }],
  devices: [],
  tests: [
    { id: id.t1, code: 92, use_case_id: id.uc, name: 'Calibra Dual Site', description: null, operations: null, position: 1 },
    { id: id.t2, code: 93, use_case_id: id.uc, name: 'Procedura annullata', description: null, operations: null, position: 2 },
  ],
  test_devices: [],
  configurations: [{ id: id.conf, name: 'AH03 + rotatore + PRISM + Pulse' }],
  releases: [
    { id: id.bare, version: 'v.2.0.1_rev00', released_on: '2026-09-11', author_id: id.alice, changes: null, position: 1 },
    { id: id.rel, version: 'v.2.1_rev00', released_on: '2026-09-20', author_id: id.alice, changes: 'Terza posizione del pollice', position: 2 },
  ],
  release_signatures: [{ release_id: id.rel, person_id: id.bruno, role: 'approver', signed_on: null }, { release_id: id.rel, person_id: id.carla, role: 'approver', signed_on: null }],
  sessions: [{ id: id.ses, release_id: id.rel, configuration_id: id.conf, tester_id: id.alice, started_on: '2026-10-24', status: 'open' }],
  results: [
    { session_id: id.ses, test_id: id.t1, outcome: 'NOT TESTED', note: null, graphic_issue: false },
    { session_id: id.ses, test_id: id.t2, outcome: 'NOT TESTED', note: null, graphic_issue: false },
  ],
  reports: [],
};

describe('dashboard, report e notifiche', () => {
  let db, server, base, current = ALICE;
  const get = (path) => fetch(base + path, { redirect: 'manual' });
  const post = (path, data = []) => fetch(base + path, { method: 'POST', body: new URLSearchParams(data), redirect: 'manual' });
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const inbox = async (person, event) => (await db.query('select title, detail, link, read_at from notifications where person_id = $1 and event = $2 order by id', [person, event])).rows;
  const reportForm = (fields = {}) => Object.entries({ test_date: '2026-10-24', executed_by: id.alice, motivation: 'Test della v2.1', next_actions: 'Rilascio', final_outcome: '', final_reason: '', ...fields });

  before(async () => {
    db = await testDb();
    await db.query('select import_workbook($1::jsonb)', [JSON.stringify(payload)]);
    await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [ALICE.id, ALICE.email, BRUNO.id, BRUNO.email]);
    await db.query('update people set user_id = $2 where id = $1', [id.alice, ALICE.id]);
    await db.query('update people set user_id = $2 where id = $1', [id.bruno, BRUNO.id]);
    const supabaseFor = () => ({ auth: { getUser: async () => ({ data: { user: current } }), signOut: async () => ({}) } });
    server = createApp({ db, supabaseFor }).listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { server.close(); await db.end(); });

  it("l'import non crea notifiche", async () => {
    assert.equal((await one('select count(*)::int n from notifications')).n, 0);
  });

  it('un nuovo NOT PASSED avvisa autore e approvatori, tranne chi lo registra', async () => {
    await post(`/sessioni/${id.ses}/esiti/92`, [['outcome', 'NOT PASSED'], ['note', 'Seriale tagliato']]);
    assert.deepEqual(await inbox(id.alice, 'not_passed'), []);
    const [n] = await inbox(id.bruno, 'not_passed');
    assert.deepEqual(n, { title: 'Test 92 · Calibra Dual Site', detail: 'AH03 + rotatore + PRISM + Pulse · registrato da Alice Autrice', link: `/sessioni/${id.ses}#t-92`, read_at: null });
    assert.equal((await inbox(id.carla, 'not_passed')).length, 1);
    // salvare di nuovo lo stesso esito non crea un'altra notifica
    await post(`/sessioni/${id.ses}/esiti/92`, [['outcome', 'NOT PASSED'], ['note', 'Seriale tagliato, ultima cifra']]);
    assert.equal((await inbox(id.bruno, 'not_passed')).length, 1);
  });

  it('la campanella mostra solo le notifiche proprie e le segna lette', async () => {
    current = BRUNO;
    const home = await (await get('/')).text();
    assert.match(home, /Notifiche: 1 da leggere/);
    assert.match(home, /Test 92 · Calibra Dual Site/);
    const mine = await one('select id from notifications where person_id = $1', [id.bruno]);
    const others = await one('select id from notifications where person_id = $1', [id.carla]);
    assert.equal((await post(`/notifiche/${others.id}/apri`)).status, 404);
    const open = await post(`/notifiche/${mine.id}/apri`);
    assert.equal(open.status, 303);
    assert.equal(open.headers.get('location'), `/sessioni/${id.ses}#t-92`);
    assert.notEqual((await inbox(id.bruno, 'not_passed'))[0].read_at, null);
    assert.match(await (await get('/notifiche')).text(), /Nessuna notifica da leggere/);
    assert.match(await (await get('/notifiche?tutte=1')).text(), /Test 92 · Calibra Dual Site/);
    current = ALICE;
  });

  it('chiudere una sessione avvisa autore e approvatori', async () => {
    await post(`/sessioni/${id.ses}/stato`, [['status', 'closed']]);
    const [n] = await inbox(id.bruno, 'session_closed');
    assert.equal(n.title, 'AH03 + rotatore + PRISM + Pulse');
    assert.equal(n.detail, '0 PASSED · 1 NOT PASSED · 1 NOT TESTED · chiusa da Alice Autrice');
    assert.deepEqual(await inbox(id.alice, 'session_closed'), []);
  });

  it('la dashboard mostra esito calcolato, copertura e NOT PASSED aperti', async () => {
    const html = await (await get('/')).text();
    assert.match(html, /Release v.2.1_rev00/);
    assert.match(html, /<span class="tag fail">NOT PASSED<\/span>/);
    assert.match(html, /1 NOT PASSED su 1 test da chiudere o motivare/);
    assert.match(html, /<span class="mk f" title="1 NOT PASSED">1<\/span>/);
    assert.match(html, /Seriale tagliato, ultima cifra/);
    // grafici: media tra le release (solo quelle con esiti) e unità con più NOT PASSED
    assert.match(html, /media delle percentuali di 1 release con esiti su 2/);
    assert.match(html, /aria-label="Media: PASSED 0%, NOT AVAILABLE 0%, NOT PASSED 50%, NOT TESTED 50%"/);
  });

  it('il report chiede la motivazione se il risultato finale è diverso da quello calcolato', async () => {
    const bad = await post(`/release/${id.rel}/report`, reportForm({ final_outcome: 'PASSED' }));
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /diverso da quello calcolato \(NOT PASSED\): scrivi la motivazione/);
    assert.equal(await one('select 1 from reports where release_id = $1', [id.rel]), undefined);
    const ok = await post(`/release/${id.rel}/report`, reportForm({ final_outcome: 'PASSED', final_reason: 'Difetto grafico accettato' }));
    assert.equal(ok.status, 303);
    assert.deepEqual(await one('select final_outcome, final_reason, status from reports where release_id = $1', [id.rel]),
      { final_outcome: 'PASSED', final_reason: 'Difetto grafico accettato', status: 'draft' });
  });

  it('invio e approvazione: solo agli approvatori, solo da un approvatore', async () => {
    assert.match(await (await post(`/release/${id.bare}/report/invia`)).text(), /Salva il report prima di inviarlo/);
    await post(`/release/${id.bare}/report`, reportForm({ final_outcome: 'NOT PASSED', final_reason: 'Nessuna sessione' }));
    const noApprovers = await post(`/release/${id.bare}/report/invia`);
    assert.equal(noApprovers.status, 409);
    assert.match(await noApprovers.text(), /non ha approvatori/);

    assert.equal((await post(`/release/${id.rel}/report/invia`)).status, 303);
    assert.equal((await one('select status from reports where release_id = $1', [id.rel])).status, 'pending_approval');
    assert.equal((await inbox(id.bruno, 'report_pending'))[0].title, 'Report v.2.1_rev00 da approvare');
    assert.equal((await inbox(id.carla, 'report_pending')).length, 1);
    assert.deepEqual(await inbox(id.alice, 'report_pending'), []);

    assert.equal((await post(`/release/${id.rel}/report/approva`)).status, 403); // Alice è l'autrice, non un'approvatrice
    current = BRUNO;
    assert.match(await (await get(`/release/${id.rel}/report`)).text(), /Approva report/);
    assert.equal((await post(`/release/${id.rel}/report/approva`)).status, 303);
    assert.equal((await one('select status from reports where release_id = $1', [id.rel])).status, 'approved');
    current = ALICE;

    // una modifica dopo l'approvazione riporta il report in bozza
    const edit = await post(`/release/${id.rel}/report`, reportForm({ final_outcome: 'PASSED', final_reason: 'Difetto grafico accettato, rimandato alla v2.2' }));
    assert.equal(edit.headers.get('location'), `/release/${id.rel}/report?ok=bozza`);
    assert.equal((await one('select status from reports where release_id = $1', [id.rel])).status, 'draft');
  });

  it('ognuno elimina le proprie notifiche, con conferma', async () => {
    current = BRUNO;
    const mine = await one("select id from notifications where person_id = $1 and event = 'session_closed'", [id.bruno]);
    assert.match(await (await get(`/notifiche/${mine.id}/elimina`)).text(), /sparirà dalle tue notifiche/);
    await post(`/notifiche/${mine.id}/elimina`);
    assert.equal(await one('select 1 from notifications where id = $1', [mine.id]), undefined);
    await post('/notifiche/lette');
    assert.equal((await one('select count(*)::int n from notifications where person_id = $1 and read_at is null', [id.bruno])).n, 0);
    assert.notEqual((await one("select count(*)::int n from notifications where person_id = $1 and read_at is null", [id.carla])).n, 0);
    current = ALICE;
  });
});

const xlsx = process.env.UT_XLSX;
test('il report della v.2.1 importata riporta gli stessi numeri del file', { skip: !xlsx && 'imposta UT_XLSX con il percorso del file Excel' }, async () => {
  const db = await testDb();
  await apply(db, await parseWorkbook(xlsx));
  const user = { id: uuid(), email: 'tester@example.com' };
  const server = createApp({ db, supabaseFor: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const { rows: [rel] } = await db.query("select id from releases where version = 'v.2.1_rev00'");
  const html = await (await fetch(`${base}/release/${rel.id}/report`)).text();
  assert.match(html, /<td>Totale<\/td><td class="num">335<\/td><td class="num fail-text">12<\/td><td class="num">4<\/td><td class="num">705<\/td>/);
  assert.match(html, /4 sessioni · 264 test/);
  assert.match(html, /12 esiti NOT PASSED su 8 test/);
  assert.match(html, /<option value="PASSED" selected>PASSED<\/option>/); // risultato finale del file
  assert.match(html, /manca la motivazione/); // il file ha PASSED senza motivazione
  const dash = await (await fetch(`${base}/`)).text();
  assert.match(dash, /12 NOT PASSED su 8 test da chiudere o motivare/);
  assert.match(dash, /<text x="100" y="86" class="g-val">31,7%<\/text>/);
  server.close();
  await db.end();
});

test('i semicerchi vanno da sinistra a destra, con lo spazio tra i segmenti e quelli piccoli visibili', () => {
  const pct = (passed, na, failed, todo) => ({ 'PASSED': passed, 'NOT AVAILABLE': na, 'NOT PASSED': failed, 'NOT TESTED': todo });
  const [only] = semicircle(pct(100, 0, 0, 0));
  assert.equal(only.d, 'M 20.00 96.00 A 80 80 0 0 1 180.00 96.00');
  const arcs = semicircle(pct(31.7, 0.4, 1.1, 66.8));
  assert.deepEqual(arcs.map((a) => a.outcome), ['PASSED', 'NOT AVAILABLE', 'NOT PASSED', 'NOT TESTED']);
  assert.match(arcs[0].d, /^M 20\.00 96\.00 /);
  assert.match(arcs.at(-1).d, / 180\.00 96\.00$/);
  const end = (a) => a.d.split(' ').slice(-2).join(' ');
  const start = (a) => a.d.split(' ').slice(1, 3).join(' ');
  assert.notEqual(end(arcs[0]), start(arcs[1])); // 2px di spazio tra PASSED e il segmento dopo
});
