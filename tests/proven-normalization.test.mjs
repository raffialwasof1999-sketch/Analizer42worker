import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeProvenObservation } from '../src/sec-splits.js';
const events=[{effectiveDate:'2020-08-31',sharesAfterPerBefore:4,verified:true,secAccession:'0000320193-20-000096'}];
const observation={val:8,metric:'dilutedEPS',end:'2019-12-31',accn:'0000320193-20-000096',basisVerified:true,basisThrough:'2019-12-31',basisSecAccession:'0000320193-20-000096'};
test('requires SEC filing matched verified basis',()=>{
 assert.equal(normalizeProvenObservation(observation,'2020-09-01',events).adjusted,2);
 assert.throws(()=>normalizeProvenObservation({...observation,basisVerified:false},'2020-09-01',events));
 assert.throws(()=>normalizeProvenObservation({...observation,accn:'not-matching'},'2020-09-01',events));
 assert.throws(()=>normalizeProvenObservation({...observation,metric:'netIncome'},'2020-09-01',events));
});
