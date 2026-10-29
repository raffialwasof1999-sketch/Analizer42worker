import test from 'node:test';
import assert from 'node:assert/strict';
import {blankReasons,blankReasonsCsv} from '../src/blank-reasons.js';

const full=(n=48)=>Array.from({length:n},(_,i)=>({fiscalYear:2026-Math.floor(i/4),fiscalQuarter:4-(i%4),
  fiscalPeriodEnd:`${2026-Math.floor(i/4)}-${String(12-3*(i%4)).padStart(2,'0')}-30`,netIncome:20,freeCashFlow:25,fcfPerShare:2.5,netAcquisitions:1,acquisitionsBasis:0,
  dilutedEPS:2-i*0.02,revenue:100,dilutedShares:10,operatingCashFlow:30,capitalExpenditures:5,dividendsPaid:10,dividendsPerShare:1,
  operatingIncome:25,incomeTaxExpense:5,incomeBeforeTax:24,investedCapital:300,totalDebt:50,cash:20,stockholdersEquity:270}));
const metrics=r=>r.map(x=>x.metric);

const PLACEHOLDERS=['Forward Dividend Yield'];
test('a complete, growing company only lacks the forward PEG and placeholder cells',()=>{
  assert.deepEqual(metrics(blankReasons(full(),{companyName:'Example'})),['PEG Ratio (Forward 3 Years)',...PLACEHOLDERS]);
});

test('10-year history gaps and skipped quarters are explained (Exxon 2015-2016 revenue)',()=>{
  const q=full(); for(let i=36;i<44;i++)q[i].revenue=null;
  const r=blankReasons(q,{companyName:'Exxon'});
  assert.match(r.find(x=>x.metric==='Profit Margin (10 Years)').reason,/Revenue is missing for 4 of the last 40 quarters/);
  assert.match(r.find(x=>x.metric==='Rev. Growth % (10 Years)').reason,/8 of the last 44/);
  assert.equal(r.find(x=>x.metric==='Profit Margin (5 Years)'),undefined);
  const skip=full(); skip.splice(10,1);
  assert.match(blankReasons(skip,{}).find(x=>x.metric==='Profit Margin (5 Years)').reason,/skips a quarter/);
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
  assert.match(r.find(x=>x.metric==='P/E Ratio (TTM)').reason,/per share class/);
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

test('debt reasons say what was filed for the missing date (Palantir vs Adobe)',()=>{
  const q=full(); q[0].totalDebt=null; q[0].investedCapital=null;
  const none=blankReasons(q,{companyName:'Palantir',debtFactsAt:()=>0});
  assert.match(none.find(x=>x.metric==='Enterprise Value').reason,/filed no standard SEC debt figures for .*may have had no debt/);
  const some=blankReasons(q,{companyName:'Adobe',debtFactsAt:()=>2});
  assert.match(some.find(x=>x.metric==='Enterprise Value').reason,/can't be added up/);
});

test('PEG wording is about growth, not average P/E',()=>{
  const q=full(); q[22].dilutedEPS=-9;
  assert.match(blankReasons(q,{}).find(x=>x.metric==='PEG Ratio (Past 5 Years)').reason,/growth rate \(and PEG\)/);
});

test('5-year Price / FCF: computed when inputs exist, explained when not', () => {
  assert.equal(blankReasons(full(),{}).find(x=>x.metric==='Price / FCF (5-Year Avg.)'),undefined);
  const unsplit=full(); unsplit[30].fcfPerShare=null; unsplit[3].fcfPerShare=null;
  assert.match(blankReasons(unsplit,{}).find(x=>x.metric==='Price / FCF (5-Year Avg.)').reason,
    /share counts for 1 of the last 24 quarters could not be put on today's split basis/);
  const burn=full(); for(let i=0;i<9;i++) burn[i].fcfPerShare=-3;
  assert.match(blankReasons(burn,{}).find(x=>x.metric==='Price / FCF (5-Year Avg.)').reason,
    /zero or negative at \d+ of the last 20 quarter-ends/);
  const brief=full(); for(let i=0;i<2;i++) brief[i].fcfPerShare=-1;   // a short dip: still averaged
  assert.equal(blankReasons(brief,{}).find(x=>x.metric==='Price / FCF (5-Year Avg.)'),undefined);
  const noCapex=full().map(r=>({...r,capitalExpenditures:null}));
  assert.match(blankReasons(noCapex,{companyName:'X'}).find(x=>x.metric==='Price / FCF (5-Year Avg.)').reason,/Capital expenditures/i);
});

test('Net Acquisitions: unknown quarters blank it; quarters counted as $0 are reported',()=>{
  const reason=q=>blankReasons(q,{companyName:'Example'}).find(r=>r.metric==='Net Acquisitions (5-Year Total)')?.reason;
  const none=full(); for(const i of [7,12]){none[i].netAcquisitions=null;none[i].acquisitionsBasis=2;}
  assert.match(reason(none),/no cash-flow statement for 2 of the last 20 quarters \(oldest 2023-12-30\)/);
  const assumed=full(); for(let i=0;i<12;i++)assumed[i].acquisitionsBasis=1;
  assert.match(reason(assumed),/^Shown, not blank: 12 of the last 20 quarters/);
  assert.equal(reason(full()),undefined);
  assert.match(reason(full(15)),/covers only 15 of the 20/);
  const custom=full(); for(const r of custom){r.netAcquisitions=null;r.acquisitionsBasis=3;}
  assert.match(reason(custom),/no standard SEC figure for acquisitions; it likely uses a company-specific label/);
  const deal=full(); deal[3].netAcquisitions=null; deal[3].acquisitionsBasis=4;
  assert.match(reason(deal),/footnotes report cash paid for acquisitions in 1 of the last 20 quarters/);
});

