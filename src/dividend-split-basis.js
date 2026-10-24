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
 * A company without a proven split is never changed, so a dividend cut
 * cannot be mistaken for a split. A negative quarterly dividend (a Q4
 * derived from an annual total and year-to-date figures on different
 * bases) is impossible and becomes null.
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
      // Candidate ratios: this row's cumulative factor relative to newer factors.
      const candidates=[...new Set(fac.slice(0,i).map(f=>fac[i]/f).filter(r=>r>=1.5))];
      const d=v/ref.value;
      const r=candidates.find(c=>Math.abs(d/c-1)<=0.15);
      if(r){ adjustments.push({periodEnd:row.fiscalPeriodEnd,original:v,adjusted:v/r,ratio:r}); v=v/r; }
    }
    values.push(v);
    if(v>0) ref={value:v};
  });
  return {values,adjustments};
}
