/** Recover the latest point-in-time common shares from its primary SEC filing.
 * Company Facts omits dimensional cover facts (for example, share classes).
 * Never substitute EPS weighted averages, diluted shares or market-cap estimates.
 */
const attr=(s,k)=>s.match(new RegExp('(?:^|\\s)'+k+'\\s*=\\s*["\x27]([^"\x27]*)["\x27]','i'))?.[1];
const content=(s,k)=>s.match(new RegExp('<(?:[\\w.-]+:)?'+k+'\\b[^>]*>([^<]*)<\\/(?:[\\w.-]+:)?'+k+'\\s*>','i'))?.[1]?.trim();
const iso=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&!Number.isNaN(Date.parse(s));
const days=(a,b)=>(Date.parse(b)-Date.parse(a))/864e5;

export function filingCoverShares(html,{cik,end,filed}) {
  if(typeof html!=='string'||html.length>6_000_000||!iso(end)||!iso(filed))return null;
  const contexts=new Map(),units=new Set(),groups=new Map();
  for(const m of html.matchAll(/<(?:[\w.-]+:)?context\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?context\s*>/gi)) {
    const id=attr(m[1],'id'),body=m[2],date=content(body,'instant');
    if(!id||!iso(date)||days(end,date)<-7||days(date,filed)<-1||
      String(Number(content(body,'identifier')))!==String(Number(cik)))continue;
    const members=[...body.matchAll(/<(?:[\w.-]+:)?explicitMember\b([^>]*)>([^<]*)<\/(?:[\w.-]+:)?explicitMember\s*>/gi)];
    const supported=!/typedMember\b|<(?:[\w.-]+:)?scenario\b/i.test(body)&&
      (members.length===0&&!/<(?:[\w.-]+:)?segment\b/i.test(body)||
       members.length===1&&attr(members[0][1],'dimension')==='us-gaap:StatementClassOfStockAxis');
    contexts.set(id,{date,key:members.length?members[0][2].trim():'TOTAL',supported});
  }
  for(const m of html.matchAll(/<(?:[\w.-]+:)?unit\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?unit\s*>/gi)) {
    const measures=[...m[2].matchAll(/<(?:[\w.-]+:)?measure\b[^>]*>([^<]*)<\/(?:[\w.-]+:)?measure\s*>/gi)];
    if(measures.length===1&&/^(?:xbrli:)?shares$/.test(measures[0][1].trim())&& !/<(?:[\w.-]+:)?divide\b/i.test(m[2]))units.add(attr(m[1],'id'));
  }
  for(const m of html.matchAll(/<ix:nonfraction\b([^>]*)>([\s\S]*?)<\/ix:nonfraction\s*>/gi)) {
    if(attr(m[1],'name')!=='dei:EntityCommonStockSharesOutstanding')continue;
    const c=contexts.get(attr(m[1],'contextref'));if(!c)continue;
    if(!groups.has(c.date))groups.set(c.date,{values:new Map(),bad:false});
    const group=groups.get(c.date),raw=m[2].replace(/<[^>]*>/g,'').replace(/[,\s]|&#160;|&nbsp;/g,''),scale=attr(m[1],'scale')??'0',format=attr(m[1],'format');
    const value=Number(raw)*10**Number(scale);
    if(!c.supported||!units.has(attr(m[1],'unitref'))||/^(?:true|1)$/i.test(attr(m[1],'xsi:nil')||'')||
      attr(m[1],'sign')==='-'||!/^\d+(?:\.\d+)?$/.test(raw)||! /^-?\d+$/.test(scale)||
      format&&!/:(?:num-dot-decimal|numcommadot)$/i.test(format)||!Number.isSafeInteger(value)||value<=0) {group.bad=true;continue;}
    if(group.values.has(c.key)&&group.values.get(c.key)!==value)group.bad=true;
    group.values.set(c.key,value);
  }
  const date=[...groups.keys()].sort().at(-1);if(!date)return null;
  const g=groups.get(date);if(g.bad||!g.values.size)return null;
  const total=g.values.get('TOTAL'),classes=[...g.values].filter(([k])=>k!=='TOTAL');
  const sum=classes.reduce((v,[,n])=>v+n,0);
  if(total!==undefined&&classes.length&&total!==sum)return null;
  const value=total??sum;
  return Number.isSafeInteger(value)&&value>0?{value,asOf:date,classes:classes.length}:null;
}

export async function recoverLatestCoverShares(rows,sub,cik,readDocument) {
  const output=rows.map(r=>({...r})),row=output[0];
  if(!row||Number.isFinite(row.sharesOutstanding)&&row.sharesOutstanding>0)return {rows:output,status:'not-needed'};
  const rec=sub?.filings?.recent;
  if(!rec?.form)return {rows:output,status:'unavailable'};
  const candidates=rec.form.map((form,i)=>({form,end:rec.reportDate?.[i],filed:rec.filingDate?.[i],accession:rec.accessionNumber?.[i],document:rec.primaryDocument?.[i]}))
    .filter(f=>/^(10-Q|10-K)(\/A)?$/.test(f.form)&&f.end===row.fiscalPeriodEnd&&f.filed===row.secFilingDate&&
      /^\d{10}-\d{2}-\d{6}$/.test(f.accession||'')&&/^[\w.-]+\.html?$/.test(f.document||''));
  if(candidates.length!==1)return {rows:output,status:'unavailable'};
  const f=candidates[0],filingDocumentUrl=`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accession.replace(/-/g,'')}/${f.document}`;
  try {
    const proof=filingCoverShares(await readDocument({filingDocumentUrl}),{...f,cik});
    if(!proof)return {rows:output,status:'unsupported',filingDocumentUrl};
    row.sharesOutstanding=proof.value;row.sharesOutstandingAsOf=proof.asOf;
    return {rows:output,status:'recovered',...proof,filingDocumentUrl};
  } catch {return {rows:output,status:'unavailable',filingDocumentUrl};}
}
