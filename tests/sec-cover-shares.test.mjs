import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filingCoverShares,recoverLatestCoverShares} from '../src/sec-cover-shares.js';
const html=readFileSync(new URL('./fixtures/googl-20260930-cover.html',import.meta.url),'utf8');
const report={cik:'0001652044',end:'2026-09-30',filed:'2026-10-29'};
const row={fiscalPeriodEnd:report.end,secFilingDate:report.filed,sharesOutstanding:null,sharesOutstandingAsOf:null,dilutedShares:12368000000};
const sub={filings:{recent:{form:['10-Q'],reportDate:[report.end],filingDate:[report.filed],accessionNumber:['0001652044-26-000084'],primaryDocument:['goog-20260930.htm']}}};
test('real SEC cover sums all three common share classes, with millions scale and cover date',()=>{
 assert.deepEqual(filingCoverShares(html,report),{value:12294000000,asOf:'2026-10-21',classes:3});
});
test('duplicate representations do not double count and conflicting class amounts reject the result',()=>{
 assert.equal(filingCoverShares(html+html,report).value,12294000000);
 assert.equal(filingCoverShares(html+html.replace('>5,888<','>5,999<'),report),null);
});
test('rejects wrong issuer, out-of-period dates and a filing before the share count',()=>{
 for(const altered of [{...report,cik:'123'},{...report,end:'2026-11-30'},{...report,filed:'2026-10-01'}]) assert.equal(filingCoverShares(html,altered),null);
});
test('unsupported dimensions, units, nil facts and negatives cannot silently drop one class',()=>{
 for(const altered of [html.replace('goog:CapitalClassCMember','goog:CapitalClassCMember').replace('dimension="us-gaap:StatementClassOfStockAxis">goog:', 'dimension="us-gaap:BusinessSegmentsAxis">goog:'),html.replace('<xbrli:measure>xbrli:shares</xbrli:measure>','<xbrli:measure>iso4217:USD</xbrli:measure>'),html.replace('id="f-101"','id="f-101" xsi:nil="true"'),html.replace('id="f-101"','id="f-101" sign="-"')]) assert.equal(filingCoverShares(altered,report),null);
});
test('total and class facts are never added together',()=>{
 const ctx='<xbrli:context id="total"><xbrli:entity><xbrli:identifier>0001652044</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-10-21</xbrli:instant></xbrli:period></xbrli:context>';
 const fact=n=>`<ix:nonFraction contextRef="total" unitRef="shares" name="dei:EntityCommonStockSharesOutstanding">${n}</ix:nonFraction>`;
 assert.equal(filingCoverShares(html+ctx+fact(12294000000),report).value,12294000000);
 assert.equal(filingCoverShares(html+ctx+fact(999),report),null);
});
test('latest-quarter fallback fills only the two existing fields and preserves diluted shares and older rows',async()=>{
 const input=[row,{...row,fiscalPeriodEnd:'2026-06-30'}],urls=[];
 const r=await recoverLatestCoverShares(input,sub,report.cik,async f=>{urls.push(f.filingDocumentUrl);return html;});
 assert.equal(r.rows[0].sharesOutstanding,12294000000);assert.equal(r.rows[0].sharesOutstandingAsOf,'2026-10-21');
 assert.equal(r.rows[0].dilutedShares,row.dilutedShares);assert.deepEqual(r.rows[1],input[1]);assert.equal(input[0].sharesOutstanding,null);
 assert.deepEqual(urls,['https://www.sec.gov/Archives/edgar/data/1652044/000165204426000084/goog-20260930.htm']);
});
test('known company facts never cause an extra fetch or replacement',async()=>{
 const known={...row,sharesOutstanding:100};const r=await recoverLatestCoverShares([known],sub,report.cik,()=>{throw Error('must not fetch');});
 assert.equal(r.status,'not-needed');assert.deepEqual(r.rows,[known]);
});
test('fetch failures and unknown evidence leave the count missing without breaking financials',async()=>{
 for(const read of [async()=>{throw Error('SEC unavailable');},async()=>'<html></html>']) {
  const r=await recoverLatestCoverShares([row],sub,report.cik,read);assert.deepEqual(r.rows,[row]);
 }
});
test('unsafe document paths and a different filing cannot be fetched',async()=>{
 for(const rec of [{...sub.filings.recent,primaryDocument:['../../other.htm']},{...sub.filings.recent,filingDate:['2026-10-30']}]) {
  const r=await recoverLatestCoverShares([row],{filings:{recent:rec}},report.cik,()=>{throw Error('must not fetch');});assert.equal(r.status,'unavailable');
 }
});
