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
    r.latestDilutedShares=finite(q[0]?.dilutedShares);
    r.a10Blank=['revenue','netIncome','dilutedEPS','freeCashFlow'].flatMap(k=>
      blank(a10,k).map(y=>k+':'+y));
    // Mixed split basis or wrong column: diluted EPS should sit at 80-102%
    // of basic EPS for profitable quarters, and equal it for losses.
    r.epsMismatch=q24.filter(x=>finite(x.basicEPS)&&finite(x.dilutedEPS)&&x.basicEPS!==0&&(
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
  }catch(e){r.error=String(e.message||e).slice(0,160);r.subrequests=calls;}
  finally{globalThis.fetch=realFetch;}
  results.push(r);
  console.log(JSON.stringify(r));
  await new Promise(s=>setTimeout(s,400));
}

const problems=r=>[
  r.error&&'error: '+r.error,
  r.ttmDilutedEPSBlank?.length&&'P/E TTM blank ('+r.ttmDilutedEPSBlank+')',
  r.q24DilutedEPSBlank?.length&&r.q24DilutedEPSBlank.length+' of 24 quarters lack diluted EPS',
  r.q24BasicEPSBlank?.length&&r.q24BasicEPSBlank.length+' lack basic EPS',
  (r.q24RevenueBlank?.length||r.q24NetIncomeBlank?.length)&&'revenue/net income gaps',
  r.latestDilutedShares===false&&'latest diluted shares blank',
  r.a10Blank?.length&&r.a10Blank.length+' annual gaps ('+r.a10Blank.slice(0,4)+')',
  r.epsMismatch?.length&&'diluted vs basic mismatch '+r.epsMismatch.slice(0,3),
  r.incomeMismatch?.length&&'EPS x shares != income '+r.incomeMismatch.slice(0,3),
  r.overSubrequestLimit&&'over Cloudflare subrequest limit ('+r.subrequests+')'
].filter(Boolean);
const lines=results.map(r=>{const p=problems(r);
  return `${p.length?'GAP':'OK '} ${r.ticker} ${r.latest||''} req=${r.subrequests} ${p.join('; ')}`;});
const clean=results.filter(r=>!problems(r).length).length;
const summary=`${clean}/${results.length} tickers complete`;
console.log(summary+'\n'+lines.join('\n'));
// Annotation text survives where logs cannot be downloaded.
console.log(`::notice title=EPS coverage: ${summary}::${lines.join('%0A')}`);
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '### '+summary+'\n```\n'+lines.join('\n')+'\n```\n');
