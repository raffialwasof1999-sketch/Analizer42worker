import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {extractSplitMentions,summarizeSplitMentions} from '../src/sec-corporate-actions.js';

const sec1='On August 28, 2020, the Company effected a four-for-one stock split to shareholders of record as of August 24, 2020. All share and per share information has been retroactively adjusted to reflect the split.';
const sec2='On August 28, 2020, the Company effected a 4-for-1 stock split. All share and per share information has been retrospectively adjusted.';
const nvda='On May 22, 2024 NVIDIA announced a ten-for-one forward stock split. The amendment became effective on June 7, 2024. Trading is expected to commence on a split-adjusted basis on June 10, 2024.';
test('read SEC stock split words, dates and restatement notes',()=>{
  const a=extractSplitMentions('<div>'+sec1+'</div>',{accession:'0000320193-20-000096',filed:'2020-10-30'});
  assert.equal(a.length,1);
  assert.equal(a[0].ratio,4);
  assert.equal(a[0].executedLanguage,true);
  assert.equal(a[0].retrospectiveEPSLanguage,true);
  assert.ok(a[0].dates.includes('2020-08-28'));
  const b=extractSplitMentions(sec2,{accession:'0000320193-20-000097',filed:'2020-11-06'});
  const grouped=summarizeSplitMentions([...a,...b]);
  assert.equal(grouped.find(x=>x.candidateDate==='2020-08-28').independentFilings,2);
  assert.equal(grouped.find(x=>x.candidateDate==='2020-08-28').confirmed,false);
});
test('not confuse NVDA amendment date or anticipated trading date with verified date',()=>{
  const a=extractSplitMentions(nvda,{accession:'0001045810-24-000144',filed:'2024-06-07'});
  assert.equal(a.length,1);
  assert.equal(a[0].ratio,10);
  assert.ok(a[0].dates.includes('2024-06-07'));
  assert.ok(a[0].dates.includes('2024-06-10'));
  assert.equal(a[0].verified,false);
});
test('proposed splits stay unverified and malformed SEC input is rejected',()=>{
  const proposed=extractSplitMentions('The board proposed a 1-for-20 reverse stock split effective on March 20, 2026.',
    {accession:'0000320193-26-000101'});
  assert.equal(proposed[0].ratio,0.05);
  assert.equal(proposed[0].proposedOrConditional,true);
  assert.equal(proposed[0].executedLanguage,false);
  assert.equal(summarizeSplitMentions(proposed)[0].confirmed,false);
  assert.throws(()=>extractSplitMentions('foo',{accession:'invalid'}));
});
