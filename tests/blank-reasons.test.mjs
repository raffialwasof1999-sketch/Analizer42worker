import test from 'node:test';
import assert from 'node:assert/strict';
import {blankReasons,blankReasonsCsv} from '../src/blank-reasons.js';

const full=(n=44)=>Array.from({length:n},(_,i)=>({fiscalPeriodEnd:`20${String(26-Math.floor(i/4)).padStart(2,'0')}-0${3-(i%3)}-30`,
  dilutedEPS:2-i*0.02,revenue:100,dilutedShares:10,operatingCashFlow:30,capitalExpenditures:5,
  operatingIncome:25,incomeTaxExpense:5,incomeBeforeTax:24,investedCapital:300,totalDebt:50,cash:20,stockholdersEquity:270}));
const metrics=r=>r.map(x=>x.metric);

test('a complete, growing company only lacks the forward PEG',()=>{
  assert.deepEqual(metrics(blankReasons(full(),{companyName:'Example'})),['PEG Ratio (Forward 3 Years)']);
});

test('banks: ROIC and free cash flow do not apply',()=>{
  const q=full().map(r=>({...r,operatingIncome:null,capitalExpenditures:null}));
  const r=blankReasons(q,{companyName:'Big Bank',bank:true,hasTag:()=>false});
  assert.match(r.find(x=>x.metric==='ROIC (TTM)').reason,/Banks don't report operating income/);
  assert.match(r.find(x=>x.metric==='Free Cash Flow (TTM)').reason,/Banks report no capital expenditures/);
});

test('share-class EPS issuers are named as such (Berkshire, Visa)',()=>{
  const q=full().map(r=>({...r,dilutedEPS:null}));
  const r=blankReasons(q,{companyName:'Berkshire Hathaway',hasEPSTags:false});
  assert.match(r.find(x=>x.metric==='P/E Ratio (TTM)').reason,/only per share class/);
});

test('negative earnings in the window explain the 5-year P/E and PEG (Exxon 2020)',()=>{
  const q=full(); q[22].dilutedEPS=-9;
  const r=blankReasons(q,{});
  assert.match(r.find(x=>x.metric==='P/E Ratio (5-Year Avg.)').reason,/zero or negative/);
  assert.match(r.find(x=>x.metric==='PEG Ratio (Past 5 Years)').reason,/zero or negative/);
  assert.equal(r.find(x=>x.metric==='P/E Ratio (TTM)'),undefined);
});

test('partial history names the count and oldest missing quarter',()=>{
  const q=full(); q[30].investedCapital=null; q[30].totalDebt=null; q[35].totalDebt=null; q[35].investedCapital=null;
  const r=blankReasons(q,{companyName:'Meta'});
  assert.match(r.find(x=>x.metric==='ROIC (10 Years)').reason,/Total debt is missing for 2 of the last 41 quarters \(oldest missing/);
  assert.equal(r.find(x=>x.metric==='ROIC (5-Year Avg.)'),undefined);
});

test('falling EPS explains PEG; CSV quotes and escapes',()=>{
  const q=full().map((r,i)=>({...r,dilutedEPS:1+i*0.02}));      // older quarters earned more
  const r=blankReasons(q,{});
  assert.match(r.find(x=>x.metric==='PEG Ratio (Past 5 Years)').reason,/did not grow/);
  const csv=blankReasonsCsv([{metric:'A',reason:'say "hi"'}],'X');
  assert.equal(csv,'"Metric","Why it is blank"\n"A","say ""hi"""\n');
});
