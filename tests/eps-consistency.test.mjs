import test from 'node:test';
import assert from 'node:assert/strict';
import {enforceQuarterlyEPSConsistency} from '../src/eps-consistency.js';

// Alphabet-like: EPS only by share class, so no share facts. Q1 2021 kept
// its pre-20:1-split EPS (26.63 basic / 26.29 diluted) beside post-split
// quarters; the FY2021 annual EPS (5.69 on 76.0bn net income) confirms the
// post-split basis. Q4 2021 has no EPS at all.
const rows=()=>[
  {fiscalYear:2022,fiscalQuarter:1,fiscalPeriodEnd:'2022-03-31',netIncome:16436e6,basicEPS:1.24,dilutedEPS:1.23},
  {fiscalYear:2021,fiscalQuarter:4,fiscalPeriodEnd:'2021-12-31',netIncome:20642e6,basicEPS:null,dilutedEPS:null},
  {fiscalYear:2021,fiscalQuarter:3,fiscalPeriodEnd:'2021-09-30',netIncome:18936e6,basicEPS:1.42,dilutedEPS:1.40},
  {fiscalYear:2021,fiscalQuarter:2,fiscalPeriodEnd:'2021-06-30',netIncome:18525e6,basicEPS:1.38,dilutedEPS:1.36},
  {fiscalYear:2021,fiscalQuarter:1,fiscalPeriodEnd:'2021-03-31',netIncome:17930e6,basicEPS:26.63,dilutedEPS:26.29}
];
const annual=[{fiscalYear:2021,netIncome:76033e6,basicEPS:5.69,dilutedEPS:5.61}];

test('rescales a pre-split quarter when the annual EPS confirms the new basis',()=>{
  const {rows:out,findings}=enforceQuarterlyEPSConsistency(rows(),annual);
  assert.ok(Math.abs(out[4].basicEPS-26.63/20)<1e-9);
  assert.ok(Math.abs(out[4].dilutedEPS-26.29/20)<1e-9);
  assert.equal(findings.find(f=>f.periodEnd==='2021-03-31').divisor,20);
});

test('fills a Q4 with no EPS from adjacent share counts and dilution',()=>{
  const {rows:out}=enforceQuarterlyEPSConsistency(rows(),annual);
  // Alphabet reported Q4 2021 basic 1.56, diluted 1.53.
  assert.ok(Math.abs(out[1].basicEPS-1.56)<=0.02,String(out[1].basicEPS));
  assert.ok(Math.abs(out[1].dilutedEPS-1.53)<=0.02,String(out[1].dilutedEPS));
});

test('a real share jump (stock-funded merger) is not treated as a split',()=>{
  const merger=rows();
  merger[4]={...merger[4],basicEPS:2.66,dilutedEPS:2.63};   // 2x fewer shares, truly
  const asReported=[{fiscalYear:2021,netIncome:76033e6,basicEPS:9.0,dilutedEPS:8.9}];
  const {rows:out,findings}=enforceQuarterlyEPSConsistency(merger,asReported);
  assert.equal(out[4].basicEPS,2.66);
  assert.ok(!findings.some(f=>f.status==='rescaled-pre-split-quarter'));
});

test('loss quarters keep diluted equal to basic; reported values untouched',()=>{
  const r=[{fiscalPeriodEnd:'a',netIncome:-500e6,basicEPS:-0.5,dilutedEPS:null},
    {fiscalPeriodEnd:'b',netIncome:900e6,basicEPS:0.9,dilutedEPS:0.88}];
  const {rows:out}=enforceQuarterlyEPSConsistency(r,[]);
  assert.equal(out[0].dilutedEPS,-0.5);
  assert.equal(out[1].dilutedEPS,0.88);
});
