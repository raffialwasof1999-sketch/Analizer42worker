import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {compareRestatedPerShare} from '../src/sec-splits.js';
const split={verified:true,effectiveDate:'2020-08-31',sharesAfterPerBefore:4};
const before={metric:'dilutedEPS',val:8,start:'2019-01-01',end:'2019-12-31',accn:'old',filed:'2020-02-01'};
const after={...before,val:2,accn:'new',filed:'2021-02-01'};
test('detect same-period SEC comparative EPS restatement evidence',()=>{
  const r=compareRestatedPerShare(before,after,split);
  assert.equal(r.status,'consistent-with-restatement');
  assert.equal(r.verified,false);
  assert.equal(r.observedFactor,4);
  assert.equal(compareRestatedPerShare(before,{...after,start:'2018-01-01'},split).status,'inconclusive');
  assert.equal(compareRestatedPerShare(before,{...after,val:7},split).status,'not-consistent');
  assert.equal(compareRestatedPerShare(before,after,{...split,verified:false}).status,'inconclusive');
  assert.equal(compareRestatedPerShare(before,{...after,accn:'old'},split).status,'inconclusive');
});
