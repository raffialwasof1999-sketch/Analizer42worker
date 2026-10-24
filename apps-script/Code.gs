
/**
 * ACTIVE ANALYZER — GOOGLE APPS SCRIPT
 * Version: AA_SEC_V3
 *
 * Compatible with the Cloudflare Worker above.
 *
 * CURRENT DASHBOARD:
 * B2       Stock ticker
 * E2       Exchange
 * B4       Company name
 * A6       Refresh SEC Data label
 * B6       Manual refresh checkbox
 * A7:B7    SEC data status
 * E3:E4    Google Finance price / market cap
 * G2:G7    SEC financial summary
 * B14:D17  Historical performance
 * E15:G20  Assumptions
 * A23      RESULTS
 * E25:G26  Maximum purchase prices
 * E27:G28  Projected annual returns
 * H4:J22   Additional metrics
 *
 * Annual SEC data: Financial Data!A:AE
 * Quarterly SEC data: Quarterly Data!A:Y
 * Last successful import: Quarterly Data!Z2
 *
 * Limited financial histories are supported.
 * Missing reported facts remain blank.
 * Dashboard formulas, assumptions and result labels are preserved.
 */

const AA = Object.freeze({
  workerUrl:'https://analyzer42-sec.raffialwasof-1999.workers.dev/',
  schema:'AA_SEC_V3',
  dashboard:'Analyzer',
  annualSheet:'Financial Data',
  quarterSheet:'Quarterly Data',
  maxAnnual:20,
  maxQuarterly:60,
  tickerCell:'B2',
  companyCell:'B4',
  exchangeCell:'E2',
  refreshCheckbox:'B6',
  triggerHandler:'aaTickerEdited'
});

const AA_ANNUAL_FIELDS = [
  'fiscalYear','revenue','netIncome','freeCashFlow','dilutedShares',
  'profitMargin','freeCashFlowMargin','roic','operatingIncome',
  'operatingCashFlow','capitalExpenditures','totalAssets','totalLiabilities',
  'stockholdersEquity','cash','shortTermDebt','longTermDebt','totalDebt',
  'incomeTaxExpense','incomeBeforeTax','dilutedEPS','revenueGrowth',
  'fiscalPeriodEnd','dividendsPaid','dividendsPerShare','acquisitions',
  'divestitures','netAcquisitions','investedCapital',
  'averageInvestedCapital','nopat'
];

const AA_QUARTER_FIELDS = [
  'fiscalYear','fiscalQuarter','fiscalPeriodEnd','revenue','netIncome',
  'dilutedEPS','operatingCashFlow','capitalExpenditures','freeCashFlow',
  'dividendsPaid','dividendsPerShare','operatingIncome','incomeTaxExpense',
  'incomeBeforeTax','investedCapital','stockholdersEquity','totalDebt',
  'cash','roic','dilutedShares','sharesOutstanding',
  'sharesOutstandingAsOf','secFilingDate','earningsDisclosureDate',
  'sourceTicker'
];

// Only labels next to cells the refresh reads or writes are checked:
// B2 (ticker), B4 (company), B6 (checkbox), B7 and A7's note (status),
// E2 (exchange), C5's note, and the notes on F2:F7. Everything else on the
// dashboard (history table, assumptions, results, metrics table) is never
// written by the refresh and is free to change in the sheet.
const AA_LABELS = {
  A2:'Stock Ticker',
  A4:'Company Name',
  A6:'↻ Refresh SEC Data',
  A7:'SEC Data Status',
  C2:'Exchange',
  C5:'Enterprise Value',
  F2:'Latest Revenue (TTM)',
  F3:'Latest Net Income (TTM)',
  F4:'Latest Free Cash Flow (TTM)',
  F5:'Latest Share Count',
  F6:'Latest Diluted Share Count',
  F7:'Latest Reported Quarter and Year'
};

// The metrics table (H2:J23: headings, metric names and their formulas) is
// not checked: refreshes never write to columns H, I or J, so its headings
// and names are free to change in the sheet (move a metric by moving its
// H and I cells together).

/* =========================================================
   SPREADSHEET MENU
   ========================================================= */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Stock Analyzer')
    .addItem('Refresh current ticker','refreshStockAnalyzer')
    .addItem('Test Worker (read-only)','testWorkerConnection')
    .addSeparator()
    .addItem('Enable automatic ticker refresh','installTickerRefresh')
    .addItem('Disable automatic ticker refresh','removeTickerRefresh')
    .addToUi();
}

