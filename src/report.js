import { Router } from 'express';
import { COMPUTED, REPORT_STATUS as STATUS, releaseSummary } from './summary.js';
import { UUID, isoDay, text, uuidOrNull } from './util.js';

const FINALS = ['PASSED', 'NOT PASSED'];

// Il risultato finale può differire da quello calcolato solo con una motivazione scritta.
const needsReason = (report, computed) => report.final_outcome && report.final_outcome !== computed && !report.final_reason;

export function report(db) {
  const r = Router();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0] ?? null;
  const all = async (sql, params) => (await db.query(sql, params)).rows;
  const notFound = (res) => res.status(404).render('message', { title: 'Release non trovata', text: 'Potrebbe essere stata eliminata.', nav: 'rel' });
  const findRelease = (id) => (UUID.test(id) ? one('select id, version from releases where id = $1', [id]) : null);
  const findReport = (releaseId) => one(`select release_id, test_date::text, executed_by, motivation, next_actions, final_outcome, final_reason, status
                                         from reports where release_id = $1`, [releaseId]);
  const isApprover = async (releaseId, userId) => Boolean(await one(
    `select 1 from release_signatures sg join people p on p.id = sg.person_id where sg.release_id = $1 and sg.role = 'approver' and p.user_id = $2`, [releaseId, userId]));

  async function render(res, rel, { draft = null, errors = [], status = 200 } = {}) {
    const [summary, saved, people, signatures] = await Promise.all([
      releaseSummary(db, rel.id),
      findReport(rel.id),
      all('select id, full_name from people order by full_name'),
      all(`select sg.role, sg.signed_on::text, p.full_name, p.title from release_signatures sg join people p on p.id = sg.person_id
           where sg.release_id = $1 order by sg.role desc, p.full_name`, [rel.id]),
    ]);
    const reportRow = draft ?? saved ?? { test_date: '', executed_by: '', motivation: '', next_actions: '', final_outcome: '', final_reason: '' };
    res.status(status).render('report', {
      rel, summary, computed: COMPUTED[summary.computed], report: reportRow, saved, people, signatures, errors, finals: FINALS,
      statusInfo: STATUS[saved?.status ?? 'draft'], canApprove: saved?.status === 'pending_approval' && await isApprover(rel.id, res.locals.user.id),
      warnReason: Boolean(saved && needsReason(saved, summary.computed)),
    });
  }

  r.get('/release/:id/report', async (req, res) => {
    const rel = await findRelease(req.params.id);
    if (!rel) return notFound(res);
    await render(res, rel);
  });

  // Versione da stampare o salvare in PDF dal browser.
  r.get('/release/:id/report/stampa', async (req, res) => {
    const rel = await findRelease(req.params.id);
    if (!rel) return notFound(res);
    const [summary, saved, signatures] = await Promise.all([
      releaseSummary(db, rel.id),
      one(`select rp.test_date::text, rp.motivation, rp.next_actions, rp.final_outcome, rp.final_reason, rp.status, p.full_name as executed_by
           from reports rp left join people p on p.id = rp.executed_by where rp.release_id = $1`, [rel.id]),
      all(`select sg.role, sg.signed_on::text, p.full_name, p.title from release_signatures sg join people p on p.id = sg.person_id
           where sg.release_id = $1 order by sg.role desc, p.full_name`, [rel.id]),
    ]);
    res.render('report-print', {
      rel, summary, computed: COMPUTED[summary.computed], report: saved ?? {}, signatures, statusInfo: STATUS[saved?.status ?? 'draft'],
      printedAt: new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' }),
    });
  });

  r.post('/release/:id/report', async (req, res) => {
    const rel = await findRelease(req.params.id);
    if (!rel) return notFound(res);
    const draft = {
      test_date: text(req.body.test_date), executed_by: text(req.body.executed_by), motivation: text(req.body.motivation) || null,
      next_actions: text(req.body.next_actions) || null, final_outcome: text(req.body.final_outcome) || null, final_reason: text(req.body.final_reason) || null,
    };
    const errors = [];
    if (draft.test_date && !isoDay(draft.test_date)) errors.push('La data del test non è valida.');
    if (draft.executed_by && !UUID.test(draft.executed_by)) errors.push('La persona indicata non è valida.');
    if (draft.final_outcome && !FINALS.includes(draft.final_outcome)) errors.push('Il risultato finale deve essere PASSED o NOT PASSED.');
    const { computed } = await releaseSummary(db, rel.id);
    if (needsReason(draft, computed)) errors.push(`Il risultato finale è diverso da quello calcolato (${COMPUTED[computed].label}): scrivi la motivazione.`);
    if (errors.length) return render(res, rel, { draft, errors, status: 400 });
    const before = await findReport(rel.id);
    // Ogni modifica riporta il report in bozza: gli approvatori devono rivedere il testo nuovo.
    const changed = await db.tx(req.user, async (q) => (await q.query(`
      insert into reports (release_id, test_date, executed_by, motivation, next_actions, final_outcome, final_reason)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (release_id) do update set test_date = excluded.test_date, executed_by = excluded.executed_by, motivation = excluded.motivation,
        next_actions = excluded.next_actions, final_outcome = excluded.final_outcome, final_reason = excluded.final_reason, status = 'draft'
      where (reports.test_date, reports.executed_by, reports.motivation, reports.next_actions, reports.final_outcome, reports.final_reason)
            is distinct from (excluded.test_date, excluded.executed_by, excluded.motivation, excluded.next_actions, excluded.final_outcome, excluded.final_reason)
      returning status`, [rel.id, isoDay(draft.test_date), uuidOrNull(draft.executed_by), draft.motivation, draft.next_actions, draft.final_outcome, draft.final_reason])).rows.length > 0);
    res.redirect(303, `/release/${rel.id}/report?ok=${changed && before && before.status !== 'draft' ? 'bozza' : 'salvato'}`);
  });

  r.post('/release/:id/report/invia', async (req, res) => {
    const rel = await findRelease(req.params.id);
    if (!rel) return notFound(res);
    const saved = await findReport(rel.id);
    const { computed } = await releaseSummary(db, rel.id);
    const { approvers } = await one("select count(*)::int as approvers from release_signatures where release_id = $1 and role = 'approver'", [rel.id]);
    const errors = [];
    if (!saved) errors.push('Salva il report prima di inviarlo.');
    else {
      if (saved.status !== 'draft') errors.push('Il report è già stato inviato.');
      if (!saved.final_outcome) errors.push('Indica il risultato finale prima di inviare il report.');
      if (needsReason(saved, computed)) errors.push(`Il risultato finale è diverso da quello calcolato (${COMPUTED[computed].label}): scrivi la motivazione.`);
    }
    if (!approvers) errors.push('La release non ha approvatori: aggiungili nella scheda della release.');
    if (errors.length) return render(res, rel, { errors, status: 409 });
    await db.tx(req.user, (q) => q.query("update reports set status = 'pending_approval' where release_id = $1 and status = 'draft'", [rel.id]));
    res.redirect(303, `/release/${rel.id}/report?ok=inviato`);
  });

  r.post('/release/:id/report/approva', async (req, res) => {
    const rel = await findRelease(req.params.id);
    if (!rel) return notFound(res);
    const saved = await findReport(rel.id);
    if (saved?.status !== 'pending_approval') return render(res, rel, { errors: ['Il report non è in attesa di approvazione.'], status: 409 });
    if (!await isApprover(rel.id, req.user.id)) {
      return render(res, rel, { errors: ['Solo un approvatore della release, collegato al proprio account, può approvare il report.'], status: 403 });
    }
    await db.tx(req.user, (q) => q.query("update reports set status = 'approved' where release_id = $1 and status = 'pending_approval'", [rel.id]));
    res.redirect(303, `/release/${rel.id}/report?ok=approvato`);
  });

  return r;
}
