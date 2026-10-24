/**
 * Put quarterly dividends per share on today's share basis.
 *
 * SEC dividend-per-share facts are as filed: quarters reported before a
 * stock split are on the old basis (Broadcom's pre-2024 quarters at $4.60
 * instead of $0.46 after its 10-for-1 split), while later filings restate
 * recent comparatives. A quarter is rescaled only when both are true:
 *   - its dividend is (within 15%, allowing for dividend growth) a split
 *     ratio times the next newer quarter's already-normalized dividend, and
 *   - that ratio is proven by the share-count split factors (from
 *     fcfPerShare: net income / today's-basis EPS vs the filed share count)
 *     for this quarter relative to newer ones.
 * The ratio can be any step between proven split factors (Nvidia's 2020
 * quarters were restated for its 2021 4-for-1 split but not the 2024
 * 10-for-1, so they need 10x, not 40x). A company without a proven split
 * is never rescaled, so a dividend cut cannot be mistaken for a split.
 * Impossible values become null: a negative quarterly dividend (a Q4
 * derived from an annual total and year-to-date figures on different
 * bases), or one more than 100x off its neighbour without a split ratio
 * (a units error in SEC's data, e.g. Whirlpool's 1,750,000 for $1.75).
 *
 * @param rows    newest-first quarterly rows with dividendsPerShare
 * @param factors newest-first split factors from fcfPerShare (null = unknown)
 * @returns {values, adjustments} values parallel to rows
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);

export function normalizeDividendsPerShare(rows,factors=[]) {
  // Factor in effect for each row: its own, else the nearest newer known one.
  const fac=[]; let last=1;
  rows.forEach((_,i)=>{ if(finite(factors[i])&&factors[i]>0) last=factors[i]; fac.push(last); });
  const values=[], adjustments=[];
  let ref=null; // nearest newer normalized dividend {value, factor}
  rows.forEach((row,i)=>{
    let v=row.dividendsPerShare;
    if(!finite(v)){ values.push(null); return; }
    if(v<0){ values.push(null); adjustments.push({periodEnd:row.fiscalPeriodEnd,original:v,adjusted:null,reason:'negative'}); return; }
    if(ref && ref.value>0 && v>0){
      // Candidate ratios: any step between the proven factors up to this row.
      const seen=[...new Set(fac.slice(0,i+1))];
      const candidates=[...new Set(seen.flatMap(a=>seen.map(b=>a/b)))].filter(r=>r>=1.5);
      const d=v/ref.value;
      const r=candidates.find(c=>Math.abs(d/c-1)<=0.15);
      if(r){ adjustments.push({periodEnd:row.fiscalPeriodEnd,original:v,adjusted:v/r,ratio:r}); v=v/r; }
      else if(d>100||d<0.01){
        adjustments.push({periodEnd:row.fiscalPeriodEnd,original:v,adjusted:null,reason:'implausible'});
        values.push(null); return;
      }
    }
    values.push(v);
    if(v>0) ref={value:v};
  });
  return {values,adjustments};
}
