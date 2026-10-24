/**
 * Worker <-> Apps Script <-> sheet compatibility.
 *
 * Loads the real apps-script/Code.gs and runs worker output through the
 * script's own payload validation (aaValidatePayload_), the same code every
 * sheet refresh runs. A worker change that would make refreshes fail, or a
 * script change that drops a field the worker supplies, fails here first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker from '../src/index.js';

const scriptSource = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

// Evaluate Code.gs with inert Google service stubs; only pure helpers run.
function loadScript() {
  const inert = new Proxy(function () {}, { get: () => inert, apply: () => inert });
  const context = vm.createContext({ SpreadsheetApp: inert, UrlFetchApp: inert, ScriptApp: inert,
    PropertiesService: inert, LockService: inert, Utilities: inert, Logger: inert, console });
  vm.runInContext(scriptSource + '\n;globalThis.__aa={AA,AA_ANNUAL_FIELDS,AA_QUARTER_FIELDS,aaValidatePayload_,aaStatusFormula_};', context);
  return context.__aa;
}
const gs = loadScript();

const workerList = name => {
  const m = workerSource.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];'));
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
};

test('schema version and history limits agree', () => {
  assert.equal(workerSource.match(/const VERSION = '([^']+)'/)[1], gs.AA.schema);
  assert.equal(gs.AA.maxAnnual, 20);
  assert.equal(gs.AA.maxQuarterly, 60);
});

test('every column the script writes is supplied by the worker', () => {
  const annual = workerList('ANNUAL_FIELDS'), quarter = workerList('QUARTER_FIELDS');
  assert.deepEqual([...gs.AA_ANNUAL_FIELDS].filter(f => !annual.includes(f)), []);
  assert.deepEqual([...gs.AA_QUARTER_FIELDS].filter(f => f !== 'sourceTicker' && !quarter.includes(f)), []);
});

test('script still writes the four-line SEC status formula', () => {
  const f = gs.aaStatusFormula_();
  assert.ok(f.startsWith('=IF(OR('));
  for (const s of ['Last imported quarter: Q', 'Released ', ' | SEC filed ', 'SEC imported ', 'CHAR(10)'])
    assert.ok(f.includes(s), s);
});

// The same small SEC fixture the basic-EPS worker test uses.
const company = { '0': { ticker: 'TEST', cik_str: 1234567, title: 'Example Company' } };
const details = { cik: 1234567, filings: { recent: {
  form: ['10-K', '10-Q', '10-Q', '10-Q'], filingDate: ['2025-10-30', '2025-07-30', '2025-04-30', '2025-01-30'],
  reportDate: ['2025-09-27', '2025-06-28', '2025-03-29', '2024-12-28'],
  accessionNumber: ['0001234567-25-000001', '0001234567-25-000002', '0001234567-25-000003', '0001234567-25-000004'],
  items: ['', '', '', ''] } }, tickers: ['TEST'], exchanges: ['Nasdaq'] };
const f = (start, end, val, form = '10-K') => ({ start, end, val, form, accn: '0001234567-25-000001', filed: '2025-10-30' });
const annual = v => [f('2024-09-29', '2025-09-27', v), f('2023-10-01', '2024-09-28', v * .9)];
const quarters = v => [f('2024-09-29', '2024-12-28', v[0], '10-Q'), f('2024-12-29', '2025-03-29', v[1], '10-Q'), f('2025-03-30', '2025-06-28', v[2], '10-Q')];
const unit = (u, e) => ({ units: { [u]: e } });
const facts = { cik: 1234567, entityName: 'Example Company', facts: { 'us-gaap': {
  RevenueFromContractWithCustomerExcludingAssessedTax: unit('USD', [...annual(400e9), ...quarters([100e9, 105e9, 110e9])]),
  NetIncomeLoss: unit('USD', [...annual(100e9), ...quarters([25e9, 26e9, 27e9])]),
  EarningsPerShareBasic: unit('USD/shares', [...annual(7.49), ...quarters([2.42, 1.67, 1.59])]),
  EarningsPerShareDiluted: unit('USD/shares', [...annual(7.46), ...quarters([2.40, 1.65, 1.57])]),
  WeightedAverageNumberOfDilutedSharesOutstanding: unit('shares', [...annual(15e9), ...quarters([15.2e9, 15.1e9, 15.0e9])])
} } };

test('worker output passes the Apps Script refresh validation unchanged', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    url = String(url);
    if (url.includes('company_tickers.json')) return Response.json(company);
    if (url.includes('/companyfacts/')) return Response.json(facts);
    if (url.includes('/submissions/')) return Response.json(details);
    throw Error('Unexpected SEC fetch ' + url);
  };
  let payload;
  try { payload = await (await worker.fetch(new Request('https://example.test/?ticker=TEST'))).json(); }
  finally { globalThis.fetch = original; }
  assert.equal(payload.success, true);
  const v = gs.aaValidatePayload_(payload, 'TEST');   // throws exactly as a refresh would
  assert.equal(v.annual[0].length, gs.AA_ANNUAL_FIELDS.length);
  assert.equal(v.quarter[0].length, gs.AA_QUARTER_FIELDS.length);
  assert.equal(v.quarter[0][gs.AA_QUARTER_FIELDS.indexOf('sourceTicker')], 'TEST');
});

test('feeds served from the shared calculation match the direct calculation byte for byte', async () => {
  const { routeRequest, resetFeedReuse } = await import('../src/index.js');
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    url = String(url);
    if (url.includes('company_tickers.json')) return Response.json(company);
    if (url.includes('/companyfacts/')) return Response.json(facts);
    if (url.includes('/submissions/')) return Response.json(details);
    throw Error('Unexpected SEC fetch ' + url);
  };
  try {
    for (const feed of ['basicEpsCsv=quarterly', 'basicEpsCsv=annual', 'fcfPerShareCsv=quarterly', 'netAcquisitionsCsv=quarterly', 'quarterlyExtrasCsv=1', 'blankReasons=1']) {
      resetFeedReuse();
      // An unknown extra parameter bypasses reuse and runs the original path.
      const direct = await (await routeRequest(new Request('https://w.test/?ticker=TEST&' + feed + '&bypass=1'))).text();
      const shared = await (await routeRequest(new Request('https://w.test/?ticker=TEST&' + feed + '&revision=1'))).text();
      assert.equal(shared, direct, feed);
    }
  } finally { globalThis.fetch = original; resetFeedReuse(); }
});

test('the combined quarterly feed equals the three separate feeds, column by column', async () => {
  const { routeRequest, resetFeedReuse } = await import('../src/index.js');
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    url = String(url);
    if (url.includes('company_tickers.json')) return Response.json(company);
    if (url.includes('/companyfacts/')) return Response.json(facts);
    if (url.includes('/submissions/')) return Response.json(details);
    throw Error('Unexpected SEC fetch ' + url);
  };
  try {
    resetFeedReuse();
    const text = async q => (await routeRequest(new Request('https://w.test/?ticker=TEST&' + q + '&revision=1'))).text();
    const rows = (await text('quarterlyExtrasCsv=1')).trim().split('\n').map(l => l.split(','));
    const separate = await Promise.all(['basicEpsCsv=quarterly', 'fcfPerShareCsv=quarterly', 'netAcquisitionsCsv=quarterly']
      .map(async q => (await text(q)).trim().split('\n')));
    assert.ok(rows.length > 0);
    separate.forEach((col, c) => assert.deepEqual(rows.map(r => r[c]), col));
  } finally { globalThis.fetch = original; resetFeedReuse(); }
});

test('the metric names in column H are free to rename (no layout check on them)', () => {
  assert.ok(!scriptSource.includes("getRange('H4:H22')"));
  assert.ok(!/AA_METRICS/.test(scriptSource));
});

test('the metrics-table headings H2, I2 and J2 are free to rename', () => {
  assert.ok(!/H2\s*:\s*'Metric'/.test(scriptSource));
  assert.ok(!/J2\s*:\s*'Google Finance Numbers'/.test(scriptSource));
  assert.ok(!scriptSource.includes("getRange('I2')"));
});

test('the layout check covers only cells the refresh reads or writes', () => {
  const labels = scriptSource.slice(scriptSource.indexOf('const AA_LABELS = {'), scriptSource.indexOf('};', scriptSource.indexOf('const AA_LABELS = {')));
  const cells = [...labels.matchAll(/^\s+([A-Z]+\d+):/gm)].map(m => m[1]);
  assert.deepEqual(cells, ['A2','A4','A6','A7','C2','C5','F2','F3','F4','F5','F6','F7']);
  for (const gone of ["getRange('E24:G24')", "getRange('B13:D13')"])
    assert.ok(!scriptSource.includes(gone), gone);
  assert.ok(scriptSource.includes("getRange('A25:A28')"));              // result safety net kept
  assert.ok(scriptSource.includes('Unexpected result formula'));
  assert.ok(scriptSource.includes('aaCheckHeader_(a,AA_ANNUAL_FIELDS)'));  // data-tab headers still checked
  assert.ok(scriptSource.includes('Refresh checkbox missing'));           // B6 still checked
});

test('a foreign filer gets a plain reason, and the script shows a failed import in B7 and B4', async () => {
  const { foreignFilerReason } = await import('../src/index.js');
  const asml = { filings: { recent: { form: ['S-8 POS', '6-K', '6-K', 'SD', '20-F', '6-K'] } } };
  assert.match(foreignFilerReason(asml, 'ASML Holding NV'), /^ASML Holding NV files with the SEC as a foreign company \(annual 20-F reports/);
  assert.equal(foreignFilerReason({ filings: { recent: { form: ['10-Q', '8-K', '10-K'] } } }, 'X'), null);
  assert.match(foreignFilerReason({ filings: { recent: { form: ['6-K', '20-F'] } } }, 'Novo Nordisk', 'IFRS'), /annual 20-F reports under IFRS accounting, quarterly/);
  assert.equal(foreignFilerReason({ filings: { recent: { form: ['40-F', '10-K'] } } }, 'X'), null);   // files 10-Ks too
  assert.match(scriptSource, /aaShowFailedImport_\(ss,String\(err\.message\|\|err\)\)/);
  assert.match(scriptSource, /SEC IMPORT FAILED for/);
});
