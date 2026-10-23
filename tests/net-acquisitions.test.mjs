import test from 'node:test';
import assert from 'node:assert/strict';
import { netAcquisitionsQuarter, ACQ_BASIS as B } from '../src/index.js';

// SEC facts: year-to-date cash-flow records for one fiscal year.
const ends=['2025-03-31','2025-06-30','2025-09-30','2025-12-31'];
const fact=(start,end,val,form)=>({start,end,val,form,filed:'2026-01-01',priority:0});
const ytd=vals=>vals.map((v,j)=>v===null?null:fact('2025-01-01',ends[j],v,j===3?'10-K':'10-Q')).filter(Boolean);
const run=map=>{
  const prev={}; return ends.map((end,j)=>{ const r={}; const q4=j===3;
    netAcquisitionsQuarter(r,map,end,q4,q4?['10-K','10-K/A']:['10-Q','10-Q/A'],prev,j);
    return [r.netAcquisitions,r.acquisitionsBasis]; });
};
// The company used the standard acquisitions line in an earlier year.
const earlier=[fact('2022-01-01','2022-12-31',300,'10-K')];

test('quarters come from year-to-date figures, net of divestitures', () => {
  const r=run({operatingCashFlow:ytd([10,20,30,40]),acquisitions:ytd([5,5,12,20]),divestitures:ytd([0,1,1,4])});
  assert.deepEqual(r,[[5,B.reported],[-1,B.reported],[7,B.reported],[5,B.reported]]);
});

test('a missing line counts as $0 when the cash-flow statement was filed (Apple after 2022)', () => {
  const r=run({operatingCashFlow:ytd([10,20,30,40]),acquisitions:[...earlier,...ytd([null,null,8,8])],divestitures:[]});
  assert.deepEqual(r,[[0,B.countedZero],[0,B.countedZero],[8,B.reported],[0,B.reported]]);
});

test('no standard acquisitions line in recent years: unknown, not $0 (Microsoft)', () => {
  const r=run({operatingCashFlow:ytd([10,20,30,40]),acquisitions:[],divestitures:[]});
  assert.deepEqual(r.map(x=>x[1]),[B.noStandardLine,B.noStandardLine,B.noStandardLine,B.noStandardLine]);
  assert.deepEqual(r.map(x=>x[0]),[null,null,null,null]);
});

test('a footnote reporting cash paid for a deal blocks the $0', () => {
  const r=run({operatingCashFlow:ytd([10,20,30,40]),acquisitions:earlier,divestitures:[],
    acquisitionDisclosure:[fact('2025-01-01','2025-12-31',69,'10-K')]});
  assert.deepEqual(r,[[0,B.countedZero],[0,B.countedZero],[0,B.countedZero],[null,B.disclosedDeal]]);
});

test('without a cash-flow statement the quarter (and the next) is unknown', () => {
  const r=run({operatingCashFlow:ytd([10,null,30,40]),acquisitions:ytd([2,null,6,6]),divestitures:[]});
  assert.deepEqual(r,[[2,B.reported],[null,B.noStatement],[null,B.reported],[0,B.reported]]);
});
