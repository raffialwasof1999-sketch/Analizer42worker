/**
 * Successor issuers. A holding-company reorganization moves the ticker to a
 * new SEC registrant whose Company Facts start at the reorganization: on
 * 2026-07-01 ExxonMobil Holdings Corp (CIK 2115436) replaced Exxon Mobil
 * Corporation (CIK 34088) as XOM, one share for one, leaving the new CIK
 * with two quarters of data and every refresh failing.
 *
 * The successor's first reports are still filed under the predecessor's
 * EDGAR filer ID, so their accession numbers start with its CIK. When the
 * successor's annual history is short, the most frequent foreign accession
 * prefix in its 10-Q/10-K facts is a candidate. It is accepted only if its
 * own Company Facts report identical values for the same periods, and its
 * history is then merged in; the successor's facts keep precedence.
 */
const ANNUAL_TAGS=['Revenues','RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenuesNetOfInterestExpense','NetIncomeLoss','ProfitLoss'];
// Filing agents whose IDs prefix many issuers' accessions; never issuers.
const FILING_AGENTS=new Set(['0001193125','0000950170','0001628280','0000950103',
  '0001104659','0001140361','0000950123','0001213900','0001558370','0001437749',
  '0001062993','0000950142','0000950109','0001047469','0000912057','0001145443',
  '0001564590','0001477932','0000930413','0001171843','0001013762','0001144204']);
const days=(a,b)=>(Date.parse(b)-Date.parse(a))/864e5;

function* entries(facts,taxonomy='us-gaap'){
  for(const [tag,concept] of Object.entries(facts?.facts?.[taxonomy]||{}))
    for(const [unit,list] of Object.entries(concept?.units||{}))
      for(const f of list||[]) yield {tag,unit,f};
}

export function annualYears(facts){
  const ends=new Set();
  for(const {tag,f} of entries(facts))
    if(ANNUAL_TAGS.includes(tag)&&/^10-K/.test(f.form||'')&&f.start&&
      days(f.start,f.end)>=330&&days(f.start,f.end)<=385)ends.add(f.end);
  return ends.size;
}

/** Most frequent foreign, non-agent CIK prefix among periodic-report facts. */
export function predecessorCandidate(facts,cik,minHistory=10){
  if(annualYears(facts)>=minHistory)return null;
  const own=String(cik).padStart(10,'0'), counts=new Map();
  for(const {f} of entries(facts)){
    if(!/^10-[KQ]/.test(f.form||''))continue;
    const prefix=String(f.accn||'').slice(0,10);
    if(!/^\d{10}$/.test(prefix)||prefix===own||FILING_AGENTS.has(prefix))continue;
    counts.set(prefix,(counts.get(prefix)||0)+1);
  }
  const best=[...counts].sort((a,b)=>b[1]-a[1])[0];
  return best&&best[1]>=3?best[0]:null;
}

/** Identical tag, unit, period and value reported by both registrants. */
export function sharedFacts(a,b){
  const seen=new Set();
  for(const {tag,unit,f} of entries(b))
    if(ANNUAL_TAGS.includes(tag)||/^EarningsPerShare/.test(tag))
      seen.add([tag,unit,f.start||'',f.end,f.val].join('|'));
  let count=0;
  for(const {tag,unit,f} of entries(a))
    if(seen.has([tag,unit,f.start||'',f.end,f.val].join('|')))count++;
  return count;
}

/** Predecessor history first, then the successor's own facts. */
export function mergeCompanyFacts(successor,predecessor){
  const merged={...successor,facts:{}};
  for(const taxonomy of new Set([...Object.keys(predecessor.facts||{}),...Object.keys(successor.facts||{})])){
    const out={};
    for(const source of [predecessor,successor])
      for(const [tag,concept] of Object.entries(source.facts?.[taxonomy]||{})){
        out[tag]??={...concept,units:{}};
        for(const [unit,list] of Object.entries(concept.units||{}))
          out[tag].units[unit]=[...(out[tag].units[unit]||[]),...list];
      }
    merged.facts[taxonomy]=out;
  }
  return merged;
}

/** Combine filing lists, tagging each row with the CIK that filed it. */
export function mergeSubmissions(successor,predecessor,predecessorCik){
  const tag=(rec,cik)=>({...rec,cik:(rec?.form||[]).map(()=>cik)});
  const own=Number(successor.cik), prior=Number(predecessorCik);
  const a=tag(successor.filings?.recent||{},own), b=tag(predecessor.filings?.recent||{},prior);
  const recent={};
  for(const key of new Set([...Object.keys(a),...Object.keys(b)]))
    recent[key]=[...(a[key]||[]),...(b[key]||[])];
  return {...successor,filings:{recent,
    files:[...(successor.filings?.files||[]),...(predecessor.filings?.files||[])]},
    predecessorCik:String(predecessorCik)};
}

/**
 * Fetch, verify and merge a predecessor when one exists. Returns the inputs
 * unchanged (with a reason) when none qualifies.
 */
export async function withPredecessor(facts,sub,cik,fetchJSON,base='https://data.sec.gov'){
  const candidate=predecessorCandidate(facts,cik);
  if(!candidate)return {facts,sub,predecessor:null};
  let prior;
  try{prior=await fetchJSON(`${base}/api/xbrl/companyfacts/CIK${candidate}.json`);}
  catch(e){return {facts,sub,predecessor:{cik:candidate,status:'unavailable',error:String(e.message).slice(0,120)}};}
  const shared=sharedFacts(facts,prior);
  if(shared<3||annualYears(prior)<=annualYears(facts))
    return {facts,sub,predecessor:{cik:candidate,status:'not-verified',sharedFacts:shared}};
  let priorSub={filings:{recent:{},files:[]}};
  try{priorSub=await fetchJSON(`${base}/submissions/CIK${candidate}.json`);}catch{}
  return {facts:mergeCompanyFacts(facts,prior),sub:mergeSubmissions(sub,priorSub,candidate),
    predecessor:{cik:candidate,name:prior.entityName||null,status:'merged',sharedFacts:shared,
      annualYears:annualYears(prior)}};
}
