import { recoverLatestCoverShares } from './sec-cover-shares.js';
import { secTotalDebt, auditedAbsentCurrentDebtProof } from './sec-debt.js';
import { financialInputArchive, rollingRoicCoverage } from './sec-input-coverage.js';
import { secFactsCatalog, secRawConcept, secRawFactsPage, secSourceSummary } from './sec-raw-facts.js';
import { secNopat } from './sec-roic.js';
import { splitAudit, secSplitFilingCandidates, detectSplitStatements, splitDateCandidates, secRestatementEvidence, previewProvenPerShare, auditedSplitRows } from './sec-splits.js';
import { inspectSplitFilingBatch } from './sec-corporate-actions.js';
import { buildSECShareBasisGraph, normalizeUsingSECShareGraph } from './sec-share-basis.js';
import { recoverSECReportedEPS } from './sec-reported-eps.js';
import { deriveQ4BasicEPS } from './q4-basic-eps.js';
import { recoverSplitCrossingQ4BasicEPS } from './split-crossing-q4-basic-eps.js';
import { normalizeHistoricalBasicEPS, findMatchingAnnualBasicEPSBasis } from './basic-eps-share-basis.js';
import { alignQuarterlyDilutedEPS } from './diluted-eps-share-basis.js';
import { withPredecessor } from './sec-predecessor.js';
import { blankReasons, blankReasonsCsv } from './blank-reasons.js';
import { fcfPerShare } from './fcf-per-share.js';
import { debtFreeEvidence } from './debt-free.js';
import { normalizeDividendsPerShare } from './dividend-split-basis.js';
import { verifyDividends } from './sec-dividend-status.js';
import { enforceQuarterlyEPSConsistency } from './eps-consistency.js';
import { FOREIGN_ANNUAL_FORMS, IFRS_TAGS, isForeignAnnualFiler, annualFormOf, foreignReportingBasis, reportBasis, composedIfrsDebt, coverSharesOutstanding } from './foreign-annual.js';
import { fullQuarterFilingHistory, assignQuarterDates, earningsDateCoverage, fillFilingDatesFromFacts } from './sec-earnings-dates.js';

/**
 * ACTIVE ANALYZER — CLOUDFLARE SEC WORKER
 * Version: AA_SEC_V3
 *
 * Compatible with the Google Apps Script below.
 *
 * Supports limited SEC histories, including newer public companies.
 * Imports reported data only. Missing values remain null.
 * Preserves the exact annual and quarterly field ordering expected
 * by the Active Analyzer spreadsheet.
 */

const CONTACT = 'Active Analyzer contact raffialwasof.1999@gmail.com';
const SEC = 'https://data.sec.gov';
const VERSION = 'AA_SEC_V3';

export const ANNUAL_FIELDS = [
  'fiscalYear','revenue','netIncome','freeCashFlow','dilutedShares',
  'profitMargin','freeCashFlowMargin','roic','operatingIncome',
  'operatingCashFlow','capitalExpenditures','totalAssets','totalLiabilities',
  'stockholdersEquity','cash','shortTermDebt','longTermDebt','totalDebt',
  'incomeTaxExpense','incomeBeforeTax','dilutedEPS','revenueGrowth',
  'fiscalPeriodEnd','dividendsPaid','dividendsPerShare','acquisitions',
  'divestitures','netAcquisitions','investedCapital',
  'averageInvestedCapital','nopat','basicEPS'
];

const QUARTER_FIELDS = [
  'fiscalYear','fiscalQuarter','fiscalPeriodEnd','revenue','netIncome',
  'dilutedEPS','operatingCashFlow','capitalExpenditures','freeCashFlow',
  'dividendsPaid','dividendsPerShare','operatingIncome','incomeTaxExpense',
  'incomeBeforeTax','investedCapital','stockholdersEquity','totalDebt',
  'cash','roic','dilutedShares','sharesOutstanding',
  'sharesOutstandingAsOf','secFilingDate','earningsDisclosureDate','basicEPS',
  // Not imported by the Apps Script; served as ?fcfPerShareCsv=quarterly.
  'fcfPerShare',
  // Not imported by the Apps Script; served as ?netAcquisitionsCsv=quarterly.
  // netAcquisitions counts a missing acquisitions/divestitures line as 0 only
  // when that is safe; acquisitionsBasis says how (ACQ_BASIS below).
  'netAcquisitions','acquisitionsBasis'
];

export const TAGS = {
  revenue: [
    // Banks' total net revenue (JPM, BAC...). Non-banks never report it, and
    // a bank's contract-revenue tags cover fee income only, so it goes first.
    'RevenuesNetOfInterestExpense',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues','SalesRevenueNet','SalesRevenueGoodsNet',
    // Pre-2018 services companies (The Trade Desk before ASC 606).
    'SalesRevenueServicesNet'
  ],
  netIncome: [
    'NetIncomeLoss','ProfitLoss','NetIncomeLossAttributableToParent'
  ],
  operatingIncome: ['OperatingIncomeLoss'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities',
    'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  // Capital expenditures: the PP&E line first (unchanged for issuers that
  // file it), then the broader productive-assets lines many issuers use for
  // their "Capital expenditures" row: Nvidia, Amazon, Home Depot, PepsiCo,
  // Chevron, AT&T, GE, Ford ("ProductiveAssets"); Verizon ("Other").
  // CapitalExpendituresIncurredButNotYetPaid is a noncash note, never used.
  capitalExpenditures: ['PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets','PaymentsToAcquireOtherProductiveAssets'],
  incomeTaxExpense: ['IncomeTaxExpenseBenefit'],
  incomeBeforeTax: [
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'
  ],
  // EBIT = pretax income + interest expense stands in for operating income
  // when an issuer reports none (Exxon, J&J, Pfizer, Nike...).
  interestExpense: ['InterestExpense','InterestExpenseNonoperating',
    'InterestExpenseDebt','InterestAndDebtExpense'],
  // Net interest income (positive = income); EBIT subtracts it (Nike, GE).
  netInterestIncome: ['InterestIncomeExpenseNonoperatingNet','InterestIncomeExpenseNet'],
  dilutedEPS: ['EarningsPerShareDiluted'],
  basicEPS: ['EarningsPerShareBasic'],
  basicShares: ['WeightedAverageNumberOfSharesOutstandingBasic'],
  // Issuers without dilutive securities may tag one combined count.
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding',
    'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'],
  dividendsPaid: ['PaymentsOfDividends','PaymentsOfDividendsCommonStock'],
  dividendsPerShare: [
    'CommonStockDividendsPerShareDeclared',
    'CommonStockDividendsPerShareCashPaid'
  ],
  acquisitions: [
    'PaymentsToAcquireBusinessesNetOfCashAcquired',
    'PaymentsToAcquireBusinessesGross'
  ],
  // Footnote total of cash paid for acquisitions: evidence of a deal even
  // when the cash-flow line uses a company-specific label (Microsoft).
  acquisitionDisclosure: ['BusinessAcquisitionCostOfAcquiredEntityCashPaid'],
  divestitures: [
    'ProceedsFromDivestitureOfBusinessesNetOfCashDivested',
    'ProceedsFromSaleOfBusinessesNetOfCashAndCashEquivalentsSold'
  ],
  stockholdersEquity: [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'
  ],
  // Banks report cash as "cash and due from banks".
  // Last resort: cash including restricted cash, for issuers that file only
  // that combined line at a period end (Chevron, Starbucks, GE).
  cash: ['CashAndCashEquivalentsAtCarryingValue','CashAndDueFromBanks',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  totalAssets: ['Assets'],
  totalLiabilities: ['Liabilities'],
  shortTermDebt: ['ShortTermDebtCurrent','ShortTermBorrowings'],
  longTermDebt: [
    'LongTermDebtNoncurrent',
    'LongTermDebtAndFinanceLeaseObligationsNoncurrent',
    'LongTermDebtAndCapitalLeaseObligationsNoncurrent',
    // Noncurrent by its taxonomy definition (Home Depot, Exxon, AT&T...).
    'LongTermDebtAndCapitalLeaseObligations'
  ],
  // All current debt in one line: current maturities plus borrowings.
  debtCurrent: ['DebtCurrent'],
  // Short-term borrowings filed without a ShortTermBorrowings line
  // (Bank of America; Home Depot's commercial paper).
  otherShortTermBorrowings: ['OtherShortTermBorrowings','CommercialPaper'],
  // Ambiguous in practice: total long-term debt for some issuers, the
  // noncurrent line for others. Used only with corroboration.
  longTermDebtTotal: ['LongTermDebt'],
  debtCarrying: ['DebtInstrumentCarryingAmount'],
  // Principal due within 12 months (debt footnote): the current portion
  // when the balance-sheet line uses a company-specific tag (PayPal).
  debtMaturity12m: ['LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths'],
  currentPortionLongTermDebt: [
    'LongTermDebtCurrent',
    'LongTermDebtAndCapitalLeaseObligationsCurrent',
    'LongTermDebtAndFinanceLeaseObligationsCurrent'
  ],
  totalDebt: [
    // Long- and short-term debt in one figure (GE, Goldman Sachs).
    'DebtLongtermAndShorttermCombinedAmount',
    'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities',
    'LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities'
  ],
  grossProfit: ['GrossProfit'],
  sga: ['SellingGeneralAndAdministrativeExpense'],
  rnd: ['ResearchAndDevelopmentExpense']
};

const INSTANT = new Set([
  'stockholdersEquity','cash','totalAssets','totalLiabilities',
  'shortTermDebt','longTermDebt','currentPortionLongTermDebt','totalDebt',
  'debtCurrent','otherShortTermBorrowings','longTermDebtTotal','debtCarrying',
  'debtMaturity12m'
]);

/*
 * Total debt still unknown after secTotalDebt (fills a null only):
 * 1. the same balance-sheet date as shown in a later 10-Q/10-K (PayPal's
 *    year-end current debt is tagged only in the next year's 10-Qs);
 * 2. noncurrent debt + principal due within 12 months from the debt
 *    footnote, when no current-debt line of any standard kind exists for
 *    that date (PayPal tags its current notes with its own label).
 */
const ANY_FORMS=['10-Q','10-Q/A','10-K','10-K/A'];
function fillUnknownDebt(r,map,end,get,context) {
  if (r.totalDebt!==null) return;
  const getAny=k=>get(k) ?? val(map[k]||[],end,'instant',ANY_FORMS);
  const later=debt(getAny,context);
  if (later!==null) {
    r.totalDebt=later;
    r.debtEvidence={status:'balance-from-later-filing'};
    return;
  }
  const long=getAny('longTermDebt'), due=getAny('debtMaturity12m');
  const currentLines=['shortTermDebt','currentPortionLongTermDebt','debtCurrent','otherShortTermBorrowings']
    .every(k=>getAny(k)===null);
  if (n(long)!==null && long>=0 && n(due)!==null && due>=0 && currentLines) {
    r.totalDebt=long+due;
    r.debtEvidence={status:'noncurrent-plus-principal-due-12-months'};
  }
}

const UNITS = {
  basicEPS: 'USD/shares',
  basicShares: 'shares',
  dilutedEPS: 'USD/shares',
  dividendsPerShare: 'USD/shares',
  dilutedShares: 'shares'
};

const n = x =>
  typeof x === 'number' && Number.isFinite(x) ? x : null;

const ratio = (a,b) =>
  n(a) !== null && n(b) !== null && b !== 0 ? a/b : null;

const minus = (a,b) =>
  n(a) !== null && n(b) !== null ? a-b : null;

const dayCount = (start,end) =>
  (Date.parse(end+'T00:00:00Z') -
   Date.parse(start+'T00:00:00Z')) / 86400000;

const validDate = s =>
  typeof s === 'string' &&
  /^\d{4}-\d\d-\d\d$/.test(s) &&
  !Number.isNaN(Date.parse(s+'T00:00:00Z'));

function json(obj,status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type':'application/json; charset=utf-8',
      'access-control-allow-origin':'*',
      'cache-control':'public, max-age=900'
    }
  });
}

