import test from 'node:test';
import assert from 'node:assert/strict';
import {isEarningsExhibitName,recoverSECReportedEPS} from '../src/sec-reported-eps.js';

// Minimal reproduction of Apple's Q4 FY2025 Exhibit 99.1 statement layout
// (accession 0000320193-25-000077): three- and twelve-month columns, net
// income in millions, Q4 basic and diluted EPS of $1.85. Only the
// three-months-ended September 27, 2025 column matches the filing; the other
// columns are placeholders to reproduce the layout.
const appleQ4=`<table>
<tr><td></td><td colspan="2">Three Months Ended</td><td colspan="2">Twelve Months Ended</td></tr>
<tr><td></td><td>September 27, 2025</td><td>September 28, 2024</td><td>September 27, 2025</td><td>September 28, 2024</td></tr>
<tr><td>Net income</td><td>27,466</td><td>14,736</td><td>112,010</td><td>93,736</td></tr>
<tr><td>Earnings per share:</td><td></td><td></td><td></td><td></td></tr>
<tr><td>Basic</td><td>1.85</td><td>0.97</td><td>7.49</td><td>6.11</td></tr>
<tr><td>Diluted</td><td>1.85</td><td>0.97</td><td>7.46</td><td>6.08</td></tr>
<tr><td>Shares used in computing earnings per share:</td><td></td><td></td><td></td><td></td></tr>
<tr><td>Basic</td><td>14,815,307</td><td>15,171,990</td><td>14,948,500</td><td>15,343,783</td></tr>
<tr><td>Diluted</td><td>14,863,609</td><td>15,242,853</td><td>15,004,697</td><td>15,408,095</td></tr>
</table>`;

test('accepts real filer exhibit 99 names and rejects paths or other documents',()=>{
  for(const name of ['a8-kex991q4202509272025.htm','ex991_q425.htm','ex-99.1.htm','exhibit99-1.html','d123dex991.htm'])
    assert.equal(isEarningsExhibitName(name),true,name);
  for(const name of ['../../foreign.htm','evil.htm','aapl-20251030.htm','ex99.htm/../x.htm','ex991.pdf',null])
    assert.equal(isEarningsExhibitName(name),false,String(name));
});

test('share-count heading naming EPS does not replace reported EPS',async()=>{
  const {reportedQuarterEPS}=await import('../src/sec-reported-eps.js');
  assert.deepEqual(reportedQuarterEPS(appleQ4,'2025-09-27'),{netIncome:27466,basicEPS:1.85,dilutedEPS:1.85});
});

test('recovers Apple Q4 diluted EPS from an a8-kex991 exhibit',async()=>{
  const row={fiscalYear:2025,fiscalQuarter:4,fiscalPeriodEnd:'2025-09-27',
    basicEPS:1.85,dilutedEPS:null,netIncome:27466000000};
  const filing={form:'8-K',filed:'2025-10-30',items:'2.02,9.01',accession:'0000320193-25-000077'};
  const listing=async()=>({directory:{item:[
    {name:'aapl-20251030.htm'},{name:'a8-kex991q4202509272025.htm'}]}});
  const urls=[];
  const result=await recoverSECReportedEPS([row],[filing],320193,listing,
    async x=>{urls.push(x.filingDocumentUrl);return appleQ4;});
  assert.equal(result.rows[0].dilutedEPS,1.85);
  assert.equal(result.rows[0].basicEPS,1.85);
  assert.deepEqual(result.audit.findings[0].fields,['dilutedEPS']);
  assert.deepEqual(urls,['https://www.sec.gov/Archives/edgar/data/320193/000032019325000077/a8-kex991q4202509272025.htm']);
});
