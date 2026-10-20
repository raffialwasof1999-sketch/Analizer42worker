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