async function secFetch(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':CONTACT,
      'Accept':'application/json'
    },
    cf: {
      cacheTtl:900,
      cacheEverything:true
    }
  });

  if (!res.ok) {
    throw Error(
      'SEC returned HTTP '+res.status+' for '+
      (url.includes('company_tickers') ? 'ticker directory' : 'issuer data')
    );
  }

  return res.json();
}

// tags/currency let foreign annual filers reuse this (foreign-annual.js).
export function fieldFacts(gaap,key,{tags=TAGS,currency='USD'}={}) {
  const unit = (UNITS[key] || 'USD').replace('USD',currency);

  return (tags[key] || []).flatMap((tag,priority) =>
    (gaap[tag]?.units?.[unit] || [])
      .filter(r => n(r.val) !== null && validDate(r.end))
      .map(r => ({...r,priority,tag}))
  );
}

export function chooseRecord(records,end,kind,forms) {
  const found = records.filter(r =>
    r.end === end &&
    forms.includes(r.form) &&
    (
      kind === 'instant'
        ? !r.start
        : (
            validDate(r.start) &&
            (
              kind === 'annual'
                ? dayCount(r.start,r.end)>=330 &&
                  dayCount(r.start,r.end)<=385
                : kind === 'ytd'
                  ? dayCount(r.start,r.end)>=60 &&
                    dayCount(r.start,r.end)<=310
                  : dayCount(r.start,r.end)>=60 &&
                    dayCount(r.start,r.end)<=110
            )
          )
    )
  );

  found.sort((a,b) =>
    a.priority-b.priority ||
    (
      kind === 'ytd'
        ? dayCount(b.start,b.end)-dayCount(a.start,a.end)
        : kind === 'quarter'
          ? dayCount(a.start,a.end)-dayCount(b.start,b.end)
          : 0
    ) ||
    String(b.filed||'').localeCompare(String(a.filed||''))
  );

  return found[0] || null;
}

const val = (records,end,kind,forms) =>
  chooseRecord(records,end,kind,forms)?.val ?? null;

const debt = secTotalDebt;

// True when no positive current-debt figure of any kind was filed within
// 400 days of `end`: a balance-sheet line would appear in the comparatives
// of neighbouring filings, so its absence is evidence of no current debt.
const CURRENT_DEBT_KEYS=['shortTermDebt','currentPortionLongTermDebt','debtCurrent','otherShortTermBorrowings'];
function noCurrentDebtNear(map,end) {
  const t=Date.parse(end);
  return !CURRENT_DEBT_KEYS.some(k=>(map[k]||[]).some(f=>
    !f.start && f.val>0 && Math.abs(Date.parse(f.end)-t)<=400*864e5));
}

// Banks report total net revenue after interest expense.
const isBank = map =>
  (map.revenue||[]).some(f=>f.tag==='RevenuesNetOfInterestExpense');

function decorate(r,older,bank=false) {
  // No pre-tax income tag (PayPal since 2019): net income + income tax,
  // the identity behind the income statement (ignores noncontrolling
  // interests, small for most companies). Fills a missing value only.
  if (n(r.incomeBeforeTax)===null && n(r.netIncome)!==null && n(r.incomeTaxExpense)!==null) {
    r.incomeBeforeTax = r.netIncome + r.incomeTaxExpense;
    r.incomeBeforeTaxBasis = 'netIncome+incomeTax';
  }
  // No reported operating income: use EBIT (pretax income + interest
  // expense), the usual substitute. Not for banks, whose interest expense
  // is their cost of goods and whose ROIC is not meaningful.
  if (n(r.operatingIncome)===null && !bank &&
      n(r.incomeBeforeTax)!==null && n(r.interestExpense)!==null) {
    r.operatingIncome = r.incomeBeforeTax + r.interestExpense;
    r.operatingIncomeBasis = 'EBIT';
  } else if (n(r.operatingIncome)===null && !bank &&
      n(r.incomeBeforeTax)!==null && n(r.netInterestIncome)!==null) {
    r.operatingIncome = r.incomeBeforeTax - r.netInterestIncome;
    r.operatingIncomeBasis = 'EBIT';
  }
  r.freeCashFlow = minus(r.operatingCashFlow,r.capitalExpenditures);
  r.profitMargin = ratio(r.netIncome,r.revenue);
  r.freeCashFlowMargin = ratio(r.freeCashFlow,r.revenue);

  r.nopat = secNopat(r);

  const eq =
    n(r.stockholdersEquity) !== null
      ? r.stockholdersEquity
      : minus(r.totalAssets,r.totalLiabilities);

  r.investedCapital =
    n(eq) !== null &&
    n(r.totalDebt) !== null &&
    n(r.cash) !== null
      ? eq+r.totalDebt-r.cash
      : null;

  r.averageInvestedCapital =
    older &&
    n(r.investedCapital) !== null &&
    n(older.investedCapital) !== null
      ? (r.investedCapital+older.investedCapital)/2
      : null;

  r.roic = ratio(r.nopat,r.averageInvestedCapital);

  r.netAcquisitions =
    n(r.acquisitions) !== null &&
    n(r.divestitures) !== null
      ? r.acquisitions-r.divestitures
      : null;

  return r;
}

// Fiscal year label for a fiscal year-end date. 52/53-week years that end on
// the weekend nearest December 31 can end in the first days of January:
// Johnson & Johnson's fiscal 2022 ended 2023-01-01. Labelling that 2023
// would duplicate fiscal 2023, so a year ending by January 7 belongs to the
// prior calendar year. Late-January and February year-ends (retailers) keep
// the calendar year they end in.
function fiscalYearOf(end) {
  const year=Number(end.slice(0,4));
  return end.slice(5,10)<='01-07' ? year-1 : year;
}

