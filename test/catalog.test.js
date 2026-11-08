import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import { createApp } from '../src/app.js';
import { testDb } from './helpers.js';

const USER = { id: uuid(), email: 'tester@example.com' };
const id = Object.fromEntries(['person', 'unit', 'empty', 'dual', 'single', 'ah03', 'prism', 't92', 't93', 't94', 'rel', 'conf', 'ses'].map((k) => [k, uuid()]));

// Un piccolo catalogo: un test con esito NOT PASSED (92), uno senza esiti (93), uno in un altro caso d'uso (94).
const payload = {
  people: [{ id: id.person, full_name: "Gianluca D'Amico", title: null }],
  units: [{ id: id.unit, name: 'Calibrazione e Test del dispositivo', position: 1 }, { id: id.empty, name: 'Unità vuota', position: 2 }],
  use_cases: [
    { id: id.dual, unit_id: id.unit, name: "Calibra Adam's Hand – DUAL SITE", position: 1 },
    { id: id.single, unit_id: id.unit, name: "Calibra Adam's Hand – SINGLE SITE", position: 2 },
  ],
  devices: [{ id: id.ah03, name: 'AH03' }, { id: id.prism, name: 'PRISM' }],
  tests: [
    { id: id.t92, code: 92, use_case_id: id.dual, name: 'Calibra Dual Site', description: 'Procedura assistita', operations: 'REST - CLOSE - OPEN', position: 1 },
    { id: id.t93, code: 93, use_case_id: id.dual, name: 'Calibra Dual Site annullata', description: null, operations: null, position: 2 },
    { id: id.t94, code: 94, use_case_id: id.single, name: 'Calibra Single Site', description: null, operations: null, position: 3 },
  ],
  test_devices: [{ test_id: id.t92, device_id: id.ah03 }],
  configurations: [{ id: id.conf, name: 'AH03 + rotatore + PRISM + Pulse' }],
  releases: [{ id: id.rel, version: 'v.2.1_rev00', released_on: '2026-09-20', author_id: id.person, changes: null, position: 1 }],
  release_signatures: [],
  sessions: [{ id: id.ses, release_id: id.rel, configuration_id: id.conf, tester_id: id.person, started_on: '2026-09-20', status: 'closed' }],
  results: [{ session_id: id.ses, test_id: id.t92, outcome: 'NOT PASSED', note: 'Seriale tagliato', graphic_issue: false }],
  reports: [],
};

