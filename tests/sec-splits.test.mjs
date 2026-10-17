import { strict as assert } from 'node:assert';
import { secSplitEvidence, splitAudit, normalizeVerifiedPerShare, secSplitFilingCandidates } from '../src/sec-splits.js';
const record = (end,val,filed='2025-01-01') => ({end,val,filed,form:'10-K',accn:'test'});
const facts = { facts: { 'us-gaap': {
  StockholdersEquityNoteStockSplitConversionRatio1: {units:{pure:[
    record('2020-08-31',4),record('2020-08-31',4,'2026-01-01'),
    record('2024-06-10',10), record('2025-03-01',0.1),
    record('2025-04-01',1),record('2025-05-01',-4)
  ]}}
}}};
const events = secSplitEvidence(facts);
assert.equal(events.length,3);
assert.deepEqual(events.map(x=>x.sharesAfterPerBefore),[4,10,0.1]);
assert.equal(splitAudit(facts).normalizationApplied,false);
assert.equal(splitAudit({facts:{}}).status,'no-structured-split-evidence');
console.log('SEC split-audit tests passed');

const verifiedEvents = [
  {effectiveDate:'2020-08-31',sharesAfterPerBefore:4,verified:true,secAccession:'0001'},
  {effectiveDate:'2022-08-25',sharesAfterPerBefore:0.1,verified:true,secAccession:'0002'},
  {effectiveDate:'2024-06-10',sharesAfterPerBefore:10,verified:true,secAccession:'0003'}
];
const normalize = (metric,value,basisThrough,targetDate='2024-06-11') =>
  normalizeVerifiedPerShare({metric,value,basisThrough,targetDate,verifiedEvents});
assert.ok(Math.abs(normalize('dilutedEPS',8,'2019-01-01').adjusted - 2) < 1e-10);
assert.ok(Math.abs(normalize('dilutedShares',100,'2019-01-01').adjusted - 400) < 1e-10);
assert.equal(normalize('dilutedEPS',8,'2024-06-11').adjusted,8);
assert.equal(normalize('dilutedEPS',8,'2020-08-31','2020-08-31').adjusted,8);
assert.throws(()=>normalize('netIncome',100,'2019-01-01'));
assert.throws(()=>normalizeVerifiedPerShare({
  metric:'dilutedEPS',value:8,basisThrough:'2019-01-01',
  targetDate:'2024-06-11',
  verifiedEvents:[{effectiveDate:'2020-08-31',sharesAfterPerBefore:4,verified:false,secAccession:'0001'}]
}));
assert.throws(()=>normalizeVerifiedPerShare({
  metric:'dilutedEPS',value:8,basisThrough:'2019-01-01',
  targetDate:'2024-06-11',verifiedEvents:[...verifiedEvents,verifiedEvents[0]]
}));

const submissions = {filings:{recent:{
  form:['8-K','10-Q','S-1','8-K'],
  accessionNumber:['0000000001-26-000001','0000000001-26-000002','0000000001-26-000003','invalid'],
  filingDate:['2026-03-02','2026-02-01','2026-01-01','2025-12-01'],
  reportDate:['2026-03-02','2025-12-31','2025-12-31',''],
  items:['5.03','','','']
}}};
const filingCandidates = secSplitFilingCandidates(submissions,[{
  accession:'0000000001-26-000002',sharesAfterPerBefore:4,
  evidenceDate:'2025-12-31',periodStart:'2025-01-01'
}]);
assert.equal(filingCandidates.length,2);
assert.equal(filingCandidates[0].form,'8-K');
assert.equal(filingCandidates[0].verifiedSplit,false);
assert.equal(filingCandidates[1].splitRatioFacts[0].sharesAfterPerBefore,4);
assert.equal(filingCandidates[1].verifiedSplit,false);
