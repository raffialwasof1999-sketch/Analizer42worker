/**
 * Split-adjusted quarterly free cash flow per diluted share, for the
 * sheet's Price / FCF (5-Year Avg.). Google Finance's historical prices are
 * split-adjusted; SEC diluted share counts are as filed, so a share count
 * from before a split (NVIDIA's 10-for-1 in 2024) must be scaled to today's
 * share basis before dividing.
 *
 * Each row's diluted EPS is already on today's basis, so net income / EPS is
 * the share count on today's basis (rounded EPS makes it approximate). Its
 * ratio to the as-filed share count, when (within 5%) 1 or a clean split
 * ratio, is the split factor, and the exact as-filed count is scaled by it.
 * Without that proof, a quarter inherits the newer quarter's factor only
 * when its share count is within 25% of that quarter's (same basis). A
 * quarter with no filed share count (some fiscal Q4s) uses net income / EPS
 * itself, when EPS is large enough (>= 0.25) for rounding not to matter and
 * the result is continuous with the newer quarter. Anything unproven stays
 * null.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const CLEAN=[1.5,2,3,4,5,6,7,8,10,12,15,20,25,30,40,50,100];
const RATIOS=[1,...CLEAN,...CLEAN.map(r=>1/r)];

function snap(f) {
  if (!finite(f) || f<=0) return null;
  return RATIOS.find(r=>Math.abs(f/r-1)<=0.05) ?? null;
}
const near=(a,b,tol)=>Math.abs(a/b-1)<=tol;

/**
 * @param rows newest-first quarterly rows as published: dilutedEPS on today's
 *             basis, dilutedShares as filed, netIncome, freeCashFlow
 * @returns {values:(number|null)[], factors:(number|null)[]} one per row
 *          (factor is null when the share count came from net income / EPS)
 */
export function fcfPerShare(rows) {
  const values=[],factors=[];
  let prev=null; // {shares, factor, adjusted} of the next-newer quarter with filed shares
  for (const row of rows) {
    const shares=finite(row.dilutedShares)&&row.dilutedShares>0 ? row.dilutedShares : null;
    const eps=row.dilutedEPS, ni=row.netIncome;
    const implied=finite(eps)&&finite(ni)&&Math.abs(eps)>=0.01&&ni/eps>0 ? ni/eps : null;
    let factor=null, adjusted=null;
    if (shares && implied) factor=snap(implied/shares);
    if (factor===null && shares && prev && near(shares,prev.shares,0.25)) factor=prev.factor;
    if (factor===null && shares && !prev && implied===null) factor=1; // newest quarter: today's basis
    if (factor!==null) adjusted=shares*factor;
    else if (!shares && implied && Math.abs(eps)>=0.25 && (!prev || near(implied,prev.adjusted,0.25)))
      adjusted=implied;
    // Sanity: adjusted shares must stay within 2x of the newer quarter's.
    if (adjusted && prev && Math.abs(Math.log(adjusted/prev.adjusted))>Math.log(2)) { adjusted=null; factor=null; }
    values.push(adjusted && finite(row.freeCashFlow) ? row.freeCashFlow/adjusted : null);
    factors.push(adjusted&&shares ? factor : null);
    if (adjusted && shares) prev={shares,factor,adjusted};
  }
  return {values,factors};
}
