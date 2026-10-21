/**
 * NOPAT from reported SEC operating income and effective income-tax data.
 * A verified income-tax benefit can produce a negative effective rate.
 * Only accept finite bounded rates with positive pretax earnings; do not
 * substitute a statutory or estimated tax rate.
 */
export function secNopat({operatingIncome,incomeTaxExpense,incomeBeforeTax}={}) {
  const valid=x=>typeof x==='number'&&Number.isFinite(x);
  if(!valid(operatingIncome)||!valid(incomeTaxExpense)||
     !valid(incomeBeforeTax)||incomeBeforeTax<=0)return null;
  const actualRate=incomeTaxExpense/incomeBeforeTax;
  if(!valid(actualRate)||actualRate< -1||actualRate>1)return null;
  return operatingIncome*(1-actualRate);
}
