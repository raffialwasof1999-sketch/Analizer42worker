import test from 'node:test';
import assert from 'node:assert/strict';
import {secFactsCatalog,secRawConcept} from '../src/sec-raw-facts.js';

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
