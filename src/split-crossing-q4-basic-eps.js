/**
 * Reconstruct a missing fiscal Q4 basic EPS when an SEC-verified share split
 * crosses the fiscal year. This uses reported annual and Q1-Q3 weighted basic
 * shares/EPS, not annual EPS minus quarterly EPS (which mixes denominators).
 * Output remains a derived, explicitly audited estimate.
 */
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const day=(a,b)=>(Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000;
const close=(a,b,p=.05)=>Math.abs(a-b)<=Math.max(.02,Math.abs(b)*p);
export function recoverSplitCrossingQ4BasicEPS(rows,rawQuarters,years,basicEPSFacts,basicShareFacts,graph){
  const results=rows.map(r=>({...r})),findings=[];
  if(!Array.isArray(rows)||!Array.isArray(rawQuarters)||!Array.isArray(years)||
    !Array.isArray(basicEPSFacts)||!Array.isArray(basicShareFacts)||
    !graph||graph.conflicts?.length||!graph.changedBasisEdges?.length)
    return {rows:results,findings};
  const verifiedRatios=graph.changedBasisEdges.flatMap(e=>
    [e.shareFactor,1/e.shareFactor]).filter(r=>finite(r)&&r>0);
  for(let i=0;i<results.length;i++){
    const q4=results[i];
    if(q4.fiscalQuarter!==4||finite(q4.basicEPS)||!finite(q4.netIncome))continue;
    const yr=years.find(r=>r.fiscalYear===q4.fiscalYear&&r.fiscalPeriodEnd===q4.fiscalPeriodEnd);
    const q=[1,2,3].map(n=>rawQuarters.find(r=>
      r.fiscalYear===q4.fiscalYear&&r.fiscalQuarter===n));
    const adjusted=q.map(r=>r&&results.find(x=>x.fiscalPeriodEnd===r.fiscalPeriodEnd));
    if(!yr||!finite(yr.basicEPS)||q.some(x=>!x)||adjusted.some(x=>!x))continue;
    const original=q.map((r,k)=>{
      const normalized=adjusted[k];
      if(!finite(r.basicEPS)||!finite(r.basicShares)||r.basicShares<=0||
        !finite(normalized.basicEPS)||Math.abs(normalized.basicEPS)<1e-8||
        !finite(r.netIncome))return null;
      const factor=r.basicEPS/normalized.basicEPS;
      if(!finite(factor)||factor<=0||
        !(close(factor,1,.05)||verifiedRatios.some(s=>close(factor,s,.05)))||
        !close(r.basicEPS*r.basicShares,r.netIncome,.05))return null;
      return {r,normalized,factor,shares:r.basicShares*factor,
        income:r.basicEPS*r.basicShares};
    });
    if(original.some(x=>!x))continue;
    const annualEPS=basicEPSFacts.filter(e=>
      e.end===q4.fiscalPeriodEnd&&['10-K','10-K/A'].includes(e.form)&&
      finite(e.val)&&finite(graph.shareFactors?.[e.accn])&&
      graph.shareFactors[e.accn]>0&&typeof e.start==='string'&&
      day(e.start,e.end)>=330&&day(e.start,e.end)<=385
    ).sort((a,b)=>String(a.filed).localeCompare(String(b.filed)));
    for(const e of annualEPS){
      const sh=basicShareFacts.find(s=>
        s.accn===e.accn&&s.start===e.start&&s.end===e.end&&
        finite(s.val)&&s.val>0);
      if(!sh)continue;
      const factor=graph.shareFactors[e.accn];
      const annualShares=sh.val*factor, annualValue=e.val/factor;
      if(!close(annualValue,yr.basicEPS,.025)||
        !close(annualValue*annualShares,yr.netIncome,.025))continue;
      const d=[day(e.start,q[0].fiscalPeriodEnd)+1,
        day(q[0].fiscalPeriodEnd,q[1].fiscalPeriodEnd),
        day(q[1].fiscalPeriodEnd,q[2].fiscalPeriodEnd),
        day(q[2].fiscalPeriodEnd,q4.fiscalPeriodEnd)];
      const total=day(e.start,q4.fiscalPeriodEnd)+1;
      if(d.some(n=>n<70||n>105)||total<340||total>375||
        Math.abs(d.reduce((a,b)=>a+b,0)-total)>.01)continue;
      const q4Shares=(annualShares*total-
        original.reduce((sum,x,k)=>sum+x.shares*d[k],0))/d[3];
      if(!finite(q4Shares)||q4Shares<=0||
        Math.abs(q4Shares/annualShares-1)>.25)continue;
      const q4Common=annualValue*annualShares-
        original.reduce((sum,x)=>sum+x.income,0);
      if(!close(q4Common,q4.netIncome,.04))continue;
      const value=Math.round((q4Common/q4Shares+Number.EPSILON)*100)/100;
      if(!finite(value)||!close(value,q4.netIncome/q4Shares,.04))continue;
      q4.basicEPS=value;
      findings.push({periodEnd:q4.fiscalPeriodEnd,estimatedBasicEPS:value,
        sourceAnnualAccession:e.accn,shareBasisFactor:factor,
        status:'estimated-from-SEC-weighted-basic-shares-and-net-income',
        explicitlyReported:false});
      break;
    }
  }
  return {rows:results,findings};
}
