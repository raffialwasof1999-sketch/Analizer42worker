import { splitAudit, secSplitFilingCandidates, detectSplitStatements, splitDateCandidates, secRestatementEvidence, previewProvenPerShare, auditedSplitRows } from './sec-splits.js';
import { inspectSplitFilingBatch } from './sec-corporate-actions.js';
import { buildSECShareBasisGraph, normalizeUsingSECShareGraph } from './sec-share-basis.js';
import { reconstructFourthQuarterEPS } from './quarter-four-eps.js';

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
  'averageInvestedCapital','nopat'
];

const QUARTER_FIELDS = [
  'fiscalYear','fiscalQuarter','fiscalPeriodEnd','revenue','netIncome',
  'dilutedEPS','operatingCashFlow','capitalExpenditures','freeCashFlow',
  'dividendsPaid','dividendsPerShare','operatingIncome','incomeTaxExpense',
  'incomeBeforeTax','investedCapital','stockholdersEquity','totalDebt',
  'cash','roic','dilutedShares','sharesOutstanding',
  'sharesOutstandingAsOf','secFilingDate','earningsDisclosureDate'
];

const TAGS = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues','SalesRevenueNet','SalesRevenueGoodsNet'
  ],
  netIncome: [
    'NetIncomeLoss','ProfitLoss','NetIncomeLossAttributableToParent'
  ],
  operatingIncome: ['OperatingIncomeLoss'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  capitalExpenditures: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  incomeTaxExpense: ['IncomeTaxExpenseBenefit'],
  incomeBeforeTax: [
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'
  ],
  dilutedEPS: ['EarningsPerShareDiluted'],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
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
  cash: ['CashAndCashEquivalentsAtCarryingValue'],
  totalAssets: ['Assets'],
  totalLiabilities: ['Liabilities'],
  shortTermDebt: ['ShortTermBorrowings','ShortTermDebtCurrent'],
  longTermDebt: ['LongTermDebtNoncurrent'],
  currentPortionLongTermDebt: [
    'LongTermDebtCurrent',
    'LongTermDebtAndCapitalLeaseObligationsCurrent',
    'LongTermDebtAndFinanceLeaseObligationsCurrent'
  ],
  totalDebt: [
    'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities',
    'LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities'
  ],
  grossProfit: ['GrossProfit'],
  sga: ['SellingGeneralAndAdministrativeExpense'],
  rnd: ['ResearchAndDevelopmentExpense']
};

const INSTANT = new Set([
  'stockholdersEquity','cash','totalAssets','totalLiabilities',
  'shortTermDebt','longTermDebt','currentPortionLongTermDebt','totalDebt'
]);

