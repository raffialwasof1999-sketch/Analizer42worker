import test from 'node:test';
import assert from 'node:assert/strict';
import {dividendStatements,applyDividendEvidence,verifyDividends} from '../src/sec-dividend-status.js';
import {blankReasons} from '../src/blank-reasons.js';
const report={end:'2026-09-30',form:'10-Q'};
const never='<h2>Dividend Policy</h2><p>We have never declared or paid any cash dividends on our capital stock.</p>';
const rows=()=>[
  {fiscalYear:2026,fiscalQuarter:3,fiscalPeriodEnd:'2026-09-30',dividendsPaid:null,dividendsPerShare:null},
  {fiscalYear:2026,fiscalQuarter:2,fiscalPeriodEnd:'2026-06-30',dividendsPaid:null,dividendsPerShare:null},
  {fiscalYear:2026,fiscalQuarter:1,fiscalPeriodEnd:'2026-03-31',dividendsPaid:null,dividendsPerShare:null},
  {fiscalYear:2025,fiscalQuarter:4,fiscalPeriodEnd:'2025-12-31',dividendsPaid:null,dividendsPerShare:null}];
const proof=()=>dividendStatements(never,report);
test('explicit issuer never-declared-or-paid statement confirms historical zero',()=>{
  const out=applyDividendEvidence(rows(),proof());
  assert.equal(proof().length,1);
  for(const r of out){assert.equal(r.dividendsPaid,0);assert.equal(r.dividendsPerShare,0);assert.equal(r.dividendEvidence.dividendsPerShare.status,'confirmed-zero');}
});
test('absence, future intentions, suspended payments and preferred stock never establish zero',()=>{
  for(const html of ['', 'We do not expect to pay dividends.', '<h2>Dividend Policy</h2>We intend to retain earnings.', '<h2>Dividend Policy</h2>We have never declared or paid any cash dividends on our preferred stock.', '<p>We suspended our dividend.</p>']) {
    assert.equal(dividendStatements(html,report).length,0);
    assert.equal(applyDividendEvidence(rows(),dividendStatements(html,report))[0].dividendsPerShare,null);
  }
});
test('hidden inline header and script text are not evidence',()=>{
  assert.equal(dividendStatements('<script>'+never+'</script>',report).length,0);
  assert.equal(dividendStatements('<ix:header>'+never+'</ix:header>',report).length,0);
});
test('evidence does not extend past its report period',()=>{
  const p=dividendStatements(never,{end:'2025-12-31'});
  assert.equal(applyDividendEvidence(rows(),p)[0].dividendsPerShare,null);
  assert.equal(applyDividendEvidence(rows(),p)[3].dividendsPerShare,0);
});
test('positive dividends contradict never-paid proof; preserve all known values',()=>{
  const r=rows();r[1].dividendsPaid=20;r[1].dividendsPerShare=.5;
  const out=applyDividendEvidence(r,proof());
  assert.equal(out[0].dividendsPerShare,null);assert.equal(out[1].dividendsPaid,20);
  assert.equal(out[1].dividendEvidence.dividendsPaid.status,'reported');
});
test('explicit numeric zero remains zero without fetching or text proof',()=>{
  const r=rows().map(x=>({...x,dividendsPaid:0,dividendsPerShare:0}));
  assert.equal(applyDividendEvidence(r)[0].dividendEvidence.dividendsPaid.status,'confirmed-zero');
});
test('a quarterly paid-only statement does not establish zero declared DPS',()=>{
  const html='We did not pay any cash dividends on our common stock during the three months ended September 30, 2026.';
  const out=applyDividendEvidence(rows(),dividendStatements(html,report));
  assert.equal(out[0].dividendsPaid,0);assert.equal(out[0].dividendsPerShare,null);
  assert.equal(out[1].dividendsPaid,null);
});
test('explicit nine-month claim covers only quarters wholly inside the named window',()=>{
  const html='We did not declare or pay any cash dividends on our common stock during the nine months ended September 30, 2026.';
  const out=applyDividendEvidence(rows(),dividendStatements(html,report));
  assert.deepEqual(out.map(r=>r.dividendsPerShare),[0,0,0,null]);
});
test('date mismatch and unverified 53-week period-limited wording remain unknown',()=>{
  const html='We did not declare or pay any cash dividends on our common stock during the three months ended June 30, 2026.';
  assert.equal(dividendStatements(html,report).length,0);
});
const sub={filings:{recent:{form:['10-Q'],reportDate:['2026-09-30'],accessionNumber:['0001234567-26-000001'],primaryDocument:['report.htm']}}};
test('verification preserves row field order and provides separate status/provenance',async()=>{
  const before=rows();let calls=0;
  const out=await verifyDividends([],before,sub,'0001234567',async f=>{calls++;assert.match(f.filingDocumentUrl,/www.sec.gov\/Archives\/edgar\/data\/1234567\//);return never;});
  assert.equal(calls,1);assert.deepEqual(Object.keys(out.quarterly[0]),Object.keys(before[0]));
  assert.equal(out.evidence.quarterly[0].dividendsPaid.status,'confirmed-zero');
  assert.equal(out.evidence.quarterly[0].dividendsPaid.accession,'0001234567-26-000001');
  assert.equal(before[0].dividendsPaid,null);
});
test('filing failures and unsafe paths leave unknown rather than breaking imports',async()=>{
  const out=await verifyDividends([],rows(),sub,'1234567',async()=>{throw Error('SEC unavailable');});
  assert.equal(out.quarterly[0].dividendsPaid,null);assert.equal(out.checks[0].status,'unavailable');
  const unsafe=structuredClone(sub);unsafe.filings.recent.primaryDocument=['../other.htm'];
  await verifyDividends([],rows(),unsafe,'1234567',async()=>assert.fail('unsafe request'));
});
test('complete numeric payer data requires no fallback requests',async()=>{
  await verifyDividends([],rows().map(r=>({...r,dividendsPaid:1,dividendsPerShare:.1})),sub,'1234567',async()=>assert.fail('unnecessary request'));
});
test('annual-only periods can obtain explicit never-paid evidence',async()=>{
  const s=structuredClone(sub);s.filings.recent.form=['20-F'];
  const out=await verifyDividends([{fiscalYear:2026,fiscalPeriodEnd:'2026-09-30',dividendsPaid:null,dividendsPerShare:null}],[],s,'1234567',async()=>never);
  assert.equal(out.annual[0].dividendsPerShare,0);
});
test('blank reasons distinguish unknown from confirmed four-quarter zero',()=>{
  const unknown=blankReasons(rows()).find(r=>r.metric==='Dividend Yield (TTM)');
  assert.match(unknown.reason,/unverified/);
  const zero=blankReasons(applyDividendEvidence(rows(),proof())).find(r=>r.metric==='Dividend Yield (TTM)');
  assert.match(zero.reason,/Shown as zero/);
});
