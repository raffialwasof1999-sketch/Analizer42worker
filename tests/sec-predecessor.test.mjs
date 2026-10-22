import test from 'node:test';
import assert from 'node:assert/strict';
import {predecessorCandidate,sharedFacts,withPredecessor} from '../src/sec-predecessor.js';
import {recoverSECReportedEPS} from '../src/sec-reported-eps.js';

// Exxon shape: ExxonMobil Holdings (CIK 2115436) took over XOM on
// 2026-07-01; its first 10-Q was filed under Exxon Mobil Corp's filer ID.
const NEW='0002115436', OLD='0000034088';
const f=(start,end,val,form,accn)=>({start,end,val,form,accn,filed:'2026-08-03'});
const successor={cik:2115436,entityName:'ExxonMobil Holdings Corp',facts:{'us-gaap':{
  NetIncomeLoss:{units:{USD:[f('2026-04-01','2026-06-30',7.1e9,'10-Q',OLD+'-26-000093'),
    f('2025-04-01','2025-06-30',7.08e9,'10-Q',OLD+'-26-000093'),
    f('2026-01-01','2026-06-30',14.9e9,'10-Q',OLD+'-26-000093'),
    f('2025-01-01','2025-06-30',14.795e9,'10-Q',OLD+'-26-000093')]}},
  Revenues:{units:{USD:[f('2025-04-01','2025-06-30',81.5e9,'10-Q',OLD+'-26-000093')]}}}}};
const annual=(y,v)=>f(`${y}-01-01`,`${y}-12-31`,v,'10-K',`${OLD}-${String(y+1).slice(2)}-000010`);
const predecessor={cik:34088,entityName:'EXXON MOBIL CORP',facts:{'us-gaap':{
  NetIncomeLoss:{units:{USD:[...[2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025]
    .map((y,i)=>annual(y,20e9+i*1e9)),
    f('2025-04-01','2025-06-30',7.08e9,'10-Q',OLD+'-25-000050'),
    f('2025-01-01','2025-06-30',14.795e9,'10-Q',OLD+'-25-000050'),
    f('2026-01-01','2026-03-31',7.8e9,'10-Q',OLD+'-26-000040')]}},
  Revenues:{units:{USD:[f('2025-04-01','2025-06-30',81.5e9,'10-Q',OLD+'-25-000050')]}}}}};
const sub=(cik,accn)=>({cik,filings:{recent:{form:['8-K'],filingDate:['2026-01-30'],
  reportDate:[''],accessionNumber:[accn],items:['2.02,9.01']},files:[]}});

test('a short history whose 10-Q carries another CIK names that CIK',()=>{
  assert.equal(predecessorCandidate(successor,NEW),OLD);
  assert.equal(predecessorCandidate(predecessor,OLD),null);     // long history: no lookup
});

test('filing agents and the issuer itself are never candidates',()=>{
  const viaAgent=JSON.parse(JSON.stringify(successor).replaceAll(OLD,'0001193125'));
  assert.equal(predecessorCandidate(viaAgent,NEW),null);
  const selfFiled=JSON.parse(JSON.stringify(successor).replaceAll(OLD,NEW));
  assert.equal(predecessorCandidate(selfFiled,NEW),null);
});

test('merges a verified predecessor and keeps successor facts',async()=>{
  assert.equal(sharedFacts(successor,predecessor),3);
  const urls=[];
  const out=await withPredecessor(successor,sub(2115436,'0001193125-26-300000'),NEW,async url=>{
    urls.push(url);
    return url.includes('companyfacts')?predecessor:sub(34088,OLD+'-26-000005');
  });
  assert.equal(out.predecessor.status,'merged');
  assert.equal(out.predecessor.cik,OLD);
  const merged=out.facts.facts['us-gaap'].NetIncomeLoss.units.USD;
  assert.ok(merged.some(x=>x.end==='2015-12-31'));                // history added
  assert.ok(merged.some(x=>x.end==='2026-06-30'&&x.start==='2026-04-01')); // successor kept
  assert.equal(out.facts.entityName,'ExxonMobil Holdings Corp');
  assert.deepEqual(out.sub.filings.recent.cik,[2115436,34088]);
  assert.equal(urls.length,2);
});

test('an unrelated CIK with no matching figures is not merged',async()=>{
  const stranger=JSON.parse(JSON.stringify(predecessor).replaceAll('14795000000','1'));
  stranger.facts['us-gaap'].NetIncomeLoss.units.USD=stranger.facts['us-gaap'].NetIncomeLoss.units.USD
    .map(x=>({...x,val:x.val+1}));
  const out=await withPredecessor(successor,sub(2115436,'x'),NEW,async()=>stranger);
  assert.equal(out.predecessor.status,'not-verified');
  assert.equal(out.facts,successor);
});

test("predecessor press releases load from the predecessor's EDGAR folder",async()=>{
  const urls=[];
  const row={fiscalPeriodEnd:'2025-12-31',fiscalQuarter:4,basicEPS:1.67,dilutedEPS:null,netIncome:7.3e9};
  const filing={form:'8-K',filed:'2026-01-30',items:'2.02,9.01',accession:OLD+'-26-000005',cik:34088};
  await recoverSECReportedEPS([row],[filing],NEW,async url=>{urls.push(url);return {directory:{item:[]}};},async()=>'');
  assert.match(urls[0],/edgar\/data\/34088\/000003408826000005\//);
});