/* =========================================================
   SPREADSHEET ACCESS
   ========================================================= */

function aaSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const d = ss.getSheetByName(AA.dashboard);
  const a = ss.getSheetByName(AA.annualSheet);
  const q = ss.getSheetByName(AA.quarterSheet);

  if (!d || !a || !q) {
    throw Error(
      'Missing Analyzer, Financial Data or Quarterly Data tab.'
    );
  }

  return {ss,d,a,q};
}

function aaTicker_(value) {
  const ticker = String(
    value == null ? '' : value
  ).trim().toUpperCase();

  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    throw Error(
      'Enter a valid ticker in Analyzer!B2, e.g. AAPL.'
    );
  }

  return ticker;
}

/* =========================================================
   DATA HEADER VALIDATION
   ========================================================= */

function aaCheckHeader_(sheet,expected) {
  const current = sheet
    .getRange(1,1,1,expected.length)
    .getDisplayValues()[0];

  expected.forEach((name,i) => {
    if (current[i] !== name) {
      throw Error(
        sheet.getName()+
        ' header '+(i+1)+
        ' changed; expected '+name+
        ', found '+current[i]
      );
    }
  });
}

/* =========================================================
   CURRENT DASHBOARD LAYOUT VALIDATION
   ========================================================= */

function aaCheckDashboard_(d,a,q) {
  for (const [cell,expected] of Object.entries(AA_LABELS)) {
    const value = d
      .getRange(cell)
      .getDisplayValue()
      .trim();

    if (value !== expected) {
      throw Error(
        'Layout changed: Analyzer!'+cell+
        ' should say "'+expected+
        '", found "'+value+'".'
      );
    }
  }

  const refreshControl = d.getRange(AA.refreshCheckbox);
  const rule = refreshControl.getDataValidation();

  if (
    !rule ||
    rule.getCriteriaType() !==
      SpreadsheetApp.DataValidationCriteria.CHECKBOX
  ) {
    throw Error(
      'Refresh checkbox missing at Analyzer!B6.'
    );
  }

  // Safety net (owner's choice): the result labels and formulas are not
  // written by the refresh, but a broken result formula stops the import
  // with a clear message instead of showing a wrong value.
  const label = d
    .getRange('A25:A28')
    .getDisplayValues()
    .map(r => r[0]);

  if (
    !label[0].includes('Net Profit Margin') ||
    !label[1].includes('Free Cash Flow Margin') ||
    !label[2].startsWith('Current Stock Price') ||
    !label[3].startsWith('Current Stock Price')
  ) {
    throw Error(
      'Result labels moved from A25:A28.'
    );
  }

  for (const col of ['E','F','G']) {
    const refs = [
      {
        cell:col+'25',
        items:[
          col+'15',col+'16',col+'18',col+'20',
          '$G$2','$G$6','$B$3'
        ]
      },
      {
        cell:col+'26',
        items:[
          col+'15',col+'17',col+'19',col+'20',
          '$G$2','$G$6','$B$3'
        ]
      },
      {
        cell:col+'27',
        items:[
          'AVERAGE('+col+'25:'+col+'26)',
          col+'20','$E$3'
        ]
      },
      {
        cell:col+'28',
        items:[col+'27','$I$16']
      }
    ];

    for (const ref of refs) {
      const formula = d
        .getRange(ref.cell)
        .getFormula();

      if (
        !formula ||
        ref.items.some(s => !formula.includes(s))
      ) {
        throw Error(
          'Unexpected result formula in Analyzer!'+
          ref.cell+'; no data was imported.'
        );
      }
    }
  }

  aaCheckHeader_(a,AA_ANNUAL_FIELDS);
  aaCheckHeader_(q,AA_QUARTER_FIELDS);

  const z = q.getRange('Z1').getDisplayValue();

  if (z && z !== 'lastImportedAt') {
    throw Error(
      'Quarterly Data!Z1 already contains an unrelated field.'
    );
  }
}

/* =========================================================
   DATE AND VALUE VALIDATION
   ========================================================= */

function aaIso_(s) {
  if (
    typeof s !== 'string' ||
    !/^\d{4}-\d\d-\d\d$/.test(s)
  ) {
    return false;
  }

  const [y,m,d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y,m-1,d));

  return dt.getUTCFullYear()===y &&
    dt.getUTCMonth()===m-1 &&
    dt.getUTCDate()===d;
}

