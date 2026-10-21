import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const tickerDirectory={'0':{ticker:'DEMO',cik_str:7654321,title:'Demo Co.'}};
const companyFacts={cik:7654321,facts:{
  'us-gaap':{Assets:{label:'Assets',units:{USD:[
    {val:100,form:'10-Q',filed:'2026-04-10',end:'2026-03-31',accn:'0001'}]
  }}},
  dei:{EntityCommonStockSharesOutstanding:{label:'Shares',units:{shares:[
    {val:10,end:'2026-04-10',form:'10-Q',accn:'0001'}]
  }}}
}};
const submissions={cik:7654321,filings:{recent:{form:[],accessionNumber:[]}}};
const original=globalThis.fetch;

function mock() {
  globalThis.fetch=async url=>{
    const u=String(url);
    if(u.includes('company_tickers.json'))return Response.json(tickerDirectory);
    if(u.includes('companyfacts/'))return Response.json(companyFacts);
    if(u.includes('/submissions/'))return Response.json(submissions);
    throw Error('Unexpected URL: '+u);
  };
}
test('raw catalog and concept endpoints return original SEC values without dashboard rows',async()=>{
 mock();
 try {
   const catalog=await worker.fetch(new Request('https://test/?ticker=DEMO&secCatalog=1'));
   assert.equal(catalog.status,200);
   const a=await catalog.json();
   assert.equal(a.success,true);
   assert.equal(a.conceptsTotal,2);
   assert.equal(a.persistentArchive,false);
   assert.equal(a.annualFinancials,undefined);
   const resp=await worker.fetch(new Request(
     'https://test/?ticker=DEMO&secFact=us-gaap:Assets&limit=1'));
   const b=await resp.json();
   assert.equal(resp.status,200);
   assert.equal(b.observations[0].reported.val,100);
   assert.equal(b.observations[0].reported.accn,'0001');
   assert.equal(b.observations[0].unit,'USD');
   assert.equal(b.quarterlyFinancials,undefined);
 } finally{globalThis.fetch=original;}
});
test('raw SEC routes reject invalid pagination and absent concepts',async()=>{
 mock();
 try {
   const invalid=await worker.fetch(new Request('https://test/?ticker=DEMO&secCatalog=1&page=-1'));
   assert.equal(invalid.status,400);
   const notFound=await worker.fetch(new Request('https://test/?ticker=DEMO&secFact=us-gaap:Revenues'));
   assert.equal(notFound.status,404);
 } finally{globalThis.fetch=original;}
});

test('source-first all-facts endpoint exposes raw SEC observations with no dashboard rows',async()=>{
 mock();
 try {
   const resp=await worker.fetch(new Request('https://test/?ticker=DEMO&secRawFacts=1&limit=1&offset=1'));
   assert.equal(resp.status,200);
   const body=await resp.json();
   assert.equal(body.scope,'All SEC Company Facts observations, prior to metric matching');
   assert.equal(body.totalObservations,2);
   assert.equal(body.observations.length,1);
   assert.equal(body.observations[0].tag,'Assets');
   assert.equal(body.observations[0].reported.accn,'0001');
   assert.equal(body.annualFinancials,undefined);
   assert.equal(body.includesIssuerExtensions,false);
   assert.equal(body.persistentArchive,false);
   const bad=await worker.fetch(new Request('https://test/?ticker=DEMO&secRawFacts=1&limit=0'));
   assert.equal(bad.status,400);
   const both=await worker.fetch(new Request('https://test/?ticker=DEMO&secRawFacts=1&secCatalog=1'));
   assert.equal(both.status,400);
 } finally{globalThis.fetch=original;}
});
