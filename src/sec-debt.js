/**
 * Recover balance-sheet interest-bearing debt from SEC CompanyFacts.
 *
 * Prefer a comprehensive explicitly reported total. Otherwise build it from
 * noncurrent debt plus disclosed current portions and independent short-term
 * borrowings. Missing components are NOT assumed to be zero unless the
 * remaining current component is itself explicitly reported.
 *
 * Callers map SEC tags to distinct semantic fields. In particular,
 * ShortTermDebtCurrent and LongTermDebtCurrent are separate classifications.
 */
const nonnegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;

export function secTotalDebt(get) {
  if(typeof get!=='function')throw Error('A SEC facts resolver is required');
  const direct=nonnegative(get('totalDebt'));
  if(direct!==null)return direct;
  const long=nonnegative(get('longTermDebt'));
  const short=nonnegative(get('shortTermDebt'));
  const current=nonnegative(get('currentPortionLongTermDebt'));
  if(long===null || (short===null && current===null))return null;
  return long+(short??0)+(current??0);
}