function aaValue_(value,field) {
  if (value===null || value===undefined) {
    return '';
  }

  if (
    [
      'fiscalPeriodEnd',
      'sharesOutstandingAsOf',
      'secFilingDate',
      'earningsDisclosureDate'
    ].includes(field)
  ) {
    if (!aaIso_(value)) {
      throw Error('Invalid SEC date in '+field);
    }

    const [y,m,d] = value.split('-').map(Number);
    return new Date(y,m-1,d,12);
  }

  if (field==='sourceTicker') {
    return String(value);
  }

  if (
    typeof value==='number' &&
    Number.isFinite(value)
  ) {
    return value;
  }

  throw Error(
    'Non-numeric SEC field '+field+' received.'
  );
}

/* =========================================================
   COMPATIBLE WORKER PAYLOAD VALIDATION
   ========================================================= */

function aaValidatePayload_(p,ticker) {
  if (
    !p ||
    p.success!==true ||
    p.schemaVersion!==AA.schema ||
    p.ticker!==ticker ||
    !/^[0-9]{10}$/.test(String(p.cik||''))
  ) {
    throw Error(
      'Worker schema, ticker, or CIK mismatch. '+
      'Deploy paired Worker first.'
    );
  }

  const a = p.annualFinancials;
  const q = p.quarterlyFinancials;
  // Foreign 20-F/40-F filers: annual rows only, in reportingCurrency.
  const annualOnly = p.dataBasis==='annual';
  if (annualOnly && !/^[A-Z]{3}$/.test(String(p.reportingCurrency||''))) {
    throw Error('Worker returned annual-only data without a reporting currency.');
  }

  // IMPORTANT: Short histories are accepted.
  if (
    !Array.isArray(a) ||
    !Array.isArray(q) ||
    a.length<1 ||
    (q.length<1 && !annualOnly) ||
    a.length>AA.maxAnnual ||
    q.length>AA.maxQuarterly
  ) {
    throw Error(
      'Worker returned incomplete/out-of-range SEC financial history.'
    );
  }

  const check = (rows,fields,isQuarter) => {
    const seen = new Set();

    return rows.map((r,i) => {
      if (
        !r ||
        !Number.isInteger(r.fiscalYear) ||
        !aaIso_(r.fiscalPeriodEnd) ||
        (
          isQuarter &&
          (
            !Number.isInteger(r.fiscalQuarter) ||
            r.fiscalQuarter<1 ||
            r.fiscalQuarter>4
          )
        )
      ) {
        throw Error(
          'Malformed SEC fiscal period at row '+(i+1)
        );
      }

      const period =
        r.fiscalYear*(isQuarter?4:1)+
        (isQuarter?r.fiscalQuarter:0);

      if (
        seen.has(period) ||
        (
          i>0 &&
          period>=(
            rows[i-1].fiscalYear*(isQuarter?4:1)+
            (isQuarter?rows[i-1].fiscalQuarter:0)
          )
        )
      ) {
        throw Error(
          'SEC fiscal periods duplicate or unsorted.'
        );
      }

      seen.add(period);

      return fields.map(field =>
        aaValue_(
          field==='sourceTicker'
            ? (i===0?ticker:'')
            : r[field],
          field
        )
      );
    });
  };

  const annual = check(a,AA_ANNUAL_FIELDS,false);
  const quarter = check(q,AA_QUARTER_FIELDS,true);

  // Existing dashboard formulas independently check for
  // four consecutive quarters and required historical years.
  // The importer must not reject a younger public company.

  if (
    typeof a[0].revenue!=='number' ||
    typeof a[0].netIncome!=='number'
  ) {
    throw Error(
      'Latest SEC annual revenue/net income is incomplete.'
    );
  }

  if (
    q.length &&
    (typeof q[0].revenue!=='number' ||
    typeof q[0].netIncome!=='number')
  ) {
    throw Error(
      'Latest SEC quarterly revenue/net income is incomplete.'
    );
  }

  return {annual,quarter,a,q,annualOnly,
    currency:annualOnly?p.reportingCurrency:'USD'};
}

/* =========================================================
   FETCH CLOUDFLARE WORKER DATA
   ========================================================= */

function aaFetch_(ticker) {
  const url =
    AA.workerUrl.replace(/\/+$/,'')+
    '/?ticker='+encodeURIComponent(ticker);

  const r = UrlFetchApp.fetch(url,{
    method:'get',
    muteHttpExceptions:true,
    followRedirects:true,
    headers:{Accept:'application/json'}
  });

  let p;

  try {
    p = JSON.parse(r.getContentText());
  } catch (err) {
    throw Error(
      'Worker did not return JSON (HTTP '+
      r.getResponseCode()+').'
    );
  }

  if (
    r.getResponseCode()!==200 ||
    p?.success!==true
  ) {
    throw Error(
      'Worker HTTP '+r.getResponseCode()+': '+
      String(p?.error||'unknown SEC error')
    );
  }

  return p;
}

