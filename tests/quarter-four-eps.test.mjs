import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {reconstructFourthQuarterEPS} from '../src/quarter-four-eps.js';

function apple2025(){
 const annual=[{fiscalYear:2025,fiscalPeriodEnd:'2025-09-27',
   netIncome:112010000000,dilutedEPS:7.46,dilutedShares:15004697000}];
 const quarterly=[
 {fiscalYear:2025,fiscalQuarter:1,fiscalPeriodEnd:'2024-12-28',
  netIncome:36330000000,dilutedEPS:2.40,dilutedShares:15150865000},
 {fiscalYear:2025,fiscalQuarter:2,fiscalPeriodEnd:'2025-03-29',
  netIncome:24780000000,dilutedEPS:1.65,dilutedShares:15056133000},
 {fiscalYear:2025,fiscalQuarter:3,fiscalPeriodEnd:'2025-06-28',
  netIncome:23434000000,dilutedEPS:1.57,dilutedShares:14948179000},
 {fiscalYear:2025,fiscalQuarter:4,fiscalPeriodEnd:'2025-09-27',
  netIncome:27466000000,dilutedEPS:null,dilutedShares:null}
 ];
 const shares=[{start:'2024-09-29',end:'2025-09-27',form:'10-K',
  filed:'2025-10-31',accn:'0000320193-25-000079',val:15004697000}];
 return {annual,quarterly,shares};
}
test('infer Apple FY2025 Q4 EPS and share denominator to cents from SEC observations',()=>{
 const {annual,quarterly,shares}=apple2025();
 const evidence=reconstructFourthQuarterEPS(quarterly,annual,shares);
 assert.equal(evidence.derivedCount,1);
 assert.equal(quarterly[3].dilutedEPS,1.85);
 assert.ok(quarterly[3].dilutedShares>14800000000);
 assert.equal(evidence.observations[0].explicitlyReported,false);
 assert.equal(evidence.observations[0].sourceAnnualAccession,'0000320193-25-000079');
 const repeated=reconstructFourthQuarterEPS(quarterly,annual,shares);
 assert.equal(repeated.derivedCount,0);
 assert.equal(quarterly[3].dilutedEPS,1.85);
});
test('do not override directly reported Q4 EPS',()=>{
 const x=apple2025();x.quarterly[3].dilutedEPS=1.87;
 assert.equal(reconstructFourthQuarterEPS(x.quarterly,x.annual,x.shares).derivedCount,0);
 assert.equal(x.quarterly[3].dilutedEPS,1.87);
});
test('reject split-basis mismatches between 10-K and 10-Q denominators',()=>{
 const x=apple2025();
 x.quarterly[1].dilutedShares/=4;
 x.quarterly[1].dilutedEPS*=4;
 assert.equal(reconstructFourthQuarterEPS(x.quarterly,x.annual,x.shares).derivedCount,0);
 assert.equal(x.quarterly[3].dilutedEPS,null);
});
test('reject missing SEC annual weighted share provenance and invalid income-EPS match',()=>{
 const a=apple2025(),b=apple2025();
 assert.equal(reconstructFourthQuarterEPS(a.quarterly,a.annual,[]).derivedCount,0);
 b.annual[0].dilutedEPS=5;
 assert.equal(reconstructFourthQuarterEPS(b.quarterly,b.annual,b.shares).derivedCount,0);
});
test('reconstruct Apple FY2024 special-tax quarter without subtracting annual EPS',()=>{
 const annual=[{fiscalYear:2024,fiscalPeriodEnd:'2024-09-28',
  netIncome:93736000000,dilutedEPS:6.08,dilutedShares:15408095000}];
 const quarterly=[
  {fiscalYear:2024,fiscalQuarter:1,fiscalPeriodEnd:'2023-12-30',netIncome:33916000000,dilutedEPS:2.18,dilutedShares:15576641000},
  {fiscalYear:2024,fiscalQuarter:2,fiscalPeriodEnd:'2024-03-30',netIncome:23636000000,dilutedEPS:1.53,dilutedShares:15464709000},
  {fiscalYear:2024,fiscalQuarter:3,fiscalPeriodEnd:'2024-06-29',netIncome:21448000000,dilutedEPS:1.40,dilutedShares:15348175000},
  {fiscalYear:2024,fiscalQuarter:4,fiscalPeriodEnd:'2024-09-28',netIncome:14736000000,dilutedEPS:null,dilutedShares:null}
 ];
 const facts=[{start:'2023-10-01',end:'2024-09-28',form:'10-K',filed:'2024-11-01',accn:'some-sec-accession',val:15408095000}];
 assert.equal(reconstructFourthQuarterEPS(quarterly,annual,facts).derivedCount,1);
 assert.equal(quarterly[3].dilutedEPS,0.97);
});
