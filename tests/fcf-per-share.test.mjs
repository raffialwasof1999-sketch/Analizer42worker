import test from 'node:test';
import assert from 'node:assert/strict';
import { fcfPerShare } from '../src/fcf-per-share.js';

const row=(end,fcf,eps)=>({fiscalPeriodEnd:end,freeCashFlow:fcf,dilutedEPS:eps});
const raw=(end,shares,eps)=>({fiscalPeriodEnd:end,dilutedShares:shares,dilutedEPS:eps});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} vs ${b}`);

test('no split: FCF divided by the as-filed diluted share count', () => {
  const r=fcfPerShare([row('2026-06-30',30e9,2.0),row('2026-03-31',28e9,1.9)],
    [raw('2026-06-30',15e9,2.0),raw('2026-03-31',15.1e9,1.9)]);
  close(r.values[0],2); close(r.values[1],28e9/15.1e9);
  assert.deepEqual(r.factors,[1,1]);
});

test('NVIDIA-style 10-for-1 split: pre-split quarters scaled to today\'s basis', () => {
  // Final EPS is split-adjusted; the pre-split 10-Q reported 10x EPS on 1/10 the shares.
  const final=[row('2024-07-28',13.5e9,0.67),row('2024-04-28',14.9e9,0.60)];
  const asFiled=[raw('2024-07-28',24.8e9,0.67),raw('2024-04-28',2.5e9,6.0)];
  const r=fcfPerShare(final,asFiled);
  assert.deepEqual(r.factors,[1,10]);
  close(r.values[1],14.9e9/25e9);                    // not 14.9e9/2.5e9
});

test('a quarter without EPS inherits the newer basis only if its share count is continuous', () => {
  const final=[row('2026-06-30',10,1),row('2026-03-31',9,null),row('2025-12-31',8,null)];
  const asFiled=[raw('2026-06-30',100,1),raw('2026-03-31',101,null),raw('2025-12-31',300,null)];
  const r=fcfPerShare(final,asFiled);
  assert.deepEqual(r.factors,[1,1,null]);           // 3x jump without EPS proof: unknown
  assert.equal(r.values[2],null);
});

test('an EPS ratio that is not a clean split ratio, or tiny EPS, gives no factor', () => {
  const r=fcfPerShare([row('2026-06-30',10,1),row('2026-03-31',9,1.37),row('2025-12-31',8,0.01)],
    [raw('2026-06-30',100,1),raw('2026-03-31',100,1.0),raw('2025-12-31',100,0.04)]);
  // 1.0/1.37 is not a split ratio -> falls back to continuity (same shares) -> factor 1.
  assert.deepEqual(r.factors,[1,1,1]);
  const lone=fcfPerShare([row('2026-06-30',10,1.37)],[raw('2026-06-30',100,1.0)]);
  assert.deepEqual(lone.factors,[null]);
});

test('missing FCF or shares leaves the value null', () => {
  const r=fcfPerShare([row('2026-06-30',null,1),row('2026-03-31',5,1)],[raw('2026-06-30',100,1),raw('2026-03-31',null,1)]);
  assert.deepEqual(r.values,[null,null]);
});