const UNITS = {
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

function debt(get) {
  const explicit = get('totalDebt');

  if (n(explicit) !== null) return explicit;

  const long = get('longTermDebt');
  const short = get('shortTermDebt');
  const current = get('currentPortionLongTermDebt');

  if (n(long) === null || n(current) === null) {
    return null;
  }

  return long + current + (n(short) !== null ? short : 0);
}

function decorate(r,older) {
  r.freeCashFlow = minus(r.operatingCashFlow,r.capitalExpenditures);
  r.profitMargin = ratio(r.netIncome,r.revenue);
  r.freeCashFlowMargin = ratio(r.freeCashFlow,r.revenue);

  const taxRate = ratio(r.incomeTaxExpense,r.incomeBeforeTax);

  r.nopat =
    n(taxRate) !== null &&
    taxRate >= 0 &&
    taxRate <= 1 &&
    n(r.operatingIncome) !== null
      ? r.operatingIncome*(1-taxRate)
      : null;

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

function buildAnnual(map,ends) {
  const forms = ['10-K','10-K/A'];

  const raw = ends.map(end => {
    const get = k =>
      val(map[k],end,INSTANT.has(k)?'instant':'annual',forms);

    const r = {
      fiscalYear:Number(end.slice(0,4)),
      fiscalPeriodEnd:end
    };

    for (const k of Object.keys(TAGS)) {
      r[k] = get(k);
    }

    r.totalDebt = debt(get);
    return r;
  });

  for (let i=raw.length-1;i>=0;i--) {
    decorate(raw[i],raw[i+1]);
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

function buildQuarterly(map,ends) {
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
        year:Number(ends[0].slice(0,4))+1
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
        year:Number(ends[i].slice(0,4))
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

        if (key==='dilutedShares' || key==='dilutedEPS') {
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

      r.totalDebt = debt(get);
      decorate(r,null);
      rows.push(r);
    }
  }

  rows.sort((a,b) =>
    b.fiscalYear-a.fiscalYear ||
    b.fiscalQuarter-a.fiscalQuarter
  );

  return rows.slice(0,60);
}

function submissionFilings(sub) {
  const rec = sub?.filings?.recent || {};
  const out = [];

  for (let i=0;i<(rec.form||[]).length;i++) {
    if (!validDate(rec.filingDate?.[i])) continue;

    out.push({
      form:rec.form[i],
      filed:rec.filingDate[i],
      end:rec.reportDate?.[i]||'',
      items:rec.items?.[i]||'',
      accession:rec.accessionNumber?.[i]||''
    });
  }

  return out;
}

function enrichQuarterDates(rows,sub) {
  const filings = submissionFilings(sub);

  for (const r of rows) {
    const forms = r.fiscalQuarter===4
      ? ['10-K','10-K/A']
      : ['10-Q','10-Q/A'];

    const matches = filings
      .filter(f =>
        forms.includes(f.form) &&
        f.end===r.fiscalPeriodEnd
      )
      .sort((a,b)=>a.filed.localeCompare(b.filed));

    const report = matches[0];

    r.secFilingDate = report?.filed || null;
    r._accession = report?.accession || null;
    r.earningsDisclosureDate = null;

    if (!report) continue;

    const filings802 = filings.filter(f =>
      f.form==='8-K' &&
      /(?:^|[^\d])2\.02(?:$|[^\d])/.test(f.items) &&
      dayCount(r.fiscalPeriodEnd,f.filed)>=0 &&
      dayCount(r.fiscalPeriodEnd,f.filed)<=105 &&
      dayCount(f.filed,report.filed)>=0 &&
      dayCount(f.filed,report.filed)<=35
    );

    filings802.sort((a,b)=>b.filed.localeCompare(a.filed));

    // Date of SEC earnings-results 8-K filing, if verified.
    r.earningsDisclosureDate = filings802[0]?.filed || null;
  }
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

export default {
  async fetch(request) {
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

      const [facts,sub] = await Promise.all([
        secFetch(`${SEC}/api/xbrl/companyfacts/CIK${cik}.json`),
        secFetch(`${SEC}/submissions/CIK${cik}.json`)
      ]);

      if (
        Number(facts.cik)!==Number(cik) ||
        Number(sub.cik)!==Number(cik)
      ) {
        throw Error('SEC CIK mismatch');
      }

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
        const annual=buildAnnual(shareMap,fiscalEnds);
        const quarterly=buildQuarterly(shareMap,fiscalEnds);
        enrichQuarterDates(quarterly,sub);
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
        const originalAnnual=buildAnnual(splitMap,splitEnds);
        const originalQuarter=buildQuarterly(splitMap,splitEnds);
        enrichQuarterDates(originalQuarter,sub);
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
      const annualFinancials = buildAnnual(map,ends);
      const quarters = buildQuarterly(map,ends);

      enrichQuarterDates(quarters,sub);
      coverShares(quarters,facts);
      const quarterFourEPS=reconstructFourthQuarterEPS(
        quarters,annualFinancials,map.dilutedShares
      );

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
      const finalQuarterly=autoQuarterly?quarterlyNormalized.rows:quarterlyFinancials;
      stockSplitAudit.quarterFourEPS=quarterFourEPS;
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
        stockSplitAudit,
        coverage:{
          annualYears:annualFinancials.length,
          reportedQuarters:quarterlyFinancials.length,
          latestFourConsecutive:
            quarterlyFinancials.length>=4 &&
            quarterlyFinancials.slice(1,4).every((r,i)=>
              quarterlyFinancials[i].fiscalYear*4+
              quarterlyFinancials[i].fiscalQuarter===
              r.fiscalYear*4+r.fiscalQuarter+1
            ),
          note:'SEC reported facts; historical diluted EPS/shares automatically normalized only where overlapping SEC filing evidence supports the share basis. Unverifiable earlier EPS may be blank.'
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
};


