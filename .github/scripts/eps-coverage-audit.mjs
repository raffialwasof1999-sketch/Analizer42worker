// Live SEC coverage audit: runs THIS checkout's worker (not production)
// against real SEC data for a broad mix of issuers and reports every gap
// that would blank a cell in the Active Analyzer sheet. Report-only.
import worker from '../../src/index.js';
import {appendFileSync} from 'node:fs';

const TICKERS=(process.env.TICKERS||[
  // mega-cap tech, calendar and offset fiscal years
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','AVGO','ORCL','ADBE','CRM',
  // past splits, losses, recent IPOs
  'TSLA','INTC','AMD','PLTR','UBER','NFLX',
  // banks, insurers, payments
  'JPM','BAC','WFC','GS','BRK-B','V','MA','UNH',
  // retail and consumer (Jan/Aug/May fiscal years)
  'WMT','COST','HD','LOW','NKE','SBUX','MCD','KO','PEP','DIS',
  // industrials, energy, healthcare, telecom, autos
  'GE','CAT','XOM','CVX','JNJ','PFE','T','VZ','F','GM'
].join(',')).split(',');
const SUBREQUEST_LIMIT=50;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const realFetch=globalThis.fetch;
const results=[];

for(const ticker of TICKERS){
  let calls=0;
  globalThis.fetch=(...a)=>{calls++;return realFetch(...a);};
  const r={ticker};
  try{
    const t0=Date.now();
    const res=await worker.fetch(new Request('https://audit.local/?ticker='+encodeURIComponent(ticker)));
    const d=await res.json();
    r.ms=Date.now()-t0; r.subrequests=calls; r.http=res.status;
    if(!d.success){r.error=String(d.error).slice(0,160);results.push(r);continue;}
    const q=d.quarterlyFinancials||[], a=d.annualFinancials||[];
    const q24=q.slice(0,24), a10=a.slice(0,10);
    const blank=(rows,k)=>rows.filter(x=>!finite(x[k])).map(x=>x.fiscalYear+'Q'+(x.fiscalQuarter??''));
    r.latest=q[0]?`FY${q[0].fiscalYear}Q${q[0].fiscalQuarter}`:null;
    r.ttmDilutedEPSBlank=blank(q.slice(0,4),'dilutedEPS');
    r.q24DilutedEPSBlank=blank(q24,'dilutedEPS');
    r.q24BasicEPSBlank=blank(q24,'basicEPS');
    r.q24RevenueBlank=blank(q24,'revenue');
    r.q24NetIncomeBlank=blank(q24,'netIncome');
    r.ttmFreeCashFlowBlank=blank(q.slice(0,4),'freeCashFlow');
    // ROIC needs operating income, tax, pre-tax income and invested capital
    // for every quarter in its window (4, 20 and 40 quarters, plus one more
    // invested capital); enterprise value needs the latest debt and cash.
    r.roicBlank=Object.fromEntries(['operatingIncome','incomeTaxExpense','incomeBeforeTax','investedCapital']
      .map(k=>[k,blank(q.slice(0,k==='investedCapital'?21:20),k).length]).filter(([,n])=>n));
    r.evBlank=['totalDebt','cash'].filter(k=>!finite(q[0]?.[k]));
    // For each remaining ROIC/EV input gap: the first quarter missing it and
    // the tags SEC holds at that date.
    const probes={
      investedCapital:[/^(StockholdersEquity\w*|DebtCurrent|LongTermDebt\w*|ShortTermBorrowings|CommercialPaper|OtherShortTermBorrowings|DebtInstrumentCarryingAmount|DebtLongtermAndShorttermCombinedAmount|CashAndCashEquivalentsAtCarryingValue)$/,true],
      cash:[/^(Cash\w*)$/,true],
      incomeBeforeTax:[/BeforeIncomeTax/,false],
      operatingIncome:[/^(OperatingIncomeLoss|InterestExpense\w*|InterestAndDebtExpense|IncomeLossFromContinuingOperationsBeforeIncomeTaxes\w*)$/,false]
    };
    const gaps=Object.entries(probes).map(([k,[re,instant]])=>{
      const row=(k==='cash'?q.slice(0,1):q.slice(0,21)).find(x=>!finite(x[k]));
      return row&&[k,row,re,instant];}).filter(Boolean);
    if(gaps.length){
      const gaap=(await (await realFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${d.cik}.json`,
        {headers:{'User-Agent':'Analyzer42 audit raffialwasof.1999@gmail.com'}})).json()).facts?.['us-gaap']||{};
      const short=t=>t.replace('StockholdersEquity','SE').replace('LongTermDebt','LTD').replace('CashAndCashEquivalentsAtCarryingValue','Cash')
        .replace('IncomeLossFromContinuingOperationsBeforeIncomeTaxes','PretaxCO').replace('InterestExpense','IntExp');
      r.inputProbe=gaps.map(([k,row,re,instant])=>{
        const comp=k==='investedCapital'?` [SE=${finite(row.stockholdersEquity)} debt=${finite(row.totalDebt)} cash=${finite(row.cash)}]`:'';
        const tags=Object.entries(gaap).filter(([t])=>re.test(t)).flatMap(([t,c])=>Object.values(c.units||{}).flat()
          .filter(x=>x.end===row.fiscalPeriodEnd&&(instant?!x.start:!!x.start)&&/^10-[KQ]/.test(x.form)).slice(0,1)
          .map(x=>`${short(t)}=${(x.val/1e9).toFixed(2)}`));
        return `${k}@${row.fiscalPeriodEnd}${comp}: ${tags.join(', ')||'none'}`;
      });
    }
    if(r.evBlank.length&&q[0]){
      const gaap=(await (await realFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${d.cik}.json`,
        {headers:{'User-Agent':'Analyzer42 audit raffialwasof.1999@gmail.com'}})).json()).facts?.['us-gaap']||{};
      r.balanceTags=Object.entries(gaap).filter(([t])=>
        /^(DebtCurrent|LongTermDebt\w*|ShortTerm(Borrowings|DebtCurrent)|CommercialPaper|OtherShortTermBorrowings|(Long)?\w*NotesPayable\w*|DebtInstrumentCarryingAmount|CashAndCashEquivalentsAtCarryingValue|Cash|CashAndDueFromBanks|OtherLongTermDebt\w*|SecuredDebt\w*|UnsecuredDebt\w*|SeniorNotes\w*|Debt\w*Combined\w*)$/.test(t)&&!/Fair|Maturit|Percent|Rate|Interest/.test(t))
        .flatMap(([t,c])=>Object.values(c.units||{}).flat()
          .filter(x=>x.end===q[0].fiscalPeriodEnd&&!x.start&&/^10-[KQ]/.test(x.form))
          .slice(0,1).map(x=>`${t.replace('CashAndCashEquivalentsAtCarryingValue','Cash').replace('LongTermDebt','LTD')}=${(x.val/1e9).toFixed(2)}`));
    }
    r.q20FreeCashFlowBlank=blank(q.slice(0,20),'freeCashFlow');
    r.latestDilutedShares=finite(q[0]?.dilutedShares);
    if(!r.latestDilutedShares&&q[0]){
      // Which share-count tags SEC holds for the latest quarter end.
      const gaap=(await (await realFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${d.cik}.json`,
        {headers:{'User-Agent':'Analyzer42 audit raffialwasof.1999@gmail.com'}})).json()).facts?.['us-gaap']||{};
      r.latestShareTags=Object.entries(gaap).filter(([t])=>/Shares?Outstanding|ShareOutstanding/.test(t))
        .flatMap(([t,c])=>Object.values(c.units||{}).flat().filter(x=>x.end===q[0].fiscalPeriodEnd)
          .map(x=>`${t}:${x.form}:${x.start||''}:${x.val}`)).slice(0,6);
    }
    r.a10Blank=['revenue','netIncome','dilutedEPS','freeCashFlow'].flatMap(k=>
      blank(a10,k).map(y=>k+':'+y));
    // Mixed split basis or wrong column: diluted EPS should sit at 80-102%
    // of basic EPS for profitable quarters, and equal it for losses.
    // A cent of rounding is allowed: $0.05 basic vs $0.04 diluted is fine.
    r.epsMismatch=q24.filter(x=>finite(x.basicEPS)&&finite(x.dilutedEPS)&&x.basicEPS!==0&&
      Math.abs(x.dilutedEPS-x.basicEPS)>0.0101&&(
      x.basicEPS>0 ? (x.dilutedEPS/x.basicEPS<.8||x.dilutedEPS/x.basicEPS>1.02)
                   : Math.abs(x.dilutedEPS/x.basicEPS-1)>.05))
      .map(x=>`${x.fiscalYear}Q${x.fiscalQuarter}:${x.basicEPS}/${x.dilutedEPS}`);
    // EPS x diluted shares should roughly reproduce net income.
    r.incomeMismatch=q24.filter(x=>finite(x.dilutedEPS)&&finite(x.dilutedShares)&&finite(x.netIncome)&&
      Math.abs(x.netIncome)>1e7 &&
      Math.abs(x.dilutedEPS*x.dilutedShares-x.netIncome)>Math.max(.2*Math.abs(x.netIncome),.03*x.dilutedShares))
      .map(x=>`${x.fiscalYear}Q${x.fiscalQuarter}`);
    const audit=d.stockSplitAudit||{};
    r.q4DilutedEstimated=(audit.quarterFourDilutedEPS?.findings||[]).length;
    r.overSubrequestLimit=calls>SUBREQUEST_LIMIT;
    r.blankReasons=d.blankReasons||[];
    // Free cash flow = operating cash flow - capital expenditures. When it is
    // missing, say which half is missing and which tags SEC holds for it.
    const fcfGap=q.slice(0,20).find(x=>!finite(x.freeCashFlow));
    if(fcfGap){
      const y=a.find(x=>x.fiscalPeriodEnd>=fcfGap.fiscalPeriodEnd&&!finite(x.freeCashFlow))||
        a.find(x=>x.fiscalPeriodEnd>=fcfGap.fiscalPeriodEnd)||a[0]||{};
      r.fcfMissing=fcfGap.fiscalPeriodEnd+' '+[!finite(fcfGap.operatingCashFlow)&&'operatingCashFlow',!finite(fcfGap.capitalExpenditures)&&'capitalExpenditures']
        .filter(Boolean).join('+')+` (annual OCF=${y.operatingCashFlow} capex=${y.capitalExpenditures})`;
      const gaap=(await (await realFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${d.cik}.json`,
        {headers:{'User-Agent':'Analyzer42 audit raffialwasof.1999@gmail.com'}})).json()).facts?.['us-gaap']||{};
      const end=fcfGap.fiscalPeriodEnd;
      r.fcfTags=Object.entries(gaap).filter(([t])=>
        /^(NetCashProvidedByUsedInOperatingActivities.*|PaymentsToAcquire.*(Property|Productive|Equipment|Capital|Plant|Intangible|Software|Fixed|RealEstate).*|PaymentsForCapitalImprovements|PaymentsForProceedsFrom(Productive|PropertyPlant).*|CapitalExpenditure.*)$/.test(t))
        .flatMap(([t,c])=>Object.values(c.units||{}).flat()
          // Every figure for the gap quarter's fiscal year, to see breaks.
          .filter(x=>x.start&&/^10-[KQ]/.test(x.form)&&Math.abs(Date.parse(x.end)-Date.parse(end))<=200*864e5)
          .map(x=>`${t.replace('PaymentsToAcquire','PTA').replace('NetCashProvidedByUsedInOperatingActivities','OCF')}=${(x.val/1e9).toFixed(2)}@${x.start}..${x.end}/${x.form}`))
        .filter((v,i,arr)=>arr.indexOf(v)===i).slice(0,40);
    }
    // Why each recent quarter lacks EPS: the row plus every audit finding
    // that names its period end.
    const findingsFor=end=>JSON.stringify(audit).match(new RegExp('\\{[^{}]*"'+end+'"[^{}]*\\}','g'))||[];
    r.epsGapDetail=q24.filter(x=>!finite(x.dilutedEPS)||!finite(x.basicEPS)).map(x=>
      `${x.fiscalPeriodEnd} Q${x.fiscalQuarter} NI=${x.netIncome} basic=${x.basicEPS} diluted=${x.dilutedEPS} shares=${x.dilutedShares} :: ${findingsFor(x.fiscalPeriodEnd).filter(f=>/reason|status/.test(f)).join(' ').slice(0,300)}`).slice(0,3);
  }catch(e){r.error=String(e.message||e).slice(0,160);r.subrequests=calls;}
  finally{globalThis.fetch=realFetch;}
  results.push(r);
  console.log(JSON.stringify(r));
  await new Promise(s=>setTimeout(s,400));
}

