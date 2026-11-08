import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import { createApp } from '../src/app.js';
import { testDb } from './helpers.js';

const USER = { id: uuid(), email: 'tester@example.com' };
const id = Object.fromEntries(['person', 'unit', 'uc', 'ah03', 'prism', 't1', 't2', 't3', 't4', 'conf', 'old', 'rel', 'ses'].map((k) => [k, uuid()]));
const test = (key, code, name, position) => ({ id: id[key], code, use_case_id: id.uc, name, description: `Descrizione ${code}`, operations: `Operazioni ${code}`, position });

// t1 AH03 (NOT PASSED nella sessione importata), t2 PRISM, t3 senza dispositivo, t4 AH03 archiviato.
const payload = {
  people: [{ id: id.person, full_name: "Gianluca D'Amico", title: 'Head of Sw Dv. Dept.' }],
  units: [{ id: id.unit, name: 'Calibrazione', position: 1 }],
  use_cases: [{ id: id.uc, unit_id: id.unit, name: 'Dual site', position: 1 }],
  devices: [{ id: id.ah03, name: 'AH03' }, { id: id.prism, name: 'PRISM' }],
  tests: [test('t1', 1, 'Calibra Dual Site', 1), test('t2', 2, 'Calibra con PRISM', 2), test('t3', 3, 'Vibrazione PULSE', 3), test('t4', 4, 'Vecchio test', 4)],
  test_devices: [{ test_id: id.t1, device_id: id.ah03 }, { test_id: id.t2, device_id: id.prism }, { test_id: id.t4, device_id: id.ah03 }],
  configurations: [{ id: id.conf, name: 'Conn.Remota ProiOS-AH02AH03+rot' }],
  releases: [
    { id: id.old, version: 'v.2.0.1_rev00', released_on: '2026-09-11', author_id: id.person, changes: 'Patch', position: 1 },
    { id: id.rel, version: 'v.2.1_rev00', released_on: '2026-09-20', author_id: id.person, changes: 'Release', position: 2 },
  ],
  release_signatures: [],
  sessions: [{ id: id.ses, release_id: id.rel, configuration_id: id.conf, tester_id: id.person, started_on: '2026-09-20', status: 'closed' }],
  results: [
    { session_id: id.ses, test_id: id.t1, outcome: 'NOT PASSED', note: 'Seriale tagliato', graphic_issue: false },
    { session_id: id.ses, test_id: id.t2, outcome: 'PASSED', note: null, graphic_issue: false },
  ],
  reports: [],
};

