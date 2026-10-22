/**
 * Analyzer42 Ticker Search
 *
 * Search interface: TickerSearch2.html
 *
 * Installs alongside your existing Apps Script.
 *
 * Does NOT replace your existing:
 * - refreshStockAnalyzer()
 * - onOpen()
 * - aaTickerEdited()
 *
 * Existing GOOGLEFINANCE formulas remain unchanged.
 */

const ANALYZER42_SEARCH_TAB = 'Analyzer';
const ANALYZER42_SEARCH_CELL = 'B2';


/**
 * Run this function ONCE to install the search menu.
 */
function installAnalyzer42TickerSearch() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss || !ss.getSheetByName(ANALYZER42_SEARCH_TAB)) {
    throw new Error(
      'Open the active Analyzer42 spreadsheet before installing.'
    );
  }

  const handler = 'addAnalyzer42TickerSearchMenu';

  const present = ScriptApp.getProjectTriggers()
    .some(trigger =>
      trigger.getHandlerFunction() === handler
    );

  if (!present) {
    ScriptApp.newTrigger(handler)
      .forSpreadsheet(ss)
      .onOpen()
      .create();
  }

  addAnalyzer42TickerSearchMenu();

  ss.toast(
    'Ticker Search installed. Use the Ticker Search menu.',
    'Analyzer42',
    6
  );
}


/**
 * Adds a separate menu without replacing
 * your existing onOpen() function.
 */
function addAnalyzer42TickerSearchMenu() {

  SpreadsheetApp.getUi()
    .createMenu('Ticker Search')
    .addItem(
      'Find a stock…',
      'openAnalyzer42TickerSearch'
    )
    .addToUi();

}


/**
 * Opens the searchable stock directory.
 *
 * HTML filename: TickerSearch2.html
 */
function openAnalyzer42TickerSearch() {

  const html = HtmlService
    .createHtmlOutputFromFile('TickerSearch2')
    .setTitle('Find a stock — Analyzer42');

  SpreadsheetApp.getUi().showSidebar(html);

}


/**
 * Downloads U.S. stock listings from Nasdaq Trader.
 *
 * The sidebar performs searching locally,
 * so it does not call the server on every keystroke.
 */
function analyzer42GetTickerDirectory() {

  const files = [
    {
      url: 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',
      type: 'nasdaq'
    },
    {
      url: 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt',
      type: 'other'
    }
  ];

  const listings = [];
  const warnings = [];
  const known = new Set();

  files.forEach(function(file) {

    try {

      const response = UrlFetchApp.fetch(file.url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          'Accept': 'text/plain'
        }
      });

      if (response.getResponseCode() !== 200) {
        throw new Error(
          'HTTP ' + response.getResponseCode()
        );
      }

      const lines = response
        .getContentText()
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter(Boolean);

      if (lines.length < 100) {
        throw new Error(
          'Directory appears incomplete'
        );
      }

      const headings = lines[0]
        .split('|')
        .map(s => s.trim());

      const indexOf = name => headings.indexOf(name);

      const symbolCol = indexOf(
        file.type === 'nasdaq'
          ? 'Symbol'
          : 'ACT Symbol'
      );

      const nameCol = indexOf('Security Name');
      const etfCol = indexOf('ETF');
      const testCol = indexOf('Test Issue');

      const exchangeCol = file.type === 'other'
        ? indexOf('Exchange')
        : -1;

      if (
        symbolCol < 0 ||
        nameCol < 0 ||
        etfCol < 0 ||
        testCol < 0
      ) {
        throw new Error(
          'Unexpected directory format'
        );
      }

      for (let i = 1; i < lines.length; i++) {

        const cells = lines[i].split('|');

        const ticker = (
          cells[symbolCol] || ''
        ).trim().toUpperCase();

        const fullName = (
          cells[nameCol] || ''
        ).trim();

        if (
          !/^[A-Z0-9][A-Z0-9.\-]{0,13}$/.test(ticker) ||
          !fullName
        ) {
          continue;
        }

        if (
          cells[etfCol] !== 'N' ||
          cells[testCol] !== 'N'
        ) {
          continue;
        }

        if (known.has(ticker)) {
          continue;
        }

        const code = exchangeCol >= 0
          ? cells[exchangeCol]
          : '';

        const exchange = file.type === 'nasdaq'
          ? 'NASDAQ'
          : ({
              N: 'NYSE',
              A: 'NYSE American',
              P: 'NYSE Arca',
              Z: 'Cboe',
              V: 'IEX'
            })[code] || 'US';

        known.add(ticker);

        listings.push([
          ticker,
          fullName,
          exchange
        ]);

      }

    } catch (error) {

      warnings.push(
        file.type + ': ' + error.message
      );

    }

  });

  if (!listings.length) {

    throw new Error(
      'Stock directory is unavailable right now. ' +
      'Try again later. ' +
      warnings.join('; ')
    );

  }

  return {
    listings: listings,
    warnings: warnings
  };

}


/**
 * Selects a ticker and updates Analyzer!B2.
 *
 * Calls your EXISTING SEC refresh function.
 *
 * No GOOGLEFINANCE formulas are modified.
 */
function analyzer42SelectTicker(ticker) {

  const symbol = String(ticker || '')
    .trim()
    .toUpperCase();

  if (
    !/^[A-Z0-9][A-Z0-9.\-]{0,13}$/.test(symbol)
  ) {
    throw new Error(
      'Please select a valid ticker from the suggestions.'
    );
  }

  if (typeof refreshStockAnalyzer !== 'function') {

    throw new Error(
      'Existing refreshStockAnalyzer() was not found. ' +
      'Nothing was changed.'
    );

  }

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(ANALYZER42_SEARCH_TAB);

  if (!sheet) {

    throw new Error(
      'Analyzer tab not found. Nothing was changed.'
    );

  }

  const input = sheet.getRange(
    ANALYZER42_SEARCH_CELL
  );

  const previousTicker = String(
    input.getDisplayValue() || ''
  ).trim().toUpperCase();

  if (previousTicker !== symbol) {

    input.setValue(symbol);

    SpreadsheetApp.flush();

  }

  try {

    refreshStockAnalyzer();

  } catch (error) {

    throw new Error(
      'Ticker ' + symbol +
      ' was entered in Analyzer!B2, ' +
      'but SEC refresh failed: ' +
      error.message +
      '. Check Analyzer!B7 before relying on financial results.'
    );

  }

  return {
    ticker: symbol,
    message: 'Ticker selected and existing SEC refresh completed.'
  };

}
