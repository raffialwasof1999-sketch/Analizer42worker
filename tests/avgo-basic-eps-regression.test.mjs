import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {findMatchingAnnualBasicEPSBasis,normalizeHistoricalBasicEPS}
  from '../src/basic-eps-share-basis.js';
import {deriveQ4BasicEPS} from '../src/q4-basic-eps.js';

const old='0001730168-22-000120', newest='0001730168-24-000139';
const annual={fiscalYear:2022,fiscalPeriodEnd:'2022-10-30',netIncome:11495e6,basicEPS:2.65};
const quarter={fiscalYear:2022,fiscalQuarter:2,fiscalPeriodEnd:'2022-05-01',
  basicEPS:6.16,netIncome:2590e6,basicShares:408e6};
const epsFacts=[
  {accn:old,start:'2021-11-01',end:'2022-10-30',
    form:'10-K',val:26.45},
  {accn:newest,start:'2021-11-01',end:'2022-10-30',
    form:'10-K',val:2.645}
];
const sharesFacts=[
  {accn:old,start:'2021-11-01',end:'2022-10-30',form:'10-K',val:421e6},
  {accn:newest,start:'2021-11-01',end:'2022-10-30',form:'10-K',val:4.21e9}
];
const graph={shareFactors:{[old]:10,[newest]:1},
  changedBasisEdges:[{from:old,to:newest,shareFactor:10}],conflicts:[]};

test('AVGO-like 2022 quarter bridges via original 10-K rather than restated comparative',()=>{
  const proof=findMatchingAnnualBasicEPSBasis(quarter,annual,epsFacts,sharesFacts,graph);
  assert.equal(proof?.annualAccession,old);
  assert.equal(proof?.annualShares,421e6);
  const out=normalizeHistoricalBasicEPS([quarter],graph,
    ()=>[{accn:'unconnected-2022-quarter',val:6.16}],[],
    ()=>proof);
  assert.ok(Math.abs(out.rows[0].basicEPS-.616)<1e-10);
  assert.equal(out.unavailableCount,0);
  assert.equal(quarter.basicEPS,6.16);
});

test('never infer basis by mixing EPS and shares from different SEC accessions',()=>{
  assert.equal(findMatchingAnnualBasicEPSBasis(quarter,annual,
    [epsFacts[0]],[sharesFacts[1]],graph),null);
  assert.equal(findMatchingAnnualBasicEPSBasis(quarter,annual,
    [epsFacts[0]],[sharesFacts[0]],{shareFactors:{}}),null);
  assert.equal(findMatchingAnnualBasicEPSBasis(
    {...quarter,basicShares:4.08e9},annual,epsFacts,sharesFacts,graph)
    ?.annualAccession??null,null);
});

test('refuse quarterly bridge when EPS is not reconciled to common-share basis',()=>{
  assert.equal(findMatchingAnnualBasicEPSBasis(
    {...quarter,basicEPS:1.23},annual,epsFacts,sharesFacts,graph),null);
});

function annualQ4Case(){
  const years=[{fiscalYear:2022,fiscalPeriodEnd:'2022-10-30',
    netIncome:1600,basicEPS:1.60}]; // latest split-restated annual comparative
  const quarters=[
    {fiscalYear:2022,fiscalQuarter:1,fiscalPeriodEnd:'2022-01-30',
      netIncome:400,basicEPS:4,basicShares:100},
    {fiscalYear:2022,fiscalQuarter:2,fiscalPeriodEnd:'2022-05-01',
      netIncome:400,basicEPS:4,basicShares:100},
    {fiscalYear:2022,fiscalQuarter:3,fiscalPeriodEnd:'2022-07-31',
      netIncome:400,basicEPS:4,basicShares:100},
    {fiscalYear:2022,fiscalQuarter:4,fiscalPeriodEnd:'2022-10-30',
      netIncome:400,basicEPS:null}
  ];
  const shares=[
    {accn:old,start:'2021-11-01',end:'2022-10-30',
      form:'10-K',filed:'2022-12-10',val:100},
    {accn:newest,start:'2021-11-01',end:'2022-10-30',
      form:'10-K',filed:'2024-12-10',val:1000}
  ];
  const annualEPS=[
    {...shares[0],val:16}, {...shares[1],val:1.6}
  ];
  return {years,quarters,shares,annualEPS};
}
test('Q4 estimate uses matching SEC annual basis, not latest split-restated annual EPS',()=>{
  const x=annualQ4Case();
  const out=deriveQ4BasicEPS(x.quarters,x.years,x.shares,x.annualEPS);
  assert.equal(out.estimatedCount,1);
  assert.equal(x.quarters[3].basicEPS,4);
  assert.equal(out.findings[0].sourceAnnualAccession,old);
  assert.equal(out.findings[0].sourceAnnualReportedBasicEPS,16);
  assert.equal(out.findings[0].explicitlyReported,false);
});
test('Q4 estimate refuses split-straddling quarters with incompatible denominators',()=>{
  const x=annualQ4Case();
  x.quarters[1].basicShares=1000;
  x.quarters[1].basicEPS=.4;
  assert.equal(deriveQ4BasicEPS(x.quarters,x.years,x.shares,x.annualEPS).estimatedCount,0);
  assert.equal(x.quarters[3].basicEPS,null);
});
test('Q4 estimate refuses annual basic EPS and basic shares from separate filings',()=>{
  const x=annualQ4Case();
  const onlyUnmatched=[{...x.annualEPS[0],accn:'other'}];
  assert.equal(deriveQ4BasicEPS(x.quarters,x.years,x.shares,onlyUnmatched).estimatedCount,0);
});

