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
        plausible(yr.netIncome/source.val,e.val))
      ).map(e=>({source,annualEPS:e.val}));
    });
    if(!compatible.length)continue;
    const ends=first.map(q=>q.fiscalPeriodEnd);
    if(!(ends[0]<ends[1]&&ends[1]<ends[2]&&
      ends[2]<q4.fiscalPeriodEnd))continue;
    let chosen=null;
    for(const {source,annualEPS} of compatible){
      if(!(source.start<ends[0]))continue;
      const qdays=[
        days(source.start,ends[0])+1,days(ends[0],ends[1]),
        days(ends[1],ends[2]),days(ends[2],q4.fiscalPeriodEnd)
      ];
      const allDays=days(source.start,q4.fiscalPeriodEnd)+1;
      if(qdays.some(d=>d<70||d>105)||allDays<340||allDays>375||
        Math.abs(qdays.reduce((a,b)=>a+b,0)-allDays)>.01)continue;
      // Recover period-specific SEC basic EPS AND denominator from the same
      // 10-Q accession. This avoids using a 2024-restated 2023 Q3 together
      // with older pre-split quarters to estimate a pre-split Q4.
      const originalQuarters=first.map(q=>{
        const matches=annualEPSFacts.filter(e=>
          e.end===q.fiscalPeriodEnd && e.start && e.accn &&
          e.form==='10-Q' && finite(e.val) &&
          days(e.start,e.end)>=60 && days(e.start,e.end)<=110 &&
          (!source.filed||!e.filed||e.filed<=source.filed)
        ).flatMap(e=>basicShareFacts.filter(sh=>
          sh.accn===e.accn && sh.start===e.start && sh.end===e.end &&
          sh.form==='10-Q' && finite(sh.val) && sh.val>0 &&
          Math.abs(sh.val/source.val-1)<=.25 &&
          Math.abs(e.val*sh.val-q.netIncome)<=
            Math.max(1,Math.abs(q.netIncome)*.10)
        ).map(sh=>({eps:e.val,shares:sh.val,filed:e.filed||''})));
        matches.sort((x,y)=>x.filed.localeCompare(y.filed));
        return matches[0]||null;
      });
      const provenQuarters=originalQuarters.every(Boolean);
      if(!provenQuarters && !first.every(q=>
        finite(q.netIncome)&&finite(q.basicEPS)&&finite(q.basicShares)&&
        q.basicShares>0&&plausible(q.netIncome/q.basicShares,q.basicEPS)&&
        Math.abs(q.basicShares/source.val-1)<=.25))continue;
      const quarterShares=provenQuarters
        ? originalQuarters.map(q=>q.shares)
        : first.map(q=>q.basicShares);
      const derivedShares=(source.val*allDays-
        quarterShares.reduce((sum,shares,i)=>sum+shares*qdays[i],0))/qdays[3];
      if(!finite(derivedShares)||derivedShares<=0||
        Math.abs(derivedShares/source.val-1)>.25||
        Math.abs(derivedShares/quarterShares[2]-1)>.25)continue;
      // The annual SEC basic EPS times annual weighted basic shares reflects
      // earnings available to COMMON stockholders. Gross net income can be
      // higher when a preferred dividend is due (as for AVGO in FY2021).
      const q4Common=provenQuarters
        ? annualEPS*source.val-
          originalQuarters.reduce((sum,q)=>sum+q.eps*q.shares,0)
        : q4.netIncome;
      if(!finite(q4Common)||Math.abs(q4Common-q4.netIncome)>
        Math.max(1,Math.abs(q4.netIncome)*.10))continue;
      const estimate=cents(q4Common/derivedShares);
      if(!finite(estimate)||!plausible(
        first.reduce((sum,q,i)=>sum+(
          provenQuarters?originalQuarters[i].eps:q.basicEPS),estimate),
        annualEPS))continue;
      chosen={source,annualEPS,estimate,method:provenQuarters?'SEC-basic-EPS-weighted-shares-common-earnings':'SEC-net-income-weighted-shares'};
      break;
    }
    if(!chosen)continue;
    q4.basicEPS=chosen.estimate;
    findings.push({fiscalYear:q4.fiscalYear,
      fiscalPeriodEnd:q4.fiscalPeriodEnd,basicEPS:chosen.estimate,
      sourceAnnualAccession:chosen.source.accn||null,
      sourceAnnualReportedBasicEPS:chosen.annualEPS,
      estimationMethod:chosen.method,
      status:'estimated-from-SEC-reported-basic-shares-and-net-income',
      explicitlyReported:false});
  }
  return {estimatedCount:findings.length,findings,
    limitation:'Q4 basic EPS estimates are not separately reported EPS. Keep evidence status visible; do not present them as exact SEC-reported values.'};
}