export function periods(map,forms=['10-K','10-K/A']) {

  const from = key =>
    [...new Set(
      map[key]
        .filter(r =>
          forms.includes(r.form) &&
          validDate(r.start) &&
          dayCount(r.start,r.end)>=330 &&
          dayCount(r.start,r.end)<=385
        )
        .map(r=>r.end)
    )].sort().reverse();

  const result = from('revenue');

  return (result.length ? result : from('netIncome')).slice(0,21);
}

export function buildAnnual(map,ends,cik=null,forms=['10-K','10-K/A'],debtFree=null) {

  const raw = ends.map(end => {
    const get = k =>
      val(map[k],end,INSTANT.has(k)?'instant':'annual',forms);

    const r = {
      fiscalYear:fiscalYearOf(end),
      fiscalPeriodEnd:end
    };

    for (const k of Object.keys(TAGS)) {
      r[k] = get(k);
    }

    const debtContext={cik,periodEnd:end,form:forms[0],noCurrentDebtNearby:noCurrentDebtNear(map,end)};
    r.totalDebt = debt(get,debtContext);
    if (forms.includes('10-K')) fillUnknownDebt(r,map,end,get,debtContext);
    if (r.totalDebt===null && debtFree?.(end,forms,map.totalAssets)) {
      r.totalDebt = 0;   // debt-free: see debt-free.js
      r.debtEvidence = {status:'no-debt-in-filing'};
    }
    const proof=auditedAbsentCurrentDebtProof(debtContext,get('longTermDebt'));
    if(proof && r.totalDebt===proof.noncurrent &&
       get('shortTermDebt')===null &&
       get('currentPortionLongTermDebt')===null) {
      // Retain verified source inputs separately from calculated ROIC.
      r.longTermDebt=r.longTermDebt??proof.noncurrent;
      r.debtEvidence=proof;
    }
    return r;
  });

  const bank = isBank(map);
  for (let i=raw.length-1;i>=0;i--) {
    decorate(raw[i],raw[i+1],bank);
  }

  for (let i=0;i<raw.length;i++) {
    const v = ratio(raw[i].revenue,raw[i+1]?.revenue);
    raw[i].revenueGrowth = v!==null ? v-1 : null;
  }

  return raw.slice(0,20).map(r =>
    Object.fromEntries(
      ANNUAL_FIELDS.map(k => [k,r[k]??null])
    )
  );
}

/*
 * Quarterly net acquisitions (cash paid for businesses, net of cash
 * acquired, minus cash received for businesses sold). Cash-flow statements
 * are year to date, so each quarter is this period's year-to-date figure
 * minus the previous quarter's. A company shows these lines only when the
 * amounts matter, so an absent line counts as 0, but only when:
 * - the period's cash-flow statement was filed (operating cash flow present);
 * - the company used the standard acquisitions line within ~5.5 years of the
 *   period (otherwise it likely uses its own label, which SEC's data omits:
 *   Microsoft);
 * - no footnote reports cash paid for an acquisition in that period.
 * Otherwise the quarter (and the next, which subtracts it) stays null.
 */
export const ACQ_BASIS={reported:0,countedZero:1,noStatement:2,noStandardLine:3,disclosedDeal:4};
export function netAcquisitionsQuarter(r,map,end,isQ4,forms,prev,j) {
  const kind=isQ4?'annual':'ytd';
  const statement=val(map.operatingCashFlow||[],end,kind,forms)!==null;
  const acqFiled=val(map.acquisitions||[],end,kind,forms);
  const standard=(map.acquisitions||[]).some(f=>Math.abs(Date.parse(f.end)-Date.parse(end))<=2000*864e5);
  const disclosed=n(val(map.acquisitionDisclosure||[],end,kind,forms))>0;
  let basis, ytd=null;
  if (!statement) basis=ACQ_BASIS.noStatement;
  else if (acqFiled===null && !standard) basis=ACQ_BASIS.noStandardLine;
  else if (acqFiled===null && disclosed) basis=ACQ_BASIS.disclosedDeal;
  else {
    basis=acqFiled===null?ACQ_BASIS.countedZero:ACQ_BASIS.reported;
    const div=val(map.divestitures||[],end,kind,forms);
    ytd=(acqFiled??0)-(div??0);
  }
  r.netAcquisitions = j===0 ? ytd : minus(ytd,prev.__netAcquisitions);
  r.acquisitionsBasis = basis;
  prev.__netAcquisitions=ytd;
}

function buildQuarterly(map,ends,cik=null,debtFree=null) {
  const formsQ = ['10-Q','10-Q/A'];
  const formsY = ['10-K','10-K/A'];

  const qEnds = [...new Set(
    map.netIncome
      .filter(r =>
        formsQ.includes(r.form) &&
        validDate(r.start) &&
        dayCount(r.start,r.end)>=60 &&
        dayCount(r.start,r.end)<=310
      )
      .map(r=>r.end)
  )].sort();

  const groups = [];

  if (ends.length) {
    const current = qEnds
      .filter(d=>d>ends[0])
      .slice(0,3);

    if (current.length) {
      groups.push({
        ends:current,
        year:fiscalYearOf(ends[0])+1
      });
    }
  }

  for (let i=0;i<Math.min(ends.length-1,15);i++) {
    const qs = qEnds
      .filter(d=>d>ends[i+1]&&d<ends[i])
      .slice(-3);

    if (qs.length===3) {
      groups.push({
        ends:[...qs,ends[i]],
        year:fiscalYearOf(ends[i])
      });
    }
  }

  // The fiscal year just before the oldest complete one: a young company's
  // first 10-Qs show only the latest quarters of its pre-IPO year as
  // comparatives (The Trade Desk: Q3 2015 in its Q3 2016 10-Q). Those
  // quarters and the derived Q4 (annual minus nine-month YTD) extend the
  // history; earlier quarters stay absent. Only reported three-month
  // figures are used for the first quarter of such a partial year.
  const oldest = groups.filter(g=>g.ends.length===4).at(-1);
  const at = oldest ? ends.indexOf(oldest.ends[3]) : -1;
  if (at>=0 && at+1<ends.length && at<15) {
    const lower = ends[at+2] ?? null;
    const qs = qEnds
      .filter(d=>d<ends[at+1] && (lower===null || d>lower) &&
        dayCount(d,ends[at+1])<=280)
      .slice(-3);
    // They must be the year's last quarters, consecutive (Q2-Q3 or Q3),
    // judged by distance from the year end, never e.g. Q1-Q2 relabelled.
    const steps = qs.map(d=>Math.round(dayCount(d,ends[at+1])/91.3));
    const lastQuarters = steps.every((k,i)=>k===qs.length-i);
    if (qs.length>=1 && qs.length<3 && lastQuarters) {
      groups.push({
        ends:[...qs,ends[at+1]],
        year:fiscalYearOf(ends[at+1]),
        firstQuarter:4-qs.length
      });
    }
  }

  const rows = [];
  const flowing = Object.keys(TAGS).filter(k=>!INSTANT.has(k));

  for (const group of groups) {
    const previousYtd = {};

    for (let j=0;j<group.ends.length;j++) {
      const end = group.ends[j];
      const isQ4 = j===group.ends.length-1 && group.ends.length===4 ||
        (group.firstQuarter && j===group.ends.length-1);
      const forms = isQ4 ? formsY : formsQ;

      const r = {
        fiscalYear:group.year,
        fiscalQuarter:(group.firstQuarter||1)+j,
        fiscalPeriodEnd:end
      };

      for (const key of flowing) {
        const ytd = val(
          map[key],end,isQ4?'annual':'ytd',forms
        );

        const direct = val(map[key],end,'quarter',forms);
        let amount = null;

        if (key==='dilutedShares' || key==='dilutedEPS' || key==='basicEPS') {
          amount = direct;
        } else if (n(direct)!==null) {
          amount = direct;
        } else if (j===0) {
          // A partial year's first quarter is not Q1: its YTD spans
          // earlier quarters, so only a reported three-month figure counts.
          amount = group.firstQuarter ? null : ytd;
        } else {
          amount = minus(ytd,previousYtd[key]);
        }

        r[key] = amount;
        previousYtd[key] = ytd;
      }

      const get = k => val(map[k],end,'instant',forms);

      for (const k of INSTANT) {
        r[k] = get(k);
      }

      const debtContext={cik,periodEnd:end,form:isQ4?'10-K':'10-Q',noCurrentDebtNearby:noCurrentDebtNear(map,end)};
      r.totalDebt = debt(get,debtContext);
      fillUnknownDebt(r,map,end,get,debtContext);
      if (r.totalDebt===null && debtFree?.(end,forms,map.totalAssets)) {
        r.totalDebt = 0;   // debt-free: see debt-free.js
        r.debtEvidence = {status:'no-debt-in-filing'};
      }
      const proof=auditedAbsentCurrentDebtProof(debtContext,get('longTermDebt'));
      if(proof && r.totalDebt===proof.noncurrent &&
         get('shortTermDebt')===null &&
         get('currentPortionLongTermDebt')===null) {
        r.longTermDebt=r.longTermDebt??proof.noncurrent;
        r.debtEvidence=proof;
      }
      decorate(r,null,isBank(map));
      netAcquisitionsQuarter(r,map,end,isQ4,forms,previousYtd,j);
      // A partial year's first quarter has only a multi-quarter YTD.
      if (group.firstQuarter && j===0) r.netAcquisitions=null;
      rows.push(r);
    }
  }

  rows.sort((a,b) =>
    b.fiscalYear-a.fiscalYear ||
    b.fiscalQuarter-a.fiscalQuarter
  );

  return rows.slice(0,60);
}

