import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { routeRequest, resetFeedReuse } from '../src/index.js';
import { isForeignAnnualFiler, foreignReportingBasis, reportBasis } from '../src/foreign-annual.js';

// One fact as Company Facts lists it.
const f=(fy,val,accn,filed,form='20-F')=>({start:`${fy}-01-01`,end:`${fy}-12-31`,val,form,accn,filed,fy:Number(accn.slice(-4)),fp:'FY'});
// A 20-F filed in year y+1 covering years y, y-1, y-2 with the given values.
const report=(y,vals,form='20-F')=>vals.map((v,i)=>f(y-i,v,`0000000000-${y+1}-${y}`,`${y+1}-03-01`,form));
const unit=(u,list)=>({units:{[u]:list}});
const subOf=forms=>({cik:1,filings:{recent:{form:forms,filingDate:[],reportDate:[],accessionNumber:[],items:[]}},tickers:['NVO'],exchanges:['NYSE']});

test('foreign annual filers: 20-F or 40-F and no 10-K/10-Q', () => {
  assert.equal(isForeignAnnualFiler(subOf(['6-K','20-F','6-K'])),true);
  assert.equal(isForeignAnnualFiler(subOf(['40-F'])),true);
  assert.equal(isForeignAnnualFiler(subOf(['10-Q','20-F'])),false);   // switched to US forms (Shopify)
  assert.equal(isForeignAnnualFiler(subOf(['10-K','8-K'])),false);
});

test('reporting currency: the unit with comparatives wins over a convenience translation (TSMC)', () => {
  const facts={facts:{'ifrs-full':{ProfitLossAttributableToOwnersOfParent:{units:{
    TWD:[...report(2024,[1158e9,838e9,1016e9]),...report(2023,[838e9,1016e9,596e9])],
    USD:[f(2024,35.3e9,'0000000000-2025-2024','2025-03-01'),f(2023,27.3e9,'0000000000-2024-2023','2024-03-01')]}}}}};
  assert.deepEqual(foreignReportingBasis(facts),{standard:'IFRS',taxonomy:'ifrs-full',currency:'TWD'});
  // us-gaap foreign filer in euros (ASML)
  const asml={facts:{'us-gaap':{NetIncomeLoss:unit('EUR',report(2025,[9.6e9,7.6e9,7.8e9]))}}};
  assert.deepEqual(foreignReportingBasis(asml),{standard:'US GAAP',taxonomy:'us-gaap',currency:'EUR'});
  assert.equal(foreignReportingBasis({facts:{}}),null);
});

test('report basis: a 2-for-1 split restated in the newer report scales the older report (Novo Nordisk 2023)', () => {
  // The 2023 report restates 2022 and 2021 EPS at half; the 2022 report has
  // the old basis and is the only source for 2020.
  const eps=[...report(2023,[18.62,12.22,10.37]).map(x=>({...x,tag:'D'})),
    ...report(2022,[24.44,20.74,18.67]).map(x=>({...x,tag:'D'}))];
  const b=reportBasis(eps,[]);
  assert.equal(b.get('0000000000-2024-2023'),1);
  assert.equal(b.get('0000000000-2023-2022'),0.5);
  // Shares prove it too (the inverse ratio), and a mild restatement snaps to 1.
  const shares=[...report(2023,[4.5e9,4.56e9,4.6e9]).map(x=>({...x,tag:'S'})),
    ...report(2022,[2.28e9,2.3e9,2.33e9]).map(x=>({...x,tag:'S'}))];
  assert.equal(reportBasis([],shares).get('0000000000-2023-2022'),0.5);
  const restated=[...report(2023,[10,9.8]).map(x=>({...x,tag:'D'})),...report(2022,[9.6,9.0]).map(x=>({...x,tag:'D'}))];
  assert.equal(reportBasis(restated,[]).get('0000000000-2023-2022'),1);
  // A big non-split restatement proves nothing: null, not a guess.
  const odd=[...report(2023,[10,7.0]).map(x=>({...x,tag:'D'})),...report(2022,[9.6,9.0]).map(x=>({...x,tag:'D'}))];
  assert.equal(reportBasis(odd,[]).get('0000000000-2023-2022'),null);
});

