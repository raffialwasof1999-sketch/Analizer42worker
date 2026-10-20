/**
 * Align quarterly basic EPS with the latest corroborated SEC annual share basis.
 * This is required when comparing older historical per-share EPS to split-
 * adjusted historical trading prices. Never silently mix split bases.
 *
 * Derived Q4 values use their stated 10-K weighted-basic-share accession.
 */
export function normalizeHistoricalBasicEPS(rows,graph,resolveQuarterly,estimatedQ4=[],resolveAnnualBasis=null){
  if(!Array.isArray(rows)||!graph||typeof resolveQuarterly!=='function')
    throw Error('Basic EPS normalization requires rows and SEC basis proof');
  const isNumeric=x=>typeof x==='number'&&Number.isFinite(x);
  const hasSplit=(graph.changedBasisEdges||[]).length>0;
  const findings=new Map(estimatedQ4.map(x=>[x.fiscalPeriodEnd,x]));
  const out=[],adjusted=[],unverified=[];
  for(const row of rows){
    const copy={...row};
    if(!hasSplit||!isNumeric(row.basicEPS)){out.push(copy);continue;}
    let accn=null;
    let f;
    const derived=findings.get(row.fiscalPeriodEnd);
    if(row.fiscalQuarter===4 && derived &&
      Math.abs(derived.basicEPS-row.basicEPS)<0.000001){
      accn=derived.sourceAnnualAccession;
      f=graph.shareFactors?.[accn];
    }else{
      const options=resolveQuarterly(row)||[];
      const matches=(Array.isArray(options)?options:[options]).filter(x=>
        x?.accn&&isNumeric(x.val)&&
        Math.abs(x.val-row.basicEPS)<=Math.max(1e-8,Math.abs(row.basicEPS)*1e-7)
      );
      const chosen=matches.find(x=>isNumeric(graph.shareFactors?.[x.accn]))||matches[0];
      accn=chosen?.accn||null;
      f=graph.shareFactors?.[accn];
    }
    // A 10-Q need not overlap any 10-K in CompanyFacts, so graph-only
    // matching leaves nearly all reported quarterly EPS unnecessarily blank.
    // SEC annual basic shares can bridge that gap when the filing's share
    // basis is graph-proven and the same quarter independently reconciles
    // EPS * weighted basic shares to reported earnings. A split-straddling
    // quarter produces a material share-count mismatch and is rejected.
    if(!isNumeric(f) && !derived && typeof resolveAnnualBasis==='function'){
      const proof=resolveAnnualBasis(row);
      if(proof && proof.annualAccession &&
        isNumeric(proof.annualShares) && proof.annualShares>0 &&
        isNumeric(proof.quarterShares) && proof.quarterShares>0 &&
        isNumeric(graph.shareFactors?.[proof.annualAccession]) &&
        Math.abs(proof.quarterShares/proof.annualShares-1)<=0.10 &&
        isNumeric(row.netIncome) &&
        Math.abs(row.netIncome/proof.quarterShares-row.basicEPS)<=
          Math.max(0.035,Math.abs(row.basicEPS)*0.06)){
        f=graph.shareFactors[proof.annualAccession];
        accn=proof.annualAccession;
      }
    }
    if((graph.conflicts||[]).length||!isNumeric(f)||f<=0){
      copy.basicEPS=null;
      unverified.push({periodEnd:row.fiscalPeriodEnd,accession:accn});
    }else{
      copy.basicEPS=row.basicEPS/f;
      adjusted.push({periodEnd:row.fiscalPeriodEnd,accession:accn,factor:f});
    }
    out.push(copy);
  }
  return {rows:out,adjustedCount:adjusted.length,
    unavailableCount:unverified.length,unverified,
    method:'SEC share-basis verified quarterly basic EPS; derived Q4 uses annual share proof'};
}