function coverShares(rows,sec) {
  const outstanding =
    sec.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares || [];

  const diluted =
    sec.facts?.['us-gaap']?.
      WeightedAverageNumberOfDilutedSharesOutstanding?.
      units?.shares || [];

  for (const r of rows) {
    r.sharesOutstanding = null;
    r.sharesOutstandingAsOf = null;

    const cover = outstanding
      .filter(f =>
        r._accession &&
        f.accn===r._accession &&
        ['10-Q','10-K','10-Q/A','10-K/A'].includes(f.form) &&
        n(f.val)!==null &&
        f.val>0 &&
        Number.isSafeInteger(f.val) &&
        validDate(f.end) &&
        dayCount(r.fiscalPeriodEnd,f.end)>=-7 &&
        r.secFilingDate &&
        dayCount(f.end,r.secFilingDate)>=-1
      )
      .sort((a,b)=>b.end.localeCompare(a.end))[0];

    if (cover) {
      r.sharesOutstanding = cover.val;
      r.sharesOutstandingAsOf = cover.end;
    }

    const precise = diluted
      .filter(f =>
        f.end===r.fiscalPeriodEnd &&
        ['10-Q','10-K','10-Q/A','10-K/A'].includes(f.form) &&
        validDate(f.start) &&
        dayCount(f.start,f.end)>=60 &&
        dayCount(f.start,f.end)<=110 &&
        n(f.val)!==null &&
        f.val>0 &&
        (!r._accession||f.accn===r._accession)
      )
      .sort((a,b)=>
        String(b.filed||'').localeCompare(String(a.filed||''))
      )[0];

    r.dilutedShares =
      precise?.val ??
      (n(r.dilutedShares)!==null ? r.dilutedShares : null);
    // With no dilution (diluted EPS = basic EPS) the basic weighted count is
    // the diluted count. ExxonMobil Holdings' first 10-Q tagged only basic.
    if (r.dilutedShares===null && n(r.basicShares)!==null && r.basicShares>0 &&
        n(r.dilutedEPS)!==null && n(r.basicEPS)!==null &&
        Math.abs(r.dilutedEPS-r.basicEPS)<0.005) {
      r.dilutedShares = r.basicShares;
    }

    delete r._accession;
  }
}

function outputRows(rows,fields) {
  return rows.map(r =>
    Object.fromEntries(
      fields.map(k=>[k,r[k]??null])
    )
  );
}

/**
 * Annual rows for a 20-F/40-F filer, in its reporting currency, through the
 * same buildAnnual as a US company. Per-share figures (EPS, dividends per
 * share) and share counts are put on the newest report's share basis
 * (reportBasis); a figure from a report whose basis can't be proven is null.
 * @returns {{rows, basis:{standard,taxonomy,currency}|null}}
 */
export function buildForeignAnnual(facts,cik=null) {
  const basis=foreignReportingBasis(facts);
  if (!basis) return {rows:[],basis:null};
  const bucket=facts.facts[basis.taxonomy];
  // us-gaap foreign filers (ASML) pay dividends under PaymentsOfOrdinaryDividends;
  // added here only, so US companies' tag lists are unchanged.
  const tags=basis.taxonomy==='ifrs-full'?IFRS_TAGS:
    {...TAGS,dividendsPaid:[...TAGS.dividendsPaid,'PaymentsOfOrdinaryDividends']};
  const map=Object.fromEntries(Object.keys(TAGS).map(k=>
    [k,fieldFacts(bucket,k,{tags,currency:basis.currency})]));
  // IFRS bonds + bank loans when no Borrowings total is filed (TSMC).
  if (basis.taxonomy==='ifrs-full') {
    const filed=new Set(map.totalDebt.map(f=>f.end));
    map.totalDebt.push(...composedIfrsDebt(bucket,basis.currency)
      .filter(f=>!filed.has(f.end)).map(f=>({...f,priority:9})));
  }
  const forms=FOREIGN_ANNUAL_FORMS;
  const rows=buildAnnual(map,periods(map,forms),cik,forms);
  const reports=reportBasis([...map.dilutedEPS,...map.basicEPS],
    [...map.dilutedShares,...map.basicShares]);
  for (const r of rows) {
    const pick=k=>chooseRecord(map[k],r.fiscalPeriodEnd,'annual',forms);
    for (const k of ['dilutedEPS','basicEPS','dividendsPerShare']) {
      const rec=pick(k), m=rec?reports.get(rec.accn):null;
      r[k]=rec&&m!=null?rec.val*m:null;
    }
    const rec=pick('dilutedShares'), m=rec?reports.get(rec.accn):null;
    r.dilutedShares=rec&&m!=null?rec.val/m:null;
  }
  // No per-share dividend for the year (ASML pays interim and final
  // dividends tagged as monthly periods; TSMC quarterly): dividends paid
  // in the year / diluted shares, on today's share basis.
  const dpsFromPaid=[];
  for (const r of rows) {
    if (r.dividendsPerShare===null && r.dividendsPaid>0 && r.dilutedShares>0) {
      r.dividendsPerShare=r.dividendsPaid/r.dilutedShares;
      dpsFromPaid.push(r.fiscalYear);
    }
  }
  return {rows,basis,dpsFromPaid,shares:coverSharesOutstanding(facts)};
}

/**
 * A plain reason when an issuer files as a foreign private issuer (annual
 * 20-F or 40-F, quarterly results as 6-K press releases, which SEC's
 * structured data does not include) instead of 10-K/10-Q. Null otherwise.
 */
export function foreignFilerReason(sub,name,standard=null) {
  const forms=(sub?.filings?.recent?.form)||[];
  if (forms.some(f=>/^10-[KQ]/.test(f))) return null;
  const annual=forms.find(f=>/^(20|40)-F/.test(f));
  if (!annual) return null;
  return `${name} files with the SEC as a foreign company (annual ${annual.replace('/A','')} reports`+
    (standard ? ` under ${standard} accounting` : '')+`, `+
    `quarterly results only as 6-K press releases that SEC's data feed does not include), `+
    `so the SEC-based figures in column I can't be calculated for it yet. `+
    `Columns J-L still show outside data.`;
}

function validateOutput(a,q,annualOnly=false) {
  // Short SEC histories are valid. Never invent missing periods.

  if (!a.length) {
    throw Error('No usable SEC annual financial periods found.');
  }

  if (!q.length && !annualOnly) {
    throw Error('No usable SEC quarterly financial periods found.');
  }

  const latest = q[0];

  if (latest && (n(latest.revenue)===null || n(latest.netIncome)===null)) {
    throw Error(
      'Latest SEC quarter lacks reported revenue or net income.'
    );
  }

  if (n(a[0].revenue)===null || n(a[0].netIncome)===null) {
    throw Error(
      'Latest SEC fiscal year lacks reported revenue or net income.'
    );
  }

  for (let i=1;i<a.length;i++) {
    if (a[i-1].fiscalYear<=a[i].fiscalYear) {
      throw Error('SEC annual periods are duplicated or incorrectly ordered.');
    }
  }

  for (let i=1;i<q.length;i++) {
    const prior =
      q[i-1].fiscalYear*4+q[i-1].fiscalQuarter;

    const next =
      q[i].fiscalYear*4+q[i].fiscalQuarter;

    if (prior<=next) {
      throw Error('SEC quarterly periods are duplicated or incorrectly ordered.');
    }
  }
}


async function limitedSecDocument(filing) {
  if (!filing.filingDocumentUrl?.startsWith('https://www.sec.gov/Archives/edgar/data/')) {
    throw Error('Untrusted SEC document location');
  }
  const response=await fetch(filing.filingDocumentUrl,{
    headers:{'User-Agent':CONTACT,'Accept':'text/html,text/plain'},
    redirect:'manual',cf:{cacheTtl:86400,cacheEverything:true}
  });
  if (response.status>=300 && response.status<400) throw Error('Unexpected SEC redirect');
  if (!response.ok) throw Error('SEC filing returned '+response.status);
  const maxBytes=6_000_000;
  const size=Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size>maxBytes) throw Error('SEC filing too large');
  const reader=response.body?.getReader();
  if (!reader) throw Error('SEC filing body missing');
  const chunks=[]; let bytes=0;
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done) break;
      bytes+=value.byteLength;
      if(bytes>maxBytes) throw Error('SEC filing too large');
      chunks.push(value);
    }
  } finally {
    if(bytes>maxBytes) await reader.cancel();
  }
  const all=new Uint8Array(bytes);
  let offset=0;
  for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder().decode(all);
}

