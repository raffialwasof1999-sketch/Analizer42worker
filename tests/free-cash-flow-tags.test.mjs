import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const accn='0001234567-25-000001';
const f=(start,end,val,form='10-K')=>({start,end,val,form,accn,filed:'2025-10-30'});
const annual=v=>[f('2024-09-29','2025-09-27',v),f('2023-10-01','2024-09-28',v*.9)];
const ytd=v=>[f('2024-09-29','2024-12-28',v[0],'10-Q'),f('2024-09-29','2025-03-29',v[1],'10-Q'),f('2024-09-29','2025-06-28',v[2],'10-Q')];
const unit=(u,list)=>({units:{[u]:list}});
const base={
  Revenues:unit('USD',[...annual(400e9),...ytd([100e9,205e9,315e9])]),
  NetIncomeLoss:unit('USD',[...annual(100e9),...ytd([25e9,51e9,78e9])]),
  NetCashProvidedByUsedInOperatingActivities:unit('USD',[...annual(120e9),...ytd([30e9,62e9,95e9])])
};
async function run(gaap){
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    url=String(url);
    if(url.includes('company_tickers.json'))return Response.json({'0':{ticker:'TEST',cik_str:1234567,title:'Example'}});
    if(url.includes('/companyfacts/'))return Response.json({cik:1234567,entityName:'Example',facts:{'us-gaap':gaap}});
    if(url.includes('/submissions/'))return Response.json({cik:1234567,filings:{recent:{form:[],filingDate:[],reportDate:[],accessionNumber:[],items:[]}},tickers:['TEST'],exchanges:['Nasdaq']});
    throw Error('Unexpected '+url);
  };
  try{return await (await worker.fetch(new Request('https://example.test/?ticker=TEST'))).json();}
  finally{globalThis.fetch=original;}
}

test('capital spending filed as PaymentsToAcquireProductiveAssets yields free cash flow',async()=>{
  const d=await run({...base,PaymentsToAcquireProductiveAssets:unit('USD',[...annual(20e9),...ytd([5e9,10e9,16e9])])});
  assert.equal(d.success,true,JSON.stringify(d).slice(0,300));
  assert.equal(d.annualFinancials[0].capitalExpenditures,20e9);
  assert.equal(d.annualFinancials[0].freeCashFlow,100e9);
  const q3=d.quarterlyFinancials.find(q=>q.fiscalPeriodEnd==='2025-06-28');
  assert.equal(q3.capitalExpenditures,6e9);                 // YTD 16 - 10
  assert.equal(q3.freeCashFlow,33e9-6e9);
});

test('the PP&E line still takes precedence when both are filed',async()=>{
  const d=await run({...base,
    PaymentsToAcquirePropertyPlantAndEquipment:unit('USD',annual(18e9)),
    PaymentsToAcquireProductiveAssets:unit('USD',annual(20e9))});
  assert.equal(d.annualFinancials[0].capitalExpenditures,18e9);
});

test('no capital spending line (banks) leaves free cash flow blank, not equal to cash flow',async()=>{
  const d=await run(base);
  assert.equal(d.annualFinancials[0].capitalExpenditures,null);
  assert.equal(d.annualFinancials[0].freeCashFlow,null);
});