// For tickers the worker could not load at all, show what SEC holds for
// the headline revenue and net income tags.
const diag=[];
for(const r of results.filter(r=>r.error)){
  try{
    const ua={headers:{'User-Agent':'Analyzer42 audit raffialwasof.1999@gmail.com'}};
    const map=await (await realFetch('https://www.sec.gov/files/company_tickers.json',ua)).json();
    const hit=Object.values(map).find(x=>x.ticker===r.ticker.replace('-','.')||x.ticker===r.ticker);
    const cik=String(hit?.cik_str).padStart(10,'0');
    const f=await (await realFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,ua)).json();
    const days=(a,b)=>(Date.parse(b)-Date.parse(a))/864e5;
    const gaap=f.facts?.['us-gaap']||{};
    const lines=['taxonomies='+Object.keys(f.facts||{}).join('/')+' usgaapTags='+Object.keys(gaap).length];
    for(const tag of Object.keys(gaap).filter(t=>/^(Revenues|RevenueFromContract.*|SalesRevenue.*|NetIncomeLoss|ProfitLoss|NetIncomeLossAttributableToParent)$/.test(t))){
      const all=Object.values(gaap[tag].units||{}).flat();
      const k=all.filter(x=>/^10-K/.test(x.form));
      const annual=k.filter(x=>x.start&&days(x.start,x.end)>=330&&days(x.start,x.end)<=385);
      lines.push(`${tag} units=${Object.keys(gaap[tag].units)} all=${all.length} 10K=${k.length} annual10K=${annual.length} newest=${JSON.stringify(annual.sort((a,b)=>b.end.localeCompare(a.end))[0]||k[0]||all[0])}`);
    }
    diag.push(`${r.ticker} cik=${cik} ${f.entityName}%0A  `+lines.join('%0A  '));
  }catch(e){diag.push(r.ticker+' diagnostic failed: '+e.message);}
}
if(diag.length)console.log(`::notice title=Load failure detail::${diag.join('%0A').replace(/::/g,'; ')}`);

