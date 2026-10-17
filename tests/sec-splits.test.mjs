import { strict as assert } from 'node:assert';
import { secSplitEvidence, splitAudit } from '../src/sec-splits.js';
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