/* =========================================================
   SEC STATUS FORMULA
   ========================================================= */

function aaStatusFormula_() {
  // Four-line SEC Data Status box: snapshot, last imported quarter,
  // earnings release and SEC filing dates, and import time.
  return "=IF(OR('Quarterly Data'!Y2=\"\",UPPER(TRIM($B$2))<>UPPER(TRIM('Quarterly Data'!Y2))),\"⚠ SEC TICKER MISMATCH: \"&UPPER(TRIM($B$2))&\" | SEC data: \"&'Quarterly Data'!Y2&\" | Do not use valuations\",LET(d,LAMBDA(v,IFERROR(TEXT(IF(ISNUMBER(v),v,DATEVALUE(v)),\"m/d/yy\"),\"n/a\")),IF('Quarterly Data'!Z6=\"annual\",\"SEC snapshot: \"&'Quarterly Data'!Y2&\" | \"&COUNT('Financial Data'!A2:A1000)&\" annual years | no quarters\"&CHAR(10)&\"Latest fiscal year: FY\"&'Financial Data'!A2&\" (ended \"&d('Financial Data'!W2)&\")\"&CHAR(10)&\"Foreign filer: annual reports only, figures in \"&'Quarterly Data'!Z4&CHAR(10)&IF(ISNUMBER('Quarterly Data'!Z2),\"SEC imported \"&TEXT('Quarterly Data'!Z2,\"m/d/yy h:mm AM/PM\"),\"Refresh timestamp missing\"),\"SEC snapshot: \"&'Quarterly Data'!Y2&\" | \"&COUNT('Financial Data'!A2:A1000)&\" annual years | \"&COUNT('Quarterly Data'!A2:A1000)&\" quarters\"&CHAR(10)&\"Last imported quarter: Q\"&'Quarterly Data'!B2&\" FY\"&'Quarterly Data'!A2&CHAR(10)&\"Released \"&d('Quarterly Data'!X2)&\" | SEC filed \"&d('Quarterly Data'!W2)&CHAR(10)&IF(ISNUMBER('Quarterly Data'!Z2),\"SEC imported \"&TEXT('Quarterly Data'!Z2,\"m/d/yy h:mm AM/PM\"),\"Refresh timestamp missing\"))))";
}

/* =========================================================
   UPDATE SEC INFORMATION NOTES
   ========================================================= */

