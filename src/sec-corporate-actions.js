/**
 * SEC-only corporate-action candidate processing.
 * A narrative mention is evidence, not a verified event. In particular,
 * execution date and first split-adjusted TRADING date may differ.
 */
const NUMBER_WORDS = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,
  eight:8,nine:9,ten:10,twenty:20,thirty:30,forty:40,fifty:50,
  hundred:100};
const NUM = '(?:\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred)';
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const dateRx = new RegExp('\\b('+MONTH+')\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b','gi');
const months = {january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11};

export function cleanFilingText(html) {
  if (typeof html !== 'string') throw Error('Filing text required');
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&(?:nbsp|#160);/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ').trim();
}

const asNumber = s => Number.isFinite(Number(s)) ? Number(s) :
  NUMBER_WORDS[String(s).toLowerCase()] ?? null;
function getDates(text) {
  const dates=[];
  for (const m of text.matchAll(dateRx)) {
    const y=Number(m[3]), mon=months[m[1].toLowerCase()], d=Number(m[2]);
    const date = new Date(Date.UTC(y,mon,d));
    if (date.getUTCFullYear()===y && date.getUTCMonth()===mon &&
        date.getUTCDate()===d) dates.push({date:date.toISOString().slice(0,10),offset:m.index});
  }
  return dates;
}

/** One entry per textual mention; proposed and conditional events remain unverified. */
export function extractSplitMentions(filingText,{accession,filed,url}={}) {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession||'')) throw Error('SEC accession required');
  if (typeof filingText !== 'string' || filingText.length>6_000_000) throw Error('Filing exceeds safe parse size');
  const text=cleanFilingText(filingText);
  const patterns=[
    new RegExp('\\b('+NUM+')\\s*(?:-\\s*for\\s*-|for\\s+)\\s*('+NUM+')\\s+(?:(?:forward|reverse)\\s+)?stock\\s+split\\b','gi'),
    new RegExp('\\b(?:forward|reverse)\\s+stock\\s+split\\s+(?:of|at|on a basis of)\\s+('+NUM+')\\s*(?:-\\s*for\\s*-|for\\s+)\\s*('+NUM+')\\b','gi')
  ];
  const found=[],seen=new Set();
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const numerator=asNumber(m[1]),denominator=asNumber(m[2]);
      if (!(numerator>0 && denominator>0) || numerator===denominator) continue;
      const prefix=text.slice(Math.max(0,m.index-190),m.index);
      const suffix=text.slice(m.index+m[0].length,Math.min(text.length,m.index+m[0].length+500));
      const near=prefix+m[0]+suffix;
      const key=m.index+':'+numerator+':'+denominator;
      if (seen.has(key)) continue;
      seen.add(key);
      const caution=/\b(?:propos(?:e|ed|al)|intend(?:s|ed)?|subject to|if approved|may effect|contemplate|consider(?:ed|ing)?|hypothetical|pending approval|plan(?:s|ned)? to)\b/i.test(
        text.slice(Math.max(0,m.index-95),Math.min(text.length,m.index+m[0].length+100))
      );
      const executed=/\b(?:effected|completed|implemented|was effective|became effective|occurred|has been completed)\b/i.test(near);
      const retroactivelyRestated=/\b(?:retroactively adjusted|retrospectively adjusted|retroactively restated|retrospectively restated)\b/i.test(suffix.slice(0,240));
      const dates=getDates(near);
      found.push({
        accession,filed:filed||null,url:url||null,
        ratio:numerator/denominator,
        ratioText:m[0],narrative:near.slice(0,740),
        dates:dates.map(x=>x.date),
        proposedOrConditional:caution,
        executedLanguage:executed && !caution,
        retrospectiveEPSLanguage:retroactivelyRestated,
        verified:false
      });
    }
  }
  return found.slice(0,100);
}

/** The same split can be mentioned in many unrelated reports.
 * Corroboration is only evidence, not proof of exact split date or EPS basis.
 */
export function summarizeSplitMentions(mentions) {
  const groups=new Map();
  for (const mention of mentions || []) {
    if (!(Number.isFinite(mention.ratio) && mention.ratio>0)) continue;
    const dates=[...new Set(mention.dates||[])];
    for (const date of dates) {
      const key=date+'|'+mention.ratio;
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(mention);
    }
  }
  return [...groups].map(([key,items])=>{
    const [date,ratio]=key.split('|');
    const filings=[...new Set(items.map(x=>x.accession))];
    const actual=items.filter(x=>x.executedLanguage && !x.proposedOrConditional);
    return {
      candidateDate:date,sharesAfterPerBefore:Number(ratio),
      independentFilings:filings.length,
      executedMentions:actual.length,
      accessions:filings,
      confirmed:false,
      status:filings.length>=2 && actual.length>=1
        ? 'corroborated-narrative-needs-date-and-basis-review'
        : 'insufficient-independent-evidence'
    };
  }).sort((a,b)=>a.candidateDate.localeCompare(b.candidateDate));
}

