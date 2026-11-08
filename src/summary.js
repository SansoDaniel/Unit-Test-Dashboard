// Esiti di una release, sessione per sessione, ed esito calcolato. Lo usano dashboard e report.
export const COMPUTED = {
  'NOT PASSED': { label: 'NOT PASSED', tag: 'fail' },
  INCOMPLETE: { label: 'DA COMPLETARE', tag: 'na' },
  PASSED: { label: 'PASSED', tag: 'pass' },
  EMPTY: { label: 'NESSUN ESITO', tag: 'todo' },
};
export const REPORT_STATUS = {
  draft: { label: 'BOZZA', tag: 'todo' },
  pending_approval: { label: 'DA APPROVARE', tag: 'na' },
  approved: { label: 'APPROVATO', tag: 'pass' },
};
const KEYS = ['total', 'PASSED', 'NOT PASSED', 'NOT AVAILABLE', 'NOT TESTED'];

export async function releaseSummary(db, releaseId) {
  const [{ rows: sessions }, { rows: [tests] }] = await Promise.all([
    db.query(`select s.id, c.name as configuration, s.status, s.started_on::text, count(x.test_id)::int as total,
                     count(x.test_id) filter (where x.outcome = 'PASSED')::int as "PASSED",
                     count(x.test_id) filter (where x.outcome = 'NOT PASSED')::int as "NOT PASSED",
                     count(x.test_id) filter (where x.outcome = 'NOT AVAILABLE')::int as "NOT AVAILABLE",
                     count(x.test_id) filter (where x.outcome = 'NOT TESTED')::int as "NOT TESTED"
              from sessions s join configurations c on c.id = s.configuration_id left join results x on x.session_id = s.id
              where s.release_id = $1 group by s.id, c.name order by c.name`, [releaseId]),
    db.query(`select count(distinct x.test_id)::int as tests, count(distinct x.test_id) filter (where x.outcome = 'NOT PASSED')::int as failed
              from results x join sessions s on s.id = x.session_id where s.release_id = $1`, [releaseId]),
  ]);
  const totals = Object.fromEntries(KEYS.map((k) => [k, sessions.reduce((sum, s) => sum + s[k], 0)]));
  const computed = totals['NOT PASSED'] ? 'NOT PASSED' : totals['NOT TESTED'] ? 'INCOMPLETE' : totals.total ? 'PASSED' : 'EMPTY';
  return { sessions, totals, tests: tests.tests, failedTests: tests.failed, computed };
}
