import { Router } from 'express';
import { UUID, list, syncDevices, text, userError, uuidOrNull } from './util.js';

export function settings(db) {
  const r = Router();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0] ?? null;
  const all = async (sql, params) => (await db.query(sql, params)).rows;
  const notFound = (res) => res.status(404).render('message', { title: 'Elemento non trovato', text: 'Potrebbe essere stato eliminato.', nav: 'set' });

  r.get('/impostazioni', (req, res) => res.redirect('/impostazioni/dispositivi'));

  // ---------- Configurazioni ----------
  const findConfig = (id) => (UUID.test(id) ? one(`select c.*, coalesce((select jsonb_agg(device_id) from configuration_devices where configuration_id = c.id), '[]') as devices
                                                   from configurations c where c.id = $1`, [id]) : null);
  const readConfig = (body) => ({ name: text(body.name), description: text(body.description) || null, devices: list(body.devices) });
  const configErrors = (c) => [
    ...(c.name ? [] : ['Il nome della configurazione è obbligatorio.']),
    ...(c.devices.every((d) => UUID.test(d)) ? [] : ['Uno dei dispositivi scelti non è valido.']),
  ];
  const renderConfig = async (res, { config, original = null, errors = [], status = 200 }) =>
    res.status(status).render('config', { config, original, errors, devices: await all('select id, name from devices order by name') });

  r.get('/impostazioni/configurazioni', async (req, res) => {
    const rows = await all(`select c.id, c.name, c.description,
                                   coalesce((select jsonb_agg(d.name order by d.name) from configuration_devices cd join devices d on d.id = cd.device_id where cd.configuration_id = c.id), '[]') as devices,
                                   (select count(*)::int from sessions where configuration_id = c.id) as sessions
                            from configurations c order by c.name`);
    res.render('configs', { rows });
  });

  r.get('/impostazioni/configurazioni/nuova', (req, res) => renderConfig(res, { config: { name: '', description: '', devices: [] } }));

  r.post('/impostazioni/configurazioni', async (req, res) => {
    const c = readConfig(req.body);
    const errors = configErrors(c);
    if (errors.length) return renderConfig(res, { config: c, errors, status: 400 });
    try {
      await db.tx(req.user, async (q) => {
        const { rows: [row] } = await q.query('insert into configurations (name, description) values ($1, $2) returning id', [c.name, c.description]);
        await syncDevices(q, 'configuration', row.id, c.devices);
      });
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderConfig(res, { config: c, errors: [msg], status: 400 });
    }
    res.redirect(303, '/impostazioni/configurazioni?ok=creato');
  });

  r.get('/impostazioni/configurazioni/:id', async (req, res) => {
    const config = await findConfig(req.params.id);
    if (!config) return notFound(res);
    await renderConfig(res, { config, original: config });
  });

  r.post('/impostazioni/configurazioni/:id', async (req, res) => {
    const original = await findConfig(req.params.id);
    if (!original) return notFound(res);
    const c = readConfig(req.body);
    const errors = configErrors(c);
    if (errors.length) return renderConfig(res, { config: c, original, errors, status: 400 });
    try {
      await db.tx(req.user, async (q) => {
        await q.query('update configurations set name = $2, description = $3 where id = $1 and (name, description) is distinct from ($2::text, $3::text)',
          [original.id, c.name, c.description]);
        await syncDevices(q, 'configuration', original.id, c.devices);
      });
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderConfig(res, { config: c, original, errors: [msg], status: 400 });
    }
    res.redirect(303, '/impostazioni/configurazioni?ok=salvato');
  });

  async function confirmConfig(res, config, status = 200) {
    const { n } = await one('select count(*)::int as n from sessions where configuration_id = $1', [config.id]);
    res.status(status).render('confirm', {
      title: `Eliminare la configurazione "${config.name}"?`,
      text: n ? `La configurazione è usata da ${n} ${n === 1 ? 'sessione' : 'sessioni'} di test: non si può eliminare.` : 'Nessuna sessione usa questa configurazione: verrà eliminata.',
      action: n ? null : `/impostazioni/configurazioni/${config.id}/elimina`, button: 'Elimina configurazione', back: '/impostazioni/configurazioni', nav: 'set',
    });
  }

  r.get('/impostazioni/configurazioni/:id/elimina', async (req, res) => {
    const config = await findConfig(req.params.id);
    if (!config) return notFound(res);
    await confirmConfig(res, config);
  });

  r.post('/impostazioni/configurazioni/:id/elimina', async (req, res) => {
    const config = await findConfig(req.params.id);
    if (!config) return notFound(res);
    try {
      await db.tx(req.user, (q) => q.query('delete from configurations where id = $1', [config.id]));
    } catch (err) {
      if (err.constraint !== 'sessions_configuration_id_fkey') throw err;
      return confirmConfig(res, config, 409);
    }
    res.redirect(303, '/impostazioni/configurazioni?ok=eliminato');
  });

  // ---------- Persone ----------
  // Una persona compare come tester, autore o approvatore; collegata a un account, ottiene anche gli esiti che registra.
  const findPerson = (id) => (UUID.test(id) ? one('select * from people where id = $1', [id]) : null);
  const renderPeople = async (res, { errors = [], draft = { full_name: '', title: '' }, status = 200 } = {}) => {
    const [rows, accounts] = await Promise.all([
      all('select p.id, p.full_name, p.title, p.user_id, u.email from people p left join auth.users u on u.id = p.user_id order by p.full_name'),
      all('select id, email from auth.users order by email'),
    ]);
    res.status(status).render('people', { rows, accounts, errors, draft });
  };
  const readPerson = (body) => ({ full_name: text(body.full_name), title: text(body.title) || null, user_id: uuidOrNull(text(body.user_id)) });

  r.get('/impostazioni/persone', (req, res) => renderPeople(res));

  r.post('/impostazioni/persone', async (req, res) => {
    const p = readPerson(req.body);
    if (!p.full_name) return renderPeople(res, { errors: ['Il nome della persona è obbligatorio.'], draft: p, status: 400 });
    try {
      await db.tx(req.user, (q) => q.query('insert into people (full_name, title, user_id) values ($1, $2, $3)', [p.full_name, p.title, p.user_id]));
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderPeople(res, { errors: [msg], draft: p, status: 400 });
    }
    res.redirect(303, '/impostazioni/persone?ok=creato');
  });

  r.post('/impostazioni/persone/:id', async (req, res) => {
    const person = await findPerson(req.params.id);
    if (!person) return notFound(res);
    const p = readPerson(req.body);
    if (!p.full_name) return renderPeople(res, { errors: ['Il nome della persona è obbligatorio.'], status: 400 });
    try {
      await db.tx(req.user, (q) => q.query(
        'update people set full_name = $2, title = $3, user_id = $4 where id = $1 and (full_name, title, user_id) is distinct from ($2::text, $3::text, $4::uuid)',
        [person.id, p.full_name, p.title, p.user_id]));
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderPeople(res, { errors: [msg], status: 400 });
    }
    res.redirect(303, '/impostazioni/persone?ok=salvato');
  });

  const PERSON_FKEYS = ['releases_author_id_fkey', 'release_signatures_person_id_fkey', 'sessions_tester_id_fkey'];
  async function confirmPerson(res, person, status = 200) {
    const { n } = await one(`select (select count(*)::int from sessions where tester_id = $1) + (select count(*)::int from releases where author_id = $1)
                                    + (select count(*)::int from release_signatures where person_id = $1) as n`, [person.id]);
    res.status(status).render('confirm', {
      title: `Eliminare ${person.full_name}?`,
      text: n ? `La persona compare ${n} ${n === 1 ? 'volta' : 'volte'} come tester, autore o firmataria: toglila da lì prima di eliminarla.` : 'La persona non compare in sessioni, release o firme e verrà eliminata.',
      action: n ? null : `/impostazioni/persone/${person.id}/elimina`, button: 'Elimina persona', back: '/impostazioni/persone', nav: 'set',
    });
  }

  r.get('/impostazioni/persone/:id/elimina', async (req, res) => {
    const person = await findPerson(req.params.id);
    if (!person) return notFound(res);
    await confirmPerson(res, person);
  });

  r.post('/impostazioni/persone/:id/elimina', async (req, res) => {
    const person = await findPerson(req.params.id);
    if (!person) return notFound(res);
    try {
      await db.tx(req.user, (q) => q.query('delete from people where id = $1', [person.id]));
    } catch (err) {
      if (!PERSON_FKEYS.includes(err.constraint)) throw err;
      return confirmPerson(res, person, 409);
    }
    res.redirect(303, '/impostazioni/persone?ok=eliminato');
  });

  return r;
}
