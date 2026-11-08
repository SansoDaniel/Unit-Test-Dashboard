import { Router } from 'express';
import { CODE, UUID, isoDay, text, uuidOrNull } from './util.js';

export const OUTCOMES = ['PASSED', 'NOT PASSED', 'NOT TESTED', 'NOT AVAILABLE'];

// Filtri della schermata di esecuzione: frammenti SQL costanti, mai costruiti dall'input.
const VIEWS = {
  tutti: { label: 'Tutti', where: 'true' },
  aperti: { label: 'Da eseguire e falliti', where: "x.outcome in ('NOT TESTED', 'NOT PASSED')" },
  falliti: { label: 'NOT PASSED', where: "x.outcome = 'NOT PASSED'" },
  note: { label: 'Con note', where: '(x.note is not null or x.graphic_issue)' },
};

// Test che entrano in una sessione: quelli dei dispositivi della configurazione e quelli senza dispositivo.
// Una configurazione senza dispositivi prende tutti i test. $1 = id della configurazione.
const INCLUDED = `not t.archived and (
  not exists (select 1 from configuration_devices cd where cd.configuration_id = $1)
  or not exists (select 1 from test_devices td where td.test_id = t.id)
  or exists (select 1 from test_devices td join configuration_devices cd on cd.device_id = td.device_id
             where td.test_id = t.id and cd.configuration_id = $1))`;

const CONFIG_DEVICES = `coalesce((select jsonb_agg(d.name order by d.name) from configuration_devices cd join devices d on d.id = cd.device_id
                                  where cd.configuration_id = c.id), '[]')`;

