/**
 * Reconstruct a missing fourth-quarter diluted EPS from reported SEC net income
 * and weighted-average diluted shares. This is an inferred metric, NOT an EPS
 * number explicitly reported in an SEC 10-K, and it can be unavailable when
 * quarter-specific anti-dilution or split restatements invalidate the formula.
 *
 * The annual diluted-share average is approximated as a time-weighted average
 * of the four quarter averages. We calculate the missing Q4 denominator and
 * round net income / shares to cents only after cross-checking reported annual
 * and Q1–Q3 diluted EPS. Never infer a value across inconsistent share bases.
 */
const num=x=>typeof x==='number'&&Number.isFinite(x);
const DAYS=86400000;
const days=(a,b)=>(Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/DAYS;
const roundedCents=x=>Math.sign(x)*Math.round((Math.abs(x)+Number.EPSILON)*100)/100;
const plausible=(actual,expected)=>Math.abs(actual-expected)<=Math.max(0.035,Math.abs(expected)*0.055);

export function reconstructFourthQuarterEPS(quarterly,annual,shareFacts){
  if(!Array.isArray(quarterly)||!Array.isArray(annual))throw Error('SEC financial rows required');
  const observations=[];
  for(const q4 of quarterly.filter(x=>x.fiscalQuarter===4)){
    if(num(q4.dilutedEPS))continue; // Keep exact, filed Q4 EPS if present.
    const fiscal=annual.find(a=>a.fiscalYear===q4.fiscalYear &&
      a.fiscalPeriodEnd===q4.fiscalPeriodEnd);
    const earlier=[1,2,3].map(q=>quarterly.find(x=>
      x.fiscalYear===q4.fiscalYear && x.fiscalQuarter===q));
    if(!fiscal || earlier.some(x=>!x) || !num(q4.netIncome) ||
       !num(fiscal.dilutedEPS)||!num(fiscal.dilutedShares)||
       !(fiscal.dilutedShares>0)||
       !plausible(fiscal.netIncome/fiscal.dilutedShares,fiscal.dilutedEPS)){
      continue;
    }

    // Confirm all three earlier quarterly EPS figures were actually reported
    // against compatible, unsplit denominators before inferring a Q4 share base.
    if(earlier.some(q=>!num(q.dilutedShares)||q.dilutedShares<=0||
      !num(q.netIncome)||!num(q.dilutedEPS)||
      !plausible(q.netIncome/q.dilutedShares,q.dilutedEPS)||
      Math.abs(q.dilutedShares/fiscal.dilutedShares-1)>0.25))continue;

    const annualSource=(shareFacts||[]).filter(x=>
      x.end===q4.fiscalPeriodEnd && x.form &&
      ['10-K','10-K/A'].includes(x.form) &&
      typeof x.start==='string' &&
      days(x.start,x.end)>=330 && days(x.start,x.end)<=385 &&
      num(x.val) && x.val>0 &&
      Math.abs(x.val/fiscal.dilutedShares-1)<0.000001
    ).sort((a,b)=>String(b.filed||'').localeCompare(String(a.filed||'')))[0];
    if(!annualSource)continue;

    const dateEnds=earlier.map(q=>q.fiscalPeriodEnd);
    if(!(annualSource.start<dateEnds[0] &&
         dateEnds[0]<dateEnds[1] &&
         dateEnds[1]<dateEnds[2] &&
         dateEnds[2]<q4.fiscalPeriodEnd))continue;
    const quarterDays=[
      days(annualSource.start,dateEnds[0])+1,
      days(dateEnds[0],dateEnds[1]),
      days(dateEnds[1],dateEnds[2]),
      days(dateEnds[2],q4.fiscalPeriodEnd)
    ];
    const annualDays=days(annualSource.start,q4.fiscalPeriodEnd)+1;
    if(quarterDays.some(d=>d<70||d>105)||
       annualDays<340||annualDays>375||
       Math.abs(quarterDays.reduce((a,b)=>a+b,0)-annualDays)>0.01)continue;

    const q4Shares=num(q4.dilutedShares) && q4.dilutedShares>0
      ? q4.dilutedShares
      : (fiscal.dilutedShares*annualDays-
          earlier.reduce((sum,q,i)=>sum+q.dilutedShares*quarterDays[i],0))/
            quarterDays[3];
    if(!num(q4Shares)||q4Shares<=0||
       Math.abs(q4Shares/fiscal.dilutedShares-1)>0.25||
       Math.abs(q4Shares/earlier[2].dilutedShares-1)>0.25)continue;
    const estimate=roundedCents(q4.netIncome/q4Shares);
    const annualCheck=earlier.reduce((sum,q)=>sum+q.dilutedEPS,0)+estimate;
    if(!plausible(annualCheck,fiscal.dilutedEPS)||
       Math.abs(annualCheck-fiscal.dilutedEPS)>Math.max(.10,Math.abs(fiscal.dilutedEPS)*.05))continue;

    // Avoid pretending the fourth quarter disclosure included these numbers.
    q4.dilutedEPS=estimate;
    if(!num(q4.dilutedShares))q4.dilutedShares=Math.round(q4Shares);
    observations.push({
      fiscalYear:q4.fiscalYear,fiscalPeriodEnd:q4.fiscalPeriodEnd,
      derivedDilutedEPS:estimate,inferredDilutedShares:Math.round(q4Shares),
      shareDenominator: num(q4.dilutedShares)?'derived-or-existing':'derived',
      sourceAnnualAccession:annualSource.accn||null,
      status:'estimated-from-SEC-reported-net-income-and-weighted-diluted-shares',
      explicitlyReported:false
    });
  }
  return {derivedCount:observations.length,observations,
    caveat:'Derived EPS is rounded estimate, not explicitly reported quarterly diluted EPS; split-basis and dilution checks must pass.'};
}