// An IFRS company (DKK) with a 2-for-1 split between its 2022 and 2023 reports.
const ifrs={
  Revenue:unit('DKK',[...report(2023,[232e9,177e9,140e9]),...report(2022,[177e9,140e9,126e9])]),
  ProfitLossAttributableToOwnersOfParent:unit('DKK',[...report(2023,[84e9,55.5e9,47.8e9]),...report(2022,[55.5e9,47.8e9,42.1e9])]),
  CashFlowsFromUsedInOperatingActivities:unit('DKK',report(2023,[96e9,78.9e9,55e9])),
  PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities:unit('DKK',report(2023,[22e9,12e9,7e9])),
  DilutedEarningsLossPerShare:unit('DKK/shares',[...report(2023,[18.62,12.22,10.37]),...report(2022,[24.44,20.74,18.67])]),
  AdjustedWeightedAverageShares:unit('shares',[...report(2023,[4.5e9,4.54e9,4.61e9]),...report(2022,[2.27e9,2.3e9,2.25e9])]),
  DividendsRecognisedAsDistributionsToOwnersPerShare:unit('DKK/shares',[...report(2023,[6.4,5.0]),...report(2022,[10.0,8.4,7.6])])
};
async function run(facts,forms=['6-K','20-F'],path='/?ticker=NVO'){
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    url=String(url);
    if(url.includes('company_tickers.json'))return Response.json({'0':{ticker:'NVO',cik_str:1,title:'Novo'}});
    if(url.includes('/companyfacts/'))return Response.json({cik:1,entityName:'Novo Nordisk A/S',facts});
    if(url.includes('/submissions/'))return Response.json(subOf(forms));
    throw Error('Unexpected '+url);
  };
  try{ resetFeedReuse(); return await routeRequest(new Request('https://example.test'+path)); }
  finally{globalThis.fetch=original;}
}

test('an IFRS 20-F filer imports annual rows in its currency, per-share figures on today\'s basis', async () => {
  const d=await (await run({'ifrs-full':ifrs})).json();
  assert.equal(d.success,true,JSON.stringify(d).slice(0,300));
  assert.equal(d.dataBasis,'annual');
  assert.equal(d.reportingCurrency,'DKK');
  assert.equal(d.reportingStandard,'IFRS');
  assert.deepEqual(d.quarterlyFinancials,[]);
  assert.deepEqual(d.annualFinancials.map(r=>r.fiscalYear),[2023,2022,2021,2020]);
  const [y23,,,y20]=d.annualFinancials;
  assert.equal(y23.revenue,232e9); assert.equal(y23.netIncome,84e9);
  assert.equal(y23.freeCashFlow,74e9);
  assert.equal(y23.dilutedEPS,18.62);
  // 2020 appears only in the old report: EPS halved, shares doubled, DPS halved.
  assert.equal(y20.dilutedEPS,18.67*0.5);
  assert.equal(y20.dilutedShares,2.25e9*2);
  assert.equal(y20.dividendsPerShare,3.8);
  assert.equal(y20.revenue,126e9);
  // Every written field is a finite number or null (the script's rule).
  for (const r of d.annualFinancials) for (const [k,v] of Object.entries(r))
    if (k!=='fiscalPeriodEnd') assert.ok(v===null||Number.isFinite(v),k);
  assert.match(d.blankReasons[0].reason,/annual 20-F reports .* in DKK under IFRS/);
});

test('feeds for an annual-only company: empty quarterly extras, annual basic EPS, the reason note', async () => {
  const facts={'ifrs-full':{...ifrs,BasicEarningsLossPerShare:unit('DKK/shares',report(2023,[18.67,12.26,10.4]))}};
  assert.equal(await (await run(facts,undefined,'/?ticker=NVO&quarterlyExtrasCsv=1')).text(),'\n');
  assert.equal(await (await run(facts,undefined,'/?ticker=NVO&basicEpsCsv=annual')).text(),'18.67\n12.26\n10.4\nNA\n');
  assert.match(await (await run(facts,undefined,'/?ticker=NVO&blankReasons=1')).text(),/Quarterly figures/);
});

test('a us-gaap 20-F filer in euros (ASML) uses the US tag list', async () => {
  const gaap={
    RevenueFromContractWithCustomerExcludingAssessedTax:unit('EUR',report(2025,[32.7e9,28.3e9,27.6e9])),
    NetIncomeLoss:unit('EUR',report(2025,[9.6e9,7.6e9,7.8e9])),
    EarningsPerShareDiluted:unit('EUR/shares',report(2025,[24.71,19.24,19.91]))
  };
  const d=await (await run({'us-gaap':gaap})).json();
  assert.equal(d.reportingCurrency,'EUR');
  assert.equal(d.reportingStandard,'US GAAP');
  assert.equal(d.annualFinancials[0].revenue,32.7e9);
  assert.equal(d.annualFinancials[0].dilutedEPS,24.71);
});

test('US companies are unchanged and now say they are quarterly, in USD', async () => {
  const fu=(start,end,val,form='10-K')=>({start,end,val,form,accn:'0001234567-25-000001',filed:'2025-10-30'});
  const annual=v=>[fu('2024-09-29','2025-09-27',v),fu('2023-10-01','2024-09-28',v*.9)];
  const ytd=v=>[fu('2024-09-29','2024-12-28',v[0],'10-Q'),fu('2024-09-29','2025-03-29',v[1],'10-Q'),fu('2024-09-29','2025-06-28',v[2],'10-Q')];
  const gaap={Revenues:unit('USD',[...annual(400e9),...ytd([100e9,205e9,315e9])]),
    NetIncomeLoss:unit('USD',[...annual(100e9),...ytd([25e9,51e9,78e9])])};
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    url=String(url);
    if(url.includes('company_tickers.json'))return Response.json({'0':{ticker:'TEST',cik_str:1,title:'X'}});
    if(url.includes('/companyfacts/'))return Response.json({cik:1,entityName:'X',facts:{'us-gaap':gaap}});
    if(url.includes('/submissions/'))return Response.json({...subOf(['10-K','10-Q']),tickers:['TEST']});
    throw Error('Unexpected '+url);
  };
  try{
    const d=await (await worker.fetch(new Request('https://example.test/?ticker=TEST'))).json();
    assert.equal(d.success,true,JSON.stringify(d).slice(0,300));
    assert.equal(d.dataBasis,'quarterly'); assert.equal(d.reportingCurrency,'USD');
    assert.ok(d.quarterlyFinancials.length>0);
  } finally { globalThis.fetch=original; }
});

