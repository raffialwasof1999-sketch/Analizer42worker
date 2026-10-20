import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {deriveQ4BasicEPS} from '../src/q4-basic-eps.js';

function example(){
 const annual=[{fiscalYear:2025,fiscalPeriodEnd:'2025-09-27',
   netIncome:800,basicEPS:0.80}];
 const quarters=[
  {fiscalYear:2025,fiscalQuarter:1,fiscalPeriodEnd:'2024-12-28',
   netIncome:220,basicEPS:0.20,basicShares:1100},
  {fiscalYear:2025,fiscalQuarter:2,fiscalPeriodEnd:'2025-03-29',
   netIncome:210,basicEPS:0.20,basicShares:1050},
  {fiscalYear:2025,fiscalQuarter:3,fiscalPeriodEnd:'2025-06-28',
   netIncome:200,basicEPS:0.20,basicShares:1000},
  {fiscalYear:2025,fiscalQuarter:4,fiscalPeriodEnd:'2025-09-27',
   netIncome:170,basicEPS:null,basicShares:null}
 ];
 const shares=[{start:'2024-09-29',end:'2025-09-27',val:1000,
   form:'10-K',filed:'2025-10-31',accn:'sec-evidence'}];
 return {annual,quarters,shares};
}
test('Q4 basic EPS estimate requires compatible reported weighted basic shares',()=>{
 const x=example();
 const result=deriveQ4BasicEPS(x.quarters,x.annual,x.shares);
 assert.equal(result.estimatedCount,1);
 assert.equal(x.quarters[3].basicEPS,0.20);
 assert.equal(result.findings[0].explicitlyReported,false);
 assert.equal(result.findings[0].sourceAnnualAccession,'sec-evidence');
 assert.equal(deriveQ4BasicEPS(x.quarters,x.annual,x.shares).estimatedCount,0);
});
test('never replace an explicitly reported Q4 basic EPS',()=>{
 const x=example();x.quarters[3].basicEPS=0.21;
 assert.equal(deriveQ4BasicEPS(x.quarters,x.annual,x.shares).estimatedCount,0);
 assert.equal(x.quarters[3].basicEPS,0.21);
});
test('reject unsupported, inconsistent or split-crossing Q4 basic EPS',()=>{
 const missing=example();missing.shares=[];
 assert.equal(deriveQ4BasicEPS(missing.quarters,missing.annual,missing.shares).estimatedCount,0);
 const split=example();split.quarters[1].basicShares=262.5;split.quarters[1].basicEPS=.80;
 assert.equal(deriveQ4BasicEPS(split.quarters,split.annual,split.shares).estimatedCount,0);
 const mismatch=example();mismatch.annual[0].basicEPS=1.8;
 assert.equal(deriveQ4BasicEPS(mismatch.quarters,mismatch.annual,mismatch.shares).estimatedCount,0);
});
