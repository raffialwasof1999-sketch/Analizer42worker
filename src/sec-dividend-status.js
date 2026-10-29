/** Conservative common-stock cash-dividend evidence. Missing is never zero.
 * Only explicit issuer statements in primary SEC periodic reports can fill
 * gaps. Policy/intention statements, absent tags and buybacks prove nothing.
 * Existing reported values are retained; evidence is bounded by report dates.
 */
const finite = n => typeof n === 'number' && Number.isFinite(n);
const iso = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const fields = ['dividendsPaid', 'dividendsPerShare'];
const days = (a,b) => (Date.parse(b)-Date.parse(a))/864e5;
const text = html => html.replace(/<(script|style|ix:header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
  .replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;|&#xA0;/gi,' ')
  .replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

export function dividendStatements(html, report) {
  if (typeof html !== 'string' || html.length > 6_000_000 || !iso(report.end)) return [];
  const body = text(html), out = [];
  // An issuer's dividend-policy section must explicitly deny both declaration
  // and payment. Future plans alone do not prove a historical zero.
  const never = /(?:dividend policy|cash dividends|dividends)[\s:—-]{0,12}(?:we|the company) ha(?:ve|s) never declared or paid (?:any )?cash dividends on (?:our|its) (?:common stock|capital stock|ordinary shares)\b/gi;
  for (const m of body.matchAll(never)) out.push({kind:'never-declared-or-paid',through:report.end,fields:[...fields],excerpt:m[0]});
  // Exact, explicitly named reporting windows. Do not reinterpret a current
  // nonpayer policy, a suspension, or a preferred-stock statement as common DPS.
  const explicit = /(?:we|the company) (?:did not|has not|have not) (declare or pay|pay) (?:any )?cash dividends on (?:our|its) (?:common stock|capital stock|ordinary shares) during the (three|six|nine|twelve) months ended (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}),? (20\d\d)\b/gi;
  const months='January February March April May June July August September October November December'.split(' ');
  for (const m of body.matchAll(explicit)) {
    const end=`${m[5]}-${String(months.indexOf(m[3])+1).padStart(2,'0')}-${m[4].padStart(2,'0')}`;
    if (end !== report.end) continue;
    out.push({kind:'explicit-period-nonpayment',through:end,months:({three:3,six:6,nine:9,twelve:12})[m[2].toLowerCase()],fields:m[1].toLowerCase()==='pay'?['dividendsPaid']:[...fields],excerpt:m[0]});
  }
  return out;
}

export function applyDividendEvidence(rows, proofs=[], annual=false) {
  const ordered=[...rows].sort((a,b)=>a.fiscalPeriodEnd.localeCompare(b.fiscalPeriodEnd));
  return rows.map(row=>{
    const r={...row}, end=r.fiscalPeriodEnd;
    const previous=ordered.findLast(x=>x.fiscalPeriodEnd<end);
    // A preceding consecutive quarter gives the precise lower bound, including
    // 52/53-week calendars. Without it a period-limited claim cannot fill a gap.
    const start=previous && !annual && r.fiscalYear*4+r.fiscalQuarter===previous.fiscalYear*4+previous.fiscalQuarter+1
      ? new Date(Date.parse(previous.fiscalPeriodEnd)+864e5).toISOString().slice(0,10) : null;
    r.dividendEvidence={};
    for(const field of fields) {
      const value=r[field];
      if(finite(value) && value>=0) {
        r.dividendEvidence[field]={status:value===0?'confirmed-zero':'reported',source:'SEC numeric data'};
        continue;
      }
      // Invalid negative numbers are not replaced by a textual zero.
      if(finite(value)) { r[field]=null; r.dividendEvidence[field]={status:'unknown',reason:'Invalid negative dividend value'}; continue; }
      const proof=proofs.find(p=>{
        if(!p.fields.includes(field) || !iso(p.through) || end>p.through) return false;
        // A positive value anywhere in the claim's covered history contradicts
        // a 'never paid' claim; never use it to overwrite or fill around conflict.
        const inWindow=x=>x.fiscalPeriodEnd<=p.through && (!p.months || days(x.fiscalPeriodEnd,p.through)<p.months*31);
        if(rows.some(x=>inWindow(x) && fields.some(k=>finite(x[k])&&x[k]>0))) return false;
        if(p.kind==='never-declared-or-paid') return true;
        if(annual) return p.months===12 && end===p.through;
        // Require a full quarter within a conservative minimum window; a
        // partial window can never authorize a whole quarter's zero.
        const date=new Date(p.through+'T00:00:00Z');
        const lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
        if(date.getUTCDate()!==lastDay) return false;
        const lower=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-p.months+1,1)).toISOString().slice(0,10);
        return start && start>=lower && days(start,end)>=60;
      });
      if(proof) {
        r[field]=0;
        r.dividendEvidence[field]={status:'confirmed-zero',source:proof.source,accession:proof.accession,form:proof.form,reportEnd:proof.through,method:proof.kind};
      } else r.dividendEvidence[field]={status:'unknown',reason:'No explicit numeric value or sufficient period-specific SEC nonpayment evidence'};
    }
    return r;
  });
}

