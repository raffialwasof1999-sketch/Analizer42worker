
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
 * H4:L27  Additional metrics (rows may be inserted/reordered)
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

// Only B2 (ticker), B4 (company), E2 (exchange), B6 (refresh checkbox),
// and B7 (status) have fixed dashboard locations. Labels, assumptions,
// results and metric rows are maintained by the sheet, not the importer.

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
  if (/Another SEC refresh is in progress/.test(message)) return;
  try {
    const d = ss.getSheetByName(AA.dashboard);
    if (!d) return;
    const ticker = String(d.getRange(AA.tickerCell).getDisplayValue()||'').trim().toUpperCase();
    const reason = message.replace(/^Worker HTTP \d+:\s*/,'');
    d.getRange('B7').setValue(
      '\u26A0 SEC IMPORT FAILED for '+ticker+'\n'+reason+
      '\nValuations are hidden until a successful refresh.'+
      aaLastSuccessfulImport_(ss));
    d.getRange(AA.companyCell).setValue('-');
  } catch (e) {
    console.error('Status update failed: '+String(e.message||e));
  }
}

function aaLastSuccessfulImport_(ss) {
  const q = ss.getSheetByName(AA.quarterSheet);
  if (!q) return '\nLast successful import: unavailable';
  const at = q.getRange('Z2').getDisplayValue();
  const ticker = q.getRange('Y2').getDisplayValue();
  return '\nLast successful import: '+(at ? ticker+' | '+at : 'unavailable');
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

    // Existing sheet formulas keep their B7 success checks when moved.
    // Do not rewrite them or require any calculation to occupy a fixed range.
    // Fail closed before validation or network access, including same-ticker
    // refreshes, by replacing the successful status prefix.
    d.getRange('B7').setValue('SEC REFRESHING — valuations hidden'+
      aaLastSuccessfulImport_(ss));
    SpreadsheetApp.flush();

    // Validate the refresh checkbox and data-tab schemas. Dashboard
    // labels and calculation locations do not restrict importing.
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

      // Publish success only after all writes and ticker checks complete.
      d.getRange('B7').setFormula(aaStatusFormula_());
      SpreadsheetApp.flush();

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

