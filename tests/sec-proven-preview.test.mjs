import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {extractSplitMentions,verifiedCompletedSplits} from '../src/sec-corporate-actions.js';
import {previewProvenPerShare} from '../src/sec-splits.js';

const accn='0000320193-20-000096';
test('proof requires completed split with explicit SEC action date',()=>{
  const text='On August 28, 2020, the Company effected a four-for-one stock split to shareholders of record as of August 24, 2020. All share and per share information has been retroactively adjusted to reflect the stock split.';
  const mentions=extractSplitMentions(text,{accession:accn,filed:'2020-10-30'}).map(m=>({...m,form:'10-K'}));
  const [event]=verifiedCompletedSplits(mentions);
  assert.equal(event.verified,true);
  assert.equal(event.effectiveDate,'2020-08-28');
  assert.equal(event.sharesAfterPerBefore,4);
  assert.deepEqual(event.basisProofAccessions,[accn]);
  const projected=extractSplitMentions('On May 22, 2024, the Company announced a ten-for-one forward stock split. Trading is expected to commence on June 10, 2024.',
    {accession:'0001045810-24-000144',filed:'2024-06-07'}).map(m=>({...m,form:'8-K'}));
  assert.equal(verifiedCompletedSplits(projected).length,0);
});
test('SEC per-share normalization preview never double-adjusts restated figures',()=>{
  const events=[
    {effectiveDate:'2020-08-28',sharesAfterPerBefore:4,verified:true,
      secAccession:accn,basisProofAccessions:[accn]},
    {effectiveDate:'2024-06-07',sharesAfterPerBefore:2,verified:true,
      secAccession:'0000320193-24-000099',basisProofAccessions:['0000320193-24-000099']}
  ];
  const fact=(accn,val,form='10-K')=>({accn,val,form,start:'2019-01-01',end:'2019-12-31',filed:'2020-10-30'});
  const facts={facts:{'us-gaap':{
    EarningsPerShareDiluted:{units:{'USD/shares':[
      fact(accn,2),fact('0000320193-24-000099',1),fact('0000320193-22-000077',2)
    ]}},
    WeightedAverageNumberOfDilutedSharesOutstanding:{units:{shares:[fact(accn,100)]}}
  }}};
  const result=previewProvenPerShare(facts,events,'2025-01-01');
  assert.equal(result.length,3);
  assert.equal(result.find(r=>r.sourceAccession===accn&&r.metric==='dilutedEPS').normalized,1);
  assert.equal(result.find(r=>r.sourceAccession==='0000320193-24-000099').normalized,1);
  assert.equal(result.find(r=>r.metric==='dilutedShares').normalized,200);
  assert.ok(result.every(r=>r.sourceAccession!=='0000320193-22-000077'));
});