describe('release, configurazioni e sessioni', () => {
  let db, server, base;
  const get = (path, headers = {}) => fetch(base + path, { redirect: 'manual', headers });
  const post = (path, data = [], headers = {}) => fetch(base + path, { method: 'POST', body: new URLSearchParams(data), redirect: 'manual', headers });
  const json = (path, data) => post(path, data, { Accept: 'application/json' });
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const result = (session, code) => one('select x.outcome, x.note, x.graphic_issue, x.executed_by from results x join tests t on t.id = x.test_id where x.session_id = $1 and t.code = $2', [session, code]);
  let newSession;

  before(async () => {
    db = await testDb();
    await db.query('select import_workbook($1::jsonb)', [JSON.stringify(payload)]);
    await db.query('update tests set archived = true where id = $1', [id.t4]);
    await db.query('insert into auth.users (id, email) values ($1, $2)', [USER.id, USER.email]);
    const supabaseFor = () => ({ auth: { getUser: async () => ({ data: { user: USER } }), signOut: async () => ({}) } });
    server = createApp({ db, supabaseFor }).listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { server.close(); await db.end(); });

  it('collega una persona al proprio account', async () => {
    const res = await post(`/impostazioni/persone/${id.person}`, [['full_name', "Gianluca D'Amico"], ['title', 'Head of Sw Dv. Dept.'], ['user_id', USER.id]]);
    assert.equal(res.status, 303);
    assert.deepEqual(await one('select user_id from people where id = $1', [id.person]), { user_id: USER.id });
    const dup = await post('/impostazioni/persone', [['full_name', 'Altra persona'], ['user_id', USER.id]]);
    assert.equal(dup.status, 400);
    assert.match(await dup.text(), /già collegato/);
  });

  it('crea una release, la modifica, gestisce le firme e la rende attiva', async () => {
    assert.equal((await post('/release', [['version', '']])).status, 400);
    assert.match(await (await post('/release', [['version', 'v.2.1_rev00']])).text(), /Esiste già una release con questa versione/);
    const created = await post('/release', [['version', 'v.2.2_rev00'], ['released_on', '2026-10-30'], ['author_id', id.person], ['changes', 'Nuove prese']]);
    assert.equal(created.status, 303);
    const rel = await one("select id, released_on::text, position from releases where version = 'v.2.2_rev00'");
    assert.deepEqual({ ...rel, id: undefined }, { id: undefined, released_on: '2026-10-30', position: 3 });

    await post(`/release/${rel.id}`, [['version', 'v.2.2_rev00'], ['released_on', 'non-una-data']]).then((r) => assert.equal(r.status, 400));
    await post(`/release/${rel.id}/firme`, [['person_id', id.person], ['role', 'approver'], ['signed_on', '2026-10-31']]);
    assert.equal((await one('select count(*)::int n from release_signatures where release_id = $1', [rel.id])).n, 1);
    assert.match(await (await post(`/release/${rel.id}/firme`, [['person_id', id.person], ['role', 'approver']])).text(), /ha già questa firma/);
    assert.match(await (await get(`/release/${rel.id}/firme/elimina?person=${id.person}&role=approver`)).text(), /non comparirà più come approvatore/);
    await post(`/release/${rel.id}/firme/elimina?person=${id.person}&role=approver`);
    assert.equal((await one('select count(*)::int n from release_signatures where release_id = $1', [rel.id])).n, 0);

    // Senza cookie la release attiva è la più recente; "Usa questa" la cambia per tutta l'app.
    assert.match(await (await get('/sessioni')).text(), /Sessioni di test · v.2.2_rev00/);
    const use = await post(`/release/${id.rel}/usa`);
    const cookie = use.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, new RegExp(`release=${id.rel}`));
    assert.match(await (await get('/sessioni', { cookie })).text(), /Conn.Remota ProiOS-AH02AH03\+rot/);
    assert.match(await (await get('/catalogo', { cookie })).text(), /NOT PASSED"/);

    assert.equal((await post(`/release/${id.rel}/elimina`)).status, 409);
    assert.equal((await post(`/release/${rel.id}/elimina`)).status, 303);
    assert.equal(await one('select 1 from releases where id = $1', [rel.id]), undefined);
  });

  it('crea configurazioni con i loro dispositivi e ne protegge l\'eliminazione', async () => {
    await post('/impostazioni/configurazioni', [['name', 'AH03 + rotatore'], ['devices', id.ah03]]);
    const conf = await one("select c.id, (select count(*)::int from configuration_devices where configuration_id = c.id) as devices from configurations c where name = 'AH03 + rotatore'");
    assert.equal(conf.devices, 1);
    assert.equal((await post(`/impostazioni/dispositivi/${id.ah03}/elimina`)).status, 409);
    assert.equal((await post(`/impostazioni/configurazioni/${id.conf}/elimina`)).status, 409);
    assert.match(await (await get('/sessioni/nuova')).text(), /AH03 \+ rotatore · 2 test · AH03/);
  });

  it('crea una sessione con i test dei dispositivi della configurazione', async () => {
    const conf = await one("select id from configurations where name = 'AH03 + rotatore'");
    const res = await post('/sessioni', [['release_id', id.rel], ['configuration_id', conf.id], ['tester_id', id.person], ['started_on', '2026-10-24']]);
    assert.equal(res.status, 303);
    newSession = res.headers.get('location').match(/\/sessioni\/([0-9a-f-]+)/)[1];
    // t1 (AH03) e t3 (senza dispositivo); non t2 (PRISM) né t4 (archiviato)
    const codes = (await db.query('select t.code from results x join tests t on t.id = x.test_id where x.session_id = $1 order by t.code', [newSession])).rows.map((r) => r.code);
    assert.deepEqual(codes, [1, 3]);
    // una configurazione senza dispositivi prende tutti i test non archiviati
    assert.match(await (await get('/sessioni/nuova')).text(), /Conn.Remota ProiOS-AH02AH03\+rot · 3 test · tutti i dispositivi/);
  });

  it('registra esiti e note senza perdere quel che c\'era', async () => {
    const page = await (await get(`/sessioni/${newSession}`)).text();
    assert.match(page, /id="t-1"/);
    assert.match(page, /Da eseguire e falliti<b data-count="aperti">2</);

    const res = await json(`/sessioni/${newSession}/esiti/1`, [['outcome', 'PASSED'], ['note', 'Ok al primo colpo']]);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.outcome, 'PASSED');
    assert.equal(body.counts.PASSED, 1);
    assert.deepEqual(await result(newSession, 1), { outcome: 'PASSED', note: 'Ok al primo colpo', graphic_issue: false, executed_by: id.person });

    // solo esito, senza campo nota (es. tasto rapido da un altro client): la nota resta
    await json(`/sessioni/${newSession}/esiti/1`, [['outcome', 'NOT PASSED']]);
    assert.equal((await result(newSession, 1)).note, 'Ok al primo colpo');
    // solo nota e problema grafico: l'esito resta
    await json(`/sessioni/${newSession}/esiti/1`, [['note', 'Slider sfasato'], ['graphic_issue', '1']]);
    assert.deepEqual(await result(newSession, 1), { outcome: 'NOT PASSED', note: 'Slider sfasato', graphic_issue: true, executed_by: id.person });

    assert.equal((await json(`/sessioni/${newSession}/esiti/1`, [['outcome', 'FORSE']])).status, 400);
    assert.equal((await json(`/sessioni/${newSession}/esiti/2`, [['outcome', 'PASSED']])).status, 404);

    // senza JavaScript: il form torna sulla riga del test con gli stessi filtri
    const form = await post(`/sessioni/${newSession}/esiti/3?vista=aperti`, [['outcome', 'NOT AVAILABLE'], ['note', '']]);
    assert.equal(form.status, 303);
    assert.equal(form.headers.get('location'), `/sessioni/${newSession}?vista=aperti#t-3`);

    const failed = await (await get(`/sessioni/${newSession}?vista=falliti`)).text();
    assert.match(failed, /id="t-1"/);
    assert.doesNotMatch(failed, /id="t-3"/);
  });

  it('toglie e aggiunge test senza cancellare esiti registrati', async () => {
    assert.equal((await post(`/sessioni/${newSession}/test/1/togli`)).status, 409);
    await json(`/sessioni/${newSession}/esiti/3`, [['outcome', 'NOT TESTED'], ['note', '']]);
    assert.equal((await post(`/sessioni/${newSession}/test/3/togli`)).status, 303);
    assert.equal(await result(newSession, 3), undefined);
    assert.match(await (await get(`/sessioni/${newSession}/aggiungi`)).text(), /Vibrazione PULSE/);
    assert.equal((await post(`/sessioni/${newSession}/aggiungi`, [['code', '3']])).status, 303);
    assert.equal((await result(newSession, 3)).outcome, 'NOT TESTED');
    assert.equal((await post(`/sessioni/${newSession}/aggiungi`, [['code', '4']])).status, 409); // archiviato
  });

  it('una sessione chiusa non accetta modifiche finché non viene riaperta', async () => {
    await post(`/sessioni/${newSession}/stato`, [['status', 'closed']]);
    const res = await json(`/sessioni/${newSession}/esiti/1`, [['outcome', 'PASSED']]);
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /chiusa/);
    assert.equal((await result(newSession, 1)).outcome, 'NOT PASSED');
    await post(`/sessioni/${newSession}/stato`, [['status', 'open']]);
    assert.equal((await json(`/sessioni/${newSession}/esiti/1`, [['outcome', 'PASSED']])).status, 200);
  });

  it('modifica ed elimina una sessione con conferma', async () => {
    assert.equal((await post(`/sessioni/${newSession}/modifica`, [['tester_id', ''], ['started_on', '2026-10-25']])).status, 303);
    assert.deepEqual(await one('select tester_id, started_on::text from sessions where id = $1', [newSession]), { tester_id: null, started_on: '2026-10-25' });
    assert.match(await (await get(`/sessioni/${newSession}/elimina`)).text(), /i suoi 2 esiti, di cui 1 già registrati/);
    assert.equal((await post(`/sessioni/${newSession}/elimina`)).status, 303);
    assert.equal((await one('select count(*)::int n from results where session_id = $1', [newSession])).n, 0);
    assert.equal((await post(`/impostazioni/persone/${id.person}/elimina`)).status, 409); // è tester della sessione importata
  });
});
