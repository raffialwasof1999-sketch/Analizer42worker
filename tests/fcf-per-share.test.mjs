import test from 'node:test';
import assert from 'node:assert/strict';
import { fcfPerShare } from '../src/fcf-per-share.js';

// Published row: EPS on today's basis, shares as filed.
const row=(end,fcf,shares,eps,ni)=>({fiscalPeriodEnd:end,freeCashFlow:fcf,dilutedShares:shares,dilutedEPS:eps,netIncome:ni});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} vs ${b}`);

test('no split: FCF divided by the as-filed diluted share count', () => {
  const r=fcfPerShare([row('2026-06-30',30e9,15e9,2.0,30e9),row('2026-03-31',28e9,15.1e9,1.9,28.7e9)]);
  close(r.values[0],2); close(r.values[1],28e9/15.1e9);
  assert.deepEqual(r.factors,[1,1]);
});

test('NVIDIA 10-for-1 and 4-for-1 splits: pre-split share counts scaled to today\'s basis', () => {
  // Real NVIDIA figures: Q1 FY25 (2.489B shares filed, 14.881B net income,
  // split-adjusted EPS 0.60) and Q1 FY22 (632M shares, 1.912B, 0.076).
  const r=fcfPerShare([row('2024-07-28',13.511e9,24.848e9,0.67,16.599e9),
    row('2024-04-28',14.976e9,2.489e9,0.60,14.881e9),
    row('2021-05-02',1.576e9,632e6,0.076,1.912e9)]);
  assert.deepEqual(r.factors,[1,10,40]);            // 4-for-1 (2021) then 10-for-1 (2024)
  close(r.values[1],14.976e9/24.89e9); close(r.values[2],1.576e9/25.28e9);
  const old=fcfPerShare([row('2021-08-01',2.499e9,2.532e9,0.094,2.374e9),row('2021-05-02',1.576e9,632e6,0.076,1.912e9)]);
  assert.deepEqual(old.factors,[10,40]);
});

test('a fiscal Q4 with no filed share count uses net income / EPS (Apple FY2020 Q4)', () => {
  const r=fcfPerShare([row('2020-12-26',35.263e9,17.113688e9,1.68,28.755e9),
    row('2020-09-26',18.792e9,null,0.73,12.673e9),
    row('2020-06-27',14.706e9,4.354788e9,0.65,11.253e9)]);
  close(r.values[1],18.792e9/(12.673e9/0.73));
  assert.deepEqual(r.factors,[1,null,4]);
  // Tiny EPS is too rounded to stand in for a share count.
  assert.equal(fcfPerShare([row('a',1,null,0.05,1e8)]).values[0],null);
});

test('without EPS proof, a quarter inherits the newer basis only if its share count is continuous', () => {
  const r=fcfPerShare([row('2026-06-30',10,100,1,100),row('2026-03-31',9,101,null,90),row('2025-12-31',8,300,null,80)]);
  assert.deepEqual(r.factors,[1,1,null]);           // 3x jump without EPS proof: unknown
  assert.equal(r.values[2],null);
  // Net income / EPS that matches no split ratio falls back to continuity.
  const odd=fcfPerShare([row('2026-06-30',10,100,1,100),row('2026-03-31',9,100,1.37,100)]);
  assert.deepEqual(odd.factors,[1,1]);
  assert.deepEqual(fcfPerShare([row('x',10,100,1.37,100)]).factors,[null]);
});

test('missing FCF or shares leaves the value null', () => {
  const r=fcfPerShare([row('2026-06-30',null,100,1,100),row('2026-03-31',5,null,null,null)]);
  assert.deepEqual(r.values,[null,null]);
});
