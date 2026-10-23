import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest, resetFeedReuse } from '../src/index.js';

// A fake full calculation that counts how often it runs.
function counter(body = { success: true, annualFinancials: [{ basicEPS: 7.49 }, { basicEPS: null }],
  quarterlyFinancials: [{ basicEPS: 1.59, fcfPerShare: 2.1, netAcquisitions: 0 }, { basicEPS: 2.42, fcfPerShare: null, netAcquisitions: null }],
  blankReasons: [{ metric: 'PEG Ratio (Forward 3 Years)', reason: 'Needs forecasts.' }] }, status = 200) {
  const calls = [];
  const handler = async request => {
    calls.push(new URL(request.url).search);
    await new Promise(r => setTimeout(r, 20));
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, handler };
}
const get = (q, h) => routeRequest(new Request('https://w.test/?' + q), h);

test('a refresh (import + three feeds) runs the calculation once', async () => {
  resetFeedReuse();
  const { calls, handler } = counter();
  await (await get('ticker=AAPL', handler)).text();
  const [q, a, r] = await Promise.all([
    get('ticker=AAPL&basicEpsCsv=quarterly&revision=1', handler),
    get('ticker=AAPL&basicEpsCsv=annual&revision=1', handler),
    get('ticker=AAPL&blankReasons=1&revision=1', handler)]);
  assert.equal(calls.length, 1);
  assert.equal(await q.text(), '1.59\n2.42\n');
  assert.equal(await a.text(), '7.49\nNA\n');
  assert.equal(await r.text(), '"Metric","Why it is blank"\n"PEG Ratio (Forward 3 Years)","Needs forecasts."\n');
  assert.equal(r.headers.get('content-type'), 'text/csv; charset=utf-8');
});

test('concurrent feeds without a recent import share one calculation', async () => {
  resetFeedReuse();
  const { calls, handler } = counter();
  await Promise.all(['basicEpsCsv=quarterly', 'basicEpsCsv=annual', 'blankReasons=1']
    .map(p => get('ticker=MSFT&' + p, handler).then(r => r.text())));
  assert.equal(calls.length, 1);
});

test('every import recalculates, so a refresh always gets fresh SEC data', async () => {
  resetFeedReuse();
  const { calls, handler } = counter();
  await get('ticker=AAPL', handler); await get('ticker=AAPL', handler);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, ['?ticker=AAPL', '?ticker=AAPL']);           // only the ticker is passed on
});

test('failures are returned unchanged and never reused', async () => {
  resetFeedReuse();
  const bad = counter({ success: false, error: 'SEC returned HTTP 503 for issuer data' }, 502);
  const r = await get('ticker=JPM&blankReasons=1', bad.handler);
  assert.equal(r.status, 502);
  assert.match(await r.text(), /SEC returned HTTP 503/);
  await get('ticker=JPM&blankReasons=1', bad.handler);
  assert.equal(bad.calls.length, 2);
});

test('raw views, audits and bad input bypass reuse', async () => {
  resetFeedReuse();
  const { calls, handler } = counter();
  for (const q of ['ticker=AAPL&secCatalog=1', 'ticker=AAPL&basisAudit=1', 'ticker=', 'ticker=AAPL&debtAudit=x'])
    await get(q, handler);
  assert.deepEqual(calls, ['?ticker=AAPL&secCatalog=1', '?ticker=AAPL&basisAudit=1', '?ticker=', '?ticker=AAPL&debtAudit=x']);
  const r = await get('ticker=AAPL&basicEpsCsv=weekly', handler);
  assert.equal(r.status, 400);
});

test('the FCF-per-share feed reuses the import and validates its parameter', async () => {
  resetFeedReuse();
  const { calls, handler } = counter();
  await (await get('ticker=NVDA', handler)).text();
  const r = await get('ticker=NVDA&fcfPerShareCsv=quarterly&revision=1', handler);
  assert.equal(await r.text(), '2.1\nNA\n');
  assert.equal(calls.length, 1);
  assert.equal((await get('ticker=NVDA&fcfPerShareCsv=annual', handler)).status, 400);
});

test('the combined quarterly feed (Quarterly Data AA:AC) reuses the import, one row per quarter', async () => {
  resetFeedReuse();
  const { calls, handler } = counter();
  await (await get('ticker=AAPL', handler)).text();
  const r = await get('ticker=AAPL&quarterlyExtrasCsv=1&revision=1', handler);
  assert.equal(await r.text(), '1.59,2.1,0\n2.42,NA,NA\n');
  assert.equal(calls.length, 1);
  assert.equal((await get('ticker=AAPL&quarterlyExtrasCsv=2', handler)).status, 400);
});
