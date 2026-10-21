/**
 * Additive SEC input snapshots and metric-specific completeness reports.
 * The historical Google Sheets import still receives its unchanged
 * annualFinancials / quarterlyFinancials arrays and column ordering.
 *
 * This is an API response snapshot, not persistent Cloudflare storage.
 */
export function financialInputArchive(rows,keys) {
  return rows.map(row=>({
    fiscalYear:row.fiscalYear,
    fiscalQuarter:row.fiscalQuarter??null,
    fiscalPeriodEnd:row.fiscalPeriodEnd,
    source:row.debtEvidence?.source??null,
    debtEvidence:row.debtEvidence?.status??null,
    inputs:Object.fromEntries(keys.map(key=>[key,row[key]??null])),
    calculated:{
      freeCashFlow:row.freeCashFlow??null,
      profitMargin:row.profitMargin??null,
      freeCashFlowMargin:row.freeCashFlowMargin??null,
      investedCapital:row.investedCapital??null,
      nopat:row.nopat??null,
      roic:row.roic??null
    }
  }));
}

const valid=x=>typeof x==='number'&&Number.isFinite(x);
const period=x=>x?.fiscalYear*4+x?.fiscalQuarter;
const id=x=>x?.fiscalYear&&x?.fiscalQuarter
  ? String(x.fiscalYear)+'Q'+String(x.fiscalQuarter) : 'unavailable';

/**
 * Each rolling ROIC observation uses four consecutive quarters of
 * operating income, tax expense and pre-tax income; invested capital
 * is the quarter-end balance averaged with four quarters prior.
 * 20/40 observations require 24/44 quarters respectively.
 */
export function rollingRoicCoverage(rows,observations) {
  const required=observations+4;
  const missing=[];
  if(!Number.isSafeInteger(observations)||observations<1)
    throw Error('ROIC observations must be a positive integer');
  for(let i=0;i<required;i++) {
    const row=rows[i];
    if(!row) {
      missing.push({period:'unavailable',field:'quarter',index:i});
      continue;
    }
    if(i>0&&rows[i-1]&&period(rows[i-1])!==period(row)+1)
      missing.push({period:id(row),field:'consecutiveQuarter'});
    if(i<observations+3) {
      for(const key of ['operatingIncome','incomeTaxExpense','incomeBeforeTax'])
        if(!valid(row[key]))missing.push({period:id(row),field:key});
    }
    if((i<observations||i>=4&&i<observations+4)&&!valid(row.investedCapital))
      missing.push({period:id(row),field:'investedCapital'});
  }
  for(let i=0;i<observations;i++){
    if(i+4>=rows.length)break;
    const x=rows.slice(i,i+4);
    if(x.some(v=>!valid(v.operatingIncome)||!valid(v.incomeTaxExpense)||!valid(v.incomeBeforeTax)))continue;
    const pretax=x.reduce((s,r)=>s+r.incomeBeforeTax,0);
    const tax=x.reduce((s,r)=>s+r.incomeTaxExpense,0);
    if(pretax<=0||tax/pretax< -1||tax/pretax>1)
      missing.push({period:id(rows[i]),field:'reportedEffectiveTaxRate'});
    const a=rows[i].investedCapital,b=rows[i+4].investedCapital;
    if(valid(a)&&valid(b)&&(a+b)<=0)
      missing.push({period:id(rows[i]),field:'averageInvestedCapital'});
  }
  return {
    ready:missing.length===0,
    observations,
    requiredQuarters:required,
    availableQuarters:Math.min(rows.length,required),
    missing
  };
}
