import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import worker from '../src/index.js';

const accession = '0000000001-26-000002';
const directory = {'0':{ticker:'TEST',cik_str:1234567,title:'Test Corporation'}};
const facts = {cik:1234567,facts:{'us-gaap':{}}};
const submissions = {
  cik:1234567,filings:{recent:{
    form:['8-K'],accessionNumber:[accession],filingDate:['2026-03-02'],
    reportDate:['2026-03-02'],primaryDocument:['report.htm'],items:['5.03']
  }}
};
const originalFetch = globalThis.fetch;
test('inspection returns unverified findings without computing quarterly SEC financials',async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    url = String(url); calls.push(url);
    if(url.includes('company_tickers.json')) return Response.json(directory);
    if(url.includes('companyfacts/')) return Response.json(facts);
    if(url.includes('/submissions/')) return Response.json(submissions);
    if(url.includes('/Archives/')) return new Response(
      'The company effected a 4-for-1 stock split.', {status:200}
    );
    throw Error('Unexpected URL: '+url);
  };
  try {
    const response = await worker.fetch(new Request(
      'https://analyzer.example/?ticker=TEST&inspectSplitAccession='+accession
    ));
    const result = await response.json();
    assert.equal(response.status,200);
    assert.equal(result.success,true);
    assert.equal(result.statements.length,1);
    assert.equal(result.statements[0].sharesAfterPerBefore,4);
    assert.equal(result.statements[0].verified,false);
    assert.equal(result.normalizationApplied,false);
    assert.equal(calls.length,4);
  } finally { globalThis.fetch = originalFetch; }
});
test('inspection rejects unknown accessions without fetching arbitrary archives',async () => {
  const calls = [];
  globalThis.fetch = async url => {
    url=String(url);calls.push(url);
    if(url.includes('company_tickers.json'))return Response.json(directory);
    if(url.includes('companyfacts/'))return Response.json(facts);
    if(url.includes('/submissions/'))return Response.json(submissions);
    throw Error('Should not fetch archive: '+url);
  };
  try {
    const response=await worker.fetch(new Request(
      'https://analyzer.example/?ticker=TEST&inspectSplitAccession=0000000001-26-999999'
    ));
    assert.equal(response.status,404);
    assert.equal(calls.length,3);
  } finally { globalThis.fetch = originalFetch; }
});
