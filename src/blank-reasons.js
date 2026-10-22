/**
 * Plain-English reasons for Active Analyzer metrics that will show "-".
 * Mirrors the sheet's own completeness rules: each metric needs its inputs
 * for every quarter in its window (newest first). Only blank metrics are
 * listed; a metric with all inputs present gets no entry.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);

const LABELS={
  dilutedEPS:'diluted EPS',revenue:'revenue',netIncome:'net income',
  operatingCashFlow:'operating cash flow',capitalExpenditures:'capital expenditures',
  operatingIncome:'operating income',incomeTaxExpense:'income tax expense',
  incomeBeforeTax:'pre-tax income',investedCapital:'invested capital',
  totalDebt:'total debt',cash:'cash',dilutedShares:'diluted share count',
  stockholdersEquity:"shareholders' equity"
};

/**
 * @param quarters newest-first quarterly rows (final output)
 * @param context {companyName, bank, hasEPSTags, hasTag(key) -> boolean}
 */
export function blankReasons(quarters,context={}){
  const q=Array.isArray(quarters)?quarters:[];
  const name=context.companyName||'This company';
  const out=[];
  const hasTag=context.hasTag||(()=>true);

  // Why `field` is missing in the first `count` quarters, or null if complete.
  const why=(field,count)=>{
    const rows=q.slice(0,count);
    if(rows.length<count)return `SEC data covers only ${rows.length} of the ${count} quarters needed.`;
    const missing=rows.filter(r=>!finite(r[field]));
    if(!missing.length)return null;
    const label=LABELS[field]||field;
    if(context.bank&&field==='operatingIncome')
      return "Banks don't report operating income, and ROIC isn't meaningful for a bank.";
    if(context.bank&&field==='capitalExpenditures')
      return 'Banks report no capital expenditures, so free cash flow does not apply.';
    if(field==='dilutedEPS'&&context.hasEPSTags===false)
      return `${name} reports no single company-wide EPS in its recent SEC data (typically because EPS is given per share class, e.g. Class A and B).`;
    if(field==='investedCapital'){
      for(const part of ['totalDebt','cash','stockholdersEquity']){
        const r=why(part,count);
        if(r)return `Invested capital needs total debt, cash and equity. ${r}`;
      }
    }
    if(field==='totalDebt'&&context.debtFactsAt){
      // Name the first missing date and what was filed for it.
      const end=missing[0].fiscalPeriodEnd, filed=context.debtFactsAt(end);
      const span=missing.length===rows.length?'':` (missing for ${missing.length} of the last ${count} quarters)`;
      return filed
        ? `The debt lines ${name} filed for ${end} can't be added up to a confirmed total without risk of double counting${span}.`
        : `${name} filed no standard SEC debt figures for ${end}${span}: it may have had no debt, or used company-specific labels, which SEC's data feed omits.`;
    }
    if(missing.length===rows.length&&!hasTag(field))
      return `${name} files no standard SEC figure for ${label}; it likely uses a company-specific label, which SEC's data feed omits.`;
    const oldest=missing[missing.length-1].fiscalPeriodEnd, Label=label[0].toUpperCase()+label.slice(1);
    if(missing.length===rows.length)
      return `${Label} is missing for all of the last ${count} quarters; ${name} files no standard SEC figure for it in that period (likely a company-specific label, which SEC's data feed omits).`;
    return `${Label} is missing for ${missing.length} of the last ${count} quarters (oldest missing ${oldest}); SEC's data has no standard figure for those periods.`;
  };
  const first=(...reasons)=>reasons.find(Boolean)||null;
  const add=(metric,reason)=>{if(reason)out.push({metric,reason});};

  const ttm=i=>q.slice(i,i+4).reduce((s,r)=>s+(finite(r.dilutedEPS)?r.dilutedEPS:NaN),0);

  // P/E (TTM)
  const peWhy=why('dilutedEPS',4);
  add('P/E Ratio (TTM)',peWhy||(ttm(0)<=0?'Trailing 12-month EPS is zero or negative, so P/E is undefined.':null));

  // 5-year P/E and PEG: 20 quarters of TTM EPS (24 quarters of EPS).
  const eps24=why('dilutedEPS',24);
  const series=[...Array(21).keys()].map(ttm);
  const negative=!eps24&&series.some(v=>!(v>0));
  const fiveYear=first(eps24,negative?'Trailing 12-month EPS was zero or negative at some point in the last 5 years, so an average P/E is undefined.':null);
  add('P/E Ratio (5-Year Avg.)',fiveYear);
  let pegWhy=first(eps24,negative?'Trailing 12-month EPS was zero or negative at some point in the last 5 years, so its growth rate (and PEG) is undefined.':null);
  if(!pegWhy){
    // Same trend line as the sheet: least squares on ln(TTM EPS) by quarter.
    const ys=series.slice(0,20).reverse().map(Math.log), n=ys.length;
    const mx=(n-1)/2, my=ys.reduce((a,b)=>a+b,0)/n;
    const slope=ys.reduce((s,y,i)=>s+(i-mx)*(y-my),0)/ys.reduce((s,_,i)=>s+(i-mx)**2,0);
    if(!(slope>0))pegWhy='EPS did not grow over the last 5 years (the trend is flat or falling), so PEG is undefined.';
  }
  add('PEG Ratio (Past 5 Years)',pegWhy);
  add('PEG Ratio (Forward 3 Years)','Needs analysts’ earnings forecasts, which SEC filings do not contain.');

  // P/S
  add('P/S Ratio (TTM)',first(why('revenue',4),why('dilutedShares',1)));

  // Free cash flow
  const fcf=n=>first(why('operatingCashFlow',n),why('capitalExpenditures',n));
  add('Free Cash Flow (TTM)',fcf(4));
  add('Free Cash Flow (5-Year Avg.)',fcf(20));

  // ROIC: operating income, tax and pre-tax income for the window, plus
  // invested capital for one more quarter; the tax rate needs pre-tax > 0.
  const roic=(n,metric)=>{
    const missing=first(why('operatingIncome',n),why('incomeTaxExpense',n),
      why('incomeBeforeTax',n),why('investedCapital',n+1));
    if(missing)return add(metric,missing);
    const pretax=q.slice(0,n).reduce((s,r)=>s+r.incomeBeforeTax,0);
    if(!(pretax>0))add(metric,'Pre-tax income over the period is zero or negative, so the tax rate used by ROIC is undefined.');
  };
  roic(4,'ROIC (TTM)');
  roic(20,'ROIC (5-Year Avg.)');
  roic(40,'ROIC (10 Years)');

  // Enterprise value
  add('Enterprise Value',first(why('totalDebt',1),why('cash',1)));

  return out;
}

/** CSV for the sheet's IMPORTDATA: a header row, then metric and reason. */
export function blankReasonsCsv(reasons,ticker){
  const cell=s=>'"'+String(s).replaceAll('"','""')+'"';
  const rows=[['Metric','Why it is blank'],...reasons.map(r=>[r.metric,r.reason])];
  if(!reasons.length)rows.push(['All metrics',`Every SEC input is available for ${ticker}.`]);
  return rows.map(r=>r.map(cell).join(',')).join('\n')+'\n';
}
