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
  const out=[],adjusted=[],unverified=[],factors=[];
  for(const row of rows){
    const copy={...row};
    if(!hasSplit||!isNumeric(row.basicEPS)){out.push(copy);factors.push(null);continue;}
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
      const shareRatio=proof?.shareRatio||proof?.annualShares/proof?.quarterShares;
      const splitRatio=(graph.changedBasisEdges||[]).flatMap(edge=>
        [edge.shareFactor,1/edge.shareFactor]).find(r=>
        isNumeric(r)&&r>0 && isNumeric(shareRatio)&&
        Math.abs(shareRatio/r-1)<=.05);
      const basisFactor=isNumeric(shareRatio) && Math.abs(shareRatio-1)<=.10
        ? 1 : (isNumeric(proof?.shareRatio)?splitRatio:undefined);
      if(proof && proof.annualAccession &&
        isNumeric(proof.annualShares) && proof.annualShares>0 &&
        isNumeric(proof.quarterShares) && proof.quarterShares>0 &&
        isNumeric(graph.shareFactors?.[proof.annualAccession]) &&
        isNumeric(basisFactor)&&basisFactor>0 &&
        isNumeric(row.netIncome) &&
        // GAAP gross income may exceed earnings available to common
        // shareholders due to preferred dividends; the annual bridge already
        // matched basic EPS and weighted basic shares by SEC accession.
        Math.abs(row.netIncome/proof.quarterShares-row.basicEPS)<=
          Math.max(0.035,Math.abs(row.netIncome/proof.quarterShares)*.30)){
        f=graph.shareFactors[proof.annualAccession]*basisFactor;
        accn=proof.annualAccession;
      }
    }
    if((graph.conflicts||[]).length||!isNumeric(f)||f<=0){
      copy.basicEPS=null;
      unverified.push({periodEnd:row.fiscalPeriodEnd,accession:accn});
      factors.push(null);
    }else{
      copy.basicEPS=row.basicEPS/f;
      adjusted.push({periodEnd:row.fiscalPeriodEnd,accession:accn,factor:f});
      factors.push(f);
    }
    out.push(copy);
  }
  // factors[i] is the proven share-basis divisor applied to rows[i], or null.
  return {rows:out,factors,adjustedCount:adjusted.length,
    unavailableCount:unverified.length,unverified,
    method:'SEC share-basis verified quarterly basic EPS; derived Q4 uses annual share proof'};
}

/**
 * Bridge an otherwise disconnected SEC 10-Q basic EPS to an annual filing
 * that reports basic EPS and basic weighted shares on the SAME share basis.
 *
 * A later restated 10-K may use 10x the shares of the original 10-Q. Choose
 * an as-filed annual observation matching the quarter's denominator instead
 * of arbitrarily picking the newest annual comparative.
 */
export function findMatchingAnnualBasicEPSBasis(quarter,annual,epsFacts,sharesFacts,graph){
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  // SEC basic EPS excludes preferred dividends from earnings available to
  // common holders. GAAP gross net income may therefore differ materially,
  // even while EPS and basic shares agree within the same SEC filing.
  const closeEPS=(computed,reported)=>
    Math.abs(computed-reported)<=Math.max(.035,Math.abs(computed)*.30);
  if(!quarter||!annual||!Array.isArray(epsFacts)||!Array.isArray(sharesFacts)||
     !graph||!finite(quarter.basicShares)||quarter.basicShares<=0||
     !finite(quarter.basicEPS)||!finite(quarter.netIncome)||
     !closeEPS(quarter.netIncome/quarter.basicShares,quarter.basicEPS)||
     !((quarter.fiscalYear===annual.fiscalYear&&
         quarter.fiscalPeriodEnd<=annual.fiscalPeriodEnd)||
       (quarter.fiscalYear===annual.fiscalYear+1&&
         quarter.fiscalPeriodEnd>annual.fiscalPeriodEnd))||
     !finite(annual.netIncome))return null;
  const compatible=[];
  for(const e of epsFacts){
    if(e.end!==annual.fiscalPeriodEnd||!['10-K','10-K/A'].includes(e.form)||
       !e.accn||!finite(e.val)||
       !finite(graph.shareFactors?.[e.accn])||
       graph.shareFactors[e.accn]<=0)continue;
    const share=sharesFacts.find(r=>
      r.accn===e.accn && r.start===e.start &&
      r.end===e.end && finite(r.val)&&r.val>0 &&
      ['10-K','10-K/A'].includes(r.form));
    if(!share)continue;
    const shareRatio=share.val/quarter.basicShares;
    const verifiedSplitRatios=(graph.changedBasisEdges||[]).flatMap(edge=>
      [edge.shareFactor,1/edge.shareFactor]).filter(finite);
    const sameBasis=Math.abs(shareRatio-1)<=.10;
    const splitBasis=verifiedSplitRatios.some(r=>
      r>0 && Math.abs(shareRatio/r-1)<=.05);
    if(!(sameBasis||splitBasis) || !closeEPS(annual.netIncome/share.val,e.val))continue;
    const shareDifference=Math.abs(shareRatio-(sameBasis?1:verifiedSplitRatios.find(r=>
      r>0 && Math.abs(shareRatio/r-1)<=.05)));
    compatible.push({annualAccession:e.accn,annualShares:share.val,
      quarterShares:quarter.basicShares,shareDifference,shareRatio});
  }
  compatible.sort((a,b)=>a.shareDifference-b.shareDifference);
  const best=compatible[0];
  return best?{annualAccession:best.annualAccession,
    annualShares:best.annualShares,quarterShares:best.quarterShares,
    shareRatio:best.shareRatio}:null;
}