/** Read at most three recent primary filings; failures leave data unknown.
 * No persistent cache or one-off ticker allowlist. Report text is discarded.
 */
export async function verifyDividends(annual, quarterly, sub, cik, fetchDocument) {
  const recent=sub?.filings?.recent || {}, candidates=[];
  const rows=quarterly.length?quarterly:annual;
  const needs=rows.some(r=>fields.some(k=>!finite(r[k])));
  if(needs) for(let i=0;i<(recent.form?.length||0);i++) {
    const form=recent.form[i], end=recent.reportDate?.[i], accession=recent.accessionNumber?.[i], name=recent.primaryDocument?.[i];
    if(!['10-Q','10-K','10-Q/A','10-K/A','20-F','20-F/A','40-F','40-F/A'].includes(form) || !iso(end) ||
      !/^\d{10}-\d{2}-\d{6}$/.test(accession||'') || !/^[\w.-]+\.html?$/i.test(name||'')) continue;
    // Only the newest four quarters / latest annual year need fallback reads.
    if(!rows.slice(0,4).some(r=>r.fiscalPeriodEnd<=end && fields.some(k=>!finite(r[k])))) continue;
    candidates.push({form,end,accession,filingDocumentUrl:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-','')}/${name}`});
  }
  candidates.sort((a,b)=>b.end.localeCompare(a.end));
  const proofs=[], checks=[];
  for(const report of candidates.slice(0,3)) {
    try {
      const found=dividendStatements(await fetchDocument(report),report).map(p=>({...p,source:report.filingDocumentUrl,accession:report.accession,form:report.form}));
      proofs.push(...found); checks.push({accession:report.accession,status:found.length?'explicit-evidence':'no-sufficient-evidence'});
      if(found.some(p=>p.kind==='never-declared-or-paid' && p.through>=rows[0]?.fiscalPeriodEnd)) break;
    } catch { checks.push({accession:report.accession,status:'unavailable'}); }
  }
  const consistent=proofs.filter(p=>![...annual,...quarterly].some(r=>
    r.fiscalPeriodEnd<=p.through && (!p.months || days(r.fiscalPeriodEnd,p.through)<p.months*31) &&
    fields.some(k=>finite(r[k])&&r[k]>0)));
  const a=applyDividendEvidence(annual,consistent,true), q=applyDividendEvidence(quarterly,consistent);
  const evidence=list=>list.map(r=>({periodEnd:r.fiscalPeriodEnd,...r.dividendEvidence}));
  const strip=list=>list.map(({dividendEvidence,...row})=>row);
  // Keep financial row schemas numeric and in their original field order.
  return {annual:strip(a),quarterly:strip(q),evidence:{annual:evidence(a),quarterly:evidence(q)},checks};
}
