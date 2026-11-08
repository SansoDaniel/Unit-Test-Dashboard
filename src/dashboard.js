import { Router } from 'express';
import { COMPUTED, releaseSummary } from './summary.js';

const TOP_UNITS = 12;
const CHART_RELEASES = 8; // righe del grafico tra le release; la media le conta tutte
const OUTCOMES = ['PASSED', 'NOT AVAILABLE', 'NOT PASSED', 'NOT TESTED']; // ordine dei segmenti: verde e rosso mai vicini

// Semicerchio (180°) nel viewBox 0 0 200 108: da sinistra a destra passando in alto. t ∈ [0, 1] è la posizione lungo l'arco.
const R = 80, CX = 100, CY = 96;
const GAP = 2 / (Math.PI * R); // 2px di arco tra un segmento e l'altro
const MIN = 0.015; // un segmento piccolo resta visibile; il valore esatto è nel suggerimento e nell'aria-label
const point = (t) => `${(CX + R * Math.cos(Math.PI * (1 - t))).toFixed(2)} ${(CY - R * Math.sin(Math.PI * (1 - t))).toFixed(2)}`;
export function semicircle(pct) {
  const parts = OUTCOMES.filter((o) => pct[o] > 0).map((o) => [o, Math.max(pct[o] / 100, MIN)]);
  const sum = parts.reduce((s, [, f]) => s + f, 0);
  let t = 0;
  return parts.map(([outcome, f], i) => {
    const t0 = t + (i ? GAP / 2 : 0);
    t += f / sum;
    const t1 = t - (i < parts.length - 1 ? GAP / 2 : 0);
    return { outcome, d: `M ${point(t0)} A ${R} ${R} 0 0 1 ${point(t1)}` };
  });
}

export function dashboard(db) {
  const r = Router();
  const all = async (sql, params) => (await db.query(sql, params)).rows;

  r.get('/', async (req, res) => {
    const { release } = res.locals;
    if (!release) return res.render('dashboard', { info: null });
    const [[info], summary, units, cells, failed, byRelease, [{ releases }]] = await Promise.all([
      all(`select rl.version, rl.released_on::text, rl.changes, p.full_name as author
           from releases rl left join people p on p.id = rl.author_id where rl.id = $1`, [release.id]),
      releaseSummary(db, release.id),
      all(`select u.id, u.name, count(t.id) filter (where not t.archived)::int as tests
           from units u left join use_cases uc on uc.unit_id = u.id left join tests t on t.use_case_id = uc.id
           group by u.id order by tests desc, u.position`),
      all(`select uc.unit_id, x.session_id, count(*)::int as n, count(*) filter (where x.outcome = 'PASSED')::int as passed,
                  count(*) filter (where x.outcome = 'NOT PASSED')::int as failed, count(*) filter (where x.outcome = 'NOT AVAILABLE')::int as na
           from results x join sessions s on s.id = x.session_id join tests t on t.id = x.test_id join use_cases uc on uc.id = t.use_case_id
           where s.release_id = $1 group by uc.unit_id, x.session_id`, [release.id]),
      all(`select t.code, t.name, jsonb_agg(c.name order by c.name) as sessions, bool_or(x.graphic_issue) as graphic,
                  (array_agg(x.note order by c.name) filter (where x.note is not null))[1] as note
           from results x join sessions s on s.id = x.session_id join configurations c on c.id = s.configuration_id join tests t on t.id = x.test_id
           where s.release_id = $1 and x.outcome = 'NOT PASSED' group by t.id order by t.code`, [release.id]),
      all(`select rl.version, count(*)::int as total, count(*) filter (where x.outcome = 'PASSED')::int as "PASSED",
                  count(*) filter (where x.outcome = 'NOT PASSED')::int as "NOT PASSED", count(*) filter (where x.outcome = 'NOT AVAILABLE')::int as "NOT AVAILABLE",
                  count(*) filter (where x.outcome = 'NOT TESTED')::int as "NOT TESTED"
           from releases rl join sessions s on s.release_id = rl.id join results x on x.session_id = s.id
           group by rl.id order by rl.position desc`),
      all('select count(*)::int as releases from releases'),
    ]);

    // Media tra le release: ogni release pesa uguale, qualunque sia il numero dei suoi esiti.
    const share = (r) => Object.fromEntries(OUTCOMES.map((o) => [o, (100 * r[o]) / r.total]));
    const shares = byRelease.map((r) => ({ label: r.version, pct: share(r), total: r.total }));
    const average = shares.length && {
      label: 'Media', avg: true, total: null,
      pct: Object.fromEntries(OUTCOMES.map((o) => [o, shares.reduce((sum, r) => sum + r.pct[o], 0) / shares.length])),
    };

    // Una cella per unità e sessione: test PASSED sui test dell'unità inclusi nella sessione.
    const byKey = new Map(cells.map((c) => [`${c.unit_id} ${c.session_id}`, c]));
    const matrix = units.filter((u) => u.tests > 0).map((u) => {
      const row = summary.sessions.map((s) => {
        const c = byKey.get(`${u.id} ${s.id}`);
        if (!c || c.passed + c.failed + c.na === 0) return { level: 0 };
        const ratio = c.passed / c.n;
        return { ...c, level: ratio >= 0.7 ? 3 : ratio >= 0.4 ? 2 : 1 };
      });
      return { ...u, row, untested: row.every((c) => c.level === 0) };
    });
    const untested = matrix.filter((u) => u.untested);
    const showAll = req.query.unita === 'tutte';
    res.render('dashboard', {
      info, summary, computed: COMPUTED[summary.computed], failed,
      matrix: showAll ? matrix : matrix.slice(0, TOP_UNITS), hidden: showAll ? 0 : Math.max(0, matrix.length - TOP_UNITS),
      untested: { units: untested.length, tests: untested.reduce((sum, u) => sum + u.tests, 0) },
      chart: {
        outcomes: OUTCOMES, withResults: shares.length, releases,
        rows: (average ? [average, ...shares.slice(0, CHART_RELEASES)] : []).map((r) => ({ ...r, arcs: semicircle(r.pct) })),
      },
      fmtPct: (n) => `${n.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`,
    });
  });

  return r;
}