/** Historic submissions live in additional free SEC JSON archives. */
async function historicalSplitFilings(sub,cik,structuredEvidence) {
  const listings=[secSplitFilingCandidates(sub,structuredEvidence)];
  const files=(sub.filings?.files||[])
    .filter(f=>/^\d{4}-\d{2}-\d{2}$/.test(f.filingTo||'') &&
      f.filingTo >= '2005-01-01' &&
      /^CIK\d{10}-submissions-\d{3}\.json$/.test(f.name||''))
    .slice(0,25);
  const failed=[];
  for(let i=0;i<files.length;i+=3){
    const batch=await Promise.all(files.slice(i,i+3).map(async item=>{
      try {
        const x=await secFetch(SEC+'/submissions/'+item.name);
        return secSplitFilingCandidates({cik,filings:{recent:x}},structuredEvidence);
      }catch(error){
        failed.push({file:item.name,error:String(error?.message||error).slice(0,100)});
        return [];
      }
    }));
    listings.push(...batch);
  }
  const map=new Map();
  for(const item of listings.flat()) if(!map.has(item.accession))map.set(item.accession,item);
  return {candidates:[...map.values()],failedArchives:failed,archiveCount:files.length};
}

/* =========================================================
   ONE CALCULATION PER REFRESH
   A sheet refresh sends the Apps Script import plus three IMPORTDATA feeds
   (basic EPS annual/quarterly, blank reasons) within about a second. Each
   used to rerun the whole SEC download and calculation, and four at once
   exceeded the Worker's resource limits ("Worker exceeded resource limits",
   HTTP 503), dropping one at random. The import always calculates fresh and
   stores its result; the feeds reuse a result under FEED_REUSE_MS old, and
   concurrent feed requests share one calculation. Feed output is unchanged.
   ========================================================= */
const FEED_REUSE_MS = 5*60*1000;
const FEED_PARAMS = new Set(['ticker','basicEpsCsv','fcfPerShareCsv','netAcquisitionsCsv','quarterlyExtrasCsv','blankReasons','revision','release','retry']);
const recent = new Map(); // ticker -> {at, promise of {status, body}}

// One value per quarterly row, newest first; 'NA' keeps row positions.
const columnCsv = key => rows => rows.map(r=>n(r[key])!==null?String(r[key]):'NA').join('\n')+'\n';
const fcfCsv = columnCsv('fcfPerShare');
const acqCsv = columnCsv('netAcquisitions');
// One request for Quarterly Data AA:AC (basicEPS, fcfPerShare,
// netAcquisitions), so a refresh asks the worker for data fewer times.
const QUARTERLY_EXTRAS = ['basicEPS','fcfPerShare','netAcquisitions'];
const extrasCsv = rows => rows.map(r=>QUARTERLY_EXTRAS.map(k=>n(r[k])!==null?String(r[k]):'NA').join(',')).join('\n')+'\n';

function csvResponse(text) {
  return new Response(text,{headers:{
    'content-type':'text/csv; charset=utf-8',
    'access-control-allow-origin':'*',
    'cache-control':'public, max-age=900'
  }});
}

function remember(ticker,promise) {
  const entry={at:Date.now(),promise};
  recent.set(ticker,entry);
  // Failed calculations are not reused; at most 8 tickers are kept.
  promise.then(r=>{ if(r.status!==200 && recent.get(ticker)===entry) recent.delete(ticker); },
    ()=>{ if(recent.get(ticker)===entry) recent.delete(ticker); });
  while (recent.size>8) recent.delete(recent.keys().next().value);
  return promise;
}

async function calculate(ticker,handler) {
  const response=await handler(new Request('https://internal.local/?ticker='+encodeURIComponent(ticker)));
  return {status:response.status,body:await response.text()};
}

export function resetFeedReuse() { recent.clear(); }

export async function routeRequest(request,handler=handleRequest) {
  if (request.method!=='GET') return handler(request);
  const url=new URL(request.url);
  const params=[...url.searchParams.keys()];
  const ticker=(url.searchParams.get('ticker')||'').trim().toUpperCase();
  // Raw views, audits and inspections keep their own path.
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker) || params.some(k=>!FEED_PARAMS.has(k)))
    return handler(request);
  const feed=url.searchParams.get('blankReasons')==='1' ? 'reasons'
    : url.searchParams.has('basicEpsCsv') ? 'basic'
    : url.searchParams.has('fcfPerShareCsv') ? 'fcf'
    : url.searchParams.has('netAcquisitionsCsv') ? 'acq'
    : url.searchParams.has('quarterlyExtrasCsv') ? 'extras' : null;
  if (feed==='basic' && !['annual','quarterly'].includes(url.searchParams.get('basicEpsCsv')))
    return json({success:false,error:'Choose basicEpsCsv=annual or quarterly'},400);
  if (feed==='fcf' && url.searchParams.get('fcfPerShareCsv')!=='quarterly')
    return json({success:false,error:'Use fcfPerShareCsv=quarterly'},400);
  if (feed==='acq' && url.searchParams.get('netAcquisitionsCsv')!=='quarterly')
    return json({success:false,error:'Use netAcquisitionsCsv=quarterly'},400);
  if (feed==='extras' && url.searchParams.get('quarterlyExtrasCsv')!=='1')
    return json({success:false,error:'Use quarterlyExtrasCsv=1'},400);

  let result;
  if (!feed) {
    result=await remember(ticker,calculate(ticker,handler));
  } else {
    const hit=recent.get(ticker);
    result=await (hit && Date.now()-hit.at<FEED_REUSE_MS
      ? hit.promise : remember(ticker,calculate(ticker,handler)));
  }
  if (result.status!==200 || !feed) return new Response(result.body,{status:result.status,headers:{
    'content-type':'application/json; charset=utf-8',
    'access-control-allow-origin':'*',
    'cache-control':'public, max-age=900'
  }});
  return feedResponse(feed,JSON.parse(result.body),url,ticker);
}

// A feed's CSV, derived from the import's JSON.
function feedResponse(feed,data,url,ticker) {
  if (feed==='reasons') return csvResponse(blankReasonsCsv(data.blankReasons||[],ticker));
  if (feed==='fcf') return csvResponse(fcfCsv(data.quarterlyFinancials));
  if (feed==='acq') return csvResponse(acqCsv(data.quarterlyFinancials));
  if (feed==='extras') return csvResponse(extrasCsv(data.quarterlyFinancials));
  const records=url.searchParams.get('basicEpsCsv')==='annual'?data.annualFinancials:data.quarterlyFinancials;
  return csvResponse(records.map(r=>n(r.basicEPS)!==null?String(r.basicEPS):'NA').join('\n')+'\n');
}

export default {
  fetch(request) { return routeRequest(request); }
};