function aaHeaderNotes_(dashboard,p) {
  const annualOnly = !p.quarterlyFinancials.length;
  const first = annualOnly ? p.annualFinancials[0] : p.quarterlyFinancials[0];

  const last = annualOnly ? first : p.quarterlyFinancials[
    Math.min(3,p.quarterlyFinancials.length-1)
  ];

  const context =
    (annualOnly
      ? 'ANNUAL-ONLY COMPANY: '+p.companyName+' files annual '+
        (p.annualReportForm||'20-F')+' reports with the SEC and no quarterly '+
        '10-Qs, so Quarterly Data is empty. Latest SEC fiscal year: FY'+
        first.fiscalYear+' (ended '+first.fiscalPeriodEnd+'), figures in '+
        p.reportingCurrency+'. '
      : 'Latest available SEC quarterly records: '+
        last.fiscalPeriodEnd+' to '+
        first.fiscalPeriodEnd+'. ')+
    'Company: '+p.companyName+
    ' ('+p.ticker+'). '+
    'Sources: SEC EDGAR via Cloudflare Worker. '+
    'Shorter history is normal for newer issuers; incomplete TTM and '+
    'historical averages correctly show a dash. '+
    'The data refresh when the Stock Analyzer refresh command runs or '+
    'its installable ticker edit trigger is enabled. '+
    'Check SEC Data Status in B7.';

  const notes = {
    F2:
      'LATEST REVENUE (TTM)\n'+
      'G2 sums four consecutive SEC quarters from Quarterly Data!D2:D5.\n'+
      context,

    F3:
      'LATEST NET INCOME (TTM)\n'+
      'G3 sums four consecutive SEC quarters from Quarterly Data!E2:E5.\n'+
      context,

    F4:
      'LATEST FREE CASH FLOW (TTM)\n'+
      'G4 sums four consecutive quarterly values from Quarterly Data!I2:I5. '+
      'Each quarter is operating cash flow minus capital expenditures; '+
      'missing facts display a dash.\n'+context,

    C5:
      'ENTERPRISE VALUE\n'+
      'E5 = current Google Finance market cap E4 + latest SEC quarter-end '+
      'total debt (Quarterly Data!Q2) - latest quarter-end cash '+
      '(Quarterly Data!R2). Balance sheet figures are point-in-time, '+
      'not TTM sums.\n'+context,

    F5:
      'LATEST COMMON SHARES OUTSTANDING (NOT DILUTED)\n'+
      'G5 reads Quarterly Data!U2, the SEC DEI '+ 
      'EntityCommonStockSharesOutstanding cover-page number tied to the '+ 
      'latest 10-Q or 10-K accession. The exact as-of date is in '+ 
      'Quarterly Data!V2. If unavailable, G5 displays a dash. '+ 
      'This is NOT the weighted-average diluted share count.\n'+context,

    F6:
      "LATEST DILUTED SHARE COUNT\nG6 reads Quarterly Data!T2, the latest quarter's SEC weighted-average diluted share count. The SEC worker supplies it for every quarter, including a fiscal Q4 (derived from the full-year and Q1-Q3 counts, since 10-Ks report only a full-year figure).\n\nBackstop: if T2 is still blank for a fiscal Q4, G6 derives it as 4 x the full-year diluted count (Financial Data!E) minus the Q1-Q3 counts (Quarterly Data!T3:T5), shown only if within 10% of Q3's; otherwise a dash.\n\nUsed by P/S (I6) and Price / FCF (I14).\n"+context,

    F7:
      'LATEST REPORTED FISCAL QUARTER\n'+
      'G7 shows fiscal year/quarter from Quarterly Data!A2:B2. '+ 
      'X2, when available, is the filing date of an SEC 8-K Item 2.02 '+ 
      'earnings-results report, not necessarily the initial public '+ 
      'earnings-announcement date. W2 is the 10-Q/10-K filing date. '+ 
      'Quarter-end C2 is NOT the public disclosure date.\n'+context,

    A7:
      "SEC DATA STATUS\nAnalyzer!B7 compares the ticker in B2 with the imported sourceTicker (Quarterly Data!Y2). A mismatch means the imported SEC financials belong to a different company.\n\nLine 1: ticker, annual years and quarters imported.\nLine 2: last imported quarter (Quarterly Data!A2:B2).\nLine 3: Released = filing date of the SEC 8-K Item 2.02 earnings release (X2); SEC filed = 10-Q/10-K filing date (W2).\nLine 4: time of the last successful import (Z2).\n\nIf the company has announced a newer quarter but line 2 still shows the older one, it has not been imported yet: new quarters arrive once the 10-Q/10-K is filed with the SEC, usually a few days after the announcement. Refresh with B6."
  };

  // Annual-only (foreign) companies: the dashboard reads the hidden
  // 'Annual View' tab, so the notes describe that instead.
  if (annualOnly) Object.assign(notes, aaAnnualNotes_(p,context));

  for (const [cell,note] of Object.entries(notes)) {
    dashboard.getRange(cell).setNote(note);
  }
}

/**
 * Notes for an annual-only (20-F/40-F) company. G2:G7, E5, the history
 * table and column I switch to the hidden 'Annual View' tab when Quarterly
 * Data!Z6 is "annual": latest fiscal year, converted to US dollars at
 * Google Finance's live rate, per-share figures per ADR.
 */
