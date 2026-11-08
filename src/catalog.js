import { Router } from 'express';
import { CODE, UUID, list, syncDevices, text, userError, uuidOrNull } from './util.js';


const FIELD_LABELS = { code: 'ID', use_case_id: "caso d'uso", name: 'nome', description: 'descrizione', operations: 'operazioni' };
const when = (at) => new Date(at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' });

function readTest(body) {
  const t = {
    code: Number(text(body.code)),
    use_case_id: text(body.use_case_id),
    name: text(body.name),
    description: text(body.description) || null,
    operations: text(body.operations) || null,
    devices: list(body.devices),
  };
  const errors = [];
  if (!Number.isInteger(t.code) || t.code < 1 || t.code > 999999999) errors.push("L'ID test deve essere un numero intero positivo.");
  if (!UUID.test(t.use_case_id)) errors.push("Scegli un caso d'uso.");
  if (!t.name) errors.push('Il nome del test è obbligatorio.');
  if (t.devices.some((d) => !UUID.test(d))) errors.push('Uno dei dispositivi scelti non è valido.');
  return { t, errors };
}


export function catalog(db) {
  const r = Router();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0] ?? null;
  const all = async (sql, params) => (await db.query(sql, params)).rows;
  const notFound = (res) => res.status(404).render('message', { title: 'Elemento non trovato', text: 'Potrebbe essere stato eliminato.', nav: 'cat' });

  // ---------- Catalogo ----------
  r.get('/catalogo', async (req, res) => {
    const filters = {
      unit: uuidOrNull(req.query.unit), device: uuidOrNull(req.query.device), q: text(req.query.q),
      np: req.query.np === '1', archived: req.query.archived === '1',
    };
    const { release } = res.locals;
    const [units, devices, tests, sessions, results, [{ total }]] = await Promise.all([
      all(`select u.id, u.name, count(t.id) filter (where not t.archived)::int as tests
           from units u left join use_cases uc on uc.unit_id = u.id left join tests t on t.use_case_id = uc.id
           group by u.id order by u.position`),
      all('select id, name from devices order by name'),
      all(`select t.id, t.code, t.name, t.archived, t.use_case_id, uc.name as use_case, u.id as unit_id, u.name as unit,
                  coalesce((select jsonb_agg(d.name order by d.name) from test_devices td join devices d on d.id = td.device_id where td.test_id = t.id), '[]') as devices
           from tests t join use_cases uc on uc.id = t.use_case_id join units u on u.id = uc.unit_id
           where ($1::uuid is null or u.id = $1)
             and ($2 = '' or t.code::text = $2
                  or position(lower($2) in lower(t.name || ' ' || coalesce(t.description, '') || ' ' || coalesce(t.operations, ''))) > 0)
             and ($3::uuid is null or exists (select 1 from test_devices td where td.test_id = t.id and td.device_id = $3))
             and (not $4 or exists (select 1 from results x join sessions s on s.id = x.session_id
                                    where x.test_id = t.id and s.release_id = $5 and x.outcome = 'NOT PASSED'))
             and (not t.archived or $6)
           order by u.position, uc.position, t.position, t.code`,
      [filters.unit, filters.q, filters.device, filters.np, release?.id ?? null, filters.archived]),
      all(`select s.id, c.name from sessions s join configurations c on c.id = s.configuration_id
           where s.release_id = $1 order by c.name`, [release?.id ?? null]),
      all(`select x.test_id, x.session_id, x.outcome from results x join sessions s on s.id = x.session_id
           where s.release_id = $1`, [release?.id ?? null]),
      all('select count(*)::int as total from tests where not archived'),
    ]);
    const unit = units.find((u) => u.id === filters.unit) ?? null;
    if (filters.unit && !unit) return notFound(res);
    const useCases = unit
      ? await all(`select uc.id, uc.name, count(t.id) filter (where not t.archived)::int as tests
                   from use_cases uc left join tests t on t.use_case_id = uc.id
                   where uc.unit_id = $1 group by uc.id order by uc.position`, [unit.id])
      : [];
    const outcomes = new Map();
    for (const x of results) outcomes.set(`${x.test_id} ${x.session_id}`, x.outcome);
    const filtered = Boolean(filters.q || filters.device || filters.np);
    res.render('catalog', { units, unit, useCases, devices, tests, sessions, outcomes, release, filters, filtered, total });
  });

  // ---------- Test ----------
  async function findTest(code) {
    if (!CODE.test(code)) return null;
    return one(`select t.*, uc.unit_id, u.name as unit,
                       coalesce((select jsonb_agg(device_id) from test_devices where test_id = t.id), '[]') as devices
                from tests t join use_cases uc on uc.id = t.use_case_id join units u on u.id = uc.unit_id
                where t.code = $1`, [Number(code)]);
  }

  async function renderTest(res, { test, original = null, errors = [], status = 200 }) {
    const release = original ? res.locals.release : null;
    const [useCases, devices, results, history] = await Promise.all([
      all(`select uc.id, uc.name, u.id as unit_id, u.name as unit from use_cases uc join units u on u.id = uc.unit_id order by u.position, uc.position`),
      all('select id, name from devices order by name'),
      original && release ? all(`select c.name as configuration, x.outcome, x.note, x.graphic_issue
                                 from results x join sessions s on s.id = x.session_id join configurations c on c.id = s.configuration_id
                                 where x.test_id = $1 and s.release_id = $2 order by c.name`, [original.id, release.id]) : [],
      original ? all(`select a.action, a.table_name, a.new_data, a.old_data, a.actor_email, a.at, d.name as device
                      from audit_log a left join devices d on d.id::text = coalesce(a.new_data, a.old_data)->>'device_id'
                      where (a.table_name = 'tests' and coalesce(a.new_data, a.old_data)->>'id' = $1)
                         or (a.table_name = 'test_devices' and coalesce(a.new_data, a.old_data)->>'test_id' = $1 and a.actor_email is not null)
                      order by a.id desc limit 30`, [original.id]) : [],
    ]);
    const unitsWithUseCases = [];
    for (const uc of useCases) {
      if (unitsWithUseCases.at(-1)?.id !== uc.unit_id) unitsWithUseCases.push({ id: uc.unit_id, name: uc.unit, items: [] });
      unitsWithUseCases.at(-1).items.push(uc);
    }
    const events = history.map((h) => {
      let label;
      if (h.table_name === 'test_devices') label = `${h.action === 'INSERT' ? 'Aggiunto' : 'Tolto'} il dispositivo ${h.device ?? '(eliminato)'}`;
      else if (h.action === 'INSERT') label = h.actor_email ? 'Creato' : "Creato dall'import del file Excel";
      else if (h.old_data.archived !== h.new_data.archived) label = h.new_data.archived ? 'Archiviato' : 'Ripristinato';
      else {
        const fields = Object.keys(FIELD_LABELS).filter((k) => h.old_data[k] !== h.new_data[k]).map((k) => FIELD_LABELS[k]);
        label = fields.length ? `Modificato: ${fields.join(', ')}` : 'Modificato';
      }
      return { label, by: h.actor_email, at: when(h.at) };
    });
    res.status(status).render('test', { test, original, errors, units: unitsWithUseCases, devices, results, events, release });
  }

  r.get('/catalogo/test/nuovo', async (req, res) => {
    const unitId = uuidOrNull(req.query.unit);
    const first = unitId ? await one('select id from use_cases where unit_id = $1 order by position limit 1', [unitId]) : null;
    const { next } = await one('select coalesce(max(code), 0) + 1 as next from tests');
    await renderTest(res, { test: { code: next, use_case_id: first?.id ?? '', name: '', description: '', operations: '', devices: [] } });
  });

  r.post('/catalogo/test', async (req, res) => {
    const { t, errors } = readTest(req.body);
    if (errors.length) return renderTest(res, { test: t, errors, status: 400 });
    try {
      await db.tx(req.user, async (q) => {
        const { rows: [row] } = await q.query(
          `insert into tests (code, use_case_id, name, description, operations, position)
           values ($1, $2, $3, $4, $5, (select coalesce(max(position), 0) + 1 from tests)) returning id`,
          [t.code, t.use_case_id, t.name, t.description, t.operations]);
        await syncDevices(q, 'test', row.id, t.devices);
      });
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderTest(res, { test: t, errors: [msg], status: 400 });
    }
    res.redirect(303, `/catalogo/test/${t.code}?ok=creato`);
  });

  r.get('/catalogo/test/:code', async (req, res) => {
    const test = await findTest(req.params.code);
    if (!test) return notFound(res);
    await renderTest(res, { test, original: test });
  });

  r.post('/catalogo/test/:code', async (req, res) => {
    const original = await findTest(req.params.code);
    if (!original) return notFound(res);
    const { t, errors } = readTest(req.body);
    if (errors.length) return renderTest(res, { test: t, original, errors, status: 400 });
    try {
      await db.tx(req.user, async (q) => {
        await q.query(
          `update tests set code = $2, use_case_id = $3, name = $4, description = $5, operations = $6
           where id = $1 and (code, use_case_id, name, description, operations) is distinct from ($2::int, $3::uuid, $4::text, $5::text, $6::text)`,
          [original.id, t.code, t.use_case_id, t.name, t.description, t.operations]);
        await syncDevices(q, 'test', original.id, t.devices);
      });
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderTest(res, { test: t, original, errors: [msg], status: 400 });
    }
    res.redirect(303, `/catalogo/test/${t.code}?ok=salvato`);
  });

  r.post('/catalogo/test/:code/duplica', async (req, res) => {
    const original = await findTest(req.params.code);
    if (!original) return notFound(res);
    const copy = await db.tx(req.user, async (q) => {
      const { rows: [row] } = await q.query(
        `insert into tests (code, use_case_id, name, description, operations, position)
         select (select max(code) + 1 from tests), use_case_id, name || ' (copia)', description, operations, position
         from tests where id = $1 returning id, code`, [original.id]);
      await q.query('insert into test_devices (test_id, device_id) select $2, device_id from test_devices where test_id = $1', [original.id, row.id]);
      return row;
    });
    res.redirect(303, `/catalogo/test/${copy.code}?ok=duplicato`);
  });

  r.get('/catalogo/test/:code/elimina', async (req, res) => {
    const test = await findTest(req.params.code);
    if (!test) return notFound(res);
    const { n } = await one('select count(distinct session_id)::int as n from results where test_id = $1', [test.id]);
    res.render('confirm', {
      title: `Eliminare il test ${test.code}?`,
      text: n
        ? `Il test ha esiti registrati in ${n} ${n === 1 ? 'sessione' : 'sessioni'}. Per non perdere lo storico verrà archiviato: non comparirà nelle nuove sessioni, ma resterà nei report delle release passate.`
        : 'Il test non ha esiti registrati e verrà eliminato definitivamente.',
      action: `/catalogo/test/${test.code}/elimina`, button: n ? 'Archivia test' : 'Elimina test', back: `/catalogo/test/${test.code}`, nav: 'cat',
    });
  });

  r.post('/catalogo/test/:code/elimina', async (req, res) => {
    const test = await findTest(req.params.code);
    if (!test) return notFound(res);
    const archived = await db.tx(req.user, async (q) => {
      const { rows: [{ n }] } = await q.query('select count(*)::int as n from results where test_id = $1', [test.id]);
      await q.query(n ? 'update tests set archived = true where id = $1' : 'delete from tests where id = $1', [test.id]);
      return n > 0;
    });
    res.redirect(303, archived ? `/catalogo/test/${test.code}?ok=archiviato` : `/catalogo?unit=${test.unit_id}&ok=eliminato`);
  });

  r.post('/catalogo/test/:code/ripristina', async (req, res) => {
    const test = await findTest(req.params.code);
    if (!test) return notFound(res);
    await db.tx(req.user, (q) => q.query('update tests set archived = false where id = $1', [test.id]));
    res.redirect(303, `/catalogo/test/${test.code}?ok=ripristinato`);
  });

  // ---------- Unità ----------
  const findUnit = (id) => (UUID.test(id) ? one('select * from units where id = $1', [id]) : null);

  r.get('/catalogo/unita/nuova', (req, res) => res.render('unit', { unit: { name: '' }, original: null, errors: [] }));

  r.post('/catalogo/unita', async (req, res) => {
    const name = text(req.body.name);
    if (!name) return res.status(400).render('unit', { unit: { name }, original: null, errors: ["Il nome dell'unità è obbligatorio."] });
    try {
      const row = await db.tx(req.user, async (q) => (await q.query(
        'insert into units (name, position) values ($1, (select coalesce(max(position), 0) + 1 from units)) returning id', [name])).rows[0]);
      res.redirect(303, `/catalogo?unit=${row.id}&ok=creato`);
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      res.status(400).render('unit', { unit: { name }, original: null, errors: [msg] });
    }
  });

  r.get('/catalogo/unita/:id', async (req, res) => {
    const unit = await findUnit(req.params.id);
    if (!unit) return notFound(res);
    res.render('unit', { unit, original: unit, errors: [] });
  });

  r.post('/catalogo/unita/:id', async (req, res) => {
    const original = await findUnit(req.params.id);
    if (!original) return notFound(res);
    const name = text(req.body.name);
    if (!name) return res.status(400).render('unit', { unit: { name }, original, errors: ["Il nome dell'unità è obbligatorio."] });
    try {
      await db.tx(req.user, (q) => q.query('update units set name = $2 where id = $1 and name is distinct from $2', [original.id, name]));
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return res.status(400).render('unit', { unit: { name }, original, errors: [msg] });
    }
    res.redirect(303, `/catalogo?unit=${original.id}&ok=salvato`);
  });

  r.post('/catalogo/unita/:id/sposta', async (req, res) => {
    const unit = await findUnit(req.params.id);
    if (!unit) return notFound(res);
    const up = req.body.dir === 'su';
    await db.tx(req.user, async (q) => {
      const { rows: [other] } = await q.query(
        up ? 'select id, position from units where position < $1 order by position desc limit 1'
           : 'select id, position from units where position > $1 order by position limit 1', [unit.position]);
      if (!other) return;
      await q.query('update units set position = $2 where id = $1', [unit.id, other.position]);
      await q.query('update units set position = $2 where id = $1', [other.id, unit.position]);
    });
    res.redirect(303, `/catalogo?unit=${unit.id}`);
  });

  async function confirmUnit(res, unit, status = 200) {
    const { n } = await one('select count(*)::int as n from use_cases where unit_id = $1', [unit.id]);
    res.status(status).render('confirm', {
      title: `Eliminare l'unità "${unit.name}"?`,
      text: n ? `L'unità contiene ${n} ${n === 1 ? "caso d'uso" : "casi d'uso"}: spostali in un'altra unità o eliminali prima.` : "L'unità è vuota e verrà eliminata.",
      action: n ? null : `/catalogo/unita/${unit.id}/elimina`, button: 'Elimina unità', back: `/catalogo?unit=${unit.id}`, nav: 'cat',
    });
    return n;
  }

  r.get('/catalogo/unita/:id/elimina', async (req, res) => {
    const unit = await findUnit(req.params.id);
    if (!unit) return notFound(res);
    await confirmUnit(res, unit);
  });

  r.post('/catalogo/unita/:id/elimina', async (req, res) => {
    const unit = await findUnit(req.params.id);
    if (!unit) return notFound(res);
    try {
      await db.tx(req.user, (q) => q.query('delete from units where id = $1', [unit.id]));
    } catch (err) {
      if (err.constraint !== 'use_cases_unit_id_fkey') throw err;
      return confirmUnit(res, unit, 409);
    }
    res.redirect(303, '/catalogo?ok=eliminato');
  });

  // ---------- Casi d'uso ----------
  const findUseCase = (id) => (UUID.test(id) ? one('select * from use_cases where id = $1', [id]) : null);
  const renderUseCase = async (res, { useCase, original = null, errors = [], status = 200 }) =>
    res.status(status).render('usecase', { useCase, original, errors, units: await all('select id, name from units order by position') });
  const readUseCase = (body) => ({ name: text(body.name), unit_id: text(body.unit_id) });
  const useCaseErrors = (uc) => [
    ...(uc.name ? [] : ["Il nome del caso d'uso è obbligatorio."]),
    ...(UUID.test(uc.unit_id) ? [] : ["Scegli un'unità."]),
  ];

  r.get('/catalogo/casi/nuovo', (req, res) => renderUseCase(res, { useCase: { name: '', unit_id: uuidOrNull(req.query.unit) ?? '' } }));

  r.post('/catalogo/casi', async (req, res) => {
    const uc = readUseCase(req.body);
    const errors = useCaseErrors(uc);
    if (errors.length) return renderUseCase(res, { useCase: uc, errors, status: 400 });
    try {
      await db.tx(req.user, (q) => q.query(
        'insert into use_cases (unit_id, name, position) values ($1, $2, (select coalesce(max(position), 0) + 1 from use_cases))', [uc.unit_id, uc.name]));
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderUseCase(res, { useCase: uc, errors: [msg], status: 400 });
    }
    res.redirect(303, `/catalogo?unit=${uc.unit_id}&ok=creato`);
  });

  r.get('/catalogo/casi/:id', async (req, res) => {
    const useCase = await findUseCase(req.params.id);
    if (!useCase) return notFound(res);
    await renderUseCase(res, { useCase, original: useCase });
  });

  r.post('/catalogo/casi/:id', async (req, res) => {
    const original = await findUseCase(req.params.id);
    if (!original) return notFound(res);
    const uc = readUseCase(req.body);
    const errors = useCaseErrors(uc);
    if (errors.length) return renderUseCase(res, { useCase: uc, original, errors, status: 400 });
    try {
      await db.tx(req.user, (q) => q.query(
        'update use_cases set name = $2, unit_id = $3 where id = $1 and (name, unit_id) is distinct from ($2::text, $3::uuid)', [original.id, uc.name, uc.unit_id]));
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderUseCase(res, { useCase: uc, original, errors: [msg], status: 400 });
    }
    res.redirect(303, `/catalogo?unit=${uc.unit_id}&ok=salvato`);
  });

  async function confirmUseCase(res, useCase, status = 200) {
    const { n } = await one('select count(*)::int as n from tests where use_case_id = $1', [useCase.id]);
    res.status(status).render('confirm', {
      title: `Eliminare il caso d'uso "${useCase.name}"?`,
      text: n ? `Il caso d'uso contiene ${n} test, archiviati compresi: spostali in un altro caso d'uso prima di eliminarlo.` : "Il caso d'uso è vuoto e verrà eliminato.",
      action: n ? null : `/catalogo/casi/${useCase.id}/elimina`, button: "Elimina caso d'uso", back: `/catalogo/casi/${useCase.id}`, nav: 'cat',
    });
  }

  r.get('/catalogo/casi/:id/elimina', async (req, res) => {
    const useCase = await findUseCase(req.params.id);
    if (!useCase) return notFound(res);
    await confirmUseCase(res, useCase);
  });

  r.post('/catalogo/casi/:id/elimina', async (req, res) => {
    const useCase = await findUseCase(req.params.id);
    if (!useCase) return notFound(res);
    try {
      await db.tx(req.user, (q) => q.query('delete from use_cases where id = $1', [useCase.id]));
    } catch (err) {
      if (err.constraint !== 'tests_use_case_id_fkey') throw err;
      return confirmUseCase(res, useCase, 409);
    }
    res.redirect(303, `/catalogo?unit=${useCase.unit_id}&ok=eliminato`);
  });

  // ---------- Dispositivi ----------
  const findDevice = (id) => (UUID.test(id) ? one('select * from devices where id = $1', [id]) : null);
  const renderDevices = async (res, { errors = [], draft = '', status = 200 } = {}) => res.status(status).render('devices', {
    devices: await all(`select d.id, d.name, count(td.test_id)::int as tests
                        from devices d left join test_devices td on td.device_id = d.id group by d.id order by d.name`),
    errors, draft,
  });

  r.get('/impostazioni/dispositivi', (req, res) => renderDevices(res));

  r.post('/impostazioni/dispositivi', async (req, res) => {
    const name = text(req.body.name);
    if (!name) return renderDevices(res, { errors: ['Il nome del dispositivo è obbligatorio.'], status: 400 });
    try {
      await db.tx(req.user, (q) => q.query('insert into devices (name) values ($1)', [name]));
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderDevices(res, { errors: [msg], draft: name, status: 400 });
    }
    res.redirect(303, '/impostazioni/dispositivi?ok=creato');
  });

  r.post('/impostazioni/dispositivi/:id', async (req, res) => {
    const device = await findDevice(req.params.id);
    if (!device) return notFound(res);
    const name = text(req.body.name);
    if (!name) return renderDevices(res, { errors: ['Il nome del dispositivo è obbligatorio.'], status: 400 });
    try {
      await db.tx(req.user, (q) => q.query('update devices set name = $2 where id = $1 and name is distinct from $2', [device.id, name]));
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderDevices(res, { errors: [msg], status: 400 });
    }
    res.redirect(303, '/impostazioni/dispositivi?ok=salvato');
  });

  async function confirmDevice(res, device, status = 200) {
    const { tests, configs } = await one(`select (select count(*)::int from test_devices where device_id = $1) as tests,
                                                 (select count(*)::int from configuration_devices where device_id = $1) as configs`, [device.id]);
    const uses = [tests && `${tests} test`, configs && `${configs} ${configs === 1 ? 'configurazione' : 'configurazioni'}`].filter(Boolean);
    res.status(status).render('confirm', {
      title: `Eliminare il dispositivo ${device.name}?`,
      text: uses.length ? `Il dispositivo è usato da ${uses.join(' e ')}: toglilo da lì prima di eliminarlo.` : 'Nessun test e nessuna configurazione usano questo dispositivo: verrà eliminato.',
      action: uses.length ? null : `/impostazioni/dispositivi/${device.id}/elimina`, button: 'Elimina dispositivo', back: '/impostazioni/dispositivi', nav: 'set',
    });
  }


  r.get('/impostazioni/dispositivi/:id/elimina', async (req, res) => {
    const device = await findDevice(req.params.id);
    if (!device) return notFound(res);
    await confirmDevice(res, device);
  });

  r.post('/impostazioni/dispositivi/:id/elimina', async (req, res) => {
    const device = await findDevice(req.params.id);
    if (!device) return notFound(res);
    try {
      await db.tx(req.user, (q) => q.query('delete from devices where id = $1', [device.id]));
    } catch (err) {
      if (!['test_devices_device_id_fkey', 'configuration_devices_device_id_fkey'].includes(err.constraint)) throw err;
      return confirmDevice(res, device, 409);
    }
    res.redirect(303, '/impostazioni/dispositivi?ok=eliminato');
  });

  return r;
}
