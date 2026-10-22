/** Conservative SEC-only fallback for reported GAAP quarterly EPS.
 * Reads earnings exhibits, never derives EPS by subtracting annual EPS.
 * Unsupported layouts, ambiguous periods and unproven share bases stay blank.
 */
const finite = v => typeof v === 'number' && Number.isFinite(v);
const text = s => s.replace(/<[^>]*>/g,' ').replace(/&#x([\da-f]+);/gi,(_,v)=>String.fromCodePoint(parseInt(v,16))).replace(/&#(\d+);/g,(_,v)=>String.fromCodePoint(Number(v))).replace(/&nbsp;|&amp;|&minus;/gi,v=>({'&nbsp;':' ','&amp;':'&','&minus;':'-'}[v.toLowerCase()])).replace(/\s+/g,' ').trim();
const number = s => /^\(?-?\d[\d,]*(?:\.\d+)?\)?$/.test(s.trim()) ? Number(s.replace(/[,()]/g,''))*(s.includes('(')?-1:1) : null;
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
export function reportedQuarterEPS(html,end) {
  if(typeof html!=='string' || html.length>6_000_000) return null;
  const found=[];
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
    const groups=rows.flat().filter(c=>/^Three Months Ended$/i.test(c.value));
    let target=null; let ambiguous=false;
    for(const row of rows) for(const c of row) if(date(c.value)===end && groups.some(g=>c.start>=g.start && c.end<=g.end)) {
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
export async function recoverSECReportedEPS(rows,filings,cik,fetchJSON,fetchDocument,estimatedBasicPeriods=[]) {
  const estimated=new Set(estimatedBasicPeriods);
  const output=rows.map(r=>({...r})), findings=[];
  const candidates=output.filter(r=>!finite(r.dilutedEPS)||!finite(r.basicEPS));
  let requests=0;
  const documents=new Map();
  for(const row of candidates) {
    if(requests>=12) break;
    const end=row.fiscalPeriodEnd;
    const matches=filings.filter(f=>f.form==='8-K' && /(?:^|[,;\s])2\.02(?:$|[,;\s])/.test(f.items||'') &&
      /^\d{10}-\d{2}-\d{6}$/.test(f.accession) && f.filed>=end && (Date.parse(f.filed)-Date.parse(end))/86400000<=105)
      .sort((a,b)=>a.filed.localeCompare(b.filed)).slice(0,2);
    for(const filing of matches) {
      if(requests>=12) break;
      const base=`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replaceAll('-','')}/`;
      try {
        if(!documents.has(base)) {
          requests++;
          const listing=await fetchJSON(base+'index.json');
          const names=(listing.directory?.item||[]).map(x=>x.name).filter(isEarningsExhibitName).slice(0,3);
          const entries=[];
          for(const name of names) entries.push({url:base+name,html:await fetchDocument({filingDocumentUrl:base+name})});
          documents.set(base,entries);
        }
        const reports=documents.get(base).map(d=>({...d,report:reportedQuarterEPS(d.html,end)})).filter(d=>d.report && reconciles(d.report,row,d.html,output,estimated));
        if(!reports.length) continue;
        if(new Set(reports.map(d=>JSON.stringify(d.report))).size!==1) {findings.push({periodEnd:end,status:'conflicting-exhibits'});continue;}
        const {report,url}=reports[0];
        // Preserve existing facts; this fallback only fills verified gaps.
        const filled=[];
        for(const key of ['basicEPS','dilutedEPS']) if(!finite(row[key]) || (key==='basicEPS' && estimated.has(end) && row[key]!==report[key])) {row[key]=report[key];filled.push(key);}
        findings.push({periodEnd:end,status:'recovered',fields:filled,accession:filing.accession,filed:filing.filed,source:url,basis:estimated.has(end)?'estimated Q4 basic EPS within 3% of reported (same share basis); quarterly net income matches':'matches normalized basic EPS and quarterly net income'});
        break;
      } catch(error) {findings.push({periodEnd:end,status:'unavailable',accession:filing.accession,error:String(error.message).slice(0,160)});}
    }
  }
  return {rows:output,audit:{method:'SEC 8-K GAAP earnings exhibits; exact quarter and normalized basic EPS anchor required',filingsInspected:requests,unfilledQuarters:output.filter(r=>!finite(r.basicEPS)||!finite(r.dilutedEPS)).length,findings}};
}
