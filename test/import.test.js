import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, normalizeOutcome, parseWorkbook } from '../scripts/import-excel.js';
import { testDb } from './helpers.js';

test('normalizeOutcome riporta gli esiti alle 4 forme standard', () => {
  assert.deepEqual(normalizeOutcome('NOT AVAILABLE '), { outcome: 'NOT AVAILABLE', graphicIssue: false });
  assert.deepEqual(normalizeOutcome('NOT PASSED (lato grafico)'), { outcome: 'NOT PASSED', graphicIssue: true });
  assert.deepEqual(normalizeOutcome(''), { outcome: 'NOT TESTED', graphicIssue: false });
  assert.throws(() => normalizeOutcome('FORSE'), /non riconosciuto/);
});

const xlsx = process.env.UT_XLSX;
test('import del file Excel su Postgres', { skip: !xlsx && 'imposta UT_XLSX con il percorso del file Excel' }, async () => {
  const db = await testDb();
  const parsed = await parseWorkbook(xlsx);
  await apply(db, parsed); // fallisce se i conteggi nel database non tornano con il file

  const one = async (sql) => (await db.query(sql)).rows[0].n;
  assert.equal(await one('select count(*)::int n from tests'), 264);
  assert.equal(await one('select count(*)::int n from units'), 29);
  assert.equal(await one('select count(*)::int n from use_cases'), 148);
  assert.equal(await one('select count(*)::int n from releases'), 32);
  assert.equal(await one('select count(*)::int n from tests where code between 168 and 266'), 99);
  const outcomes = Object.fromEntries((await db.query('select outcome, sum(n)::int n from session_outcomes group by outcome')).rows.map((r) => [r.outcome, r.n]));
  assert.deepEqual(outcomes, { 'PASSED': 335, 'NOT PASSED': 12, 'NOT AVAILABLE': 4, 'NOT TESTED': 705 });
  assert.equal(await one('select count(*)::int n from results where graphic_issue'), 2);
  assert.equal(await one("select count(*)::int n from audit_log where action = 'INSERT' and table_name = 'tests' and actor is null"), 264);

  // Un secondo import viene rifiutato senza toccare i dati.
  await assert.rejects(apply(db, parsed), /una sola volta/);
  assert.equal(await one('select count(*)::int n from tests'), 264);
  await db.end();
});
