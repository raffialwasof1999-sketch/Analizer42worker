/**
 * Guarded Q4 BASIC EPS estimate from SEC CompanyFacts.
 *
 * Preferred data remains a separately reported Q4 basic EPS observation.
 * Only estimate when the annual and the three known quarter EPS/weighted
 * basic-share observations agree, and the exact 10-K weighted-share period
 * can be apportioned across all four fiscal quarters.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const days=(start,end)=>(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
const plausible=(a,b)=>Math.abs(a-b)<=Math.max(0.035,Math.abs(b)*0.055);
const cents=x=>Math.round((x+Number.EPSILON)*100)/100;

export function deriveQ4BasicEPS(quarters,years,basicShareFacts,annualEPSFacts=[]){
  const findings=[];
  if(!Array.isArray(quarters)||!Array.isArray(years)||!Array.isArray(basicShareFacts)||!Array.isArray(annualEPSFacts))
    throw Error('Q4 basic EPS requires SEC observations');
  for(const q4 of quarters.filter(q=>q.fiscalQuarter===4)){
    if(finite(q4.basicEPS))continue;
    const yr=years.find(a=>a.fiscalYear===q4.fiscalYear &&
      a.fiscalPeriodEnd===q4.fiscalPeriodEnd);
    const first=[1,2,3].map(q=>quarters.find(r=>
      r.fiscalYear===q4.fiscalYear&&r.fiscalQuarter===q));
    if(!yr||!finite(yr.basicEPS)||!finite(yr.netIncome)||
      !finite(q4.netIncome)||first.some(q=>!q))continue;
    // A newer 10-K may restate older years onto a post-split share basis.
    // Select a SAME-ACCESSION annual basic EPS and basic-share pair whose
    // denominator agrees with the quarter's actual reporting basis.
    const sources=basicShareFacts.filter(f=>
      f.end===q4.fiscalPeriodEnd&&['10-K','10-K/A'].includes(f.form) &&
      typeof f.start==='string'&&finite(f.val)&&f.val>0&&
      days(f.start,f.end)>=330&&days(f.start,f.end)<=385
    ).sort((a,b)=>String(a.filed||'').localeCompare(String(b.filed||'')));
    const compatible=sources.flatMap(source=>{
      const annualValues=annualEPSFacts.length
        ? annualEPSFacts.filter(e=>e.accn===source.accn &&
            e.start===source.start && e.end===source.end &&
            ['10-K','10-K/A'].includes(e.form) && finite(e.val))
        : [{val:yr.basicEPS}]; // Compatibility for callers with no fact provenance.
      return annualValues.filter(e=>
        plausible(yr.netIncome/source.val,e.val) &&
        first.every(q=>finite(q.netIncome)&&finite(q.basicEPS)&&
          finite(q.basicShares)&&q.basicShares>0&&
          plausible(q.netIncome/q.basicShares,q.basicEPS)&&
          Math.abs(q.basicShares/source.val-1)<=.25)
      ).map(e=>({source,annualEPS:e.val}));
    });
    if(!compatible.length)continue;
    const ends=first.map(q=>q.fiscalPeriodEnd);
    if(!(source.start<ends[0]&&ends[0]<ends[1]&&
      ends[1]<ends[2]&&ends[2]<q4.fiscalPeriodEnd))continue;
    const qdays=[
      days(source.start,ends[0])+1,days(ends[0],ends[1]),
      days(ends[1],ends[2]),days(ends[2],q4.fiscalPeriodEnd)
    ];
    const allDays=days(source.start,q4.fiscalPeriodEnd)+1;
    if(qdays.some(d=>d<70||d>105)||allDays<340||allDays>375||
      Math.abs(qdays.reduce((a,b)=>a+b,0)-allDays)>.01)continue;
    let chosen=null;
    for(const {source,annualEPS} of compatible){
      const derivedShares=(source.val*allDays-
        first.reduce((sum,q,i)=>sum+q.basicShares*qdays[i],0))/qdays[3];
      if(!finite(derivedShares)||derivedShares<=0||
        Math.abs(derivedShares/source.val-1)>.25||
        Math.abs(derivedShares/first[2].basicShares-1)>.25)continue;
      const estimate=cents(q4.netIncome/derivedShares);
      if(!finite(estimate)||!plausible(first.reduce((s,q)=>s+q.basicEPS,estimate),annualEPS))
        continue;
      chosen={source,annualEPS,estimate};
      break;
    }
    if(!chosen)continue;
    q4.basicEPS=chosen.estimate;
    findings.push({fiscalYear:q4.fiscalYear,
      fiscalPeriodEnd:q4.fiscalPeriodEnd,basicEPS:chosen.estimate,
      sourceAnnualAccession:chosen.source.accn||null,
      sourceAnnualReportedBasicEPS:chosen.annualEPS,
      status:'estimated-from-SEC-reported-basic-shares-and-net-income',
      explicitlyReported:false});
  }
  return {estimatedCount:findings.length,findings,
    limitation:'Q4 basic EPS estimates are not separately reported EPS. Keep evidence status visible; do not present them as exact SEC-reported values.'};
}
