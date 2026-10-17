import { strict as assert } from 'node:assert';
import { secSplitEvidence, splitAudit, normalizeVerifiedPerShare } from '../src/sec-splits.js';
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
