/**
 * Put quarterly diluted EPS on the same share basis as quarterly basic EPS.
 *
 * When the SEC share-basis graph cannot prove every quarter, the worker only
 * normalizes basic EPS. Raw diluted EPS from before a stock split would then
 * sit next to split-adjusted basic EPS (e.g. AAPL FY2018 Q4: basic 0.735,
 * diluted 2.91). This applies, per quarter and in order of preference:
 *
 *  1. the graph-proven diluted EPS factor for that quarter;
 *  2. the basic EPS factor proven for the same quarter, when raw diluted and
 *     raw basic EPS are on one share basis (diluted within 85-101% of basic);
 *  3. no adjustment, when the quarter's raw diluted share count is within 25%
 *     of the newest quarter's (a split of 3-for-2 or more is far outside it).
 *
 * Anything else is unverifiable and becomes null rather than a mixed basis.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);

export function alignQuarterlyDilutedEPS(rows,rawRows,graphRows,basicFactors,splitDetected){
  const findings={adjustedFromGraph:0,adjustedFromBasic:0,currentBasis:0,unverified:[]};
  if(!splitDetected||!Array.isArray(rows))return {rows:rows.map(r=>({...r})),findings};
  const newestShares=rawRows.find(r=>finite(r?.dilutedShares)&&r.dilutedShares>0)?.dilutedShares;
  const out=rows.map((row,i)=>{
    const copy={...row},raw=rawRows[i];
    if(!finite(raw?.dilutedEPS))return copy;
    const fromGraph=graphRows?.[i]?.dilutedEPS;
    if(finite(fromGraph)){copy.dilutedEPS=fromGraph;findings.adjustedFromGraph++;return copy;}
    const f=basicFactors?.[i];
    const ratio=finite(raw.basicEPS)&&raw.basicEPS!==0?raw.dilutedEPS/raw.basicEPS:NaN;
    if(finite(f)&&f>0&&ratio>=.85&&ratio<=1.01){
      copy.dilutedEPS=raw.dilutedEPS/f;findings.adjustedFromBasic++;return copy;
    }
    if(finite(newestShares)&&finite(raw.dilutedShares)&&raw.dilutedShares>0&&
      Math.abs(raw.dilutedShares/newestShares-1)<=.25){
      findings.currentBasis++;return copy;
    }
    copy.dilutedEPS=null;
    findings.unverified.push(row.fiscalPeriodEnd);
    return copy;
  });
  return {rows:out,findings};
}
