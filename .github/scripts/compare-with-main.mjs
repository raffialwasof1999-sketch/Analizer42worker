// Regression check for worker PRs: runs main's worker and this branch's
// worker side by side against the same live SEC data, and reports every
// value that differs. "Filled" (blank -> number) is the intended effect of
// fill-only fixes; "changed" or "lost" values are what to look at.
import {appendFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const head=(await import(pathToFileURL(path.resolve('src/index.js')).href)).default;
const base=(await import(pathToFileURL(path.resolve('base/src/index.js')).href)).default;
const TICKERS=(process.env.TICKERS||[
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','AVGO','ORCL','ADBE','CRM','CSCO','IBM','QCOM','TXN',
  'TSLA','INTC','AMD','PLTR','UBER','NFLX','ABNB','PYPL','TTD','ANET','SHOP',
  'JPM','BAC','WFC','GS','V','MA','UNH',
  'WMT','COST','HD','LOW','NKE','SBUX','MCD','KO','PEP','DIS','PG',
  'GE','CAT','BA','XOM','CVX','JNJ','PFE','MRK','LLY','ABBV','T','VZ','F','GM','WHR'
].join(',')).split(',');
const num=x=>typeof x==='number'&&Number.isFinite(x);
const same=(a,b)=>a===b||(num(a)&&num(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(worker,t){
  const res=await worker.fetch(new Request('https://compare.local/?ticker='+encodeURIComponent(t)));
  return res.json();
}
function diff(rowsA,rowsB,label){
  const out={filled:[],changed:[],lost:[],rows:[]};
  const key=r=>r.fiscalPeriodEnd;
  const A=new Map((rowsA||[]).map(r=>[key(r),r])), B=new Map((rowsB||[]).map(r=>[key(r),r]));
  for(const k of B.keys()) if(!A.has(k)) out.rows.push(`+${label} ${k}`);
  for(const k of A.keys()) if(!B.has(k)) out.rows.push(`-${label} ${k}`);
  for(const [k,a] of A){
    const b=B.get(k); if(!b) continue;
    for(const f of new Set([...Object.keys(a),...Object.keys(b)])){
      const x=a[f], y=b[f];
      if(same(x,y)) continue;
      const tag=`${label} ${k} ${f}: ${x} -> ${y}`;
      if(x==null&&num(y)) out.filled.push(tag);
      else if(num(x)&&y==null) out.lost.push(tag);
      else out.changed.push(tag);
    }
  }
  return out;
}
const lines=[], summary=[];
let flagged=0;
for(const t of TICKERS){
  let a,b;
  try{ a=await get(base,t); await sleep(500); b=await get(head,t); }
  catch(e){ summary.push(`| ${t} | error: ${String(e.message||e).slice(0,80)} | | | |`); continue; }
  if(!a.success||!b.success){
    summary.push(`| ${t} | ${a.success?'ok':'main failed'} / ${b.success?'ok':'branch failed: '+String(b.error).slice(0,80)} | | | |`);
    if(a.success&&!b.success) flagged++;
    continue;
  }
  const d=[diff(a.annualFinancials,b.annualFinancials,'annual'),diff(a.quarterlyFinancials,b.quarterlyFinancials,'quarter')];
  const n=k=>d[0][k].length+d[1][k].length;
  const bad=n('changed')+n('lost');
  if(bad) flagged++;
  summary.push(`| ${t} | ${bad?'⚠ check':'ok'} | ${n('filled')} | ${n('changed')} | ${n('lost')} | ${n('rows')} |`);
  for(const x of d) for(const k of ['changed','lost','rows']) for(const s of x[k].slice(0,15)) lines.push(`${t} ${k}: ${s}`);
  await sleep(500);
}
const report=[`### Worker values: this branch vs main (${TICKERS.length} tickers, same live SEC data)`,'',
  flagged?`**${flagged} ticker(s) have changed or lost values; details below.**`:'**No value changed or lost; only blanks filled.**','',
  '| Ticker | Result | Filled | Changed | Lost | Rows ± |','|---|---|---|---|---|---|',...summary,'',
  lines.length?'<details><summary>Changed / lost / row differences</summary>\n\n```\n'+lines.slice(0,400).join('\n')+'\n```\n</details>':''].join('\n');
writeFileSync('compare-report.md',report);
if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,report+'\n');
console.log(report);
