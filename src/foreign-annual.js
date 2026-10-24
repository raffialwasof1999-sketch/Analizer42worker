/**
 * Annual mode for foreign private issuers (ASML, TSMC, Novo Nordisk, SAP,
 * Toronto-Dominion...). They file annual 20-F or 40-F reports instead of
 * 10-K/10-Q, often under IFRS, in their own currency, and their quarterly
 * results arrive as 6-K press releases that SEC's Company Facts mostly omit.
 *
 * The worker builds the same annual rows as for a US company (index.js
 * buildAnnual), from the us-gaap or ifrs-full taxonomy, in the company's
 * reporting currency. Converting to US dollars and to ADR shares is the
 * sheet's job (it has live exchange rates and prices).
 */

export const FOREIGN_ANNUAL_FORMS = ['20-F','20-F/A','40-F','40-F/A'];

/** True when the issuer files 20-F/40-F annual reports and no 10-K/10-Q. */
export function isForeignAnnualFiler(sub) {
  const forms=(sub?.filings?.recent?.form)||[];
  return !forms.some(f=>/^10-[KQ]/.test(f)) && forms.some(f=>/^(20|40)-F/.test(f));
}

/** The annual report form the issuer files (for messages), e.g. '20-F'. */
export function annualFormOf(sub) {
  const f=((sub?.filings?.recent?.form)||[]).find(x=>/^(20|40)-F/.test(x));
  return f ? f.replace('/A','') : '20-F';
}

/*
 * IFRS concepts for the same keys as index.js TAGS, most specific first.
 * Net income is the owners'-of-parent share, like us-gaap NetIncomeLoss.
 * No interest-expense tags: the EBIT fallback for a missing operating
 * income is not applied to IFRS filers (for a bank, interest expense is its
 * cost of goods; IFRS "finance costs" mix in other items).
 */
export const IFRS_TAGS = {
  revenue: ['Revenue','RevenueFromContractsWithCustomers'],
  netIncome: ['ProfitLossAttributableToOwnersOfParent','ProfitLoss'],
  operatingIncome: ['ProfitLossFromOperatingActivities'],
  operatingCashFlow: ['CashFlowsFromUsedInOperatingActivities'],
  // SAP reports one line for PP&E and intangible assets together.
  capitalExpenditures: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
    'PurchaseOfPropertyPlantAndEquipment',
    'PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets'],
  incomeTaxExpense: ['IncomeTaxExpenseContinuingOperations'],
  incomeBeforeTax: ['ProfitLossBeforeTax'],
  dilutedEPS: ['DilutedEarningsLossPerShare'],
  basicEPS: ['BasicEarningsLossPerShare'],
  basicShares: ['WeightedAverageShares'],
  dilutedShares: ['AdjustedWeightedAverageShares'],
  dividendsPaid: ['DividendsPaidClassifiedAsFinancingActivities',
    'DividendsPaidToEquityHoldersOfParentClassifiedAsFinancingActivities','DividendsPaid'],
  dividendsPerShare: ['DividendsRecognisedAsDistributionsToOwnersPerShare'],
  acquisitions: ['CashFlowsUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities'],
  divestitures: ['CashFlowsFromLosingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities'],
  stockholdersEquity: ['EquityAttributableToOwnersOfParent','Equity'],
  cash: ['CashAndCashEquivalents'],
  totalAssets: ['Assets'],
  totalLiabilities: ['Liabilities'],
  // Debt: the combined total, or current + noncurrent borrowings (the
  // current line already includes current maturities, so no separate
  // current-portion line is added).
  shortTermDebt: ['CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings','CurrentBorrowings'],
  longTermDebt: ['NoncurrentPortionOfNoncurrentBorrowings','NoncurrentBorrowings'],
  totalDebt: ['Borrowings']
};

const ANNUAL_DAYS=[330,385];
const days=(s,e)=>(Date.parse(e+'T00:00:00Z')-Date.parse(s+'T00:00:00Z'))/864e5;
const annualFact=r=>typeof r?.val==='number'&&Number.isFinite(r.val)&&r.start&&r.end&&
  days(r.start,r.end)>=ANNUAL_DAYS[0]&&days(r.start,r.end)<=ANNUAL_DAYS[1];

/**
 * Which taxonomy and currency to read. The taxonomy with the more recent
 * annual net income in a 20-F/40-F wins (us-gaap for ASML, ifrs-full for
 * TSMC). The currency is the monetary unit with the most annual net-income
 * facts: TSMC files TWD with prior-year comparatives and a USD convenience
 * translation of the latest year only, so TWD wins.
 * @returns {{standard:'US GAAP'|'IFRS', taxonomy, currency}|null}
 */
