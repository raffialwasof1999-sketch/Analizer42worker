import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {secRestatementEvidence} from '../src/sec-splits.js';
const split={verified:true,effectiveDate:'2020-08-31',sharesAfterPerBefore:4,secAccession:'0000320193-20-000096'};
const data={facts:{'us-gaap':{
  EarningsPerShareDiluted:{units:{'USD/shares':[
    {start:'2019-01-01',end:'2019-12-31',filed:'2020-02-01',accn:'old',form:'10-K',val:8},
    {start:'2019-01-01',end:'2019-12-31',filed:'2021-02-01',accn:'new',form:'10-K',val:2},
    {start:'2018-01-01',end:'2018-12-31',filed:'2021-02-01',accn:'unpaired',form:'10-K',val:1}
  ]}}
}}};
test('SEC historical observations show restatement evidence, not automatic basis proof',()=>{
  const rows=secRestatementEvidence(data,[split]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].status,'consistent-with-restatement');
  assert.equal(rows[0].verified,false);
  assert.equal(rows[0].beforeAccession,'old');
  assert.equal(rows[0].afterAccession,'new');
  assert.equal(secRestatementEvidence(data,[{verified:false}]).length,0);
  assert.equal(secRestatementEvidence(data,[]).length,0);
});
