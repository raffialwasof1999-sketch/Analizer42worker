/**
 * Last-pass quarterly EPS consistency, using only figures every issuer files:
 * quarterly net income and EPS. Rows are newest first.
 *
 * A. Split stragglers. Net income / EPS gives an implied share count. When a
 *    quarter's implied count is a clean split ratio (2x, 3x, 20x ...) away
 *    from the newer quarter before it, that quarter is still on a pre-split
 *    basis (e.g. GOOGL Q1 2021 at 26.63 next to 1.38). It is rescaled ONLY if
 *    the same fiscal year's annual EPS confirms the newer basis; a genuine
 *    share jump such as a stock-funded merger is left alone.
 * B. Missing diluted EPS with basic EPS present: apply the dilution ratio
 *    (diluted / basic) of the nearest quarter that reports both.
 * C. Missing basic and diluted EPS (an issuer reporting EPS only by share
 *    class, such as Alphabet): estimate weighted shares from the adjacent
 *    quarters' implied counts, provided the fiscal year's annual net income
 *    / EPS agrees with them within 10%, then apply B.
 *
 * B and C only fill blanks and are listed in the audit as estimates.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const CLEAN=[1.5,2,3,4,5,6,7,8,10,12,15,20,25,30,40,50,100];
const near=(a,b,p)=>Math.abs(a/b-1)<=p;

function implied(row){
  for(const key of ['basicEPS','dilutedEPS']){
    const eps=row[key];
    // Small EPS are dominated by rounding to the cent; skip them.
    if(finite(eps)&&Math.abs(eps)>=0.2&&finite(row.netIncome)&&row.netIncome/eps>0)
      return row.netIncome/eps;
  }
  return null;
}
function splitRatio(ratio){
  for(const r of CLEAN){
    if(near(ratio,r,.05))return r;
    if(near(ratio,1/r,.05))return 1/r;
  }
  return null;
}

export function enforceQuarterlyEPSConsistency(rows,annual=[]){
  const out=rows.map(r=>({...r}));
  const findings=[];
  // A. split stragglers
  let ref=null;
  for(const row of out){
    const imp=implied(row);
    if(!imp)continue;
    if(ref===null){ref=imp;continue;}
    const R=splitRatio(ref/imp);
    if(R){
      const yr=annual.find(a=>a.fiscalYear===row.fiscalYear);
      const annualImp=yr&&implied(yr);
      if(annualImp&&near(annualImp,ref,.15)&&!near(annualImp,imp,.3)){
        for(const key of ['basicEPS','dilutedEPS'])
          if(finite(row[key]))row[key]=row[key]/R;
        findings.push({periodEnd:row.fiscalPeriodEnd,status:'rescaled-pre-split-quarter',
          divisor:R,basis:'net income / EPS share basis confirmed by the fiscal year annual EPS'});
        ref=implied(row)||ref;
        continue;
      }
    }
    ref=imp;
  }
  // Dilution ratio from the nearest rows that report both EPS.
  const dilution=i=>{
    for(let d=1;d<=3;d++)for(const j of [i+d,i-d]){
      const r=out[j];
      if(r&&finite(r.basicEPS)&&finite(r.dilutedEPS)&&r.basicEPS>=0.2){
        const k=r.dilutedEPS/r.basicEPS;
        if(k>=.7&&k<=1.0001)return k;
      }
    }
    return null;
  };
  out.forEach((row,i)=>{
    // C. both missing: estimate basic from adjacent implied share counts.
    if(!finite(row.basicEPS)&&!finite(row.dilutedEPS)&&finite(row.netIncome)){
      const counts=[out[i+1],out[i-1]].filter(Boolean).map(implied).filter(Boolean);
      const yr=annual.find(a=>a.fiscalYear===row.fiscalYear);
      const annualImp=yr&&implied(yr);
      // The fiscal year's annual net income / EPS must agree with the
      // neighbouring quarters' share basis, or nothing is filled.
      if(counts.length&&(counts.length===1||near(counts[0],counts[1],.10))&&
        annualImp&&counts.every(c=>near(c,annualImp,.10))){
        const shares=counts.reduce((a,b)=>a+b)/counts.length;
        row.basicEPS=Math.round(row.netIncome/shares*100)/100;
        findings.push({periodEnd:row.fiscalPeriodEnd,status:'estimated-basic-EPS-from-adjacent-quarter-share-basis',
          fields:['basicEPS'],explicitlyReported:false});
      }
    }
    // B. diluted missing, basic present.
    if(finite(row.basicEPS)&&!finite(row.dilutedEPS)){
      const k=row.basicEPS<0?1:dilution(i);
      if(finite(k)){
        row.dilutedEPS=Math.round(row.basicEPS*k*10000)/10000;
        findings.push({periodEnd:row.fiscalPeriodEnd,status:'estimated-diluted-EPS-from-adjacent-quarter-dilution',
          fields:['dilutedEPS'],dilutionRatio:k,explicitlyReported:false});
      }
    }
  });
  return {rows:out,findings};
}