test('latest interim FY can inherit matching verified prior annual share basis',()=>{
  const latest={fiscalYear:2026,fiscalQuarter:1,fiscalPeriodEnd:'2026-02-01',
    basicEPS:2.75,netIncome:13.1e9,basicShares:4.76e9};
  const prior={fiscalYear:2025,fiscalPeriodEnd:'2025-11-02',
    netIncome:23.126e9,basicEPS:4.91};
  const annualEPS=[{accn:newest,start:'2024-11-04',end:'2025-11-02',
    form:'10-K',val:4.91}];
  const annualShares=[{accn:newest,start:'2024-11-04',end:'2025-11-02',
    form:'10-K',val:4.71e9}];
  const proof=findMatchingAnnualBasicEPSBasis(latest,prior,annualEPS,
    annualShares,{shareFactors:{[newest]:1}});
  assert.equal(proof?.annualAccession,newest);
  const out=normalizeHistoricalBasicEPS([latest],graph,
    ()=>[{accn:'unconnected-2026-quarter',val:2.75}],[],()=>proof);
  assert.equal(out.rows[0].basicEPS,2.75);
});

test('AVGO 2023 Q4 uses same-basis original Q3 rather than split-restated Q3',()=>{
  const years=[{fiscalYear:2023,fiscalPeriodEnd:'2023-10-29',
    netIncome:14082e6,basicEPS:3.39}]; // last-filing restated annual EPS
  const q=[
    {fiscalYear:2023,fiscalQuarter:1,fiscalPeriodEnd:'2023-01-29',
      netIncome:3774e6,basicEPS:9.03,basicShares:418e6},
    {fiscalYear:2023,fiscalQuarter:2,fiscalPeriodEnd:'2023-04-30',
      netIncome:3481e6,basicEPS:8.39,basicShares:415e6},
    {fiscalYear:2023,fiscalQuarter:3,fiscalPeriodEnd:'2023-07-30',
      netIncome:3303e6,basicEPS:.80,basicShares:4.13e9},
    {fiscalYear:2023,fiscalQuarter:4,fiscalPeriodEnd:'2023-10-29',
      netIncome:3524e6,basicEPS:null}
  ];
  const f2023='0001730168-23-000096', f2024='0001730168-24-000139';
  const shares=[
    {start:'2022-10-31',end:'2023-10-29',
      val:415e6,form:'10-K',accn:f2023,filed:'2023-12-14'},
    {start:'2022-10-31',end:'2023-10-29',
      val:4.149e9,form:'10-K',accn:f2024,filed:'2024-12-20'}
  ];
  const eps=[
    {...shares[0],val:33.93},{...shares[1],val:3.39}
  ];
  for(const [idx,accn,posted,reported,n] of [
    [0,'0001730168-23-000008','2023-03-08',9.03,418e6],
    [1,'0001730168-23-000064','2023-06-07',8.39,415e6],
    [2,'0001730168-23-000077','2023-09-06',8,413e6]]){
    const current=q[idx];
    const start=['2022-10-31','2023-01-30','2023-05-01'][idx];
    const common={start,end:current.fiscalPeriodEnd,form:'10-Q',
      filed:posted,accn};
    shares.push({...common,val:n});
    eps.push({...common,val:reported});
  }
  const result=deriveQ4BasicEPS(q,years,shares,eps);
  assert.equal(result.estimatedCount,1);
  assert.equal(result.findings[0].sourceAnnualAccession,f2023);
  assert.equal(result.findings[0].estimationMethod,'SEC-basic-EPS-weighted-shares-common-earnings');
  assert.ok(q[3].basicEPS>=8.40 && q[3].basicEPS<=8.60,q[3].basicEPS);
  assert.equal(q[2].basicEPS,.8); // Do not edit source reported/restated quarter.
});

