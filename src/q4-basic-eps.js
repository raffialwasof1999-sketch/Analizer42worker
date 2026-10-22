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
// Does EPS x weighted shares reproduce net income? Preferred dividends only
// LOWER common earnings (Wells Fargo's took 48% of 2020 net income and 94%
// in Q1 2020), so the product may fall short by up to `shortfall` x |net
// income| (60% for a full year, 100% for a quarter) but exceed it by no more
// than 30%. Cent-rounded EPS on billions of shares adds
// noise of half a cent per share (AMD's $0.01 Q4 2022 on 1.6bn shares).
// Same-accession pairs share one split basis, so this guards units only.
const earningsMatch=(eps,shares,income,shortfall)=>{
  const gap=eps*shares-income, noise=Math.max(1,shares*0.005);
  return gap<=Math.max(noise,Math.abs(income)*.30) && -gap<=Math.max(noise,Math.abs(income)*shortfall);
};

// The same method serves diluted EPS: pass {eps:'dilutedEPS',
// shares:'dilutedShares'} with diluted weighted-share and EPS SEC facts.
export function deriveQ4BasicEPS(quarters,years,basicShareFacts,annualEPSFacts=[],metric={eps:'basicEPS',shares:'basicShares'}){
  const EPS=metric.eps, SHARES=metric.shares;
  const findings=[],skipped=[];
  if(!Array.isArray(quarters)||!Array.isArray(years)||!Array.isArray(basicShareFacts)||!Array.isArray(annualEPSFacts))
    throw Error('Q4 basic EPS requires SEC observations');
  // Index facts once: banks file thousands of EPS and share facts, and
  // scanning every list inside the per-quarter loops exceeded Cloudflare's
  // per-request CPU allowance.
  const index=(list,key)=>{const m=new Map();for(const f of list){const k=key(f);if(!m.has(k))m.set(k,[]);m.get(k).push(f);}return m;};
  const fullKey=f=>f.accn+'|'+f.start+'|'+f.end;
  const sharesByEnd=index(basicShareFacts,f=>f.end), sharesByKey=index(basicShareFacts,fullKey);
  const epsByEnd=index(annualEPSFacts,f=>f.end), epsByKey=index(annualEPSFacts,fullKey);
  for(const q4 of quarters.filter(q=>q.fiscalQuarter===4)){
    if(finite(q4[EPS]))continue;
    const yr=years.find(a=>a.fiscalYear===q4.fiscalYear &&
      a.fiscalPeriodEnd===q4.fiscalPeriodEnd);
    const first=[1,2,3].map(q=>quarters.find(r=>
      r.fiscalYear===q4.fiscalYear&&r.fiscalQuarter===q));
    const skip=reason=>skipped.push({fiscalPeriodEnd:q4.fiscalPeriodEnd,metric:EPS,reason});
    if(!yr||!finite(yr[EPS])||!finite(yr.netIncome)||
      !finite(q4.netIncome)||first.some(q=>!q)){skip('missing annual EPS, net income or Q1-Q3 rows');continue;}
    // A newer 10-K may restate older years onto a post-split share basis.
    // Select a SAME-ACCESSION annual basic EPS and basic-share pair whose
    // denominator agrees with the quarter's actual reporting basis.
    const sources=(sharesByEnd.get(q4.fiscalPeriodEnd)||[]).filter(f=>
      ['10-K','10-K/A'].includes(f.form) &&
      typeof f.start==='string'&&finite(f.val)&&f.val>0&&
      days(f.start,f.end)>=330&&days(f.start,f.end)<=385
    ).sort((a,b)=>String(a.filed||'').localeCompare(String(b.filed||'')));
    const compatible=sources.flatMap(source=>{
      const annualValues=annualEPSFacts.length
        ? (epsByKey.get(fullKey(source))||[]).filter(e=>
            ['10-K','10-K/A'].includes(e.form) && finite(e.val))
        : [{val:yr[EPS]}]; // Compatibility for callers with no fact provenance.
      return annualValues.filter(e=>earningsMatch(e.val,source.val,yr.netIncome,.6)
      ).map(e=>({source,annualEPS:e.val}));
    });
    if(!compatible.length){skip('no 10-K EPS and share pair reconciles to annual net income');continue;}
    const ends=first.map(q=>q.fiscalPeriodEnd);
    if(!(ends[0]<ends[1]&&ends[1]<ends[2]&&
      ends[2]<q4.fiscalPeriodEnd)){skip('quarter ends out of order');continue;}
    let chosen=null,why='no candidate';
    for(const {source,annualEPS} of compatible){
      if(!(source.start<ends[0])){why='10-K period starts after Q1';continue;}
      const qdays=[
        days(source.start,ends[0])+1,days(ends[0],ends[1]),
        days(ends[1],ends[2]),days(ends[2],q4.fiscalPeriodEnd)
      ];
      const allDays=days(source.start,q4.fiscalPeriodEnd)+1;
      // 12/12/12/16-week fiscal calendars (Costco) put 112-119 days in Q4.
      if(qdays.some(d=>d<70||d>120)||allDays<340||allDays>375||
        Math.abs(qdays.reduce((a,b)=>a+b,0)-allDays)>.01){why='quarter lengths '+qdays.join('/');continue;}
      // Recover period-specific SEC basic EPS AND denominator from the same
      // 10-Q accession. This avoids using a 2024-restated 2023 Q3 together
      // with older pre-split quarters to estimate a pre-split Q4.
      const originalQuarters=first.map(q=>{
        const matches=(epsByEnd.get(q.fiscalPeriodEnd)||[]).filter(e=>
          e.start && e.accn &&
          e.form==='10-Q' && finite(e.val) &&
          days(e.start,e.end)>=60 && days(e.start,e.end)<=110 &&
          (!source.filed||!e.filed||e.filed<=source.filed)
        ).flatMap(e=>(sharesByKey.get(fullKey(e))||[]).filter(sh=>
          sh.form==='10-Q' && finite(sh.val) && sh.val>0 &&
          Math.abs(sh.val/source.val-1)<=.25 &&
          earningsMatch(e.val,sh.val,q.netIncome,1)
        ).map(sh=>({eps:e.val,shares:sh.val,filed:e.filed||''})));
        matches.sort((x,y)=>x.filed.localeCompare(y.filed));
        return matches[0]||null;
      });
      const provenQuarters=originalQuarters.every(Boolean);
      if(!provenQuarters && !first.every(q=>
        finite(q.netIncome)&&finite(q[EPS])&&finite(q[SHARES])&&
        q[SHARES]>0&&plausible(q.netIncome/q[SHARES],q[EPS])&&
        Math.abs(q[SHARES]/source.val-1)<=.25)){why='Q1-Q3 EPS, shares and income not proven';continue;}
      const quarterShares=provenQuarters
        ? originalQuarters.map(q=>q.shares)
        : first.map(q=>q[SHARES]);
      const derivedShares=(source.val*allDays-
        quarterShares.reduce((sum,shares,i)=>sum+shares*qdays[i],0))/qdays[3];
      if(!finite(derivedShares)||derivedShares<=0||
        Math.abs(derivedShares/source.val-1)>.25||
        Math.abs(derivedShares/quarterShares[2]-1)>.25){why='derived Q4 shares '+Math.round(derivedShares)+' vs Q3 '+quarterShares[2];continue;}
      // The annual SEC basic EPS times annual weighted basic shares reflects
      // earnings available to COMMON stockholders. Gross net income can be
      // higher when a preferred dividend is due (as for AVGO in FY2021).
      const q4Common=provenQuarters
        ? annualEPS*source.val-
          originalQuarters.reduce((sum,q)=>sum+q.eps*q.shares,0)
        : q4.netIncome;
      // Common earnings sit below GAAP net income by preferred dividends:
      // about 11% for Wells Fargo in Q4 2020. q4Common is built from four
      // cent-rounded EPS figures, so it also carries up to 2 cents per share
      // of rounding noise; within that noise, net income is the better base.
      const rounding=0.02*derivedShares;
      if(!finite(q4Common)||Math.abs(q4Common-q4.netIncome)>
        Math.max(1,Math.abs(q4.netIncome)*.20,rounding)){why='Q4 common earnings '+Math.round(q4Common)+' vs net income '+q4.netIncome;continue;}
      const base=Math.abs(q4Common-q4.netIncome)<=rounding?q4.netIncome:q4Common;
      const estimate=cents(base/derivedShares);
      // Quarterly EPS add up to the annual figure only while the share count
      // is steady; a mid-year issuance (AMD's Xilinx deal) moves the sum by
      // about EPS x the quarter's share deviation from the annual average.
      const quarterEPS=first.map((q,i)=>provenQuarters?originalQuarters[i].eps:q[EPS]);
      const drift=quarterEPS.reduce((sum,e,i)=>sum+Math.abs(e*(1-quarterShares[i]/source.val)),0)+
        Math.abs(estimate*(1-derivedShares/source.val));
      const total=quarterEPS.reduce((a,b)=>a+b,estimate);
      if(!finite(estimate)||Math.abs(total-annualEPS)>
        Math.max(0.035,Math.abs(annualEPS)*0.055)+drift){why='quarters sum to '+cents(total)+' vs annual '+annualEPS;continue;}
      chosen={source,annualEPS,estimate,derivedShares,method:provenQuarters?'SEC-basic-EPS-weighted-shares-common-earnings':'SEC-net-income-weighted-shares'};
      break;
    }
    if(!chosen){skip(why);continue;}
    q4[EPS]=chosen.estimate;
    // The 10-K gives only a full-year weighted count; the Q4 count derived
    // above (full year x days minus Q1-Q3) fills the quarter's own figure.
    if(!finite(q4[SHARES]))q4[SHARES]=Math.round(chosen.derivedShares);
    findings.push({fiscalYear:q4.fiscalYear,
      fiscalPeriodEnd:q4.fiscalPeriodEnd,[EPS]:chosen.estimate,metric:EPS,
      sourceAnnualAccession:chosen.source.accn||null,
      sourceAnnualReportedBasicEPS:chosen.annualEPS,sourceAnnualReportedEPS:chosen.annualEPS,
      estimationMethod:chosen.method,derivedWeightedShares:Math.round(chosen.derivedShares),
      status:'estimated-from-SEC-reported-basic-shares-and-net-income',
      explicitlyReported:false});
  }
  return {estimatedCount:findings.length,findings,skipped,
    limitation:'Q4 basic EPS estimates are not separately reported EPS. Keep evidence status visible; do not present them as exact SEC-reported values.'};
}
