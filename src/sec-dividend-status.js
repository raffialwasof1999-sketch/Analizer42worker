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

const attr=(s,name)=>s.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*["\x27]([^"\x27]*)["\x27]','i'))?.[1];
const content=(s,name)=>s.match(new RegExp('<(?:[\\w.-]+:)?'+name+'\\b[^>]*>([^<]*)<\\/(?:[\\w.-]+:)?'+name+'\\s*>','i'))?.[1]?.trim();
const zeroTags={
  'us-gaap:PaymentsOfDividends':'dividendsPaid',
  'us-gaap:PaymentsOfDividendsCommonStock':'dividendsPaid',
  'us-gaap:PaymentsOfOrdinaryDividends':'dividendsPaid',
  'us-gaap:CommonStockDividendsPerShareDeclared':'dividendsPerShare',
  'us-gaap:CommonStockDividendsPerShareCashPaid':'dividendsPerShare',
  'ifrs-full:DividendsPaid':'dividendsPaid',
  'ifrs-full:DividendsPaidClassifiedAsFinancingActivities':'dividendsPaid',
  'ifrs-full:DividendsPaidToEquityHoldersOfParentClassifiedAsFinancingActivities':'dividendsPaid',
  'ifrs-full:DividendsPaidClassifiedAsOperatingActivities':'dividendsPaid',
  'ifrs-full:DividendsRecognisedAsDistributionsToOwnersPerShare':'dividendsPerShare'
};

/** Explicit inline-XBRL table zeros only: exact issuer, unit and duration.
 * A missing row, empty cell, preferred-only dimension or nil value is unknown.
 * Supported tagged facts do not require a human-readable table layout guess.
 */
export function dividendTableZeros(html,report,cik) {
  if(typeof html!=='string'||html.length>6_000_000||!iso(report.end)) return [];
  const contexts=new Map(),units=new Map();
  for(const m of html.matchAll(/<(?:[\w.-]+:)?context\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?context\s*>/gi)) {
    const id=attr(m[1],'id'),body=m[2],from=content(body,'startDate'),through=content(body,'endDate');
    if(!id||!iso(from)||!iso(through)||from>through||through>report.end||
      /<(?:[\w.-]+:)?(?:segment|scenario)\b|(?:explicit|typed)Member\b/i.test(body)||
      String(Number(content(body,'identifier')))!==String(Number(cik))) continue;
    contexts.set(id,{from,through});
  }
  for(const m of html.matchAll(/<(?:[\w.-]+:)?unit\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?unit\s*>/gi)) {
    const id=attr(m[1],'id'),body=m[2];
    const measures=[...body.matchAll(/<(?:[\w.-]+:)?measure\b[^>]*>([^<]*)<\/(?:[\w.-]+:)?measure\s*>/gi)].map(x=>x[1].trim());
    if(measures.length===1&&/^iso4217:[A-Z]{3}$/.test(measures[0]))units.set(id,'dividendsPaid');
    else if(measures.length===2&&/^iso4217:[A-Z]{3}$/.test(measures[0])&&/^(?:xbrli:)?shares$/.test(measures[1])&&/<(?:[\w.-]+:)?divide\b/i.test(body))units.set(id,'dividendsPerShare');
  }
  const facts=[];
  for(const m of html.matchAll(/<ix:nonfraction\b([^>]*)>([\s\S]*?)<\/ix:nonfraction\s*>/gi)) {
    const tag=attr(m[1],'name'),field=zeroTags[tag],period=contexts.get(attr(m[1],'contextref'));
    if(!field||!period||units.get(attr(m[1],'unitref'))!==field||/^(?:true|1)$/i.test(attr(m[1],'xsi:nil')||''))continue;
    const raw=text(m[2]).replace(/[,$\s]/g,''),format=attr(m[1],'format')||'';
    const value=/^\d+(?:\.\d+)?$/.test(raw)?Number(raw)
      : /^(?:-|—|–)$/.test(raw)&&/:(?:zerodash|numdash|fixed-zero)$/i.test(format)?0:null;
    if(value===null)continue;
    facts.push({field,tag,...period,value});
  }
  return facts.filter(f=>f.value===0&&!facts.some(g=>g.field===f.field&&g.value>0&&g.from<=f.through&&g.through>=f.from))
    .map(f=>({kind:'explicit-inline-zero',from:f.from,through:f.through,fields:[f.field],tag:f.tag}));
}

export function applyDividendEvidence(rows, proofs=[], annual=false) {
  const ordered=[...rows].sort((a,b)=>a.fiscalPeriodEnd.localeCompare(b.fiscalPeriodEnd));
  return rows.map(row=>{
    const r={...row}, end=r.fiscalPeriodEnd;
    const previous=ordered.findLast(x=>x.fiscalPeriodEnd<end);
    // A preceding consecutive quarter gives the precise lower bound, including
    // 52/53-week calendars. Without it a period-limited claim cannot fill a gap.
    const consecutive=previous && (annual?r.fiscalYear===previous.fiscalYear+1:r.fiscalYear*4+r.fiscalQuarter===previous.fiscalYear*4+previous.fiscalQuarter+1);
    const start=consecutive
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
        const inWindow=x=>x.fiscalPeriodEnd<=p.through && (!p.from||x.fiscalPeriodEnd>=p.from) && (!p.months || days(x.fiscalPeriodEnd,p.through)<p.months*31);
        if(rows.some(x=>inWindow(x) && p.fields.some(k=>finite(x[k])&&x[k]>0))) return false;
        if(p.kind==='never-declared-or-paid') return true;
        if(p.kind==='explicit-inline-zero') return start && p.from<=start && days(start,end)>=(annual?330:60);
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
        r.dividendEvidence[field]={status:'confirmed-zero',source:proof.source,accession:proof.accession,form:proof.form,reportEnd:proof.through,periodStart:proof.from||null,tag:proof.tag||null,method:proof.kind};
      } else r.dividendEvidence[field]={status:'unknown',reason:'No explicit numeric value or sufficient period-specific SEC nonpayment evidence'};
    }
    return r;
  });
}

