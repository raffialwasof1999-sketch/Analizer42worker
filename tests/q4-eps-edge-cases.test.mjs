import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveQ4BasicEPS} from '../src/q4-basic-eps.js';

// Calendar-2022 issuer built from quarterly net income, preferred dividends
// and weighted shares; EPS is cent-rounded exactly as SEC filings report it.
const starts=['2022-01-01','2022-04-01','2022-07-01','2022-10-01'];
const ends=['2022-03-31','2022-06-30','2022-09-30','2022-12-31'];
const dayCount=[90,91,92,92];
const cents=x=>Math.round((x+Number.EPSILON)*100)/100;
function issuer({income,preferred=[0,0,0,0],shares}){
  const eps=income.map((n,i)=>cents((n-preferred[i])/shares[i]));
  const annualShares=shares.reduce((s,v,i)=>s+v*dayCount[i],0)/365;
  const annualIncome=income.reduce((a,b)=>a+b,0);
  const annualEPS=cents((annualIncome-preferred.reduce((a,b)=>a+b,0))/annualShares);
  const quarters=ends.map((end,i)=>({fiscalYear:2022,fiscalQuarter:i+1,fiscalPeriodEnd:end,
    netIncome:income[i],dilutedEPS:i<3?eps[i]:null,dilutedShares:i<3?shares[i]:null}));
  const years=[{fiscalYear:2022,fiscalPeriodEnd:ends[3],netIncome:annualIncome,dilutedEPS:annualEPS}];
  const fact=(i,val)=>({start:starts[i],end:ends[i],val,form:'10-Q',accn:'q'+i,filed:'2022-'+(5+i*3)+'-01'});
  const annual=val=>({start:starts[0],end:ends[3],val,form:'10-K',accn:'k',filed:'2023-02-01'});
  return {quarters,years,trueQ4:eps[3],
    shareFacts:[annual(annualShares),...[0,1,2].map(i=>fact(i,shares[i]))],
    epsFacts:[annual(annualEPS),...[0,1,2].map(i=>fact(i,eps[i]))]};
}
const diluted={eps:'dilutedEPS',shares:'dilutedShares'};
const run=x=>deriveQ4BasicEPS(x.quarters,x.years,x.shareFacts,x.epsFacts,diluted);

test('tiny Q4 EPS after a mid-year share issuance (AMD 2022 shape)',()=>{
  const x=issuer({income:[786e6,447e6,66e6,21e6],shares:[1.48e9,1.62e9,1.62e9,1.62e9]});
  const out=run(x);
  assert.equal(out.estimatedCount,1,JSON.stringify(out.skipped));
  assert.equal(x.quarters[3].dilutedEPS,x.trueQ4);   // 0.01, not 0.02 from rounding noise
  // The derived Q4 weighted count fills the quarter's share figure.
  assert.ok(Math.abs(x.quarters[3].dilutedShares/1.62e9-1)<0.001,String(x.quarters[3].dilutedShares));
});

test('preferred dividends taking most of a quarter (Wells Fargo 2020 shape)',()=>{
  const x=issuer({income:[653e6,-2379e6,2035e6,3091e6],preferred:[612e6,315e6,315e6,100e6],
    shares:[4.1e9,4.1e9,4.12e9,4.13e9]});
  const out=run(x);
  assert.equal(out.estimatedCount,1,JSON.stringify(out.skipped));
  assert.ok(Math.abs(x.quarters[3].dilutedEPS-x.trueQ4)<=0.01,`${x.quarters[3].dilutedEPS} vs ${x.trueQ4}`);
});

test('skipped quarters say which check stopped them',()=>{
  const x=issuer({income:[786e6,447e6,66e6,21e6],shares:[1.48e9,1.62e9,1.62e9,1.62e9]});
  x.years[0].netIncome*=3;
  const out=run(x);
  assert.equal(out.estimatedCount,0);
  assert.match(out.skipped[0].reason,/reconciles to annual net income/);
});

test('a 16-week fiscal Q4 (Costco calendar) still gets its share count',()=>{
  // FY 2024-09-02 to 2025-08-31: three 12-week quarters, then 16 weeks.
  const st=['2024-09-02','2024-11-25','2025-02-17','2025-05-12'];
  const en=['2024-11-24','2025-02-16','2025-05-11','2025-08-31'];
  const d=[84,84,84,112], sh=[444.6e6,444.5e6,444.3e6,444.2e6], ni=[1.80e9,1.79e9,1.90e9,2.61e9];
  const S=sh.reduce((s,v,i)=>s+v*d[i],0)/364, eps=ni.map((n,i)=>cents(n/sh[i]));
  const q=en.map((e,i)=>({fiscalYear:2025,fiscalQuarter:i+1,fiscalPeriodEnd:e,netIncome:ni[i],
    dilutedEPS:i<3?eps[i]:null,dilutedShares:i<3?sh[i]:null}));
  const yrs=[{fiscalYear:2025,fiscalPeriodEnd:en[3],netIncome:ni.reduce((a,b)=>a+b),dilutedEPS:cents(ni.reduce((a,b)=>a+b)/S)}];
  const fact=(i,val)=>({start:st[i],end:en[i],val,form:'10-Q',accn:'q'+i,filed:'2025-0'+(1+i*3)+'-15'});
  const yr=val=>({start:st[0],end:en[3],val,form:'10-K',accn:'k',filed:'2025-10-08'});
  const out=deriveQ4BasicEPS(q,yrs,[yr(S),...[0,1,2].map(i=>fact(i,sh[i]))],
    [yr(yrs[0].dilutedEPS),...[0,1,2].map(i=>fact(i,eps[i]))],diluted);
  assert.equal(out.estimatedCount,1,JSON.stringify(out.skipped));
  assert.ok(Math.abs(q[3].dilutedShares/444.2e6-1)<0.001,String(q[3].dilutedShares));
});
