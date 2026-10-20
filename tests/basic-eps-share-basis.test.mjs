import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {normalizeHistoricalBasicEPS} from '../src/basic-eps-share-basis.js';
const graph={shareFactors:{old:4,new:1},
  changedBasisEdges:[{from:'old',to:'new',shareFactor:4}],conflicts:[]};
test('convert reported basic EPS to verified latest split basis',()=>{
 const rows=[
  {fiscalYear:2023,fiscalQuarter:1,fiscalPeriodEnd:'2023-03-31',basicEPS:4,dilutedEPS:3.9},
  {fiscalYear:2025,fiscalQuarter:1,fiscalPeriodEnd:'2025-03-31',basicEPS:1.2,dilutedEPS:1.19}
 ];
 const out=normalizeHistoricalBasicEPS(rows,graph,row=>({
   accn:row.fiscalYear===2023?'old':'new',val:row.basicEPS
 }));
 assert.equal(out.rows[0].basicEPS,1);
 assert.equal(out.rows[0].dilutedEPS,3.9);
 assert.equal(out.rows[1].basicEPS,1.2);
 assert.equal(out.adjustedCount,2);
 assert.equal(rows[0].basicEPS,4);
});
test('Q4 basic EPS estimate uses annual SEC share-basis evidence',()=>{
 const rows=[{fiscalYear:2023,fiscalQuarter:4,
   fiscalPeriodEnd:'2023-12-31',basicEPS:2}];
 const out=normalizeHistoricalBasicEPS(rows,graph,()=>[],
   [{fiscalPeriodEnd:'2023-12-31',basicEPS:2,
     sourceAnnualAccession:'old'}]);
 assert.equal(out.rows[0].basicEPS,.5);
});
test('unknown or contradictory share bases erase historical P/E inputs',()=>{
 const rows=[{fiscalQuarter:1,fiscalPeriodEnd:'2022-03-31',basicEPS:3}];
 const x=normalizeHistoricalBasicEPS(rows,graph,()=>[{accn:'unknown',val:3}]);
 assert.equal(x.rows[0].basicEPS,null);
 assert.equal(x.unavailableCount,1);
 const conflict=normalizeHistoricalBasicEPS(rows,{...graph,conflicts:[{from:'old',to:'new'}]},
   ()=>[{accn:'old',val:3}]);
 assert.equal(conflict.rows[0].basicEPS,null);
});
test('no observed split preserves reported basic EPS',()=>{
 const rows=[{fiscalQuarter:1,basicEPS:2}];
 assert.equal(normalizeHistoricalBasicEPS(rows,
   {shareFactors:{},changedBasisEdges:[],conflicts:[]},()=>[]).rows[0].basicEPS,2);
});
