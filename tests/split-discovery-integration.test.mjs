import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import worker from '../src/index.js';

const recent={form:['10-K'],accessionNumber:['0001234567-20-000001'],
  filingDate:['2020-10-30'],reportDate:['2020-09-30'],
  primaryDocument:['report.htm'],items:['']};
const archive={form:['10-K'],accessionNumber:['0001234567-19-000001'],
  filingDate:['2019-10-30'],reportDate:['2019-09-30'],
  primaryDocument:['report.htm'],items:['']};
const directory={'0':{ticker:'TEST',cik_str:1234567,title:'Test Corporation'}};
const sub={cik:1234567,filings:{recent,files:[
  {name:'CIK0001234567-submissions-001.json',filingFrom:'2019-01-01',filingTo:'2019-12-31'}
]}};
const original=globalThis.fetch;
test('SEC discovery spans archived filings and never modifies EPS',async()=>{
  const calls=[];
  globalThis.fetch=async input=>{
    const url=String(input);calls.push(url);
    if(url.includes('company_tickers.json'))return Response.json(directory);
    if(url.includes('/companyfacts/'))return Response.json({cik:1234567,facts:{'us-gaap':{}}});
    if(url.endsWith('/submissions/CIK0001234567.json'))return Response.json(sub);
    if(url.includes('submissions-001.json'))return Response.json(archive);
    if(url.includes('/Archives/edgar/data/'))return new Response(
      'On August 28, 2020, the Company effected a four-for-one stock split. All share and per share information has been retroactively adjusted.',{status:200}
    );
    throw Error('Unexpected URL: '+url);
  };
  try{
    const response=await worker.fetch(new Request('https://test.example/?ticker=TEST&discoverSplits=1'));
    const body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.success,true);
    assert.equal(body.splitDiscovery.archiveCount,1);
    assert.equal(body.splitDiscovery.documentsAttempted,2);
    assert.equal(body.splitDiscovery.mentions.length,2);
    assert.equal(body.splitDiscovery.mentions[0].ratio,4);
    assert.equal(body.splitDiscovery.mentions[0].verified,false);
    assert.equal(body.splitDiscovery.normalizationApplied,false);
    assert.equal(body.annualFinancials,null);
    assert.ok(calls.some(x=>x.includes('submissions-001.json')));
  } finally {globalThis.fetch=original;}
});
