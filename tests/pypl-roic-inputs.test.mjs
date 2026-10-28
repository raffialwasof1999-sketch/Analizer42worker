import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

// PayPal-shaped facts: no pre-tax income tag, current notes under its own
// label, year-end current debt only in the next year's 10-Q, and the debt
// footnote's principal due within 12 months.
const d=(start,end,val,form,filed)=>({start,end,val,form,filed,accn:form+filed});
const i=(end,val,form,filed)=>({end,val,form,filed,accn:form+filed});
const flows=(v)=>[d('2025-01-01','2025-12-31',v*4,'10-K','2026-02-03'),d('2024-01-01','2024-12-31',v*3.6,'10-K','2025-02-04'),
  d('2025-01-01','2025-03-31',v,'10-Q','2025-04-29'),d('2025-04-01','2025-06-30',v,'10-Q','2025-07-29'),d('2025-01-01','2025-06-30',v*2,'10-Q','2025-07-29'),
  d('2025-07-01','2025-09-30',v,'10-Q','2025-10-28'),d('2025-01-01','2025-09-30',v*3,'10-Q','2025-10-28'),
  d('2026-01-01','2026-03-31',v,'10-Q','2026-05-05')];
const gaap={
  Revenues:{units:{USD:flows(8e9)}},NetIncomeLoss:{units:{USD:flows(1e9)}},
  IncomeTaxExpenseBenefit:{units:{USD:flows(0.25e9)}},OperatingIncomeLoss:{units:{USD:flows(1.4e9)}},
  StockholdersEquity:{units:{USD:[i('2025-12-31',20e9,'10-K','2026-02-03'),i('2026-03-31',20e9,'10-Q','2026-05-05'),i('2025-09-30',20e9,'10-Q','2025-10-28')]}},
  CashAndCashEquivalentsAtCarryingValue:{units:{USD:[i('2025-12-31',8e9,'10-K','2026-02-03'),i('2026-03-31',7e9,'10-Q','2026-05-05'),i('2025-09-30',9e9,'10-Q','2025-10-28')]}},
  LongTermDebtNoncurrent:{units:{USD:[i('2025-12-31',9.987e9,'10-K','2026-02-03'),i('2026-03-31',9.409e9,'10-Q','2026-05-05'),i('2025-09-30',11.276e9,'10-Q','2025-10-28')]}},
  DebtCurrent:{units:{USD:[i('2025-12-31',1.596e9,'10-Q','2026-07-28')]}},
  LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths:{units:{USD:[i('2026-03-31',0.5e9,'10-Q','2026-05-05'),i('2025-09-30',1.405e9,'10-Q','2025-10-28'),i('2025-12-31',1.397e9,'10-K','2026-02-03')]}}
};
async function run(){
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    url=String(url);
    if(url.includes('company_tickers.json'))return Response.json({'0':{ticker:'PYPL',cik_str:1,title:'PayPal'}});
    if(url.includes('/companyfacts/'))return Response.json({cik:1,entityName:'PayPal',facts:{'us-gaap':gaap}});
    if(url.includes('/submissions/'))return Response.json({cik:1,filings:{recent:{form:['10-K','10-Q'],filingDate:[],reportDate:[],accessionNumber:[],items:[]}},tickers:['PYPL'],exchanges:['Nasdaq']});
    throw Error('Unexpected '+url);
  };
  try { return await (await worker.fetch(new Request('https://example.test/?ticker=PYPL'))).json(); }
  finally { globalThis.fetch=original; }
}

test('PayPal-style ROIC inputs: pre-tax from net income + tax, debt from later comparatives or the 12-month maturities', async () => {
  const r=await run();
  assert.equal(r.success,true,JSON.stringify(r).slice(0,300));
  const q=Object.fromEntries(r.quarterlyFinancials.map(x=>[x.fiscalPeriodEnd,x]));
  assert.equal(q['2026-03-31'].incomeBeforeTax,1.25e9);                // 1.0 + 0.25
  assert.equal(q['2025-12-31'].totalDebt,9.987e9+1.596e9);             // year-end current debt from the 2026 10-Q
  assert.equal(q['2026-03-31'].totalDebt,9.409e9+0.5e9);              // noncurrent + principal due in 12 months
  assert.equal(q['2025-09-30'].totalDebt,11.276e9+1.405e9);
  assert.equal(q['2026-03-31'].investedCapital,20e9+9.909e9-7e9);
  assert.equal(r.annualFinancials[0].totalDebt,9.987e9+1.596e9);
  assert.equal(r.annualFinancials[0].incomeBeforeTax,5e9);
});
