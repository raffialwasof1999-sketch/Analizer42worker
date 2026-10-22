import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

// Johnson & Johnson's 52/53-week fiscal years end on the Sunday nearest
// December 31: fiscal 2021 ended 2022-01-02 and fiscal 2022 ended 2023-01-01.
// Labelling years by the calendar year they end in gave two "2023" years and
// failed the whole refresh.
const yearEnds=[['2023-01-02','2023-12-31'],['2022-01-03','2023-01-01'],['2021-01-04','2022-01-02']];
const quarterEnds=[['2024-01-01','2024-03-31'],['2024-04-01','2024-06-30'],['2024-07-01','2024-09-29']];
const fact=(start,end,val,form,accn,filed)=>({start,end,val,form,accn,filed});
const series=(annual,quarterly)=>[
  ...yearEnds.map(([s,e],i)=>fact(s,e,annual[i],'10-K','k'+i,'2024-02-15')),
  ...quarterEnds.map(([s,e],i)=>fact(s,e,quarterly[i],'10-Q','q'+i,'2024-'+(5+i*3)+'-01'))
];
const unit=(u,list)=>({units:{[u]:list}});
const facts={cik:200406,entityName:'Example Health',facts:{'us-gaap':{
  Revenues:unit('USD',series([85e9,80e9,78e9],[21e9,22e9,22.5e9])),
  NetIncomeLoss:unit('USD',series([35e9,18e9,21e9],[5e9,4.7e9,2.7e9])),
  EarningsPerShareDiluted:unit('USD/shares',series([14.6,6.7,7.8],[2.0,1.9,1.1]))
}}};
const details={cik:200406,filings:{recent:{form:[],filingDate:[],reportDate:[],accessionNumber:[],items:[]}},
  tickers:['JNJX'],exchanges:['NYSE']};

test('fiscal years ending in the first week of January belong to the prior year',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    url=String(url);
    if(url.includes('company_tickers.json'))return Response.json({'0':{ticker:'JNJX',cik_str:200406,title:'Example Health'}});
    if(url.includes('/companyfacts/'))return Response.json(facts);
    if(url.includes('/submissions/'))return Response.json(details);
    throw Error('Unexpected SEC fetch '+url);
  };
  try{
    const res=await worker.fetch(new Request('https://example.test/?ticker=JNJX'));
    const data=await res.json();
    assert.equal(data.success,true,JSON.stringify(data).slice(0,300));
    assert.deepEqual(data.annualFinancials.map(a=>[a.fiscalYear,a.fiscalPeriodEnd]),
      [[2023,'2023-12-31'],[2022,'2023-01-01'],[2021,'2022-01-02']]);
    assert.equal(data.quarterlyFinancials[0].fiscalYear,2024);
  }finally{globalThis.fetch=original;}
});
