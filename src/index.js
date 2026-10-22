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
import { enforceQuarterlyEPSConsistency } from './eps-consistency.js';
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

const ANNUAL_FIELDS = [
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
  'sharesOutstandingAsOf','secFilingDate','earningsDisclosureDate','basicEPS'
];

const TAGS = {
  revenue: [
    // Banks' total net revenue (JPM, BAC...). Non-banks never report it, and
    // a bank's contract-revenue tags cover fee income only, so it goes first.
    'RevenuesNetOfInterestExpense',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues','SalesRevenueNet','SalesRevenueGoodsNet'
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
  'debtCurrent','otherShortTermBorrowings','longTermDebtTotal','debtCarrying'
]);

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

function fieldFacts(gaap,key) {
  const unit = UNITS[key] || 'USD';

  return (TAGS[key] || []).flatMap((tag,priority) =>
    (gaap[tag]?.units?.[unit] || [])
      .filter(r => n(r.val) !== null && validDate(r.end))
      .map(r => ({...r,priority,tag}))
  );
}

function chooseRecord(records,end,kind,forms) {
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

function periods(map) {
  const forms = ['10-K','10-K/A'];

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

function buildAnnual(map,ends,cik=null) {
  const forms = ['10-K','10-K/A'];

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

    const debtContext={cik,periodEnd:end,form:'10-K',noCurrentDebtNearby:noCurrentDebtNear(map,end)};
    r.totalDebt = debt(get,debtContext);
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

function buildQuarterly(map,ends,cik=null) {
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

  const rows = [];
  const flowing = Object.keys(TAGS).filter(k=>!INSTANT.has(k));

  for (const group of groups) {
    const previousYtd = {};

    for (let j=0;j<group.ends.length;j++) {
      const end = group.ends[j];
      const isQ4 = j===3;
      const forms = isQ4 ? formsY : formsQ;

      const r = {
        fiscalYear:group.year,
        fiscalQuarter:j+1,
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
          amount = ytd;
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
      const proof=auditedAbsentCurrentDebtProof(debtContext,get('longTermDebt'));
      if(proof && r.totalDebt===proof.noncurrent &&
         get('shortTermDebt')===null &&
         get('currentPortionLongTermDebt')===null) {
        r.longTermDebt=r.longTermDebt??proof.noncurrent;
        r.debtEvidence=proof;
      }
      decorate(r,null,isBank(map));
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

function validateOutput(a,q) {
  // Short SEC histories are valid. Never invent missing periods.

  if (!a.length) {
    throw Error('No usable SEC annual financial periods found.');
  }

  if (!q.length) {
    throw Error('No usable SEC quarterly financial periods found.');
  }

  const latest = q[0];

  if (n(latest.revenue)===null || n(latest.netIncome)===null) {
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
const FEED_PARAMS = new Set(['ticker','basicEpsCsv','blankReasons','revision','release','retry']);
const recent = new Map(); // ticker -> {at, promise of {status, body}}

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
    : url.searchParams.has('basicEpsCsv') ? 'basic' : null;
  if (feed==='basic' && !['annual','quarterly'].includes(url.searchParams.get('basicEpsCsv')))
    return json({success:false,error:'Choose basicEpsCsv=annual or quarterly'},400);

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
  const data=JSON.parse(result.body);
  if (feed==='reasons') return csvResponse(blankReasonsCsv(data.blankReasons||[],ticker));
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

      const gaap = facts.facts?.['us-gaap'];

      if (!gaap) {
        throw Error(
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
      const annualFinancials = buildAnnual(map,ends,cik);
      const quarters = buildQuarterly(map,ends,cik);

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
      const finalAnnual=autoAnnual?annualNormalized.rows:annualFinancials;
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
      const finalQuarterly=epsConsistency.rows;
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
        annualFinancials:finalAnnual,
        quarterlyFinancials:finalQuarterly,
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