export function sessions(db) {
  const r = Router();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0] ?? null;
  const all = async (sql, params) => (await db.query(sql, params)).rows;
  const notFound = (res) => res.status(404).render('message', { title: 'Sessione non trovata', text: 'Potrebbe essere stata eliminata.', nav: 'ses' });
  const wantsJson = (req) => (req.get('accept') ?? '').includes('application/json');

  const findSession = (id) => (UUID.test(id) ? one(`
    select s.id, s.status, s.started_on::text, s.release_id, s.configuration_id, s.tester_id, rl.version, c.name as configuration,
           p.full_name as tester, ${CONFIG_DEVICES} as devices
    from sessions s join releases rl on rl.id = s.release_id join configurations c on c.id = s.configuration_id left join people p on p.id = s.tester_id
    where s.id = $1`, [id]) : null);

  const counts = (sessionId) => one(`
    select count(*) filter (where outcome = 'PASSED')::int as "PASSED", count(*) filter (where outcome = 'NOT PASSED')::int as "NOT PASSED",
           count(*) filter (where outcome = 'NOT TESTED')::int as "NOT TESTED", count(*) filter (where outcome = 'NOT AVAILABLE')::int as "NOT AVAILABLE",
           count(*) filter (where note is not null or graphic_issue)::int as notes, count(*)::int as total
    from results where session_id = $1`, [sessionId]);

  // ---------- Elenco ----------
  r.get('/sessioni', async (req, res) => {
    const { release } = res.locals;
    const rows = release ? await all(`
      select s.id, c.name as configuration, s.status, s.started_on::text, p.full_name as tester, ${CONFIG_DEVICES} as devices,
             count(x.test_id)::int as total, count(x.test_id) filter (where x.outcome = 'PASSED')::int as passed,
             count(x.test_id) filter (where x.outcome = 'NOT PASSED')::int as failed, count(x.test_id) filter (where x.outcome = 'NOT AVAILABLE')::int as na
      from sessions s join configurations c on c.id = s.configuration_id left join people p on p.id = s.tester_id left join results x on x.session_id = s.id
      where s.release_id = $1 group by s.id, c.id, p.full_name order by c.name`, [release.id]) : [];
    res.render('sessions', { rows });
  });

  // ---------- Nuova sessione ----------
  async function renderNew(res, { draft, errors = [], status = 200 }) {
    const [releaseRows, configs, people] = await Promise.all([
      all('select id, version from releases order by position desc'),
      all(`select c.id, c.name, ${CONFIG_DEVICES} as devices, (select count(*)::int from tests t where ${INCLUDED.replaceAll('$1', 'c.id')}) as tests
           from configurations c order by c.name`),
      all('select id, full_name from people order by full_name'),
    ]);
    res.status(status).render('session-new', { draft, errors, releases: releaseRows, configs, people });
  }

  r.get('/sessioni/nuova', async (req, res) => {
    const me = await one('select id from people where user_id = $1', [req.user.id]);
    const releaseId = uuidOrNull(req.query.release) ?? res.locals.release?.id ?? '';
    await renderNew(res, { draft: { release_id: releaseId, configuration_id: '', tester_id: me?.id ?? '', started_on: new Date().toISOString().slice(0, 10) } });
  });

  r.post('/sessioni', async (req, res) => {
    const draft = { release_id: text(req.body.release_id), configuration_id: text(req.body.configuration_id), tester_id: text(req.body.tester_id), started_on: text(req.body.started_on) };
    const errors = [];
    if (!UUID.test(draft.release_id)) errors.push('Scegli la release.');
    if (!UUID.test(draft.configuration_id)) errors.push('Scegli la configurazione.');
    if (draft.tester_id && !UUID.test(draft.tester_id)) errors.push('Il tester scelto non è valido.');
    if (draft.started_on && !isoDay(draft.started_on)) errors.push('La data non è valida.');
    if (errors.length) return renderNew(res, { draft, errors, status: 400 });
    let created;
    try {
      created = await db.tx(req.user, async (q) => {
        const { rows: [s] } = await q.query('insert into sessions (release_id, configuration_id, tester_id, started_on) values ($1, $2, $3, $4) returning id',
          [draft.release_id, draft.configuration_id, uuidOrNull(draft.tester_id), isoDay(draft.started_on)]);
        await q.query(`insert into results (session_id, test_id) select $2, t.id from tests t where ${INCLUDED}`, [draft.configuration_id, s.id]);
        return s;
      });
    } catch (err) {
      if (!['sessions_release_id_fkey', 'sessions_configuration_id_fkey', 'sessions_tester_id_fkey'].includes(err.constraint)) throw err;
      return renderNew(res, { draft, errors: ['La release, la configurazione o il tester scelti non esistono più.'], status: 400 });
    }
    res.redirect(303, `/sessioni/${created.id}?ok=creato`);
  });

  // ---------- Esecuzione ----------
  r.get('/sessioni/:id', async (req, res) => {
    const session = await findSession(req.params.id);
    if (!session) return notFound(res);
    const view = VIEWS[req.query.vista] ? req.query.vista : 'tutti';
    const q = text(req.query.q);
    const [rows, units, c] = await Promise.all([
      all(`select x.outcome, x.note, x.graphic_issue, t.code, t.name, t.description, t.operations, uc.name as use_case, u.id as unit_id, u.name as unit,
                  coalesce((select jsonb_agg(d.name order by d.name) from test_devices td join devices d on d.id = td.device_id where td.test_id = t.id), '[]') as devices
           from results x join tests t on t.id = x.test_id join use_cases uc on uc.id = t.use_case_id join units u on u.id = uc.unit_id
           where x.session_id = $1 and ${VIEWS[view].where}
             and ($2 = '' or t.code::text = $2 or position(lower($2) in lower(t.name)) > 0)
           order by u.position, uc.position, t.position, t.code`, [session.id, q]),
      all(`select u.id, count(*)::int as total, count(*) filter (where x.outcome = 'PASSED')::int as passed, count(*) filter (where x.outcome = 'NOT PASSED')::int as failed
           from results x join tests t on t.id = x.test_id join use_cases uc on uc.id = t.use_case_id join units u on u.id = uc.unit_id
           where x.session_id = $1 group by u.id`, [session.id]),
      counts(session.id),
    ]);
    res.render('session', { session, rows, units: new Map(units.map((u) => [u.id, u])), counts: c, views: VIEWS, view, q, outcomes: OUTCOMES });
  });

  // Torna alla schermata di esecuzione con gli stessi filtri, sul test appena modificato.
  const back = (session, req, { code, ok } = {}) => {
    const params = new URLSearchParams();
    if (VIEWS[req.query.vista] && req.query.vista !== 'tutti') params.set('vista', req.query.vista);
    if (text(req.query.q)) params.set('q', text(req.query.q));
    if (ok) params.set('ok', ok);
    return `/sessioni/${session.id}${params.size ? `?${params}` : ''}${code ? `#t-${code}` : ''}`;
  };
  const refuse = (req, res, status, message) => (wantsJson(req)
    ? res.status(status).json({ error: message })
    : res.status(status).render('message', { title: 'Modifica non salvata', text: message, nav: 'ses' }));
  const CLOSED = 'La sessione è chiusa: riaprila per modificare gli esiti.';

  r.post('/sessioni/:id/esiti/:code', async (req, res) => {
    const session = await findSession(req.params.id);
    if (!session || !CODE.test(req.params.code)) return notFound(res);
    if (session.status === 'closed') return refuse(req, res, 409, CLOSED);
    const outcome = req.body.outcome == null ? null : String(req.body.outcome);
    if (outcome !== null && !OUTCOMES.includes(outcome)) return refuse(req, res, 400, `Esito non valido: ${outcome}.`);
    // La nota si aggiorna solo se il form la contiene: un client che manda solo l'esito non la cancella.
    const hasNote = 'note' in req.body;
    const note = text(req.body.note) || null;
    const graphic = req.body.graphic_issue === '1';
    const saved = await db.tx(req.user, async (q) => (await q.query(`
      update results x set
        outcome = coalesce($3::outcome, x.outcome),
        note = case when $4 then $5 else x.note end,
        graphic_issue = case when $4 then $6 else x.graphic_issue end,
        executed_by = case when $3::outcome is null then x.executed_by else (select id from people where user_id = $7) end,
        executed_at = case when $3::outcome is null then x.executed_at else now() end
      from tests t
      where t.id = x.test_id and x.session_id = $1 and t.code = $2
      returning x.outcome`, [session.id, Number(req.params.code), outcome, hasNote, note, graphic, req.user.id])).rows[0]);
    if (!saved) return refuse(req, res, 404, 'Il test non fa parte di questa sessione.');
    if (wantsJson(req)) return res.json({ outcome: saved.outcome, counts: await counts(session.id) });
    res.redirect(303, back(session, req, { code: req.params.code }));
  });

  r.post('/sessioni/:id/test/:code/togli', async (req, res) => {
    const session = await findSession(req.params.id);
    if (!session || !CODE.test(req.params.code)) return notFound(res);
    if (session.status === 'closed') return refuse(req, res, 409, CLOSED);
    const removed = await db.tx(req.user, async (q) => (await q.query(`
      delete from results x using tests t
      where t.id = x.test_id and x.session_id = $1 and t.code = $2 and x.outcome = 'NOT TESTED' and x.note is null and not x.graphic_issue
      returning x.test_id`, [session.id, Number(req.params.code)])).rows[0]);
    if (!removed) return refuse(req, res, 409, 'Si possono togliere solo i test ancora NOT TESTED e senza nota, per non perdere esiti già registrati.');
    res.redirect(303, back(session, req, { ok: 'tolto' }));
  });

  r.get('/sessioni/:id/aggiungi', async (req, res) => {
    const session = await findSession(req.params.id);
    if (!session) return notFound(res);
    const q = text(req.query.q);
    const rows = await all(`
      select t.code, t.name, u.name as unit from tests t join use_cases uc on uc.id = t.use_case_id join units u on u.id = uc.unit_id
      where not t.archived and not exists (select 1 from results x where x.session_id = $1 and x.test_id = t.id)
        and ($2 = '' or t.code::text = $2 or position(lower($2) in lower(t.name)) > 0)
      order by u.position, uc.position, t.position limit 50`, [session.id, q]);
    res.render('session-add', { session, rows, q });
  });

  r.post('/sessioni/:id/aggiungi', async (req, res) => {
    const session = await findSession(req.params.id);
    if (!session) return notFound(res);
    if (session.status === 'closed') return refuse(req, res, 409, CLOSED);
    const code = text(req.body.code);
    if (!CODE.test(code)) return refuse(req, res, 400, 'ID test non valido.');
    const added = await db.tx(req.user, async (q) => (await q.query(
      'insert into results (session_id, test_id) select $1, id from tests where code = $2 and not archived on conflict do nothing returning test_id',
      [session.id, Number(code)])).rows[0]);
    if (!added) return refuse(req, res, 409, 'Il test non esiste, è archiviato o è già nella sessione.');
    res.redirect(303, `/sessioni/${session.id}/aggiungi?ok=aggiunto`);
  });

  // ---------- Modifica, stato, eliminazione ----------
  r.get('/sessioni/:id/modifica', async (req, res) => {
    const session = await findSession(req.params.id);
    if (!session) return notFound(res);
    res.render('session-edit', { session, draft: session, errors: [], people: await all('select id, full_name from people order by full_name') });
  });

  r.post('/sessioni/:id/modifica', async (req, res) => {
    const session = await findSession(req.params.id);
    if (!session) return notFound(res);
    const draft = { tester_id: text(req.body.tester_id), started_on: text(req.body.started_on) };
    const errors = [];
    if (draft.tester_id && !UUID.test(draft.tester_id)) errors.push('Il tester scelto non è valido.');
    if (draft.started_on && !isoDay(draft.started_on)) errors.push('La data non è valida.');
    if (errors.length) {
      return res.status(400).render('session-edit', { session, draft, errors, people: await all('select id, full_name from people order by full_name') });
    }
    await db.tx(req.user, (q) => q.query(
      'update sessions set tester_id = $2, started_on = $3 where id = $1 and (tester_id, started_on) is distinct from ($2::uuid, $3::date)',
      [session.id, uuidOrNull(draft.tester_id), isoDay(draft.started_on)]));
    res.redirect(303, `/sessioni/${session.id}?ok=salvato`);
  });

  r.post('/sessioni/:id/stato', async (req, res) => {
    const session = await findSession(req.params.id);
    if (!session) return notFound(res);
    const status = req.body.status === 'closed' ? 'closed' : 'open';
    await db.tx(req.user, (q) => q.query('update sessions set status = $2 where id = $1 and status <> $2', [session.id, status]));
    res.redirect(303, `/sessioni/${session.id}?ok=${status === 'closed' ? 'chiusa' : 'riaperta'}`);
  });

  r.get('/sessioni/:id/elimina', async (req, res) => {
    const session = await findSession(req.params.id);
    if (!session) return notFound(res);
    const c = await counts(session.id);
    const done = c.total - c['NOT TESTED'];
    res.render('confirm', {
      title: `Eliminare la sessione "${session.configuration}"?`,
      text: `Verranno cancellati anche i suoi ${c.total} esiti${done ? `, di cui ${done} già registrati (PASSED, NOT PASSED o NOT AVAILABLE)` : ''}. L'operazione non si può annullare.`,
      action: `/sessioni/${session.id}/elimina`, button: 'Elimina sessione ed esiti', back: `/sessioni/${session.id}`, nav: 'ses',
    });
  });

  r.post('/sessioni/:id/elimina', async (req, res) => {
    const session = await findSession(req.params.id);
    if (!session) return notFound(res);
    await db.tx(req.user, (q) => q.query('delete from sessions where id = $1', [session.id]));
    res.redirect(303, '/sessioni?ok=eliminato');
  });

  return r;
}