function aaAnnualNotes_(p,context) {
  const cur = p.reportingCurrency;
  const usd = cur==='USD' ? 'in US dollars' :
    'converted from '+cur+' to US dollars at the live Google Finance rate ("Annual View"!B4)';
  const fy = 'the latest fiscal year (Financial Data row 2)';
  return {
    F2: 'LATEST REVENUE (LATEST FISCAL YEAR for this company)\nG2 = revenue of '+fy+', '+usd+'. This company reports annually, so there is no trailing-twelve-month figure.\n'+context,
    F3: 'LATEST NET INCOME (LATEST FISCAL YEAR for this company)\nG3 = net income attributable to shareholders for '+fy+', '+usd+'.\n'+context,
    F4: 'LATEST FREE CASH FLOW (LATEST FISCAL YEAR for this company)\nG4 = operating cash flow minus capital expenditures for '+fy+', '+usd+'.\n'+context,
    C5: 'ENTERPRISE VALUE\nE5 = market value (price E3 x diluted shares G6, "Annual View"!B19; Google\'s market cap is wrong for some ADRs) + (total debt - cash) at the end of '+fy+', '+usd+'.\n'+context,
    F5: 'LATEST COMMON SHARES OUTSTANDING (ADR EQUIVALENTS)\nG5 = ordinary shares outstanding on the cover page of the latest annual report (Quarterly Data!Z8, as of Z10) divided by the ordinary shares per ADR ("Annual View"!B9). This is NOT the diluted count (G6).\n'+context,
    F6: 'LATEST DILUTED SHARE COUNT (ADR EQUIVALENTS)\nG6 = weighted diluted ordinary shares of '+fy+' divided by the ordinary shares per ADR ("Annual View"!B9: from the ADR table at "Annual View"!A43, else inferred from Google\'s market cap when within 5% of a clean ratio), so per-share results match the US-listed price. P/E, P/S, P/FCF and yields use price x this count.\n'+context,
    F7: 'LATEST REPORTED FISCAL YEAR\nG7 shows the latest fiscal year in SEC data and its year end. If it ended more than 500 days ago, valuations show a dash ("too old for valuations").\n'+context
  };
}

/* =========================================================
   WRITE SEC FINANCIAL DATA
   ========================================================= */

function aaWriteRows_(sheet,fields,records,isQuarter) {
  const previous = Math.max(0,sheet.getLastRow()-1);
  const count = Math.max(previous,records.length);

  if (count) {
    sheet.getRange(2,1,count,fields.length)
      .clearContent();
  }

  // Annual-only companies have no quarterly rows.
  if (!records.length) return;

  sheet.getRange(2,1,records.length,fields.length)
    .setValues(records);

  if (isQuarter) {
    sheet.getRange('C2:C'+(records.length+1))
      .setNumberFormat('yyyy-mm-dd');

    sheet.getRange('V2:X'+(records.length+1))
      .setNumberFormat('yyyy-mm-dd');

    sheet.getRange('T2:U'+(records.length+1))
      .setNumberFormat('#,##0');
  } else {
    sheet.getRange('W2:W'+(records.length+1))
      .setNumberFormat('yyyy-mm-dd');

    sheet.getRange('F2:H'+(records.length+1))
      .setNumberFormat('0.00%');

    sheet.getRange('V2:V'+(records.length+1))
      .setNumberFormat('0.00%');
  }
}

/* =========================================================
   WORKER CONNECTION TEST — NO SHEET CHANGES
   ========================================================= */

function testWorkerConnection() {
  const {ss,d,a,q} = aaSheets_();
  aaCheckDashboard_(d,a,q);

  const ticker = aaTicker_(
    d.getRange(AA.tickerCell).getDisplayValue()
  );

  const p = aaFetch_(ticker);
  const v = aaValidatePayload_(p,ticker);

  ss.toast(
    'Worker contract OK: '+v.annual.length+
    ' annual, '+v.quarter.length+
    ' quarters. No changes made.',
    'Stock Analyzer',
    10
  );

  return {
    ticker,
    schema:p.schemaVersion,
    annual:v.annual.length,
    quarterly:v.quarter.length,
    latestQuarter:p.quarterlyFinancials.length
      ? p.quarterlyFinancials[0].fiscalPeriodEnd : null
  };
}

/* =========================================================
   INITIAL SETUP
   ========================================================= */

function setupStockAnalyzer() {
  refreshStockAnalyzer();
  installTickerRefresh();
}

/* =========================================================
   INSTALL / REMOVE EDIT TRIGGER
   ========================================================= */

function installTickerRefresh() {
  const {ss,d,a,q} = aaSheets_();
  aaCheckDashboard_(d,a,q);

  aaRemoveTickerTriggers_(false);

  ScriptApp.newTrigger(AA.triggerHandler)
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  ss.toast(
    'Ticker B2 and refresh checkbox B6 are active.',
    'Stock Analyzer',
    7
  );
}

function removeTickerRefresh() {
  aaRemoveTickerTriggers_(true);
}

function aaRemoveTickerTriggers_(notify) {
  const known = new Set([
    AA.triggerHandler,
    'stockAnalyzerTickerEdited',
    'tickerEdited',
    'onTickerEdit'
  ]);

  ScriptApp.getProjectTriggers().forEach(t => {
    if (known.has(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
    }
  });

  if (notify) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Automatic ticker refresh disabled. Manual refresh remains available.',
      'Stock Analyzer',
      7
    );
  }
}

