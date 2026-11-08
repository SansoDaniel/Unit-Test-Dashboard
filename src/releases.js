import { Router } from 'express';
import { UUID, isoDay, text, userError, uuidOrNull } from './util.js';

const ROLES = { author: 'Autore', approver: 'Approvatore' };
const YEAR = 365 * 24 * 3600 * 1000;

export function releases(db) {
  const r = Router();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0] ?? null;
  const all = async (sql, params) => (await db.query(sql, params)).rows;
  const notFound = (res) => res.status(404).render('message', { title: 'Release non trovata', text: 'Potrebbe essere stata eliminata.', nav: 'rel' });
  const findRelease = (id) => (UUID.test(id) ? one('select id, version, released_on::text, author_id, changes, position from releases where id = $1', [id]) : null);
  const people = () => all('select id, full_name from people order by full_name');

  function readRelease(body) {
    const v = { version: text(body.version), released_on: text(body.released_on), author_id: uuidOrNull(text(body.author_id)), changes: text(body.changes) || null };
    const errors = [];
    if (!v.version) errors.push('La versione è obbligatoria.');
    if (v.released_on && !isoDay(v.released_on)) errors.push('La data non è valida.');
    v.released_on = isoDay(v.released_on);
    return { v, errors };
  }

  async function renderRelease(res, { release, original = null, errors = [], status = 200 }) {
    const [persons, signatures, sessions] = await Promise.all([
      people(),
      original ? all(`select sg.person_id, sg.role, sg.signed_on::text, p.full_name, p.title from release_signatures sg join people p on p.id = sg.person_id
                      where sg.release_id = $1 order by sg.role, p.full_name`, [original.id]) : [],
      original ? all(`select s.id, c.name as configuration, s.status, count(x.test_id)::int as tests
                      from sessions s join configurations c on c.id = s.configuration_id left join results x on x.session_id = s.id
                      where s.release_id = $1 group by s.id, c.name order by c.name`, [original.id]) : [],
    ]);
    res.status(status).render('release', { release, original, errors, persons, signatures, sessions, roles: ROLES });
  }

  r.get('/release', async (req, res) => {
    const rows = await all(`select rl.id, rl.version, rl.released_on::text, rl.changes, p.full_name as author, count(s.id)::int as sessions
                            from releases rl left join people p on p.id = rl.author_id left join sessions s on s.release_id = rl.id
                            group by rl.id, p.full_name order by rl.position desc`);
    res.render('releases', { rows });
  });

  r.get('/release/nuova', async (req, res) => renderRelease(res, { release: { version: '', released_on: '', author_id: '', changes: '' } }));

  r.post('/release', async (req, res) => {
    const { v, errors } = readRelease(req.body);
    if (errors.length) return renderRelease(res, { release: v, errors, status: 400 });
    try {
      const row = await db.tx(req.user, async (q) => (await q.query(
        `insert into releases (version, released_on, author_id, changes, position)
         values ($1, $2, $3, $4, (select coalesce(max(position), 0) + 1 from releases)) returning id`,
        [v.version, v.released_on, v.author_id, v.changes])).rows[0]);
      res.redirect(303, `/release/${row.id}?ok=creato`);
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      renderRelease(res, { release: v, errors: [msg], status: 400 });
    }
  });

  r.get('/release/:id', async (req, res) => {
    const release = await findRelease(req.params.id);
    if (!release) return notFound(res);
    await renderRelease(res, { release, original: release });
  });

  r.post('/release/:id', async (req, res) => {
    const original = await findRelease(req.params.id);
    if (!original) return notFound(res);
    const { v, errors } = readRelease(req.body);
    if (errors.length) return renderRelease(res, { release: v, original, errors, status: 400 });
    try {
      await db.tx(req.user, (q) => q.query(
        `update releases set version = $2, released_on = $3, author_id = $4, changes = $5
         where id = $1 and (version, released_on, author_id, changes) is distinct from ($2::text, $3::date, $4::uuid, $5::text)`,
        [original.id, v.version, v.released_on, v.author_id, v.changes]));
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderRelease(res, { release: v, original, errors: [msg], status: 400 });
    }
    res.redirect(303, `/release/${original.id}?ok=salvato`);
  });

  // La release scelta vale per catalogo, sessioni e scheda test.
  r.post('/release/:id/usa', async (req, res) => {
    const release = await findRelease(req.params.id);
    if (!release) return notFound(res);
    res.cookie('release', release.id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: YEAR });
    res.redirect(303, '/sessioni?ok=usata');
  });

  r.post('/release/:id/firme', async (req, res) => {
    const release = await findRelease(req.params.id);
    if (!release) return notFound(res);
    const s = { person_id: uuidOrNull(text(req.body.person_id)), role: text(req.body.role), signed_on: text(req.body.signed_on) };
    const errors = [];
    if (!s.person_id) errors.push('Scegli la persona che firma.');
    if (!ROLES[s.role]) errors.push('Scegli il ruolo della firma.');
    if (s.signed_on && !isoDay(s.signed_on)) errors.push('La data della firma non è valida.');
    if (errors.length) return renderRelease(res, { release, original: release, errors, status: 400 });
    try {
      await db.tx(req.user, (q) => q.query('insert into release_signatures (release_id, person_id, role, signed_on) values ($1, $2, $3, $4)',
        [release.id, s.person_id, s.role, isoDay(s.signed_on)]));
    } catch (err) {
      const msg = userError(err);
      if (!msg) throw err;
      return renderRelease(res, { release, original: release, errors: [msg], status: 400 });
    }
    res.redirect(303, `/release/${release.id}?ok=creato#firme`);
  });

  const findSignature = async (release, query) => {
    if (!UUID.test(query.person ?? '') || !ROLES[query.role]) return null;
    return one(`select sg.person_id, sg.role, p.full_name from release_signatures sg join people p on p.id = sg.person_id
                where sg.release_id = $1 and sg.person_id = $2 and sg.role = $3`, [release.id, query.person, query.role]);
  };

  r.get('/release/:id/firme/elimina', async (req, res) => {
    const release = await findRelease(req.params.id);
    const sig = release && await findSignature(release, req.query);
    if (!sig) return notFound(res);
    res.render('confirm', {
      title: 'Togliere la firma?',
      text: `${sig.full_name} non comparirà più come ${ROLES[sig.role].toLowerCase()} della release ${release.version}.`,
      action: `/release/${release.id}/firme/elimina?person=${sig.person_id}&role=${sig.role}`, button: 'Togli firma', back: `/release/${release.id}#firme`, nav: 'rel',
    });
  });

  r.post('/release/:id/firme/elimina', async (req, res) => {
    const release = await findRelease(req.params.id);
    const sig = release && await findSignature(release, req.query);
    if (!sig) return notFound(res);
    await db.tx(req.user, (q) => q.query('delete from release_signatures where release_id = $1 and person_id = $2 and role = $3', [release.id, sig.person_id, sig.role]));
    res.redirect(303, `/release/${release.id}?ok=eliminato#firme`);
  });

  async function confirmRelease(res, release, status = 200) {
    const { n } = await one('select count(*)::int as n from sessions where release_id = $1', [release.id]);
    res.status(status).render('confirm', {
      title: `Eliminare la release ${release.version}?`,
      text: n ? `La release ha ${n} ${n === 1 ? 'sessione' : 'sessioni'} di test: eliminale prima di eliminare la release.` : 'La release non ha sessioni e verrà eliminata, con le sue firme e il suo report.',
      action: n ? null : `/release/${release.id}/elimina`, button: 'Elimina release', back: `/release/${release.id}`, nav: 'rel',
    });
  }

  r.get('/release/:id/elimina', async (req, res) => {
    const release = await findRelease(req.params.id);
    if (!release) return notFound(res);
    await confirmRelease(res, release);
  });

  r.post('/release/:id/elimina', async (req, res) => {
    const release = await findRelease(req.params.id);
    if (!release) return notFound(res);
    try {
      await db.tx(req.user, (q) => q.query('delete from releases where id = $1', [release.id]));
    } catch (err) {
      if (err.constraint !== 'sessions_release_id_fkey') throw err;
      return confirmRelease(res, release, 409);
    }
    res.redirect(303, '/release?ok=eliminato');
  });

  return r;
}