describe('catalogo', () => {
  let db, server, base;
  const get = (path) => fetch(base + path, { redirect: 'manual' });
  const post = (path, data = []) => fetch(base + path, { method: 'POST', body: new URLSearchParams(data), redirect: 'manual' });
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const testForm = (fields = {}, devices = []) => [
    ...Object.entries({ code: '200', use_case_id: id.single, name: 'Nuovo test', description: '', operations: '', ...fields }),
    ...devices.map((d) => ['devices', d]),
  ];

  before(async () => {
    db = await testDb();
    await db.query('select import_workbook($1::jsonb)', [JSON.stringify(payload)]);
    const supabaseFor = () => ({ auth: { getUser: async () => ({ data: { user: USER } }), signOut: async () => ({}) } });
    server = createApp({ db, supabaseFor }).listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { server.close(); await db.end(); });

  it('mostra albero, test ed esiti della release', async () => {
    const html = await (await get(`/catalogo?unit=${id.unit}`)).text();
    assert.match(html, /Calibra Dual Site/);
    assert.match(html, /Unità vuota/);
    assert.match(html, /aria-label="AH03 \+ rotatore \+ PRISM \+ Pulse: NOT PASSED"/);
  });

  it('filtra per testo, dispositivo e NOT PASSED', async () => {
    const byText = await (await get('/catalogo?q=single')).text();
    assert.match(byText, /Calibra Single Site/);
    assert.doesNotMatch(byText, /Calibra Dual Site</);
    const byCode = await (await get('/catalogo?q=93')).text();
    assert.match(byCode, /Calibra Dual Site annullata/);
    assert.doesNotMatch(byCode, /Calibra Single Site/);
    const byDevice = await (await get(`/catalogo?device=${id.ah03}`)).text();
    assert.match(byDevice, /Calibra Dual Site</);
    assert.doesNotMatch(byDevice, /Calibra Single Site/);
    const failed = await (await get('/catalogo?np=1')).text();
    assert.match(failed, /Calibra Dual Site</);
    assert.doesNotMatch(failed, /Calibra Dual Site annullata/);
  });

  it('crea un test con i suoi dispositivi e registra chi lo ha creato', async () => {
    const res = await post('/catalogo/test', testForm({}, [id.ah03, id.prism]));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/catalogo/test/200?ok=creato');
    const t = await one("select t.id, (select count(*)::int from test_devices where test_id = t.id) as devices from tests t where code = 200");
    assert.equal(t.devices, 2);
    const audit = await one("select actor, actor_email from audit_log where table_name = 'tests' and action = 'INSERT' and new_data->>'id' = $1", [t.id]);
    assert.deepEqual(audit, { actor: USER.id, actor_email: USER.email });
  });

  it('rifiuta dati non validi senza salvare', async () => {
    const dupCode = await post('/catalogo/test', testForm({ code: '92' }));
    assert.equal(dupCode.status, 400);
    assert.match(await dupCode.text(), /Esiste già un test con questo ID/);
    const noName = await post('/catalogo/test', testForm({ code: '201', name: '' }));
    assert.equal(noName.status, 400);
    assert.match(await noName.text(), /Il nome del test è obbligatorio/);
    assert.equal((await one('select count(*)::int n from tests where code = 201')).n, 0);
  });

  it('modifica nome e dispositivi e mostra lo storico', async () => {
    const res = await post('/catalogo/test/200', testForm({ name: 'Nuovo test rivisto' }, [id.prism]));
    assert.equal(res.status, 303);
    const devices = (await db.query("select d.name from tests t join test_devices td on td.test_id = t.id join devices d on d.id = td.device_id where t.code = 200")).rows;
    assert.deepEqual(devices, [{ name: 'PRISM' }]);
    const html = await (await get('/catalogo/test/200')).text();
    assert.match(html, /Modificato: nome/);
    assert.match(html, /Tolto il dispositivo AH03/);
  });

  it('duplica un test con i dispositivi', async () => {
    const res = await post('/catalogo/test/92/duplica');
    assert.equal(res.status, 303);
    const copy = await one("select t.name, t.code, (select count(*)::int from test_devices where test_id = t.id) as devices from tests t where name = 'Calibra Dual Site (copia)'");
    assert.deepEqual(copy, { name: 'Calibra Dual Site (copia)', code: 201, devices: 1 });
  });

  it('archivia un test con esiti ed elimina uno senza', async () => {
    assert.match(await (await get('/catalogo/test/92/elimina')).text(), /verrà archiviato/);
    assert.equal((await post('/catalogo/test/92/elimina')).status, 303);
    assert.deepEqual(await one('select archived from tests where code = 92'), { archived: true });
    assert.doesNotMatch(await (await get(`/catalogo?unit=${id.unit}`)).text(), /Calibra Dual Site</);
    assert.match(await (await get(`/catalogo?unit=${id.unit}&archived=1`)).text(), /Calibra Dual Site</);

    assert.match(await (await get('/catalogo/test/93/elimina')).text(), /eliminato definitivamente/);
    await post('/catalogo/test/93/elimina');
    assert.equal(await one('select 1 from tests where code = 93'), undefined);

    await post('/catalogo/test/92/ripristina');
    assert.deepEqual(await one('select archived from tests where code = 92'), { archived: false });
  });

  it('elimina unità, casi d\'uso e dispositivi solo se non sono usati', async () => {
    const unit = await post(`/catalogo/unita/${id.unit}/elimina`);
    assert.equal(unit.status, 409);
    assert.match(await unit.text(), /contiene 2 casi d(&#39;|')uso/);
    assert.equal((await post(`/catalogo/unita/${id.empty}/elimina`)).status, 303);
    assert.equal(await one('select 1 from units where id = $1', [id.empty]), undefined);

    assert.equal((await post(`/catalogo/casi/${id.single}/elimina`)).status, 409);
    assert.equal((await post(`/impostazioni/dispositivi/${id.ah03}/elimina`)).status, 409);
    await post('/impostazioni/dispositivi', [['name', 'MyoUnit']]);
    const myo = await one("select id from devices where name = 'MyoUnit'");
    assert.equal((await post(`/impostazioni/dispositivi/${myo.id}/elimina`)).status, 303);
    assert.equal(await one("select 1 from devices where name = 'MyoUnit'"), undefined);
  });

  it('gestisce nomi duplicati, spostamenti e riordino', async () => {
    const dup = await post('/catalogo/unita', [['name', 'Calibrazione e Test del dispositivo']]);
    assert.equal(dup.status, 400);
    assert.match(await dup.text(), /Esiste già un(&#39;|')unità con questo nome/);

    await post('/catalogo/unita', [['name', 'Datalog']]);
    const datalog = await one("select id, position from units where name = 'Datalog'");
    await post(`/catalogo/unita/${datalog.id}/sposta`, [['dir', 'su']]);
    assert.deepEqual((await db.query('select name from units order by position')).rows.map((u) => u.name), ['Datalog', 'Calibrazione e Test del dispositivo']);

    assert.equal((await post(`/catalogo/casi/${id.single}`, [['name', 'Single Site'], ['unit_id', datalog.id]])).status, 303);
    assert.deepEqual(await one('select name, unit_id from use_cases where id = $1', [id.single]), { name: 'Single Site', unit_id: datalog.id });
  });

  it('risponde 404 a indirizzi e id non validi', async () => {
    assert.equal((await get('/catalogo/test/abc')).status, 404);
    assert.equal((await get('/catalogo/unita/non-un-uuid')).status, 404);
    assert.equal((await get(`/catalogo?unit=${uuid()}`)).status, 404);
  });
});