/* =========================================================
   TICKER CHANGE / B6 CHECKBOX REFRESH HANDLER
   ========================================================= */

function aaTickerEdited(e) {
  if (
    !e ||
    !e.range ||
    e.range.getSheet().getName()!==AA.dashboard
  ) {
    return;
  }

  if (
    e.range.getNumRows()!==1 ||
    e.range.getNumColumns()!==1
  ) {
    return;
  }

  const cell = e.range.getA1Notation();

  if (cell===AA.refreshCheckbox) {
    if (e.range.getValue()!==true) return;

    try {
      refreshStockAnalyzer();
    } catch (err) {
      const message =
        'SEC refresh failed: '+String(err.message||err);

      console.error(message);

      SpreadsheetApp.getActiveSpreadsheet().toast(
        message,
        'Stock Analyzer',
        10
      );
    } finally {
      // Editing by a script does not invoke onEdit again.
      e.range.setValue(false);
    }

    return;
  }

  if (cell===AA.tickerCell) {
    try {
      refreshStockAnalyzer();
    } catch (err) {
      const message =
        'Ticker refresh failed: '+String(err.message||err);

      console.error(message);

      SpreadsheetApp.getActiveSpreadsheet().toast(
        message,
        'Stock Analyzer',
        10
      );
    }
  }
}

/* =========================================================
   MAIN SEC FINANCIAL DATA REFRESH
   ========================================================= */

/**
 * After a failed import, say why in the status box (B7) and blank the
 * company name (B4), instead of leaving the previous company's name with a
 * generic mismatch warning. The next successful refresh rewrites both.
 * Transient conflicts with another refresh are left alone, because that
 * other refresh writes the status itself.
 */
function aaShowFailedImport_(ss,message) {
  if (/Another SEC refresh is in progress|Ticker changed during fetch/.test(message)) return;
  try {
    const d = ss.getSheetByName(AA.dashboard);
    if (!d) return;
    const ticker = String(d.getRange(AA.tickerCell).getDisplayValue()||'').trim().toUpperCase();
    const reason = message.replace(/^Worker HTTP \d+:\s*/,'');
    d.getRange('B7').setValue(
      '\u26A0 SEC IMPORT FAILED for '+ticker+'\n'+reason+
      '\nColumn I stays blank for this ticker.');
    d.getRange(AA.companyCell).setValue('-');
  } catch (e) {
    console.error('Status update failed: '+String(e.message||e));
  }
}

