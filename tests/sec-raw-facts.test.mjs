import test from 'node:test';
import assert from 'node:assert/strict';
import {secFactsCatalog,secRawConcept,secRawFactsPage,secSourceSummary} from '../src/sec-raw-facts.js';

const facts={facts:{
  'us-gaap':{
    Revenues:{label:'Revenues',description:'Reported sales',units:{
      USD:[
        {val:120,start:'2025-01-01',end:'2025-12-31',form:'10-K',accn:'0001',filed:'2026-02-01'},
        {val:33,start:'2026-01-01',end:'2026-03-31',form:'10-Q',accn:'0002',filed:'2026-04-20'}
      ]
    }},
    Assets:{label:'Assets',description:'Assets at period end',units:{USD:[
      {val:500,end:'2026-03-31',form:'10-Q',accn:'0002'}
    ]}}
  },
  dei:{
    EntityCommonStockSharesOutstanding:{label:'Shares',units:{shares:[
      {val:1000,end:'2026-04-12',form:'10-Q',accn:'0002'}
    ]}}
  }
}};
test('catalog lists every standardized concept without changing source or dashboard fields',()=>{
 const source=structuredClone(facts);
 const first=secFactsCatalog(facts,{pageSize:2});
 assert.equal(first.conceptsTotal,3);
 assert.equal(first.hasMore,true);
 assert.deepEqual(first.concepts.map(x=>x.tag),
  ['EntityCommonStockSharesOutstanding','Assets']);
 assert.equal(secFactsCatalog(facts,{page:2,pageSize:2}).concepts.length,1);
 assert.equal(secFactsCatalog(facts,{search:'sales'}).conceptsMatching,1);
 assert.equal(first.includesIssuerExtensions,false);
 assert.equal(first.persistentArchive,false);
 assert.deepEqual(facts,source);
});
test('raw fact observations preserve SEC units, values, periods and accessions',()=>{
 const raw=secRawConcept(facts,{selector:'us-gaap:Revenues',offset:1,limit:1});
 assert.equal(raw.total,2);
 assert.equal(raw.observations[0].unit,'USD');
 assert.deepEqual(raw.observations[0].reported,facts.facts['us-gaap'].Revenues.units.USD[1]);
 assert.equal(raw.hasMore,false);
 const shares=secRawConcept(facts,{selector:'dei:EntityCommonStockSharesOutstanding'});
 assert.equal(shares.observations[0].unit,'shares');
 assert.equal(secRawConcept(facts,{selector:'us-gaap:NotReported'}),null);
});
test('rejects invalid selectors and unbounded pagination',()=>{
 assert.throws(()=>secRawConcept(facts,{selector:'../../something'}),TypeError);
 assert.throws(()=>secRawConcept(facts,{selector:'us-gaap:Assets',limit:1000}),RangeError);
 assert.throws(()=>secFactsCatalog(facts,{pageSize:10000}),RangeError);
});

test('raw-first observations include unknown tags, units and all SEC metadata in stable pages',()=>{
 const data=structuredClone(facts);
 data.facts['us-gaap'].UnfamiliarRevenueAdjustment={
   label:'Unknown adjustment',units:{USD:[
     {val:-7,start:'2025-01-01',end:'2025-12-31',
      accn:'0003',form:'10-K',filed:'2026-02-15',frame:'CY2025'}
   ]}};
 const original=structuredClone(data);
 const p1=secRawFactsPage(data,{offset:0,limit:2});
 const p2=secRawFactsPage(data,{offset:2,limit:2});
 const p3=secRawFactsPage(data,{offset:4,limit:2});
 const full=[...p1.observations,...p2.observations,...p3.observations];
 assert.equal(p1.totalObservations,5);
 assert.equal(p2.totalObservations,5);
 assert.equal(full.length,5);
 assert.equal(p3.observations.length,1);
 const unknown=full.find(x=>x.tag==='UnfamiliarRevenueAdjustment');
 assert.equal(unknown.reported.val,-7);
 assert.equal(unknown.reported.frame,'CY2025');
 assert.equal(unknown.reported.accn,'0003');
 assert.equal(unknown.unit,'USD');
 assert.equal(p1.persistentArchive,false);
 assert.equal(p1.includesIssuerExtensions,false);
 assert.deepEqual(data,original);
});
test('source summary reports unmatched concepts without treating them as unavailable',()=>{
 const summary=secSourceSummary(facts,{revenue:['Revenues']});
 assert.equal(summary.rawConcepts,3);
 assert.equal(summary.rawObservations,4);
 assert.equal(summary.knownGaapTagConcepts,1);
 assert.equal(summary.otherGaapConcepts,1);
 assert.equal(summary.otherConceptsPreserved,true);
 assert.equal(summary.includesDimensionalFacts,false);
});
test('rejects unbounded all-facts pagination',()=>{
 assert.throws(()=>secRawFactsPage(facts,{limit:201}),RangeError);
 assert.throws(()=>secRawFactsPage(facts,{offset:-1}),RangeError);
});
