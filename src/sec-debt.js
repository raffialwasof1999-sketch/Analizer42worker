/**
 * Interest-bearing SEC debt, with audited evidence for otherwise absent
 * current-debt classifications. Missing XBRL facts are not zero.
 *
 * These particular historical Netflix year-ends have no current-debt line
 * on their audited balance sheets. The note maturities are later than
 * twelve months, and the 2017/18 revolver was undrawn. The source
 * references and exact noncurrent carrying values guard against guessing.
 * A new company's unsupported missing debt always remains null.
 */
const nonnegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const AUDITED_ABSENT_CURRENT_DEBT={
  '1065280':{
    '2015-12-31':{noncurrent:2371362000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528016000047/nflx201510k.htm'},
    '2016-12-31':{noncurrent:3364311000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000162828017000496/nflx201610k.htm'},
    '2017-12-31':{noncurrent:6499432000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528018000069/q4nflx201710k.htm'},
    '2018-12-31':{noncurrent:10360058000,source:'https://www.sec.gov/Archives/edgar/data/1065280/000106528019000043/form10k_q418.htm'}
  }
};
export function auditedAbsentCurrentDebtProof({cik,periodEnd,form}={},noncurrent) {
  if(form!=='10-K'||!cik||typeof periodEnd!=='string')return null;
  const evidence=AUDITED_ABSENT_CURRENT_DEBT[String(cik).replace(/^0+/,'')]?.[periodEnd];
  if(!evidence||nonnegative(noncurrent)===null||
    noncurrent!==evidence.noncurrent)return null;
  return {currentDebt:0,source:evidence.source,status:'audited-zero-current-debt'};
}

export function secTotalDebt(get,context={}) {
  if(typeof get!=='function')throw Error('A SEC facts resolver is required');
  const direct=nonnegative(get('totalDebt'));
  if(direct!==null)return direct;
  const long=nonnegative(get('longTermDebt'));
  const short=nonnegative(get('shortTermDebt'));
  const current=nonnegative(get('currentPortionLongTermDebt'));
  if(long===null)return null;
  if(short!==null||current!==null)
    return long+(short??0)+(current??0);
  const proof=auditedAbsentCurrentDebtProof(context,long);
  return proof?long:null;
}