export function foreignReportingBasis(facts) {
  const options=[['us-gaap','US GAAP',['NetIncomeLoss','ProfitLoss']],
    ['ifrs-full','IFRS',IFRS_TAGS.netIncome]];
  let best=null;
  for (const [taxonomy,standard,tags] of options) {
    const bucket=facts?.facts?.[taxonomy];
    if (!bucket) continue;
    const counts={}; let latest='';
    for (const tag of tags) for (const [unit,list] of Object.entries(bucket[tag]?.units||{})) {
      if (!/^[A-Z]{3}$/.test(unit)) continue;
      for (const r of list||[]) if (FOREIGN_ANNUAL_FORMS.includes(r.form)&&annualFact(r)) {
        counts[unit]=(counts[unit]||0)+1;
        if (r.end>latest) latest=r.end;
      }
    }
    const currency=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0];
    if (currency && (!best || latest>best.latest)) best={standard,taxonomy,currency,latest};
  }
  return best && {standard:best.standard,taxonomy:best.taxonomy,currency:best.currency};
}

const CLEAN=[1.5,2,3,4,5,6,7,8,10,12,15,20,25,30,40,50,100];
const RATIOS=[1,...CLEAN,...CLEAN.map(r=>1/r)];
const snap=f=>Number.isFinite(f)&&f>0 ? RATIOS.find(r=>Math.abs(f/r-1)<=0.05)??null : null;

/**
 * Per-share basis of each annual report. A 20-F restates its comparative
 * years after a split (Novo Nordisk's 2-for-1 in 2023), but the oldest
 * years appear only in older reports, on the old basis. Each report gets a
 * multiplier that puts its per-share figures on the newest report's basis:
 * 1 for the newest; for an older report, the newer report's multiplier
 * times the ratio of the two reports' figures for a year they share
 * (EPS ratio, or the inverse share-count ratio), snapped to 1 or a clean
 * split ratio. Conflicting or unsnappable ratios leave the report null.
 *
 * @param epsFacts   annual per-share facts (diluted and basic EPS)
 * @param shareFacts annual weighted share counts (diluted and basic)
 * @returns Map accession -> multiplier (per-share x m, shares / m) or null
 */
export function reportBasis(epsFacts,shareFacts) {
  const reports=new Map(); // accn -> {latestEnd, filed, eps:Map, shares:Map}
  const add=(list,kind)=>{ for (const f of list) {
    if (!f.accn || !annualFact(f)) continue;
    const r=reports.get(f.accn)||{latestEnd:'',filed:'',eps:new Map(),shares:new Map()};
    if (f.end>r.latestEnd) r.latestEnd=f.end;
    if (String(f.filed||'')>r.filed) r.filed=String(f.filed||'');
    const key=(f.tag||'')+'|'+f.end;
    if (!r[kind].has(key)) r[kind].set(key,f.val);
    reports.set(f.accn,r);
  }};
  add(epsFacts,'eps'); add(shareFacts,'shares');
  // Newest report first: by the latest period it covers, then filing date
  // (a late 20-F/A for an old year must not become the reference basis).
  const order=[...reports.entries()].sort((a,b)=>
    b[1].latestEnd.localeCompare(a[1].latestEnd)||b[1].filed.localeCompare(a[1].filed));
  const basis=new Map();
  order.forEach(([accn,r],i)=>{
    if (i===0) { basis.set(accn,1); return; }
    const found=new Set();
    for (const [newer,nr] of order.slice(0,i)) {
      const m=basis.get(newer);
      if (m==null) continue;
      for (const [key,v] of r.eps) {
        const w=nr.eps.get(key);
        if (w!==undefined && Math.abs(v)>=0.01 && Math.abs(w)>=0.01) {
          const s=snap(w/v); if (s!==null) found.add(m*s);
        }
      }
      for (const [key,v] of r.shares) {
        const w=nr.shares.get(key);
        if (w!==undefined && v>0 && w>0) { const s=snap(v/w); if (s!==null) found.add(m*s); }
      }
      if (found.size) break; // nearest newer report that overlaps decides
    }
    const values=[...found];
    const agree=values.length>0 && values.every(x=>Math.abs(x/values[0]-1)<1e-9);
    basis.set(accn,agree?values[0]:null);
  });
  return basis;
}