test('AVGO 2021 preferred dividends use basic common earnings rather than gross net income',()=>{
  const years=[{fiscalYear:2021,fiscalPeriodEnd:'2021-10-31',
    netIncome:6736e6,basicEPS:15.70}];
  const original='0001730168-21-000153';
  const q=[
    {fiscalYear:2021,fiscalQuarter:1,fiscalPeriodEnd:'2021-01-31',
      netIncome:1378e6,basicEPS:3.20,basicShares:407e6},
    {fiscalYear:2021,fiscalQuarter:2,fiscalPeriodEnd:'2021-05-02',
      netIncome:1493e6,basicEPS:3.46,basicShares:409e6},
    {fiscalYear:2021,fiscalQuarter:3,fiscalPeriodEnd:'2021-08-01',
      netIncome:1876e6,basicEPS:4.38,basicShares:411e6},
    {fiscalYear:2021,fiscalQuarter:4,fiscalPeriodEnd:'2021-10-31',
      netIncome:1989e6,basicEPS:null}
  ];
  const annual={start:'2020-11-02',end:'2021-10-31',
    form:'10-K',filed:'2021-12-17',accn:original};
  const shares=[{...annual,val:410e6}];
  const eps=[{...annual,val:15.70}];
  for(const [i,accn,start,reported,weighted] of [
    [0,'0001730168-21-000045','2020-11-02',3.20,407e6],
    [1,'0001730168-21-000116','2021-02-01',3.46,409e6],
    [2,'0001730168-21-000123','2021-05-03',4.38,411e6]]){
    const row={start,end:q[i].fiscalPeriodEnd,form:'10-Q',
      accn,filed:'2021-09-09'};
    shares.push({...row,val:weighted});
    eps.push({...row,val:reported});
  }
  const result=deriveQ4BasicEPS(q,years,shares,eps);
  assert.equal(result.estimatedCount,1);
  assert.ok(q[3].basicEPS>4.5&&q[3].basicEPS<4.8,q[3].basicEPS);
  assert.equal(result.findings[0].estimationMethod,'SEC-basic-EPS-weighted-shares-common-earnings');
});

test('AVGO FY2020 preferred dividends do not erase as-filed basic EPS',()=>{
  const f2020='0001730168-20-000226';
  const year={fiscalYear:2020,fiscalPeriodEnd:'2020-11-01',
    netIncome:2960e6,basicEPS:6.62};
  const q=[
    {fiscalYear:2020,fiscalQuarter:1,fiscalPeriodEnd:'2020-02-02',
      netIncome:385e6,basicEPS:.78,basicShares:398e6},
    {fiscalYear:2020,fiscalQuarter:2,fiscalPeriodEnd:'2020-05-03',
      netIncome:563e6,basicEPS:1.22,basicShares:401e6},
    {fiscalYear:2020,fiscalQuarter:3,fiscalPeriodEnd:'2020-08-02',
      netIncome:688e6,basicEPS:1.52,basicShares:403e6},
    {fiscalYear:2020,fiscalQuarter:4,fiscalPeriodEnd:'2020-11-01',
      netIncome:1324e6,basicEPS:null}
  ];
  const a={accn:f2020,form:'10-K',filed:'2020-12-18',
    start:'2019-11-04',end:'2020-11-01'};
  const shares=[{...a,val:402e6}],eps=[{...a,val:6.62}];
  for(const [i,accn,start,weighted,reported] of [
    [0,'0001730168-20-000045','2019-11-04',398e6,.78],
    [1,'0001730168-20-000109','2020-02-03',401e6,1.22],
    [2,'0001730168-20-000164','2020-05-04',403e6,1.52]]){
    const row={accn,start,end:q[i].fiscalPeriodEnd,form:'10-Q',filed:'2020-09-11'};
    shares.push({...row,val:weighted});
    eps.push({...row,val:reported});
  }
  const proof=findMatchingAnnualBasicEPSBasis(q[0],year,eps,shares,
    {shareFactors:{[f2020]:10}});
  assert.equal(proof?.annualAccession,f2020);
  const estimate=deriveQ4BasicEPS(q,[year],shares,eps);
  assert.equal(estimate.estimatedCount,1);
  assert.equal(estimate.findings[0].estimationMethod,'SEC-basic-EPS-weighted-shares-common-earnings');
  assert.ok(q[3].basicEPS>2.9&&q[3].basicEPS<3.3,q[3].basicEPS);
});
