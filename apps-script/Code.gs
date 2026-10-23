
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

  // IMPORTANT: Short histories are accepted.
  if (
    !Array.isArray(a) ||
    !Array.isArray(q) ||
    a.length<1 ||
    q.length<1 ||
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
    typeof q[0].revenue!=='number' ||
    typeof q[0].netIncome!=='number'
  ) {
    throw Error(
      'Latest SEC quarterly revenue/net income is incomplete.'
    );
  }

  return {annual,quarter,a,q};
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
  return "=IF(OR('Quarterly Data'!Y2=\"\",UPPER(TRIM($B$2))<>UPPER(TRIM('Quarterly Data'!Y2))),\"⚠ SEC TICKER MISMATCH: \"&UPPER(TRIM($B$2))&\" | SEC data: \"&'Quarterly Data'!Y2&\" | Do not use valuations\",LET(d,LAMBDA(v,IFERROR(TEXT(IF(ISNUMBER(v),v,DATEVALUE(v)),\"m/d/yy\"),\"n/a\")),\"SEC snapshot: \"&'Quarterly Data'!Y2&\" | \"&COUNT('Financial Data'!A2:A1000)&\" annual years | \"&COUNT('Quarterly Data'!A2:A1000)&\" quarters\"&CHAR(10)&\"Last imported quarter: Q\"&'Quarterly Data'!B2&\" FY\"&'Quarterly Data'!A2&CHAR(10)&\"Released \"&d('Quarterly Data'!X2)&\" | SEC filed \"&d('Quarterly Data'!W2)&CHAR(10)&IF(ISNUMBER('Quarterly Data'!Z2),\"SEC imported \"&TEXT('Quarterly Data'!Z2,\"m/d/yy h:mm AM/PM\"),\"Refresh timestamp missing\")))";
}

/* =========================================================
   UPDATE SEC INFORMATION NOTES
   ========================================================= */

function aaHeaderNotes_(dashboard,p) {
  const first = p.quarterlyFinancials[0];

  const last = p.quarterlyFinancials[
    Math.min(3,p.quarterlyFinancials.length-1)
  ];

  const context =
    'Latest available SEC quarterly records: '+
    last.fiscalPeriodEnd+' to '+
    first.fiscalPeriodEnd+
    '. Company: '+p.companyName+
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

  for (const [cell,note] of Object.entries(notes)) {
    dashboard.getRange(cell).setNote(note);
  }
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
    latestQuarter:p.quarterlyFinancials[0].fiscalPeriodEnd
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
      verified.quarter.length
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
      ' quarters for '+ticker,
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
    }

    throw err;

  } finally {
    lock.releaseLock();
  }
}
