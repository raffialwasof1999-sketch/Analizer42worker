import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {buildSECShareBasisGraph,normalizeUsingSECShareGraph} from '../src/sec-share-basis.js';

function annualFacts(perFiling) {
  const eps=[],shares=[];
  for(const [accn,filed,records] of perFiling)for(const [year,e,s] of records){
    const x={start:year+'-01-01',end:year+'-12-31',accn,filed,form:'10-K'};
    eps.push({...x,val:e});shares.push({...x,val:s});
  }
  return {facts:{'us-gaap':{
    EarningsPerShareDiluted:{units:{'USD/shares':eps}},
    WeightedAverageNumberOfDilutedSharesOutstanding:{units:{shares}}
  }}};
}
test('build SEC share-basis chain across multi-year forward and reverse splits',()=>{
 const data=annualFacts([
  ['A','2019-02-01',[[2017,8,100],[2018,10,100]]],
  ['B','2020-02-01',[[2018,10,100],[2019,12,100]]],
  ['C','2021-02-01',[[2018,2.5,400],[2019,3,400],[2020,4,400]]],
  ['D','2022-02-01',[[2019,3,400],[2020,4,400],[2021,5,400]]],
  ['E','2023-02-01',[[2020,40,40],[2021,50,40],[2022,60,40]]]
 ]);
 const graph=buildSECShareBasisGraph(data);
 assert.equal(graph.anchorAccession,'E');
 assert.equal(graph.complete,true);
 assert.ok(Math.abs(graph.shareFactors.A-0.4)<1e-8);
 assert.ok(Math.abs(graph.shareFactors.C-0.1)<1e-8);
 assert.equal(graph.changedBasisEdges.some(e=>Math.abs(e.shareFactor-4)<1e-8),true);
 assert.equal(graph.changedBasisEdges.some(e=>Math.abs(e.shareFactor-.1)<1e-8),true);
 const out=normalizeUsingSECShareGraph([
   {fiscalPeriodEnd:'2017-12-31',dilutedEPS:8,dilutedShares:100,netIncome:800}
 ],graph,(row,metric)=>({accn:'A',val:row[metric]}));
 assert.equal(out.complete,true);
 assert.ok(Math.abs(out.rows[0].dilutedEPS-20)<1e-8);
 assert.ok(Math.abs(out.rows[0].dilutedShares-40)<1e-8);
 assert.equal(out.rows[0].netIncome,800);
});
test('unknown share-basis components fail closed',()=>{
 const data=annualFacts([['A','2020-01-01',[[2019,8,100]]],
                         ['B','2021-01-01',[[2020,2,400]]]]);
 const graph=buildSECShareBasisGraph(data);
 assert.equal(graph.complete,false);
 const out=normalizeUsingSECShareGraph([
   {fiscalPeriodEnd:'2019-12-31',dilutedEPS:8,dilutedShares:100}
 ],graph,()=>({accn:'A'}));
 assert.equal(out.rows[0].dilutedEPS,null);
 assert.equal(out.issues.length,2);
});