const problems=r=>[
  r.error&&'error: '+r.error,
  r.ttmDilutedEPSBlank?.length&&'P/E TTM blank ('+r.ttmDilutedEPSBlank+')',
  r.q24DilutedEPSBlank?.length&&r.q24DilutedEPSBlank.length+' of 24 quarters lack diluted EPS',
  r.ttmFreeCashFlowBlank?.length&&'FCF TTM blank ('+r.ttmFreeCashFlowBlank+')',
  r.q20FreeCashFlowBlank?.length&&r.q20FreeCashFlowBlank.length+' of 20 quarters lack FCF',
  r.q24BasicEPSBlank?.length&&r.q24BasicEPSBlank.length+' lack basic EPS',
  (r.q24RevenueBlank?.length||r.q24NetIncomeBlank?.length)&&'revenue/net income gaps',
  Object.keys(r.roicBlank||{}).length&&'ROIC 5y gaps '+JSON.stringify(r.roicBlank),
  r.evBlank?.length&&'EV blank ('+r.evBlank+')',
  r.latestDilutedShares===false&&'latest diluted shares blank'+(r.latestShareTags?' [SEC has: '+(r.latestShareTags.join(', ')||'none')+']':''),
  r.a10Blank?.length&&r.a10Blank.length+' annual gaps ('+r.a10Blank.slice(0,4)+')',
  r.epsMismatch?.length&&'diluted vs basic mismatch '+r.epsMismatch.slice(0,3),
  r.overSubrequestLimit&&'over Cloudflare subrequest limit ('+r.subrequests+')'
].filter(Boolean);
const lines=results.map(r=>{const p=problems(r);
  const info=r.incomeMismatch?.length?' (info: EPS x shares != income '+r.incomeMismatch.slice(0,2)+')':'';
  return `${p.length?'GAP':'OK '} ${r.ticker} ${r.latest||''} req=${r.subrequests} ${p.join('; ')}${info}`;});
