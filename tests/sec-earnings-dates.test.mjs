import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {
  filingRows, fullQuarterFilingHistory, assignQuarterDates,
  earningsDateCoverage
} from '../src/sec-earnings-dates.js';

const cik='0000104169';
const olderFile='CIK'+cik+'-submissions-001.json';
const rows=()=>[
  {fiscalQuarter:3,fiscalPeriodEnd:'2023-04-30'},
  {fiscalQuarter:2,fiscalPeriodEnd:'2026-07-31'}
];
const recent={
  form:['10-Q','8-K'],
  filingDate:['2026-09-01','2026-08-20'],
  reportDate:['2026-07-31','2026-07-31'],
  items:['','2.02,9.01'],
  accessionNumber:['2026-quarter','2026-earnings']
};
const archive={
  form:['10-Q','8-K','8-K'],
  filingDate:['2023-06-02','2023-05-18','2023-05-21'],
  reportDate:['2023-04-30','',''],
  items:['','2.02','5.02'],
  accessionNumber:['2023-quarter','2023-earnings','2023-unrelated']
};

test('older 8-K is retrieved from SEC archives and assigned to correct quarter',async()=>{
  const calls=[];
  const sub={filings:{recent,files:[{
    name:olderFile,filingFrom:'2023-01-01',filingTo:'2023-12-31'
  }]}};
  const source=await fullQuarterFilingHistory(sub,rows(),cik,async url=>{
    calls.push(url);
    return archive;
  });
  const quarters=rows();
  assignQuarterDates(quarters,source.filings);
  assert.equal(calls.length,1);
  assert.ok(calls[0].endsWith('/'+olderFile));
  assert.equal(quarters[0].secFilingDate,'2023-06-02');
  assert.equal(quarters[0].earningsDisclosureDate,'2023-05-18');
  assert.equal(quarters[1].earningsDisclosureDate,'2026-08-20');
  assert.deepEqual(earningsDateCoverage(quarters,source.archivesScanned)
    .missingItem202ForFiledQuarters,[]);
});

test('never requests irrelevant older archives before oldest available quarter',async()=>{
  const sub={filings:{recent,files:[{
    name:olderFile,filingTo:'2020-12-31',filingFrom:'2010-01-01'
  }]}};
  const loaded=await fullQuarterFilingHistory(sub,rows(),cik,async()=>{
    throw Error('must not fetch irrelevant files');
  });
  assert.equal(loaded.archivesScanned,0);
  assert.equal(loaded.filings.length,2);
});

test('keeps a missing 8-K date null rather than substituting the 10-Q date',()=>{
  const quarters=[{fiscalQuarter:3,fiscalPeriodEnd:'2023-04-30'}];
  assignQuarterDates(quarters,filingRows({
    form:['10-Q'],filingDate:['2023-06-02'],
    reportDate:['2023-04-30'],accessionNumber:['a']
  }));
  assert.equal(quarters[0].secFilingDate,'2023-06-02');
  assert.equal(quarters[0].earningsDisclosureDate,null);
  assert.deepEqual(earningsDateCoverage(quarters,0)
    .missingItem202ForFiledQuarters,['2023-04-30']);
});

test('archive retrieval errors are reported visibly without failing the response',async()=>{
  const sub={filings:{recent,files:[{name:olderFile,filingTo:'2023-12-31'}]}};
  const loaded=await fullQuarterFilingHistory(sub,rows(),cik,async()=>{throw Error('SEC 503');});
  assert.equal(loaded.archivesSkipped.length,1);
  assert.equal(loaded.archivesSkipped[0].name,olderFile);
  assert.match(loaded.archivesSkipped[0].reason,/SEC 503/);
  const quarters=rows();
  assignQuarterDates(quarters,loaded.filings);
  assert.equal(quarters[0].earningsDisclosureDate,null);    // older quarter: visibly unknown
  assert.equal(quarters[1].earningsDisclosureDate,'2026-08-20'); // recent dates intact
});

test('heavy filers read only the newest archives within the subrequest budget',async()=>{
  const files=Array.from({length:40},(_,k)=>({
    name:`CIK${cik}-submissions-${String(k+1).padStart(3,'0')}.json`,
    filingTo:`20${String(10+Math.floor(k/4)).padStart(2,'0')}-12-31`}));
  const sub={filings:{recent,files}};
  const calls=[];
  const loaded=await fullQuarterFilingHistory(sub,[{fiscalPeriodEnd:'2011-03-31'}],cik,
    async url=>{calls.push(url);return archive;},14);
  assert.equal(calls.length,14);
  assert.equal(loaded.archivesSkipped.length,22);   // 4 archives end before 2011 and are irrelevant
  assert.ok(calls.every(u=>!loaded.archivesSkipped.some(x=>u.endsWith(x.name))));
  const readTo=files.filter(f=>calls.some(u=>u.endsWith('/'+f.name))).map(f=>f.filingTo);
  assert.ok(loaded.archivesSkipped.every(x=>readTo.every(t=>x.filingTo<=t)));
});

test('de-duplicates archive/recent overlap by accession',async()=>{
  const sub={filings:{recent,files:[{name:olderFile,filingTo:'2026-07-31'}]}};
  const loaded=await fullQuarterFilingHistory(sub,rows(),cik,async()=>recent);
  assert.equal(loaded.filings.length,2);
});

test('handles a company with only recent filings',async()=>{
  const quarters=[{fiscalQuarter:2,fiscalPeriodEnd:'2026-07-31'}];
  const loaded=await fullQuarterFilingHistory(
    {filings:{recent}},quarters,cik,async()=>{throw Error('no archives');}
  );
  assignQuarterDates(quarters,loaded.filings);
  assert.equal(loaded.archivesScanned,0);
  assert.equal(quarters[0].earningsDisclosureDate,'2026-08-20');
});
