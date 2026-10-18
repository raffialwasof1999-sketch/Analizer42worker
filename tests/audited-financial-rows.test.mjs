import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {auditedSplitRows} from '../src/sec-splits.js';

const source='0000320193-20-000096';
const events=[
  {verified:true,effectiveDate:'2020-08-28',sharesAfterPerBefore:4,
    secAccession:source,basisProofAccessions:[source]},
  {verified:true,effectiveDate:'2024-06-07',sharesAfterPerBefore:2,
    secAccession:'0000320193-24-000099',basisProofAccessions:[]}
];
test('strict financial rows normalize only proven SEC filing basis',()=>{
  const rows=[
    {fiscalPeriodEnd:'2019-12-31',dilutedEPS:2,dilutedShares:100,netIncome:200},
    {fiscalPeriodEnd:'2018-12-31',dilutedEPS:8,dilutedShares:25,netIncome:200}
  ];
  const resolve=(row,metric)=>row.fiscalPeriodEnd==='2019-12-31' ?
    {accn:source,val:row[metric]} : {accn:'unknown',val:row[metric]};
  const audit=auditedSplitRows(rows,events,'2025-01-01',resolve);
  assert.equal(audit.rows[0].dilutedEPS,1);
  assert.equal(audit.rows[0].dilutedShares,200);
  assert.equal(audit.rows[1].dilutedEPS,null);
  assert.equal(audit.rows[1].dilutedShares,null);
  assert.equal(audit.rows[0].netIncome,200);
  assert.equal(rows[0].dilutedEPS,2);
  assert.equal(audit.adjustments.length,2);
  assert.equal(audit.issues.length,2);
  assert.equal(audit.complete,false);
});

test('same SEC comparative value may be tied to earlier proven filing',()=>{
  const rows=[{fiscalPeriodEnd:'2019-12-31',dilutedEPS:2,netIncome:200}];
  const resolver=(row,metric)=>[
    {accn:'0000320193-22-000077',val:row[metric]},
    {accn:source,val:row[metric]}
  ];
  const audit=auditedSplitRows(rows,events,'2025-01-01',resolver);
  assert.equal(audit.rows[0].dilutedEPS,1);
  assert.equal(audit.adjustments[0].sourceAccession,source);
  assert.equal(audit.issues.length,0);
});
