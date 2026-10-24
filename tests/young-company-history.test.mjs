import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

// The Trade Desk's real early net income (USD): IPO Sept 2016. Its Q3 2016
// 10-Q shows Q3 2015 as a comparative; 2017 10-Qs show Q1/Q2 2016.
const F=(start,end,val,form,filed)=>({start,end,val,form,filed,accn:'a-'+filed});
const ni=[
  F('2015-01-01','2015-12-31',15929000,'10-K','2017-02-16'),
  F('2015-01-01','2015-09-30',10279000,'10-Q','2016-11-10'),
  F('2015-07-01','2015-09-30',4605000,'10-Q','2016-11-10'),
  F('2016-01-01','2016-03-31',-1040000,'10-Q','2017-05-11'),
  F('2016-04-01','2016-06-30',7598000,'10-Q','2017-08-11'),
  F('2016-01-01','2016-06-30',6558000,'10-Q','2017-08-11'),
  F('2016-07-01','2016-09-30',3644000,'10-Q','2016-11-10'),
  F('2016-01-01','2016-09-30',10202000,'10-Q','2016-11-10'),
  F('2016-01-01','2016-12-31',20482000,'10-K','2017-02-16'),
  F('2017-01-01','2017-03-31',4909000,'10-Q','2017-05-11'),
  F('2017-04-01','2017-06-30',18849000,'10-Q','2017-08-11'),
  F('2017-01-01','2017-06-30',23758000,'10-Q','2017-08-11'),
  F('2017-07-01','2017-09-30',10229000,'10-Q','2017-11-13'),
  F('2017-01-01','2017-09-30',33987000,'10-Q','2017-11-13'),
  F('2017-01-01','2017-12-31',50798000,'10-K','2018-02-28')
];
// Revenue under the pre-2018 services tag, scaled from net income for the fixture.
const rev=ni.map(f=>({...f,val:f.val*10}));
const facts={cik:1,entityName:'The Trade Desk',facts:{'us-gaap':{
  NetIncomeLoss:{units:{USD:ni}},SalesRevenueServicesNet:{units:{USD:rev}}}}};
const sub={cik:1,filings:{recent:{form:['10-K','10-Q'],filingDate:[],reportDate:[],accessionNumber:[],items:[]}},tickers:['TTD'],exchanges:['Nasdaq']};

test('a young company keeps its pre-IPO comparative quarters (The Trade Desk Q3-Q4 2015)', async () => {
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    url=String(url);
    if(url.includes('company_tickers.json'))return Response.json({'0':{ticker:'TTD',cik_str:1,title:'TTD'}});
    if(url.includes('/companyfacts/'))return Response.json(facts);
    if(url.includes('/submissions/'))return Response.json(sub);
    throw Error('Unexpected '+url);
  };
  let d;
  try { d=await (await worker.fetch(new Request('https://example.test/?ticker=TTD'))).json(); }
  finally { globalThis.fetch=original; }
  assert.equal(d.success,true,JSON.stringify(d).slice(0,300));
  const q=Object.fromEntries(d.quarterlyFinancials.map(r=>[r.fiscalYear+'Q'+r.fiscalQuarter,r]));
  assert.deepEqual(d.quarterlyFinancials.map(r=>r.fiscalYear+'Q'+r.fiscalQuarter),
    ['2017Q4','2017Q3','2017Q2','2017Q1','2016Q4','2016Q3','2016Q2','2016Q1','2015Q4','2015Q3']);
  assert.equal(q['2015Q3'].netIncome,4605000);              // reported three-month figure
  assert.equal(q['2015Q4'].netIncome,15929000-10279000);    // annual minus nine-month YTD
  assert.equal(q['2016Q4'].netIncome,20482000-10202000);
  assert.equal(q['2017Q1'].revenue,49090000);               // SalesRevenueServicesNet
  assert.equal(q['2015Q3'].netAcquisitions,null);
});