test('full-year figures filed in a 6-K annual report count (Novo Nordisk 2015-2018)', async () => {
  const six=(y,v)=>f(y,v,`0000000000-${y+1}-6k${y}`,`${y+1}-02-01`,'6-K');
  const facts={'ifrs-full':{
    Revenue:unit('DKK',[...report(2020,[126e9,122e9]),six(2018,112e9),six(2017,111e9)]),
    ProfitLossAttributableToOwnersOfParent:unit('DKK',[...report(2020,[42e9,39e9]),six(2018,38.6e9),six(2017,38.1e9)])}};
  const d=await (await run(facts)).json();
  assert.deepEqual(d.annualFinancials.map(r=>r.fiscalYear),[2020,2019,2018,2017]);
  assert.equal(d.annualFinancials[2].revenue,112e9);
});

test('TSMC-style debt: noncurrent bonds + bank loans + the larger current line (real FY2024 values)', async () => {
  const { composedIfrsDebt } = await import('../src/foreign-annual.js');
  const i=(end,val,filed='2025-04-17')=>({end,val,form:'20-F',accn:'a-'+filed,filed});
  const bucket={
    NoncurrentPortionOfNoncurrentBondsIssued:{units:{TWD:[i('2024-12-31',926604500000),i('2023-12-31',913899800000,'2024-04-18')]}},
    LongtermBorrowings:{units:{TWD:[i('2024-12-31',31824400000),i('2023-12-31',4383000000,'2024-04-18')]}},
    CurrentPortionOfLongtermBorrowings:{units:{TWD:[i('2024-12-31',59857900000)]}},
    CurrentBondsIssuedAndCurrentPortionOfNoncurrentBondsIssued:{units:{TWD:[i('2024-12-31',57148000000),i('2023-12-31',6997700000,'2024-04-18')]}}
  };
  const d=Object.fromEntries(composedIfrsDebt(bucket,'TWD').map(f=>[f.end,f.val]));
  assert.equal(d['2024-12-31'],926604500000+31824400000+59857900000);   // current portion includes current bonds
  assert.equal(d['2023-12-31'],913899800000+4383000000+6997700000);
  assert.deepEqual(composedIfrsDebt({},'TWD'),[]);
});

test('cover-page shares outstanding sum share classes of the latest annual report', async () => {
  const { coverSharesOutstanding } = await import('../src/foreign-annual.js');
  const f=(val,frame,accn='n-2026',filed='2026-02-04',end='2026-01-30')=>({val,frame,accn,filed,end,form:'20-F'});
  const facts={facts:{dei:{EntityCommonStockSharesOutstanding:{units:{shares:[
    f(1075000000,'A'),f(3370000000,'B'),f(4500000000,'X','n-2025','2025-02-05','2025-01-31')]}}}}};
  assert.deepEqual(coverSharesOutstanding(facts),{value:4445000000,asOf:'2026-01-30'});
  assert.deepEqual(coverSharesOutstanding({facts:{}}),{value:null,asOf:null});
});

test('ASML-style dividends: PaymentsOfOrdinaryDividends, and dividend per share from dividends paid', async () => {
  const gaap={
    RevenueFromContractWithCustomerExcludingAssessedTax:unit('EUR',report(2025,[32.7e9,28.3e9])),
    NetIncomeLoss:unit('EUR',report(2025,[9.6e9,7.6e9])),
    PaymentsOfOrdinaryDividends:unit('EUR',report(2025,[2.5503e9,2.4529e9])),
    WeightedAverageNumberOfDilutedSharesOutstanding:unit('shares',report(2025,[388.9e6,393.6e6])),
    CommonStockDividendsPerShareDeclared:unit('EUR/shares',[f(2024,6.4,'0000000000-2026-2025','2026-03-01')])
  };
  const d=await (await run({'us-gaap':gaap})).json();
  assert.equal(d.annualFinancials[0].dividendsPaid,2.5503e9);
  assert.equal(d.annualFinancials[0].dividendsPerShare,2.5503e9/388.9e6);   // derived
  assert.equal(d.annualFinancials[1].dividendsPerShare,6.4);                 // reported wins
  assert.deepEqual(d.dividendsPerShareFromPaid,[2025]);
});