/** Select candidate filings across archived submissions without assuming all filings mention splits. */
export function selectSplitFilings(candidates,maxDocuments=30) {
  const cap=Math.max(1,Math.min(50,Math.trunc(maxDocuments)||30));
  const unique=[...new Map((candidates||[]).filter(x=>x?.filingDocumentUrl && x.accession)
    .map(x=>[x.accession,x])).values()];
  const sorted=unique.sort((a,b)=>b.filed.localeCompare(a.filed));
  const result=[];
  const seen=new Set();
  const append=x=>{
    if (!x || seen.has(x.accession) || result.length>=cap) return;
    seen.add(x.accession);result.push(x);
  };
  // Strongest machine-readable hint: ratio tag linked to this filing.
  sorted.filter(x=>x.splitRatioFacts?.length).forEach(append);
  // One annual statement per year provides retrospective stock-split notes.
  const years=new Set();
  for(const x of sorted){
    if (!['10-K','10-K/A'].includes(x.form)) continue;
    const year=x.reportDate?.slice(0,4)||x.filed.slice(0,4);
    if (years.has(year)) continue;
    years.add(year); append(x);
  }
  // Split amendments and miscellaneous 8-K disclosures can carry effective dates.
  sorted.filter(x=>x.form?.startsWith('8-K') &&
    /(?:^|[^0-9])5\.03(?:$|[^0-9])/.test(x.items||'')).forEach(append);
  sorted.filter(x=>x.form?.startsWith('8-K') &&
    /(?:^|[^0-9])8\.01(?:$|[^0-9])/.test(x.items||'')).forEach(append);
  return result;
}

/** Bounded sequential-in-batches document inspection. Skips blocked and oversize SEC filings. */
export async function inspectSplitFilingBatch(candidates,fetchText,{maxDocuments=30}={}) {
  const selected=selectSplitFilings(candidates,maxDocuments);
  const documents=[],failures=[];
  for(let i=0;i<selected.length;i+=2){
    const chunk=selected.slice(i,i+2);
    const found=await Promise.all(chunk.map(async filing=>{
      try{
        const text=await fetchText(filing);
        const mentions=extractSplitMentions(text,{
          accession:filing.accession,filed:filing.filed,url:filing.filingDocumentUrl
        });
        return {accession:filing.accession,url:filing.filingDocumentUrl,mentions:mentions.map(m=>({...m,form:filing.form}))};
      }catch(error){
        return {accession:filing.accession,error:String(error?.message||error).slice(0,140)};
      }
    }));
    for(const r of found) {
      if(r.error) failures.push(r); else documents.push(r);
    }
  }
  const mentions=documents.flatMap(d=>d.mentions);
  return {
    documentsAttempted:selected.length,documentsRead:documents.length,
    documentsWithSplitMentions:documents.filter(d=>d.mentions.length).length,
    failedDocuments:failures,mentions:mentions.slice(0,200),
    summaries:summarizeSplitMentions(mentions),
    verifiedEvents:verifiedCompletedSplits(mentions),
    status:failures.length ? 'partial-evidence' : 'scanned-selected-filings',
    normalizationApplied:false
  };
}

/**
 * Narrow affirmative proof: an SEC report must say an action was completed
 * on an explicit date in the same clause as the ratio. An announcement,
 * record date, or projected split-adjusted trading date is NOT enough.
 * The retrospective-accounting note is separate evidence about that filing.
 */
export function verifiedCompletedSplits(mentions) {
  const events=new Map();
  const dt=MONTH+'\\s+\\d{1,2},?\\s+20\\d{2}';
  const leading=new RegExp('\\bOn\\s+('+dt+'),?\\s+(?:the\\s+)?(?:Company|Registrant|Issuer|we)\\s+(?:effected|completed|implemented|executed)\\s+(?:a|an)\\s*$','i');
  const trailing=new RegExp('^\\s+(?:(?:which|that)\\s+)?(?:was\\s+)?(?:effective|effected)\\s+(?:on|as\\s+of)\\s+('+dt+')','i');
  for(const mention of mentions||[]) {
    if (!mention?.executedLanguage || mention.proposedOrConditional ||
        !/^\d{10}-\d{2}-\d{6}$/.test(mention.accession||'') ||
        !(mention.ratio>0) || !mention.filed || !mention.narrative ||
        !mention.ratioText) continue;
    const index=mention.narrative.indexOf(mention.ratioText);
    if(index<0)continue;
    const prefix=mention.narrative.slice(Math.max(0,index-160),index);
    const suffix=mention.narrative.slice(index+mention.ratioText.length,index+mention.ratioText.length+100);
    const match=prefix.match(leading)||suffix.match(trailing);
    if (!match) continue;
    const dates=getDates(match[1]);
    if (dates.length!==1 || dates[0].date>mention.filed) continue;
    const effectiveDate=dates[0].date;
    const key=effectiveDate+'|'+mention.ratio;
    if(!events.has(key))events.set(key,{
      effectiveDate,sharesAfterPerBefore:mention.ratio,
      verified:true,confirmation:'explicit-completed-SEC-disclosure',
      secAccession:mention.accession,secAccessions:[],
      basisProofAccessions:[],basisThrough:effectiveDate
    });
    const event=events.get(key);
    if(!event.secAccessions.includes(mention.accession))event.secAccessions.push(mention.accession);
    if(mention.retrospectiveEPSLanguage &&
       !event.basisProofAccessions.includes(mention.accession)) {
      event.basisProofAccessions.push(mention.accession);
    }
  }
  return [...events.values()].sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate));
}
