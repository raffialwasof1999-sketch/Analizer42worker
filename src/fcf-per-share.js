/**
 * Split-adjusted quarterly free cash flow per diluted share, for the
 * sheet's Price / FCF (5-Year Avg.). Google Finance's historical prices are
 * split-adjusted; SEC diluted share counts are as filed, so a share count
 * from before a split (NVIDIA's 10-for-1 in 2024) must be scaled to today's
 * share basis before dividing.
 *
 * The scale for each quarter comes from its own diluted EPS: the worker's
 * final EPS is on today's basis, the as-filed EPS on the filing's basis, so
 * as-filed / final is the split factor, accepted only when it is (within
 * 3%) 1 or a clean split ratio. A quarter without usable EPS inherits the
 * newer quarter's factor only when its share count is within 25% of that
 * quarter's (same basis). Anything unproven stays null.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const CLEAN=[1.5,2,3,4,5,6,7,8,10,12,15,20,25,30,40,50,100];
const RATIOS=[1,...CLEAN,...CLEAN.map(r=>1/r)];

function snap(f) {
  if (!finite(f) || f<=0) return null;
  return RATIOS.find(r=>Math.abs(f/r-1)<=0.03) ?? null;
}

/**
 * @param finalRows newest-first rows as published (dilutedEPS on today's basis)
 * @param rawRows   rows before normalization (as-filed EPS and shares)
 * @returns {values:number[]|null[], factors} one entry per final row
 */
export function fcfPerShare(finalRows,rawRows) {
  const raw=new Map(rawRows.map(r=>[r.fiscalPeriodEnd,r]));
  const values=[],factors=[];
  let prev=null; // {shares, factor} of the next-newer quarter with a factor
  for (const row of finalRows) {
    const r=raw.get(row.fiscalPeriodEnd)||row;
    const shares=finite(r.dilutedShares)&&r.dilutedShares>0 ? r.dilutedShares : null;
    let factor=null;
    if (finite(r.dilutedEPS) && finite(row.dilutedEPS) && Math.abs(row.dilutedEPS)>=0.05)
      factor=snap(r.dilutedEPS/row.dilutedEPS);
    if (factor===null && shares && prev && Math.abs(shares/prev.shares-1)<=0.25)
      factor=prev.factor;
    if (factor===null && shares && !prev && !finite(r.dilutedEPS)) factor=1; // newest quarter: today's basis
    // Sanity: adjusted shares must stay within 2x of the newer quarter's.
    if (factor!==null && shares && prev && Math.abs(Math.log((shares*factor)/(prev.shares*prev.factor)))>Math.log(2))
      factor=null;
    const adjusted=shares&&factor!==null ? shares*factor : null;
    values.push(adjusted && finite(row.freeCashFlow) ? row.freeCashFlow/adjusted : null);
    factors.push(factor);
    if (shares && factor!==null) prev={shares,factor};
  }
  return {values,factors};
}
