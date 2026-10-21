import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatchingAnnualBasicEPSBasis, normalizeHistoricalBasicEPS } from '../src/basic-eps-share-basis.js';
import { recoverSplitCrossingQ4BasicEPS } from '../src/split-crossing-q4-basic-eps.js';

const graph={
  changedBasisEdges:[{shareFactor:10,status:'cross-period-split-evidence'}],
  conflicts:[],shareFactors:{'annual-2025':1}
};
const yearly={fiscalYear:2025,fiscalPeriodEnd:'2025-12-31',
  basicEPS:2.70,netIncome:2700};
const annualEPS=[{accn:'annual-2025',form:'10-K',filed:'2026-01-23',
  start:'2025-01-01',end:'2025-12-31',val:2.70}];
const annualShares=[{accn:'annual-2025',form:'10-K',filed:'2026-01-23',
  start:'2025-01-01',end:'2025-12-31',val:1000}];
const q=[
  {fiscalYear:2025,fiscalQuarter:1,fiscalPeriodEnd:'2025-03-31',
    basicEPS:6,basicShares:100,netIncome:600},
  {fiscalYear:2025,fiscalQuarter:2,fiscalPeriodEnd:'2025-06-30',
    basicEPS:7,basicShares:100,netIncome:700},
  {fiscalYear:2025,fiscalQuarter:3,fiscalPeriodEnd:'2025-09-30',
    basicEPS:8,basicShares:100,netIncome:800},
  {fiscalYear:2025,fiscalQuarter:4,fiscalPeriodEnd:'2025-12-31',
    basicEPS:null,basicShares:null,netIncome:600}
];
test('recover pre-split Q3 basic EPS only via a verified annual share ratio',()=>{
  const proof=findMatchingAnnualBasicEPSBasis(q[2],yearly,annualEPS,annualShares,graph);
  assert.ok(proof);
  assert.equal(proof.shareRatio,10);
  const v=normalizeHistoricalBasicEPS([q[2]],graph,
    ()=>[{accn:'third-quarter',val:8}],[],()=>proof);
  assert.equal(v.rows[0].basicEPS,.8);
  assert.equal(v.unavailableCount,0);
});
test('refuse unproven split ratios',()=>{
  const unproven={...graph,changedBasisEdges:[]};
  assert.equal(findMatchingAnnualBasicEPSBasis(q[2],yearly,annualEPS,annualShares,unproven),null);
});
test('reconstruct split-crossing Q4 from annual weighted basic shares',()=>{
  const adjusted=q.map((x,i)=>({...x,basicEPS:i===3?null:x.basicEPS/10}));
  const out=recoverSplitCrossingQ4BasicEPS(adjusted,q,[yearly],annualEPS,annualShares,graph);
  assert.equal(out.rows[3].basicEPS,.6);
  assert.equal(out.findings.length,1);
  assert.equal(out.findings[0].explicitlyReported,false);
});
test('leave split-crossing Q4 blank if verified evidence is unavailable',()=>{
  const adjusted=q.map((x,i)=>({...x,basicEPS:i===3?null:x.basicEPS/10}));
  const out=recoverSplitCrossingQ4BasicEPS(adjusted,q,[yearly],annualEPS,annualShares,
    {...graph,changedBasisEdges:[]});
  assert.equal(out.rows[3].basicEPS,null);
});