function refreshStockAnalyzer() {
  const lock =
    LockService.getDocumentLock() ||
    LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw Error('Another SEC refresh is in progress.');
  }

  let ss = null;

  try {
    const x = aaSheets_();
    const {d,a,q} = x;
    ss = x.ss;

    // Validate the layout before changing anything.
    aaCheckDashboard_(d,a,q);

    const original = d
      .getRange(AA.tickerCell)
      .getDisplayValue();

    const ticker = aaTicker_(original);

    // Fetch all SEC financial data.
    const p = aaFetch_(ticker);

    // Validate the source ticker, contract, dates, and columns.
    const verified = aaValidatePayload_(p,ticker);

    // Reject a result if the user changed tickers during the request.
    if (
      aaTicker_(
        d.getRange(AA.tickerCell).getDisplayValue()
      )!==ticker
    ) {
      throw Error(
        'Ticker changed during fetch; retry the latest ticker.'
      );
    }

    // Back up previous imported data before writing.
    const oldA = Math.max(
      a.getLastRow()-1,
      verified.annual.length
    );

    const oldQ = Math.max(
      q.getLastRow()-1,
      verified.quarter.length,
      1
    );

    const previousAnnual = a
      .getRange(2,1,oldA,AA_ANNUAL_FIELDS.length)
      .getValues();

    const previousQuarter = q
      .getRange(2,1,oldQ,AA_QUARTER_FIELDS.length)
      .getValues();

    const previousZHeader = q
      .getRange('Z1').getValue();

    const previousZ2 = q
      .getRange('Z2').getValue();

    // Z3:Z10 = reportingCurrency / dataBasis / sharesOutstanding /
    // sharesOutstandingAsOf labels and values.
    const previousBasis = q
      .getRange('Z3:Z10').getValues();

    const previousName = d
      .getRange(AA.companyCell).getValue();

    const previousExchange = d
      .getRange(AA.exchangeCell).getValue();

    const previousStatus = d
      .getRange('B7').getFormula();

    const noteCells = [
      'F2','F3','F4','C5','F5','F6','F7','A7'
    ];

    const previousNotes = Object.fromEntries(
      noteCells.map(cell=>[
        cell,d.getRange(cell).getNote()
      ])
    );

    let writing = false;

    try {
      writing = true;

      // Replace annual SEC financials.
      aaWriteRows_(
        a,
        AA_ANNUAL_FIELDS,
        verified.annual,
        false
      );

      // Replace quarterly SEC financials.
      aaWriteRows_(
        q,
        AA_QUARTER_FIELDS,
        verified.quarter,
        true
      );

      // Annual-only (foreign) companies have no quarterly rows; Y2 still
      // records whose data this is, so ticker checks keep working.
      if (verified.annualOnly) {
        q.getRange('Y2').setValue(ticker);
      }

      // Annual-only companies: cover-page shares outstanding (ordinary
      // shares) of the latest annual report, for Analyzer G5.
      const shares = verified.annualOnly && Number.isFinite(p.sharesOutstanding) &&
        p.sharesOutstanding>0 ? p.sharesOutstanding : '';
      const sharesAsOf = shares!=='' && aaIso_(p.sharesOutstandingAsOf) ?
        p.sharesOutstandingAsOf : '';
      q.getRange('Z3:Z10').setValues([
        ['reportingCurrency'],[verified.currency],
        ['dataBasis'],[verified.annualOnly?'annual':'quarterly'],
        ['sharesOutstanding'],[shares],
        ['sharesOutstandingAsOf'],[sharesAsOf]
      ]);

      q.getRange('Z1').setValue('lastImportedAt');

      q.getRange('Z2')
        .setValue(new Date())
        .setNumberFormat('m/d/yyyy h:mm AM/PM');

      // Update company and exchange only after successful validation.
      d.getRange(AA.companyCell)
        .setValue(p.companyName||ticker);

      d.getRange(AA.exchangeCell)
        .setValue(p.exchange||'');

      // SEC status formula continues monitoring ticker matching.
      d.getRange('B7')
        .setFormula(aaStatusFormula_());

      // Refresh notes relating to the new SEC snapshot.
      aaHeaderNotes_(d,p);

      SpreadsheetApp.flush();

      if (
        aaTicker_(
          d.getRange(AA.tickerCell).getDisplayValue()
        )!==ticker
      ) {
        throw Error('Ticker was modified during import.');
      }

      if (
        aaTicker_(
          q.getRange('Y2').getDisplayValue()
        )!==ticker
      ) {
        throw Error(
          'Imported SEC ticker could not be verified.'
        );
      }

    } catch (err) {
      if (writing) {
        try {
          // Restore the previous SEC snapshot.
          a.getRange(
            2,1,oldA,AA_ANNUAL_FIELDS.length
          ).setValues(previousAnnual);

          q.getRange(
            2,1,oldQ,AA_QUARTER_FIELDS.length
          ).setValues(previousQuarter);

          q.getRange('Z1')
            .setValue(previousZHeader);

          q.getRange('Z2')
            .setValue(previousZ2);

          q.getRange('Z3:Z10')
            .setValues(previousBasis);

          d.getRange(AA.companyCell)
            .setValue(previousName);

          d.getRange(AA.exchangeCell)
            .setValue(previousExchange);

          if (previousStatus) {
            d.getRange('B7')
              .setFormula(previousStatus);
          }

          for (const [cell,note] of Object.entries(previousNotes)) {
            d.getRange(cell).setNote(note);
          }

          SpreadsheetApp.flush();

        } catch (rollbackError) {
          throw Error(
            String(err.message||err)+
            ' | ROLLBACK FAILED: '+
            String(rollbackError.message||rollbackError)
          );
        }
      }

      throw err;
    }

    ss.toast(
      'Imported '+verified.annual.length+
      ' annual years and '+verified.quarter.length+
      ' quarters for '+ticker+
      (verified.annualOnly?' (annual reports only, '+verified.currency+')':''),
      'Stock Analyzer',
      8
    );

    return {
      ticker,
      annual:verified.annual.length,
      quarters:verified.quarter.length,
      status:'SEC imported successfully'
    };

  } catch (err) {
    if (ss) {
      ss.toast(
        String(err.message||err),
        'SEC refresh failed',
        10
      );
      aaShowFailedImport_(ss,String(err.message||err));
    }

    throw err;

  } finally {
    lock.releaseLock();
  }
}
