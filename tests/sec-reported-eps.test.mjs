import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reportedQuarterEPS,recoverSECReportedEPS} from '../src/sec-reported-eps.js';
const html=readFileSync(new URL('./fixtures/nflx-q425-sec-income.html',import.meta.url),'utf8');
const row={fiscalPeriodEnd:'2025-12-31',basicEPS:.57,dilutedEPS:null,netIncome:2418521000};
const filing={form:'8-K',filed:'2026-01-20',items:'2.02,9.01',accession:'0001065280-26-000033'};
const listing=async()=>({directory:{item:[{name:'ex991_q425.htm'},{name:'../../foreign.htm'},{name:'evil.htm'}]}});
test('real SEC exhibit selects three months, not twelve months with same date',()=>{
 assert.deepEqual(reportedQuarterEPS(html,'2025-12-31'),{netIncome:2418521,basicEPS:.57,dilutedEPS:.56});
 assert.deepEqual(reportedQuarterEPS(html,'2025-09-30'),{netIncome:2546916,basicEPS:.60,dilutedEPS:.59});
 assert.equal(reportedQuarterEPS(html,'2025-06-30'),null);
});
test('fills reported diluted EPS with exact SEC provenance, preserves input',async()=>{
 const urls=[];
 const result=await recoverSECReportedEPS([row],[filing],1065280,listing,async x=>{urls.push(x.filingDocumentUrl);return html;});
 assert.equal(result.rows[0].dilutedEPS,.56);assert.equal(row.dilutedEPS,null);
 assert.deepEqual(result.audit.findings[0].fields,['dilutedEPS']);
 assert.match(urls[0],/^https:\/\/www.sec.gov\/Archives\/edgar\/data\/1065280\/000106528026000033\/ex991_q425.htm$/);
 assert.equal(urls.length,1);
});
test('rejects mismatched split basis and different quarter profit',async()=>{
 for(const altered of [{...row,basicEPS:5.7},{...row,netIncome:999e6},{...row,basicEPS:null}]) {
  const result=await recoverSECReportedEPS([altered],[filing],1065280,listing,async()=>html);
  assert.equal(result.rows[0].dilutedEPS,null);
 }
});
test('can recover both EPS types with another quarter in same statement anchoring share basis',async()=>{
 const result=await recoverSECReportedEPS([{...row,basicEPS:null},{fiscalPeriodEnd:'2025-09-30',basicEPS:.60,dilutedEPS:.59,netIncome:2546916000}],[filing],1065280,listing,async()=>html);
 assert.equal(result.rows[0].basicEPS,.57);assert.equal(result.rows[0].dilutedEPS,.56);
});
test('preserves known EPS, rejects conflicting tables and non-GAAP statements',async()=>{
 const known={...row,dilutedEPS:.55};
 const result=await recoverSECReportedEPS([known],[filing],1065280,()=>{throw Error('must not fetch');},async()=>html);
 assert.equal(result.rows[0].dilutedEPS,.55);
 assert.equal(reportedQuarterEPS(html+html.replace('0.56','0.54'),'2025-12-31'),null);
 assert.equal(reportedQuarterEPS(html.replace('Earnings per share','Adjusted earnings per share'),'2025-12-31'),null);
});
test('SEC outage and unsupported exhibit do not break other financial data',async()=>{
 const result=await recoverSECReportedEPS([row],[filing],1065280,async()=>{throw Error('SEC unavailable');},async()=>html);
 assert.equal(result.rows[0].dilutedEPS,null);assert.equal(result.rows[0].netIncome,row.netIncome);
 assert.equal(result.audit.findings[0].status,'unavailable');
});