const clean=results.filter(r=>!problems(r).length).length;
const summary=`${clean}/${results.length} tickers complete`;
console.log(summary+'\n'+lines.join('\n'));
// The sheet's "Data Notes" text for a representative sample.
for(const t of ['AAPL','XOM','JPM','BRK-B','ORCL','META','ADBE','MCD','NKE','PLTR']){
  const r=results.find(x=>x.ticker===t); if(!r?.blankReasons)continue;
  console.log(`::warning title=Blank reasons ${t}::${r.blankReasons.map(x=>x.metric+': '+x.reason).join('%0A').replace(/::/g,'; ').slice(0,3900)||'none'}`);
}
const probe=results.filter(r=>r.inputProbe).map(r=>`${r.ticker}: ${r.inputProbe.join(' | ')}`);
for(let i=0;false&&i<probe.length;i+=6)console.log(`::notice title=ROIC input probe ${i/6+1}::${probe.slice(i,i+6).join('%0A').replace(/::/g,'; ').slice(0,3900)}`);
const bal=results.filter(r=>r.balanceTags).map(r=>`${r.ticker} blank:${r.evBlank}%0A  ${r.balanceTags.join(', ')||'none'}`);
if(false&&bal.length)console.log(`::notice title=Debt and cash tags::${bal.join('%0A').replace(/::/g,'; ')}`);
const fcf=results.filter(r=>r.fcfMissing).map(r=>`${r.ticker}: missing ${r.fcfMissing}%0A  SEC: ${r.fcfTags.join(', ')||'none'}`);
if(fcf.length)console.log(`::notice title=FCF gap detail::${fcf.join('%0A').replace(/::/g,'; ')}`);
const detail=results.filter(r=>r.epsGapDetail?.length).map(r=>r.ticker+'%0A  '+r.epsGapDetail.join('%0A  '));
if(detail.length)console.log(`::notice title=EPS gap detail::${detail.join('%0A').replace(/::/g,'; ')}`);
// Annotation text survives where logs cannot be downloaded.
console.log(`::notice title=EPS coverage: ${summary}::${lines.join('%0A')}`);
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '### '+summary+'\n```\n'+lines.join('\n')+'\n```\n');