/** Select reports for the latest four quarters plus the most recent annual
 * report, rather than the first N filings. At most five distinct reports;
 * amendments share a period with their original. Failures remain unknown.
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
    candidates.push({form,end,accession,filed:recent.filingDate?.[i]||'',filingDocumentUrl:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-','')}/${name}`});
  }
  candidates.sort((a,b)=>b.end.localeCompare(a.end)||b.filed.localeCompare(a.filed));
  const annualReport=candidates.find(r=>/^(?:10-K|20-F|40-F)(?:\/A)?$/.test(r.form)&&r.end<=rows[0]?.fiscalPeriodEnd);
  const targetEnds=new Set(rows.slice(0,quarterly.length?4:1).map(r=>r.fiscalPeriodEnd));
  const byPeriod=new Map();
  if(annualReport)byPeriod.set(annualReport.end,annualReport);
  for(const r of candidates)if(targetEnds.has(r.end)&&!byPeriod.has(r.end))byPeriod.set(r.end,r);
  const proofs=[], checks=[];
  for(const report of [...byPeriod.values()].slice(0,5)) {
    try {
      const html=await fetchDocument(report);
      const found=[...dividendStatements(html,report),...dividendTableZeros(html,report,cik)].map(p=>({...p,source:report.filingDocumentUrl,accession:report.accession,form:report.form}));
      proofs.push(...found); checks.push({accession:report.accession,form:report.form,reportEnd:report.end,source:report.filingDocumentUrl,status:found.length?'explicit-evidence':'no-sufficient-evidence',evidence:found.map(p=>({method:p.kind,from:p.from||null,through:p.through,fields:p.fields}))});
      if(found.some(p=>p.kind==='never-declared-or-paid' && p.through>=rows[0]?.fiscalPeriodEnd)) break;
    } catch(error) { checks.push({accession:report.accession,form:report.form,reportEnd:report.end,source:report.filingDocumentUrl,status:'unavailable',reason:String(error?.message||error).slice(0,160)}); }
  }
  const consistent=proofs.filter(p=>![...annual,...quarterly].some(r=>
    r.fiscalPeriodEnd<=p.through && (!p.from||r.fiscalPeriodEnd>=p.from) && (!p.months || days(r.fiscalPeriodEnd,p.through)<p.months*31) &&
    p.fields.some(k=>finite(r[k])&&r[k]>0)));
  const a=applyDividendEvidence(annual,consistent,true), q=applyDividendEvidence(quarterly,consistent);
  const evidence=list=>list.map(r=>({periodEnd:r.fiscalPeriodEnd,...r.dividendEvidence}));
  const strip=list=>list.map(({dividendEvidence,...row})=>row);
  // Keep financial row schemas numeric and in their original field order.
  return {annual:strip(a),quarterly:strip(q),evidence:{annual:evidence(a),quarterly:evidence(q)},checks};
}