async function handleRequest(request) {
    if (request.method!=='GET') {
      return json({success:false,error:'GET only'},405);
    }

    try {
      const ticker =
        (new URL(request.url).searchParams.get('ticker')||'')
          .trim().toUpperCase();

      if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
        return json({
          success:false,
          error:'Provide ?ticker=AAPL'
        },400);
      }

      // Read-only split text inspection, constrained to SEC filing candidates.
      // Fetches exactly one SEC document, never alters reported financial fields.
      const url = new URL(request.url);
      const inspectAccession = url.searchParams.get('inspectSplitAccession');
      const directory = await secFetch(
        'https://www.sec.gov/files/company_tickers.json'
      );

      const company = Object.values(directory).find(v =>
        String(v.ticker||'').toUpperCase()===ticker
      );

      if (!company) {
        return json({
          success:false,
          error:'Ticker not in SEC directory'
        },404);
      }

      const cik = String(company.cik_str).padStart(10,'0');

      let [facts,sub] = await Promise.all([
        secFetch(`${SEC}/api/xbrl/companyfacts/CIK${cik}.json`),
        secFetch(`${SEC}/submissions/CIK${cik}.json`)
      ]);

      if (
        Number(facts.cik)!==Number(cik) ||
        Number(sub.cik)!==Number(cik)
      ) {
        throw Error('SEC CIK mismatch');
      }

      // Read-only raw SEC views, deliberately separate from normalized
      // spreadsheet-facing arrays. Company Facts excludes custom issuer tags.
      const rawCatalog = url.searchParams.get('secCatalog');
      const rawFact = url.searchParams.get('secFact');
      const rawEverything = url.searchParams.get('secRawFacts');
      if (rawCatalog !== null || rawFact !== null || rawEverything !== null) {
        if ([rawCatalog,rawFact,rawEverything].filter(v=>v!==null).length!==1)
          return json({success:false,error:'Choose one SEC source view'},400);
        const parseBounded=(name,fallback,max,min=0)=>{
          const value=url.searchParams.get(name);
          if(value===null)return fallback;
          if(!/^[0-9]+$/.test(value))throw new RangeError('Invalid '+name);
          const n=Number(value);
          if(!Number.isSafeInteger(n)||n<min||n>max)
            throw new RangeError('Invalid '+name);
          return n;
        };
        try {
          if(rawCatalog!==null) {
            if(rawCatalog!=='1')
              return json({success:false,error:'Use secCatalog=1'},400);
            return json({
              success:true,ticker,cik,
              ...secFactsCatalog(facts,{
                page:parseBounded('page',1,100000,1),
                pageSize:parseBounded('pageSize',100,200,1),
                search:url.searchParams.get('search')||''
              })
            });
          }
          if(rawEverything!==null) {
            if(rawEverything!=='1')
              return json({success:false,error:'Use secRawFacts=1'},400);
            return json({
              success:true,ticker,cik,
              ...secRawFactsPage(facts,{
                offset:parseBounded('offset',0,100000000),
                limit:parseBounded('limit',100,200,1)
              })
            });
          }
          const concept=secRawConcept(facts,{
            selector:rawFact,
            offset:parseBounded('offset',0,10000000),
            limit:parseBounded('limit',100,200,1)
          });
          if(!concept)
            return json({success:false,error:'SEC concept not reported for ticker'},404);
          return json({success:true,ticker,cik,...concept});
        } catch(e) {
          if(e instanceof TypeError || e instanceof RangeError)
            return json({success:false,error:e.message},400);
          throw e;
        }
      }

      // A successor registrant (holding-company reorganization) inherits its
      // verified predecessor's history; see sec-predecessor.js.
      const succession = await withPredecessor(facts,sub,cik,secFetch,SEC);
      facts = succession.facts;
      sub = succession.sub;

      // Foreign private issuers (20-F/40-F, no 10-K/10-Q): annual rows only,
      // in the reporting currency; the sheet converts to US dollars.
      if (isForeignAnnualFiler(sub)) {
        const name=facts.entityName||company.title||ticker;
        const foreign=buildForeignAnnual(facts,cik);
        if (!foreign.rows.length) {
          throw Error(foreignFilerReason(sub,name,facts.facts?.['ifrs-full']?'IFRS':null)||
            'No usable SEC annual financial periods found.');
        }
        validateOutput(foreign.rows,[],true);
        const dividendVerification=await verifyDividends(foreign.rows,[],sub,cik,limitedSecDocument);
        foreign.rows=dividendVerification.annual;
        const form=annualFormOf(sub);
        const index=(sub.tickers||[]).findIndex(t=>String(t).toUpperCase()===ticker);
        const data={
          schemaVersion:VERSION,success:true,ticker,cik,companyName:name,
          exchange:index>=0?(sub.exchanges?.[index]||''):'',
          // 'annual': no quarterly rows; figures are in reportingCurrency.
          dataBasis:'annual',
          reportingCurrency:foreign.basis.currency,
          reportingStandard:foreign.basis.standard,
          annualReportForm:form,
          annualFinancials:foreign.rows,
          quarterlyFinancials:[],
          // Cover-page shares outstanding of the latest annual report
          // (ordinary shares; the sheet converts to ADRs).
          sharesOutstanding:foreign.shares.value,
          sharesOutstandingAsOf:foreign.shares.asOf,
          // Fiscal years whose dividendsPerShare = dividends paid / diluted shares.
          dividendsPerShareFromPaid:foreign.dpsFromPaid,
          dividendVerification:{...dividendVerification.evidence,checks:dividendVerification.checks,rule:'Zero only with explicit SEC evidence; missing remains unknown.'},
          blankReasons:[{metric:'Quarterly figures',reason:
            `${name} files annual ${form} reports with the SEC (no quarterly 10-Q data), `+
            `with figures in ${foreign.basis.currency} under ${foreign.basis.standard}. `+
            `Financial Data holds ${foreign.rows.length} fiscal years (latest FY${foreign.rows[0].fiscalYear}); `+
            `Quarterly Data stays empty.`}],
          coverage:{annualYears:foreign.rows.length,reportedQuarters:0,latestFourConsecutive:false},
          retrievedAt:new Date().toISOString(),
          provenance:'SEC EDGAR companyfacts ('+form+' annual reports) and submissions; Google Finance supplies live prices and exchange rates'
        };
        const feed=url.searchParams.get('blankReasons')==='1' ? 'reasons'
          : url.searchParams.has('basicEpsCsv') ? 'basic'
          : url.searchParams.has('fcfPerShareCsv') ? 'fcf'
          : url.searchParams.has('netAcquisitionsCsv') ? 'acq'
          : url.searchParams.has('quarterlyExtrasCsv') ? 'extras' : null;
        return feed ? feedResponse(feed,data,url,ticker) : json(data);
      }

      const gaap = facts.facts?.['us-gaap'];

      if (!gaap) {
        throw Error(
          foreignFilerReason(sub, facts.entityName||company.title||ticker,
            facts.facts?.['ifrs-full'] ? 'IFRS' : null) ||
          'No SEC us-gaap Company Facts; issuer not supported.'
        );
      }

      if (url.searchParams.get('basisAudit') === '1') {
        const graph=buildSECShareBasisGraph(facts);
        const shareMap=Object.fromEntries(Object.keys(TAGS).map(k=>[
          k,fieldFacts(gaap,k)
        ]));
        const fiscalEnds=periods(shareMap);
        const annual=buildAnnual(shareMap,fiscalEnds,cik);
        const quarterly=buildQuarterly(shareMap,fiscalEnds,cik);
        const basisEarningsHistory = await fullQuarterFilingHistory(sub,quarterly,cik,secFetch);
        assignQuarterDates(quarterly,basisEarningsHistory.filings);
        coverShares(quarterly,facts);
        const findFact=(row,metric,kind,forms)=>{
          const list=(shareMap[metric]||[]).filter(r=>
            r.end===row.fiscalPeriodEnd && forms.includes(r.form) &&
            validDate(r.start) && (
              kind==='annual'
                ? dayCount(r.start,r.end)>=330 && dayCount(r.start,r.end)<=385
                : dayCount(r.start,r.end)>=60 && dayCount(r.start,r.end)<=110
            ));
          const first=chooseRecord(shareMap[metric],row.fiscalPeriodEnd,kind,forms);
          return [first,...list].filter(Boolean);
        };
        const adjustedAnnual=normalizeUsingSECShareGraph(
          annual,graph,(row,metric)=>findFact(row,metric,'annual',['10-K','10-K/A'])
        );
        const adjustedQuarterly=normalizeUsingSECShareGraph(
          quarterly,graph,(row,metric)=>findFact(row,metric,'quarter',
            row.fiscalQuarter===4?['10-K','10-K/A']:['10-Q','10-Q/A'])
        );
        return json({
          schemaVersion:VERSION,success:true,ticker,cik,
          originalAnnualFinancials:annual,
          originalQuarterlyFinancials:outputRows(quarterly,QUARTER_FIELDS),
          shareBasisGraph:graph,
          adjustedAnnualFinancials:adjustedAnnual,
          adjustedQuarterlyFinancials:adjustedQuarterly,
          note:'SEC-only cross-filing share-basis inference. Unconnected or contradictory per-share observations remain null in adjusted financials.'
        });
      }

      const stockSplitAudit = splitAudit(facts);
      const allFilingCandidates = secSplitFilingCandidates(sub,stockSplitAudit.candidates);
      stockSplitAudit.filingCandidates = allFilingCandidates.slice(0,30);

      if (url.searchParams.get('discoverSplits') === '1') {
        const historical=await historicalSplitFilings(sub,Number(cik),stockSplitAudit.candidates);
        const requestedLimit=Number(url.searchParams.get('maxDocuments')||30);
        const maxDocuments=Number.isSafeInteger(requestedLimit) &&
          requestedLimit>=1 && requestedLimit<=50 ? requestedLimit : 30;
        const scan=await inspectSplitFilingBatch(historical.candidates,limitedSecDocument,
          {maxDocuments});
        const reportingRestatements=secRestatementEvidence(facts,scan.verifiedEvents);
        const normalizedPreview=previewProvenPerShare(
          facts,scan.verifiedEvents,new Date().toISOString().slice(0,10)
        );
        const targetDate=new Date().toISOString().slice(0,10);
        const splitMap=Object.fromEntries(Object.keys(TAGS).map(k=>[
          k,fieldFacts(gaap,k)
        ]));
        const splitEnds=periods(splitMap);
        const originalAnnual=buildAnnual(splitMap,splitEnds,cik);
        const originalQuarter=buildQuarterly(splitMap,splitEnds,cik);
        const previewEarningsHistory = await fullQuarterFilingHistory(sub,originalQuarter,cik,secFetch);
        assignQuarterDates(originalQuarter,previewEarningsHistory.filings);
        coverShares(originalQuarter,facts);
        const candidateSources=(row,metric,kind,forms)=>{
          const all=(splitMap[metric]||[]).filter(r=>
            r.end===row.fiscalPeriodEnd && forms.includes(r.form) &&
            validDate(r.start) && (
              kind==='annual'
                ? dayCount(r.start,r.end)>=330 && dayCount(r.start,r.end)<=385
                : dayCount(r.start,r.end)>=60 && dayCount(r.start,r.end)<=110
            )
          );
          const chosen=chooseRecord(splitMap[metric],row.fiscalPeriodEnd,kind,forms);
          return [chosen,...all].filter(Boolean);
        };
        const auditedAnnual=auditedSplitRows(
          originalAnnual,scan.verifiedEvents,targetDate,(row,metric)=>
            candidateSources(row,metric,'annual',['10-K','10-K/A'])
        );
        const auditedQuarter=auditedSplitRows(
          originalQuarter,scan.verifiedEvents,targetDate,(row,metric)=>
            candidateSources(row,metric,'quarter',
              row.fiscalQuarter===4 ? ['10-K','10-K/A'] : ['10-Q','10-Q/A'])
        );
        return json({
          schemaVersion:VERSION,success:true,ticker,cik,
          splitDiscovery:{...scan,reportingRestatements,normalizedPreview,
            auditedAnnualFinancials:auditedAnnual,
            auditedQuarterlyFinancials:auditedQuarter,
            splitHistoryComplete:false,archiveCount:historical.archiveCount,
            failedArchives:historical.failedArchives,
            filingCandidatesFound:historical.candidates.length},
          annualFinancials:null,quarterlyFinancials:null,
          note:'Only explicit completed SEC disclosures become verified events. Preview is restricted to filings with retrospective per-share basis proof; historical split completeness cannot be guaranteed.'
        });
      }

      if (inspectAccession !== null) {
        const candidate = allFilingCandidates.find(f =>
          f.accession === inspectAccession
        );
        if (!candidate?.filingDocumentUrl) {
          return json({success:false,error:'SEC filing not available for inspection'},404);
        }
        const response = await fetch(candidate.filingDocumentUrl, {
          headers:{'User-Agent':CONTACT,'Accept':'text/html, text/plain'},
          redirect:'manual'
        });
        if (!response.ok) throw Error('SEC filing returned HTTP '+response.status);
        const size = Number(response.headers.get('content-length'));
        if (Number.isFinite(size) && size > 2_000_000) {
          return json({success:false,error:'SEC document exceeds inspection size limit'},413);
        }
        const reader = response.body?.getReader();
        if (!reader) throw Error('SEC document body unavailable');
        const chunks = [];
        let bytes = 0;
        while (true) {
          const {done,value} = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2_000_000) {
            await reader.cancel();
            return json({success:false,error:'SEC document exceeds inspection size limit'},413);
          }
          chunks.push(value);
        }
        const all = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { all.set(chunk,offset); offset += chunk.length; }
        const statements = detectSplitStatements(new TextDecoder().decode(all),candidate.accession)
          .map(s => ({...s,dateCandidates:splitDateCandidates(s)}));
        return json({
          success:true,ticker,cik,accession:candidate.accession,
          filingDocumentUrl:candidate.filingDocumentUrl,
          statements,verifiedEvents:[],normalizationApplied:false
        });
      }

      const map = Object.fromEntries(
        Object.keys(TAGS).map(k=>[
          k,fieldFacts(gaap,k)
        ])
      );

      const ends = periods(map);
      const debtFree = debtFreeEvidence(gaap);
      const annualFinancials = buildAnnual(map,ends,cik,undefined,debtFree);
      if (!annualFinancials.length) {
        const foreign = foreignFilerReason(sub, facts.entityName||company.title||ticker);
        if (foreign) throw Error(foreign);
      }
      const quarters = buildQuarterly(map,ends,cik,debtFree);

      const earningsHistory = await fullQuarterFilingHistory(sub,quarters,cik,secFetch);
      assignQuarterDates(quarters,earningsHistory.filings);
      const factFilingDates=fillFilingDatesFromFacts(quarters,[map.netIncome,map.revenue]);
      coverShares(quarters,facts);
      const q4BasicEPSEvidence=deriveQ4BasicEPS(quarters,annualFinancials,map.basicShares,map.basicEPS);
      // Most issuers never file a standalone fiscal Q4 diluted EPS. Estimate it
      // the same guarded way from the 10-K and Q1-Q3 diluted EPS and shares;
      // a readable earnings exhibit replaces the estimate further below.
      const q4DilutedEPSEvidence=deriveQ4BasicEPS(quarters,annualFinancials,
        map.dilutedShares,map.dilutedEPS,{eps:'dilutedEPS',shares:'dilutedShares'});

      const quarterlyFinancials =
        outputRows(quarters,QUARTER_FIELDS);

      validateOutput(annualFinancials,quarterlyFinancials);

      // Automatic normalization is SEC-only. Changed split bases are applied
      // to annual history where graph evidence is consistent. Unconnected
      // historical EPS becomes null rather than an inaccurate comparison.
      // Quarterlies only switch when the entire set is provably connected,
      // preserving recent reported EPS used in the live P/E calculation.
      const basisGraph=buildSECShareBasisGraph(facts);
      const sourceCandidates=(row,metric,kind,forms)=>{
        const matching=(map[metric]||[]).filter(r=>
          r.end===row.fiscalPeriodEnd && forms.includes(r.form) &&
          validDate(r.start) && (
            kind==='annual'
              ? dayCount(r.start,r.end)>=330 && dayCount(r.start,r.end)<=385
              : dayCount(r.start,r.end)>=60 && dayCount(r.start,r.end)<=110
          ));
        return [chooseRecord(map[metric],row.fiscalPeriodEnd,kind,forms),
          ...matching].filter(Boolean);
      };
      const annualNormalized=normalizeUsingSECShareGraph(
        annualFinancials,basisGraph,(row,metric)=>
          sourceCandidates(row,metric,'annual',['10-K','10-K/A'])
      );
      const quarterlyNormalized=normalizeUsingSECShareGraph(
        quarterlyFinancials,basisGraph,(row,metric)=>
          sourceCandidates(row,metric,'quarter',
            row.fiscalQuarter===4 ? ['10-K','10-K/A'] : ['10-Q','10-Q/A'])
      );
      const splitDetected=basisGraph.changedBasisEdges.length>0;
      const consistent=basisGraph.conflicts.length===0;
      const autoAnnual=splitDetected && consistent;
      const autoQuarterly=autoAnnual && quarterlyNormalized.complete;
      let finalAnnual=autoAnnual?annualNormalized.rows:annualFinancials;
      const annualSharesProof=(row)=>{
        const quarter=quarters.find(q=>q.fiscalPeriodEnd===row.fiscalPeriodEnd);
        const fiscalAnnual=annualFinancials.find(a=>a.fiscalYear===row.fiscalYear) ||
          (row.fiscalYear===annualFinancials[0]?.fiscalYear+1
            ? annualFinancials[0] : null);
        return findMatchingAnnualBasicEPSBasis(quarter,fiscalAnnual,
          map.basicEPS,map.basicShares,basisGraph);
      };
      const basicHistorical=normalizeHistoricalBasicEPS(
        quarterlyFinancials,basisGraph,
        row=>sourceCandidates(row,'basicEPS','quarter',
          row.fiscalQuarter===4?['10-K','10-K/A']:['10-Q','10-Q/A']),
        q4BasicEPSEvidence.findings,annualSharesProof
      );
      const dilutedAlignment=autoQuarterly
        ? {rows:quarterlyNormalized.rows,findings:null}
        : alignQuarterlyDilutedEPS(quarterlyFinancials,quarterlyFinancials,
            quarterlyNormalized.rows,basicHistorical.factors,splitDetected);
      const preliminaryQuarterly=dilutedAlignment.rows
        .map((row,i)=>({...row,basicEPS:basicHistorical.rows[i].basicEPS}));
      const q4SplitRecovery=recoverSplitCrossingQ4BasicEPS(
        preliminaryQuarterly,quarters,finalAnnual,map.basicEPS,map.basicShares,basisGraph
      );
      const estimatedBasicPeriods=[
        ...q4BasicEPSEvidence.findings.map(f=>f.fiscalPeriodEnd),
        ...q4SplitRecovery.findings.map(f=>f.periodEnd)
      ];
      const reportedEPS=await recoverSECReportedEPS(
        q4SplitRecovery.rows,earningsHistory.filings,cik,secFetch,limitedSecDocument,
        estimatedBasicPeriods,q4DilutedEPSEvidence.findings.map(f=>f.fiscalPeriodEnd)
      );
      const epsConsistency=enforceQuarterlyEPSConsistency(reportedEPS.rows,finalAnnual);
      let finalQuarterly=epsConsistency.rows;
      // Split-adjusted FCF per diluted share for the sheet's 5-year P/FCF.
      const fcfShares=fcfPerShare(finalQuarterly);
      finalQuarterly.forEach((row,i)=>{ row.fcfPerShare=fcfShares.values[i]; });
      // Dividends per share on today's split basis (proven splits only).
      const dps=normalizeDividendsPerShare(finalQuarterly,fcfShares.factors);
      finalQuarterly.forEach((row,i)=>{ row.dividendsPerShare=dps.values[i]; });
      // Reuse the primary document when dividend verification also reads it.
      const shareDocuments=new Map();
      const readShareDocument=filing=>{
        const url=filing.filingDocumentUrl;
        if(shareDocuments.has(url))return shareDocuments.get(url);
        const pending=limitedSecDocument(filing);
        // Keep at most the one cover document, not every dividend report.
        if(shareDocuments.size===0)shareDocuments.set(url,pending);
        return pending;
      };
      const coverShareRecovery=await recoverLatestCoverShares(finalQuarterly,sub,cik,readShareDocument);
      finalQuarterly=coverShareRecovery.rows;
      const dividendVerification=await verifyDividends(finalAnnual,finalQuarterly,sub,cik,readShareDocument);
      finalAnnual=dividendVerification.annual;
      finalQuarterly=dividendVerification.quarterly;
      // Small, public CSV feed for Google Sheets IMPORTDATA. Existing Apps
      // Script writes only the older 31/26 columns, so basic EPS needs an
      // independent column feed. 'NA' preserves row positions in sparse data.
      const DEBT_KEYS=['totalDebt','longTermDebt','debtCurrent','longTermDebtTotal',
        'shortTermDebt','currentPortionLongTermDebt','otherShortTermBorrowings'];
      const reasons=blankReasons(finalQuarterly,{
        companyName:facts.entityName||company.title||ticker,
        bank:isBank(map),
        // Any company-wide EPS filed for the last ~6 years' period ends.
        hasEPSTags:['dilutedEPS','basicEPS'].some(k=>(map[k]||[]).some(f=>
          f.end>=(finalQuarterly[23]?.fiscalPeriodEnd||'0000'))),
        hasTag:key=>(key==='totalDebt'?DEBT_KEYS:[key]).some(k=>(map[k]||[]).length>0),
        debtFactsAt:end=>DEBT_KEYS.reduce((sum,k)=>sum+(map[k]||[]).filter(f=>f.end===end&&!f.start).length,0)
      });
      // Small CSV for the sheet's IMPORTDATA "Data Notes" tab.
      if (url.searchParams.get('blankReasons') === '1') {
        return new Response(blankReasonsCsv(reasons,ticker),{
          headers:{
            'content-type':'text/csv; charset=utf-8',
            'access-control-allow-origin':'*',
            'cache-control':'public, max-age=900'
          }
        });
      }
      const fcfShareCsv = url.searchParams.get('fcfPerShareCsv');
      if (fcfShareCsv !== null) {
        if (fcfShareCsv!=='quarterly') return json({success:false,error:'Use fcfPerShareCsv=quarterly'},400);
        return csvResponse(fcfCsv(finalQuarterly));
      }
      const netAcqCsv = url.searchParams.get('netAcquisitionsCsv');
      if (netAcqCsv !== null) {
        if (netAcqCsv!=='quarterly') return json({success:false,error:'Use netAcquisitionsCsv=quarterly'},400);
        return csvResponse(acqCsv(finalQuarterly));
      }
      const extras = url.searchParams.get('quarterlyExtrasCsv');
      if (extras !== null) {
        if (extras!=='1') return json({success:false,error:'Use quarterlyExtrasCsv=1'},400);
        return csvResponse(extrasCsv(finalQuarterly));
      }
      const basicCsv = url.searchParams.get('basicEpsCsv');
      if (basicCsv !== null) {
        if (!['annual','quarterly'].includes(basicCsv)) {
          return json({success:false,error:'Choose basicEpsCsv=annual or quarterly'},400);
        }
        const records = basicCsv==='annual'?finalAnnual:finalQuarterly;
        const csv=records.map(r=>n(r.basicEPS)!==null
          ? String(r.basicEPS)
          : 'NA').join('\n')+'\n';
        return new Response(csv,{
          headers:{
            'content-type':'text/csv; charset=utf-8',
            'access-control-allow-origin':'*',
            'cache-control':'public, max-age=900'
          }
        });
      }
      stockSplitAudit.basicEPSHistoricalNormalization={
        method:basicHistorical.method,adjustedCount:basicHistorical.adjustedCount,
        unavailableCount:basicHistorical.unavailableCount
      };
      stockSplitAudit.quarterlyDilutedEPSAlignment=dilutedAlignment.findings;
      stockSplitAudit.quarterFourBasicEPS=q4BasicEPSEvidence;
      stockSplitAudit.quarterFourDilutedEPS=q4DilutedEPSEvidence;
      stockSplitAudit.quarterlyEPSConsistency=epsConsistency.findings;
      stockSplitAudit.splitCrossingQ4BasicEPS=q4SplitRecovery.findings;
      stockSplitAudit.reportedQuarterEPS=reportedEPS.audit;
      stockSplitAudit.companyFactsNormalization={
        method:basisGraph.method,
        anchorAccession:basisGraph.anchorAccession,
        anchorFiled:basisGraph.anchorFiled,
        changedBasisEdges:basisGraph.changedBasisEdges.length,
        conflictCount:basisGraph.conflicts.length,
        annualApplied:autoAnnual,
        quarterlyApplied:autoQuarterly,
        annualUnverified:annualNormalized.issues.length,
        quarterlyUnverified:quarterlyNormalized.issues.length,
        limitation:'SEC-only inferred historical share basis; may not capture a split after the most recent financial filing.'
      };
      if(splitDetected)stockSplitAudit.status=autoAnnual
        ? 'automatically-adjusted-from-SEC-evidence'
        : 'SEC-split-evidence-conflicting';

      const index = (sub.tickers||[]).findIndex(t =>
        String(t).toUpperCase()===ticker
      );

      return json({
        schemaVersion:VERSION,
        success:true,
        ticker,
        cik,
        companyName:facts.entityName||company.title||ticker,
        exchange:index>=0?(sub.exchanges?.[index]||''):'',
        dataBasis:'quarterly',
        reportingCurrency:'USD',
        annualFinancials:finalAnnual,
        quarterlyFinancials:finalQuarterly,
        dividendVerification:{...dividendVerification.evidence,checks:dividendVerification.checks,rule:'Zero only with explicit SEC evidence; missing remains unknown.'},
        // Additive source-input snapshots for future metrics without
        // changing the existing 32/25-column Google Sheets import.
        sourceFactsSummary:secSourceSummary(facts,TAGS),
        // Set when history was merged from a verified predecessor registrant.
        predecessorIssuer:succession.predecessor,
        // Why each sheet metric that will show "-" is blank.
        blankReasons:reasons,
        sourceFactsAccess:{
          secRawFacts:'?ticker='+encodeURIComponent(ticker)+'&secRawFacts=1&offset=0&limit=100',
          secCatalog:'?ticker='+encodeURIComponent(ticker)+'&secCatalog=1',
          secFactExample:'?ticker='+encodeURIComponent(ticker)+'&secFact=us-gaap:Assets',
          scope:'SEC standardized Company Facts; custom issuer tags require individual filing extraction',
          persistentArchive:false
        },
        financialInputArchive:{
          annual:financialInputArchive(annualFinancials,ANNUAL_FIELDS),
          quarterly:financialInputArchive(quarters,Object.keys(TAGS))
        },
        stockSplitAudit,
        coverage:{
          rollingROIC:{
            oneYear:rollingRoicCoverage(quarters,1),
            fiveYear:rollingRoicCoverage(quarters,20),
            tenYear:rollingRoicCoverage(quarters,40)
          },
          earningsDates:{...earningsDateCoverage(quarters,earningsHistory.archivesScanned),archivesSkipped:earningsHistory.archivesSkipped||[],filingDatesFromCompanyFacts:factFilingDates},
          annualYears:annualFinancials.length,
          reportedQuarters:quarterlyFinancials.length,
          latestFourConsecutive:
            quarterlyFinancials.length>=4 &&
            quarterlyFinancials.slice(1,4).every((r,i)=>
              quarterlyFinancials[i].fiscalYear*4+
              quarterlyFinancials[i].fiscalQuarter===
              r.fiscalYear*4+r.fiscalQuarter+1
            ),
          note:'SEC reported basic and diluted EPS; historical per-share values are normalized only with corroborating SEC share-basis evidence. Unverifiable earlier EPS may be blank.'
        },
        retrievedAt:new Date().toISOString(),
        provenance:
          'SEC EDGAR companyfacts and submissions; Google Finance supplies live prices'
      });

    } catch (err) {
      return json({
        schemaVersion:VERSION,
        success:false,
        error:String(err?.message||err)
      },502);
    }
}



