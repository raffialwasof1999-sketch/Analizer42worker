import test from 'node:test';
import assert from 'node:assert/strict';
import { netAcquisitionsQuarter } from '../src/index.js';

// SEC facts: year-to-date cash-flow records for one fiscal year.
const fact=(start,end,val,form='10-Q')=>({start,end,val,form,filed:'2026-01-01',priority:0});
const ends=['2025-03-31','2025-06-30','2025-09-30','2025-12-31'];
const ytd=(vals,{form4='10-K'}={})=>vals.map((v,j)=>v===null?null:fact('2025-01-01',ends[j],v,j===3?form4:'10-Q')).filter(Boolean);
const run=map=>{
  const prev={}; return ends.map((end,j)=>{ const r={}; const q4=j===3;
    netAcquisitionsQuarter(r,map,end,q4,q4?['10-K','10-K/A']:['10-Q','10-Q/A'],prev,j);
    return [r.netAcquisitions,r.acquisitionsLineMissing]; });
};

test('quarters come from year-to-date figures, net of divestitures', () => {
  const r=run({operatingCashFlow:ytd([10,20,30,40]),acquisitions:ytd([5,5,12,20]),divestitures:ytd([0,1,1,4])});
  assert.deepEqual(r,[[5,0],[-1,0],[7,0],[5,0]]);
});

test('a missing line counts as $0 when the cash-flow statement was filed', () => {
  // Acquisitions shown only from Q3 (a deal that quarter); no divestitures line ever.
  const r=run({operatingCashFlow:ytd([10,20,30,40]),acquisitions:ytd([null,null,8,8]),divestitures:[]});
  assert.deepEqual(r,[[0,1],[0,1],[8,0],[0,0]]);
});

test('without a cash-flow statement the quarter (and the next) is unknown', () => {
  const r=run({operatingCashFlow:ytd([10,null,30,40]),acquisitions:ytd([2,null,6,6]),divestitures:[]});
  assert.deepEqual(r,[[2,0],[null,null],[null,0],[0,0]]);
});
