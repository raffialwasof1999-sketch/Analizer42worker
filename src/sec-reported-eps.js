/** Conservative SEC-only fallback for reported GAAP quarterly EPS.
 * Reads earnings exhibits, never derives EPS by subtracting annual EPS.
 * Unsupported layouts, ambiguous periods and unproven share bases stay blank.
 */
const finite = v => typeof v === 'number' && Number.isFinite(v);
const text = s => s.replace(/<[^>]*>/g,' ').replace(/&#x([\da-f]+);/gi,(_,v)=>String.fromCodePoint(parseInt(v,16))).replace(/&#(\d+);/g,(_,v)=>String.fromCodePoint(Number(v))).replace(/&nbsp;|&amp;|&minus;/gi,v=>({'&nbsp;':' ','&amp;':'&','&minus;':'-'}[v.toLowerCase()])).replace(/\s+/g,' ').trim();
// Accepts "1,234", "(0.06)" and a currency sign in the same cell, as
// Microsoft prints it: "$27,233", "$ (0.06)", "($0.06)".
const number = s => { const t=s.replace(/\$/g,'').replace(/\s+/g,''); return /^\(?-?\d[\d,]*(?:\.\d+)?\)?$/.test(t) ? Number(t.replace(/[,()]/g,''))*(t.includes('(')?-1:1) : null; };
const months = 'January February March April May June July August September October November December'.split(' ');
function date(s) {
  const m=s.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s*(\d{1,2}),?\s*(20\d\d)/i);
  return m ? `${m[3]}-${String(months.findIndex(x=>x.toLowerCase()===m[1].toLowerCase())+1).padStart(2,'0')}-${m[2].padStart(2,'0')}` : null;
}
function tables(html) {
  // A stack keeps nested layout tables from merging separate statements.
  const stack=[],out=[];
  for(const token of html.matchAll(/<table\b[^>]*>|<\/table\s*>/gi)) {
    if(/^<table\b/i.test(token[0])) stack.push(token.index+token[0].length);
    else if(stack.length) { const start=stack.pop(); const body=html.slice(start,token.index); if(!/<table\b/i.test(body)) out.push(body); }
  }
  return out;
}
// Parsing an exhibit is the costly step (Cloudflare caps worker CPU time),
// and the same document is queried for many quarters, so each document's
// income-statement tables are parsed once. The cache is emptied when each
// recovery run ends: module state outlives a request inside a Cloudflare
// isolate, and retained documents would exhaust its 128 MB memory limit.
const parsedCache=new Map();
function statements(html) {
  if(parsedCache.has(html)) return parsedCache.get(html);
  const out=[];
  for(const table of tables(html)) {
    const summary=text(table);
    if(!/Three Months Ended/i.test(summary) || !/Earnings per (?:common )?share/i.test(summary) || /non[ -]?GAAP|adjusted earnings per/i.test(summary)) continue;
    const rows=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(r=>{
      let col=0;
      return [...r[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]\s*>/gi)].map(c=>{
        const width=Math.min(100,Math.max(1,Number(c[1].match(/colspan\s*=\s*["']?(\d+)/i)?.[1]||1)));
        const cell={start:col,end:col+width,value:text(c[2])}; col+=width; return cell;
      });
    });
    // Period group headers: "Three Months Ended" alone (dates in the row
    // below), or "Three Months Ended June 30," (years alone in the row below,
    // as Microsoft lays it out). Twelve-month groups are tracked so that a
    // year cell under them is never taken for a quarter.
    const periodGroups=rows.flat().filter(c=>/^(?:Three|Six|Nine|Twelve) Months Ended\b/i.test(c.value));
    const groups=periodGroups.filter(g=>/^Three Months Ended\b/i.test(g.value));
    const owner=c=>periodGroups.find(g=>c.start>=g.start && c.end<=g.end) ||
      periodGroups.filter(g=>g.start<=c.start).sort((a,b)=>b.start-a.start)[0];
    const cellDate=c=>{
      const full=date(c.value); if(full) return full;
      const year=c.value.match(/^(20\d\d)$/)?.[1]; if(!year) return null;
      const g=owner(c); if(!g || !groups.includes(g)) return null;
      return date(g.value.replace(/,?\s*$/,'')+', '+year);
    };
    const dated=[];
    for(const row of rows) for(const c of row) {
      const d=cellDate(c);
      if(d && (date(c.value) ? groups.some(g=>c.start>=g.start && c.end<=g.end) : true)) dated.push({cell:c,date:d});
    }
    out.push({rows,dated});
  }
  if(parsedCache.size>=4) parsedCache.delete(parsedCache.keys().next().value);
  parsedCache.set(html,out);
  return out;
}
export function reportedQuarterEPS(html,end) {
  if(typeof html!=='string' || html.length>6_000_000) return null;
  const found=[];
  for(const {rows,dated} of statements(html)) {
    let target=null; let ambiguous=false;
    for(const {cell:c,date:d} of dated) if(d===end) {
      if(target && target.start!==c.start) { ambiguous=true; break; }
      target=c;
    }
    if(!target || ambiguous) continue;
    const result={}; let eps=false;
    for(const row of rows) {
      const label=row.find(c=>c.value)?.value||'';
      // Share-count headings end the EPS section. Check them first: Apple's
      // "Shares used in computing earnings per share:" also names EPS.
      if(/Weighted.average|\bshares\b/i.test(label)) eps=false;
      else if(/Earnings per (?:common )?share/i.test(label)) {eps=true;continue;}
      const values=row.filter(c=>c.start<target.end && c.end>target.start).map(c=>number(c.value)).filter(finite);
      if(values.length!==1) continue;
      if(/^Net income(?:\s*\*|\s*\([^)]*\))?$/i.test(label)) result.netIncome=values[0];
      if(eps && /^Basic\s*\*?$/i.test(label)) result.basicEPS=values[0];
      if(eps && /^Diluted\s*\*?$/i.test(label)) result.dilutedEPS=values[0];
    }
    if(finite(result.basicEPS)&&finite(result.dilutedEPS)&&finite(result.netIncome)) found.push(result);
  }
  const unique=[...new Map(found.map(v=>[JSON.stringify(v),v])).values()];
  return unique.length===1?unique[0]:null;
}
function reconciles(report,row,html,rows,estimated) {
  // Existing normalized basic EPS anchors the split basis. The same statement's
  // net income must independently match the exact quarter, including units.
  // A Q4 basic EPS the worker estimated (not SEC-reported) can be a cent off,
  // so it anchors the share basis within 3% instead: any stock split is at
  // least 3-for-2, far outside that, and net income must still match exactly.
  const own=estimated.has(row.fiscalPeriodEnd) && finite(row.basicEPS);
  const anchors=own ? [] : finite(row.basicEPS) ? [{known:row.basicEPS,reported:report.basicEPS}] : rows.filter(r=>finite(r.basicEPS)).map(r=>({known:r.basicEPS,reported:reportedQuarterEPS(html,r.fiscalPeriodEnd)?.basicEPS}));
  const anchored=own
    ? Math.abs(row.basicEPS-report.basicEPS)<=Math.max(0.0051,Math.abs(report.basicEPS)*.03)
    : anchors.some(a=>finite(a.reported) && Math.abs(a.known-a.reported)<0.0051);
  return anchored && finite(row.netIncome) &&
    [1,1000,1e6].some(scale=>Math.abs(report.netIncome*scale-row.netIncome)<=Math.max(1,Math.abs(row.netIncome)*0.001));
}
// Exhibit 99 filenames vary by filer: "ex991_q425.htm" (Netflix),
// "a8-kex991q4202509272025.htm" (Apple). Accept a plain filename (no path
// segments) containing an ex99 / exhibit99 token.
export function isEarningsExhibitName(name) {
  return typeof name==='string' && /^[A-Za-z0-9_-]*?ex(?:hibit)?[-_]?99[\w.-]*\.html?$/i.test(name);
}
// estimatedBasicPeriods: period ends whose basic EPS the worker estimated
// rather than read from SEC; a reported exhibit value replaces the estimate.
// estimatedDilutedPeriods: likewise for diluted EPS.
export async function recoverSECReportedEPS(...args) {
  try { return await recoverReported(...args); }
  finally { parsedCache.clear(); }
}
async function recoverReported(rows,filings,cik,fetchJSON,fetchDocument,estimatedBasicPeriods=[],estimatedDilutedPeriods=[]) {
  const estimated=new Set(estimatedBasicPeriods);
  const estimatedDiluted=new Set(estimatedDilutedPeriods);
  const output=rows.map(r=>({...r})), findings=[];
  // An exhibit improves an estimated Q4 diluted EPS by about a cent, and
  // parsing exhibits is the main CPU cost (Cloudflare's Free plan allows
  // ~10 ms per request), so only the newest 8 quarters, which feed
  // P/E (TTM), are looked up for that reason.
  const recent=new Set(output.slice(0,8).map(r=>r.fiscalPeriodEnd));
  const candidates=output.filter(r=>!finite(r.dilutedEPS)||!finite(r.basicEPS)||(estimatedDiluted.has(r.fiscalPeriodEnd)&&recent.has(r.fiscalPeriodEnd)));
  let requests=0;
  const documents=new Map();
  for(const row of candidates) {
    if(requests>=16) break;
    const end=row.fiscalPeriodEnd;
    const matches=filings.filter(f=>f.form==='8-K' && /(?:^|[,;\s])2\.02(?:$|[,;\s])/.test(f.items||'') &&
      /^\d{10}-\d{2}-\d{6}$/.test(f.accession) && f.filed>=end && (Date.parse(f.filed)-Date.parse(end))/86400000<=105)
      .sort((a,b)=>a.filed.localeCompare(b.filed)).slice(0,2);
    for(const filing of matches) {
      if(requests>=16) break;
      // A predecessor's filings live under its own CIK.
      const base=`https://www.sec.gov/Archives/edgar/data/${Number(filing.cik||cik)}/${filing.accession.replaceAll('-','')}/`;
      try {
        if(!documents.has(base)) {
          requests++;
          const listing=await fetchJSON(base+'index.json');
          const names=(listing.directory?.item||[]).map(x=>x.name).filter(isEarningsExhibitName).slice(0,3);
          const entries=[];
          // Every document counts against the same budget as directory
          // listings: Cloudflare caps subrequests per worker invocation.
          for(const name of names) {
            if(requests>=16) break;
            requests++;
            entries.push({url:base+name,html:await fetchDocument({filingDocumentUrl:base+name})});
          }
          documents.set(base,entries);
        }
        const reports=documents.get(base).map(d=>({...d,report:reportedQuarterEPS(d.html,end)})).filter(d=>d.report && reconciles(d.report,row,d.html,output,estimated));
        if(!reports.length) continue;
        if(new Set(reports.map(d=>JSON.stringify(d.report))).size!==1) {findings.push({periodEnd:end,status:'conflicting-exhibits'});continue;}
        const {report,url}=reports[0];
        // Preserve existing facts; this fallback only fills verified gaps.
        const filled=[];
        for(const key of ['basicEPS','dilutedEPS']) if(!finite(row[key]) || (key==='basicEPS' && estimated.has(end) && row[key]!==report[key]) || (key==='dilutedEPS' && estimatedDiluted.has(end) && row[key]!==report[key])) {row[key]=report[key];filled.push(key);}
        findings.push({periodEnd:end,status:'recovered',fields:filled,accession:filing.accession,filed:filing.filed,source:url,basis:estimated.has(end)?'estimated Q4 basic EPS within 3% of reported (same share basis); quarterly net income matches':'matches normalized basic EPS and quarterly net income'});
        break;
      } catch(error) {findings.push({periodEnd:end,status:'unavailable',accession:filing.accession,error:String(error.message).slice(0,160)});}
    }
  }
  return {rows:output,audit:{method:'SEC 8-K GAAP earnings exhibits; exact quarter and normalized basic EPS anchor required',filingsInspected:requests,unfilledQuarters:output.filter(r=>!finite(r.basicEPS)||!finite(r.dilutedEPS)).length,estimatedDilutedRemaining:output.filter(r=>estimatedDiluted.has(r.fiscalPeriodEnd)&&!findings.some(f=>f.periodEnd===r.fiscalPeriodEnd&&f.status==='recovered')).map(r=>r.fiscalPeriodEnd),findings}};
}
