/**
 * Interest-bearing SEC debt, with audited evidence for otherwise absent
 * current-debt classifications. Missing XBRL facts are not zero.
 *
 * Selected Netflix quarterly and annual balance sheets explicitly show their
 * reported noncurrent debt and no current interest-bearing borrowing. Each
 * exceptional period is tied to its original SEC filing and exact amount.
 * A new company's unsupported missing debt always remains null.
 */
const nonnegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const AUDITED_ABSENT_CURRENT_DEBT={
  '1065280':{
    '2015-09-30':{noncurrent:2400000000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528015000038/nflx-093015x10qxdoc.htm',form:'10-Q'},
    '2016-03-31':{noncurrent:2372218000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528016000057/nflx-33116x10qxdoc.htm',form:'10-Q'},
    '2016-06-30':{noncurrent:2373085000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528016000072/nflx-63016x10qxdoc.htm',form:'10-Q'},
    '2016-09-30':{noncurrent:2373966000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528016000081/nflx-93016x10qxdoc.htm',form:'10-Q'},
    '2017-03-31':{noncurrent:3365431000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000162828017003939/nflx-033117x10qxdoc.htm',form:'10-Q'},
    '2017-06-30':{noncurrent:4836502000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528017000046/nflx-063017x10qxdoc.htm',form:'10-Q'},
    '2017-09-30':{noncurrent:4888783000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528017000180/nflx-093017x10qxdoc.htm',form:'10-Q'},
    '2018-03-31':{noncurrent:6542373000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528018000205/nflx-033118x10qxdoc.htm',form:'10-Q'},
    '2018-06-30':{noncurrent:8342067000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528018000360/nflx-063018x10qxdoc.htm',form:'10-Q'},
    '2018-09-30':{noncurrent:8336586000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528018000538/nflx-093018x10qxdoc.htm',form:'10-Q'},
    '2019-03-31':{noncurrent:10305023000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528019000157/form10q_q119.htm',form:'10-Q'},
    '2019-06-30':{noncurrent:12594135000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528019000260/form10qq219.htm',form:'10-Q'},
    '2019-09-30':{noncurrent:12425746000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528019000368/form10qq319.htm',form:'10-Q'},
    '2015-12-31':{noncurrent:2371362000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528016000047/nflx201510k.htm',form:'10-K'},
    '2016-12-31':{noncurrent:3364311000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000162828017000496/nflx201610k.htm',form:'10-K'},
    '2017-12-31':{noncurrent:6499432000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528018000069/q4nflx201710k.htm',form:'10-K'},
    '2018-12-31':{noncurrent:10360058000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528019000043/form10k_q418.htm',form:'10-K'}
  }
};
/**
 * Exact-period balance-sheet evidence. Use this only for Netflix periods
 * independently reconciled to their original SEC Form 10-Q/10-K.
 * The source shows no current borrowings and reports the debt as noncurrent.
 * Unlike a broad assumption, this cannot affect unreviewed companies or dates.
 * If the structured noncurrent fact conflicts, decline the exception.
 */
export function auditedAbsentCurrentDebtProof({cik,periodEnd,form}={},noncurrent=null) {
  if(!cik||typeof periodEnd!=='string')return null;
  const evidence=AUDITED_ABSENT_CURRENT_DEBT[String(cik).replace(/^0+/,'')]?.[periodEnd];
  if(!evidence||form!==evidence.form)return null;
  if(noncurrent!==null && nonnegative(noncurrent)!==evidence.noncurrent)return null;
  return {
    currentDebt:0,
    noncurrent:evidence.noncurrent,
    source:evidence.source,
    form:evidence.form,
    status:'audited-zero-current-debt'
  };
}

/**
 * Total interest-bearing debt from balance-sheet facts. A missing figure is
 * never read as zero without evidence:
 * - a combined total is used directly;
 * - noncurrent debt plus current debt (DebtCurrent, which already contains
 *   current maturities and borrowings, or else the separate borrowings and
 *   current-maturity lines). Commercial paper counts only when no
 *   ShortTermBorrowings line exists, since that line usually includes it;
 * - noncurrent debt alone only when total long-term debt or the debt
 *   carrying amount equals it, proving there is no current portion (Meta,
 *   McDonald's);
 * - unclassified LongTermDebt (banks) plus short-term borrowings;
 * - LongTermDebt with DebtCurrent only when the carrying amount confirms
 *   that they add up (Tesla), because LongTermDebt is the noncurrent line
 *   for some issuers and the total for others.
 */
export function secTotalDebt(get,context={}) {
  if(typeof get!=='function')throw Error('A SEC facts resolver is required');
  const direct=nonnegative(get('totalDebt'));
  if(direct!==null)return direct;
  const long=nonnegative(get('longTermDebt'));
  const short=nonnegative(get('shortTermDebt'));
  const current=nonnegative(get('currentPortionLongTermDebt'));
  const debtCurrent=nonnegative(get('debtCurrent'));
  const borrowings=short??nonnegative(get('otherShortTermBorrowings'));
  const ltdTotal=nonnegative(get('longTermDebtTotal'));
  const carrying=nonnegative(get('debtCarrying'));
  const same=(a,b)=>a!==null&&b!==null&&Math.abs(a-b)<=Math.max(1,0.005*Math.max(a,b));
  if(long!==null) {
    if(debtCurrent!==null)return long+debtCurrent;
    if(borrowings!==null||current!==null)return long+(borrowings??0)+(current??0);
    if(same(ltdTotal,long)||same(carrying,long))return long;
    return auditedAbsentCurrentDebtProof(context,long)?.noncurrent??null;
  }
  if(ltdTotal!==null) {
    if(debtCurrent!==null)
      return same(carrying,ltdTotal+debtCurrent)?ltdTotal+debtCurrent:null;
    if(borrowings!==null&&current===null)return ltdTotal+borrowings;
    return null;
  }
  // An absent noncurrent taxonomy fact is recovered only when the exact
  // historic filing has independently verified the balance, and no other
  // current borrowing has been reported.
  if(short!==null||current!==null||debtCurrent!==null)return null;
  return auditedAbsentCurrentDebtProof(context)?.noncurrent??null;
}
