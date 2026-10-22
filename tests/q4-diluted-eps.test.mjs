import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveQ4BasicEPS} from '../src/q4-basic-eps.js';

// A December fiscal year with no standalone Q4 filing. Quarter diluted
// shares fall 100m -> 94m; net income 200m, 150m, 140m, 180m. The true Q4
// diluted EPS is 180/94 = 1.91.
const ends=['2025-03-31','2025-06-30','2025-09-30','2025-12-31'];
const starts=['2025-01-01','2025-04-01','2025-07-01','2025-10-01'];
const days=[90,91,92,92];
const shares=[100e6,98e6,96e6,94e6];
const income=[200e6,150e6,140e6,180e6];
const annualShares=shares.reduce((s,v,i)=>s+v*days[i],0)/365;
const annualIncome=income.reduce((a,b)=>a+b);
const cents=x=>Math.round(x*100)/100;
const annualEPS=cents(annualIncome/annualShares);
const qAccn=['q1','q2','q3'];

const quarters=()=>ends.map((end,i)=>({fiscalYear:2025,fiscalQuarter:i+1,fiscalPeriodEnd:end,
  netIncome:income[i],dilutedEPS:i<3?cents(income[i]/shares[i]):null,dilutedShares:i<3?shares[i]:null}));
const years=[{fiscalYear:2025,fiscalPeriodEnd:'2025-12-31',netIncome:annualIncome,dilutedEPS:annualEPS}];
const shareFacts=[
  {start:'2025-01-01',end:'2025-12-31',val:annualShares,form:'10-K',accn:'k',filed:'2026-02-01'},
  ...[0,1,2].map(i=>({start:starts[i],end:ends[i],val:shares[i],form:'10-Q',accn:qAccn[i],filed:'2025-0'+(i+4)+'-30'}))
];
const epsFacts=[
  {start:'2025-01-01',end:'2025-12-31',val:annualEPS,form:'10-K',accn:'k',filed:'2026-02-01'},
  ...[0,1,2].map(i=>({start:starts[i],end:ends[i],val:cents(income[i]/shares[i]),form:'10-Q',accn:qAccn[i],filed:'2025-0'+(i+4)+'-30'}))
];
const diluted={eps:'dilutedEPS',shares:'dilutedShares'};

test('estimates fiscal Q4 diluted EPS from 10-K and Q1-Q3 diluted figures',()=>{
  const q=quarters();
  const out=deriveQ4BasicEPS(q,years,shareFacts,epsFacts,diluted);
  assert.equal(out.estimatedCount,1);
  assert.ok(Math.abs(q[3].dilutedEPS-1.91)<=0.02,String(q[3].dilutedEPS));
  assert.equal(out.findings[0].metric,'dilutedEPS');
  assert.equal(out.findings[0].explicitlyReported,false);
  assert.equal(q[3].basicEPS,undefined);              // basic untouched
});

test('reported Q4 diluted EPS is never overwritten',()=>{
  const q=quarters(); q[3].dilutedEPS=1.90;
  assert.equal(deriveQ4BasicEPS(q,years,shareFacts,epsFacts,diluted).estimatedCount,0);
  assert.equal(q[3].dilutedEPS,1.90);
});

test('inconsistent annual figures leave Q4 diluted EPS blank',()=>{
  const q=quarters();
  const badYears=[{...years[0],netIncome:annualIncome*3}];
  assert.equal(deriveQ4BasicEPS(q,badYears,shareFacts,epsFacts,diluted).estimatedCount,0);
  assert.equal(q[3].dilutedEPS,null);
});
