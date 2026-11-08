import { Router } from 'express';

export const EVENTS = {
  not_passed: { label: 'NOT PASSED', tag: 'fail' },
  session_closed: { label: 'SESSIONE CHIUSA', tag: 'info' },
  report_pending: { label: 'DA APPROVARE', tag: 'na' },
};
const when = (at) => new Date(at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' });
// Solo le notifiche delle persone collegate all'utente: nessuno vede o tocca quelle degli altri.
const MINE = 'n.person_id in (select id from people where user_id = $1)';

export function notifications(db) {
  const r = Router();
  const all = async (sql, params) => (await db.query(sql, params)).rows;
  const list = async (userId, onlyUnread, limit) => (await all(
    `select n.id, n.event, n.title, n.detail, n.read_at, n.created_at from notifications n
     where ${MINE} ${onlyUnread ? 'and n.read_at is null' : ''} order by n.id desc limit ${limit}`, [userId]))
    .map((n) => ({ ...n, when: when(n.created_at), ...EVENTS[n.event] }));

  // Campanella nella barra superiore: numero di non lette e le ultime cinque.
  r.use(async (req, res, next) => {
    const [{ unread }] = await all(`select count(*)::int as unread from notifications n where ${MINE} and n.read_at is null`, [req.user.id]);
    res.locals.bell = { unread, items: unread ? await list(req.user.id, true, 5) : [] };
    next();
  });

  r.get('/notifiche', async (req, res) => {
    const everything = req.query.tutte === '1';
    const [{ total }] = await all(`select count(*)::int as total from notifications n where ${MINE}`, [req.user.id]);
    res.render('notifications', { items: await list(req.user.id, !everything, 200), everything, total });
  });

  r.post('/notifiche/lette', async (req, res) => {
    await db.tx(req.user, (q) => q.query(`update notifications n set read_at = now() where ${MINE} and n.read_at is null`, [req.user.id]));
    res.redirect(303, '/notifiche');
  });

  const findMine = async (req) => (/^\d{1,18}$/.test(req.params.id)
    ? (await all(`select n.id, n.title, n.link from notifications n where n.id = $2 and ${MINE}`, [req.user.id, req.params.id]))[0] : null);
  const notFound = (res) => res.status(404).render('message', { title: 'Notifica non trovata', text: 'Potrebbe essere stata eliminata.', nav: null });

  r.post('/notifiche/:id/apri', async (req, res) => {
    const n = await findMine(req);
    if (!n) return notFound(res);
    await db.tx(req.user, (q) => q.query('update notifications set read_at = coalesce(read_at, now()) where id = $1', [n.id]));
    res.redirect(303, n.link); // il database accetta solo percorsi interni ("/…", mai "//…")
  });

  r.post('/notifiche/:id/letta', async (req, res) => {
    const n = await findMine(req);
    if (!n) return notFound(res);
    await db.tx(req.user, (q) => q.query('update notifications set read_at = coalesce(read_at, now()) where id = $1', [n.id]));
    res.redirect(303, '/notifiche');
  });

  r.get('/notifiche/:id/elimina', async (req, res) => {
    const n = await findMine(req);
    if (!n) return notFound(res);
    res.render('confirm', { title: 'Eliminare la notifica?', text: `"${n.title}" sparirà dalle tue notifiche. Il test, la sessione o il report a cui si riferisce non cambiano.`,
      action: `/notifiche/${n.id}/elimina`, button: 'Elimina notifica', back: '/notifiche?tutte=1', nav: null });
  });

  r.post('/notifiche/:id/elimina', async (req, res) => {
    const n = await findMine(req);
    if (!n) return notFound(res);
    await db.tx(req.user, (q) => q.query('delete from notifications where id = $1', [n.id]));
    res.redirect(303, '/notifiche?tutte=1&ok=eliminato');
  });

  return r;
}
