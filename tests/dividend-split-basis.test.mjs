import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDividendsPerShare } from '../src/dividend-split-basis.js';

const rows = list => list.map(([end, dps]) => ({ fiscalPeriodEnd: end, dividendsPerShare: dps }));
const near = (a, b) => a.forEach((v, i) => assert.ok(b[i] === null ? v === null : Math.abs(v - b[i]) < 1e-9, `${i}: ${v} vs ${b[i]}`));

test('Broadcom: pre-split quarters rescaled 10x, the impossible negative Q4 dropped', () => {
  // Real values (newest first) and fcfPerShare split factors: 1 after the
  // July 2024 10-for-1 split, 10 for quarters filed before it.
  const r = rows([['2024-08-04', 0.525], ['2024-05-05', 0.525], ['2023-10-29', 0.46], ['2023-07-30', 0.46],
    ['2023-04-30', 4.6], ['2023-01-29', 4.6], ['2022-10-30', -10.66], ['2022-07-31', 4.1]]);
  const f = [1, 10, 10, 10, 10, 10, 10, 10];
  const out = normalizeDividendsPerShare(r, f);
  near(out.values, [0.525, 0.525, 0.46, 0.46, 0.46, 0.46, null, 0.41]);
  assert.equal(out.adjustments.filter(a => a.ratio === 10).length, 3);
});

test('a dividend cut with no proven split is never mistaken for one (Whirlpool)', () => {
  const r = rows([['2026-06-30', 0.9], ['2026-03-31', 0.9], ['2025-12-31', 1.75], ['2025-09-30', 1.75]]);
  const out = normalizeDividendsPerShare(r, [1, 1, 1, 1]);
  near(out.values, [0.9, 0.9, 1.75, 1.75]);
  assert.deepEqual(out.adjustments, []);
});

test('a jump matching no proven split ratio is left alone; raises are untouched', () => {
  // Nvidia-style raise from 0.01 to 0.25 (25x) with no split between them.
  const out = normalizeDividendsPerShare(rows([['a', 0.25], ['b', 0.01], ['c', 0.01]]), [1, 1, 1]);
  near(out.values, [0.25, 0.01, 0.01]);
  // A 4-for-1 split proven by the factors, followed by older 10x values: not 4x, so kept.
  const odd = normalizeDividendsPerShare(rows([['a', 0.2], ['b', 2.0]]), [1, 4]);
  near(odd.values, [0.2, 2.0]);
});

test('chained splits (4-for-1 then 10-for-1) and missing values', () => {
  const r = rows([['a', 0.01], ['b', 0.1], ['c', null], ['d', 0.4]]);
  const out = normalizeDividendsPerShare(r, [1, 10, null, 40]);
  near(out.values, [0.01, 0.01, null, 0.01]);
});

test('Nvidia: quarters restated for the 4-for-1 split but not the 10-for-1 need 10x', () => {
  // Real: 0.004 after both splits; 2020 quarters filed as 0.04 (after 4:1 only).
  const r = rows([['2024-10-27', 0.01], ['2023-10-29', 0.004], ['2021-05-02', 0.004], ['2020-10-25', 0.04]]);
  const out = normalizeDividendsPerShare(r, [1, 10, 40, 40]);
  near(out.values, [0.01, 0.004, 0.004, 0.004]);
});

test('a units error in SEC data (Whirlpool 1,750,000 for $1.75) becomes null', () => {
  const r = rows([['a', 1.75], ['b', 1750000], ['c', 1.75]]);
  const out = normalizeDividendsPerShare(r, [1, 1, 1]);
  near(out.values, [1.75, null, 1.75]);
  assert.equal(out.adjustments[0].reason, 'implausible');
});
