import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import worker from '../src/index.js';
import {normalizeUsingSECShareGraph} from '../src/sec-share-basis.js';

const company = {'0':{ticker:'TEST',cik_str:1234567,title:'Example Company'}};
const details = {cik:1234567,filings:{recent:{
  form:['10-K','10-Q','10-Q','10-Q'],
  filingDate:['2025-10-30','2025-07-30','2025-04-30','2025-01-30'],
  reportDate:['2025-09-27','2025-06-28','2025-03-29','2024-12-28'],
  accessionNumber:['0001234567-25-000001','0001234567-25-000002',
    '0001234567-25-000003','0001234567-25-000004'],
  items:['','','','']
}},tickers:['TEST'],exchanges:['Nasdaq']};
const f=(start,end,val,form='10-K')=>({
  start,end,val,form,accn:'0001234567-25-000001',filed:'2025-10-30'
});
const annual=(val)=>[
 f('2024-09-29','2025-09-27',val),
 f('2023-10-01','2024-09-28',val*.9)
];
const quarters=(values)=>[
 f('2024-09-29','2024-12-28',values[0],'10-Q'),
 f('2024-12-29','2025-03-29',values[1],'10-Q'),
 f('2025-03-30','2025-06-28',values[2],'10-Q')
];
const unit=(u,entries)=>({units:{[u]:entries}});
const facts={cik:1234567,entityName:'Example Company',facts:{'us-gaap':{
 RevenueFromContractWithCustomerExcludingAssessedTax:unit('USD',[
   ...annual(400e9),...quarters([100e9,105e9,110e9])
 ]),
 NetIncomeLoss:unit('USD',[
   ...annual(100e9),...quarters([25e9,26e9,27e9])
 ]),
 EarningsPerShareBasic:unit('USD/shares',[
   ...annual(7.49),...quarters([2.42,1.67,1.59])
 ]),
 EarningsPerShareDiluted:unit('USD/shares',[
   ...annual(7.46),...quarters([2.40,1.65,1.57])
 ]),
 WeightedAverageNumberOfDilutedSharesOutstanding:unit('shares',[
   ...annual(15e9),...quarters([15.2e9,15.1e9,15.0e9])
 ])
}}};
test('Worker exports reported basic EPS in appended schema without changing diluted EPS',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{
   url=String(url);
   if(url.includes('company_tickers.json'))return Response.json(company);
   if(url.includes('/companyfacts/'))return Response.json(facts);
   if(url.includes('/submissions/'))return Response.json(details);
   throw Error('Unexpected SEC fetch '+url);
 };
 try{
   const res=await worker.fetch(new Request('https://example.test/?ticker=TEST'));
   const data=await res.json();
   assert.equal(res.status,200,JSON.stringify(data));
   assert.equal(data.success,true);
   assert.equal(data.annualFinancials[0].basicEPS,7.49);
   assert.equal(data.annualFinancials[0].dilutedEPS,7.46);
   assert.equal(data.quarterlyFinancials[1].basicEPS,1.59);
   assert.equal(data.quarterlyFinancials[1].dilutedEPS,1.57);
   assert.equal(data.quarterlyFinancials[0].basicEPS,null);
   assert.equal(Object.keys(data.annualFinancials[0]).at(-1),'basicEPS');
   assert.equal(Object.keys(data.quarterlyFinancials[0]).at(-1),'basicEPS');
 }finally{globalThis.fetch=original;}
});
test('basic EPS split scaling preserves diluted EPS and cash flows',()=>{
 const row={fiscalPeriodEnd:'2019-12-31',basicEPS:8.2,dilutedEPS:8,
   dilutedShares:100,netIncome:800};
 const graph={shareFactors:{before:0.25},conflicts:[]};
 const result=normalizeUsingSECShareGraph([row],graph,(_,metric)=>
   [{accn:'before',val:row[metric]}]);
 assert.equal(result.complete,true);
 assert.equal(result.rows[0].basicEPS,2.05);
 assert.equal(result.rows[0].dilutedEPS,2);
 assert.equal(result.rows[0].dilutedShares,25);
 assert.equal(result.rows[0].netIncome,800);
 assert.equal(row.basicEPS,8.2);
});
test('basic EPS with unverified share basis remains absent, not guessed',()=>{
 const row={fiscalPeriodEnd:'2019-12-31',basicEPS:8.2,dilutedEPS:8,
   dilutedShares:100};
 const result=normalizeUsingSECShareGraph([row],
   {shareFactors:{},conflicts:[]},()=>[{accn:'unverified',val:8.2}]);
 assert.equal(result.rows[0].basicEPS,null);
 assert.equal(result.complete,false);
});
