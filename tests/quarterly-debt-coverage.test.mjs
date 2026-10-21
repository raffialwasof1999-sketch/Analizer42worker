import test from 'node:test';
import assert from 'node:assert/strict';
import {secTotalDebt,auditedAbsentCurrentDebtProof} from '../src/sec-debt.js';
import {financialInputArchive,rollingRoicCoverage} from '../src/sec-input-coverage.js';

const verified=[
  ['2015-09-30',2400000000],
  ['2016-03-31',2372218000],
  ['2016-06-30',2373085000],
  ['2016-09-30',2373966000],
  ['2017-03-31',3365431000],
  ['2017-06-30',4836502000],
  ['2017-09-30',4888783000],
  ['2018-03-31',6542373000],
  ['2018-06-30',8342067000],
  ['2018-09-30',8336586000],
  ['2019-03-31',10305023000],
  ['2019-06-30',12594135000],
  ['2019-09-30',12425746000]
];

test('13 Netflix quarterly long-term debt balances recovered only for cited filings',()=>{
  for(const [periodEnd,noncurrent] of verified) {
    const context={cik:'0001065280',periodEnd,form:'10-Q'};
    const proof=auditedAbsentCurrentDebtProof(context);
    assert.equal(proof.noncurrent,noncurrent);
    assert.equal(proof.currentDebt,0);
    assert.match(proof.source,/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1065280\//);
    assert.equal(secTotalDebt(()=>null,context),noncurrent);
    assert.equal(secTotalDebt(k=>k==='longTermDebt'?noncurrent:null,context),noncurrent);
    assert.equal(secTotalDebt(k=>k==='longTermDebt'?noncurrent+1:null,context),null);
    assert.equal(secTotalDebt(()=>null,{...context,cik:'320193'}),null);
    assert.equal(secTotalDebt(()=>null,{...context,form:'10-K'}),null);
  }
});
test('never override real reported current borrowings with verified no-current exception',()=>{
  const ctx={cik:'1065280',periodEnd:'2017-03-31',form:'10-Q'};
  const report={longTermDebt:3365431000,shortTermDebt:50};
  assert.equal(secTotalDebt(k=>report[k]??null,ctx),3365431050);
  assert.equal(secTotalDebt(k=>k==='shortTermDebt'?50:null,ctx),null);
});
test('provenance archive retains additional raw inputs without mutating source',()=>{
  const row={fiscalYear:2017,fiscalQuarter:1,fiscalPeriodEnd:'2017-03-31',
    longTermDebt:3365431000,totalDebt:3365431000,
    incomeBeforeTax:100,operatingIncome:200,investedCapital:500,
    debtEvidence:auditedAbsentCurrentDebtProof({
      cik:'1065280',periodEnd:'2017-03-31',form:'10-Q'
    })};
  const archive=financialInputArchive([row],['longTermDebt','incomeBeforeTax','cash']);
  assert.equal(archive[0].inputs.longTermDebt,3365431000);
  assert.equal(archive[0].inputs.cash,null);
  assert.equal(archive[0].calculated.investedCapital,500);
  assert.match(archive[0].source,/sec.gov/);
  assert.equal(row.cash,undefined);
});
const rows=Array.from({length:44},(_,i)=>{
  const ordinal=2026*4+2-i;
  const yr=Math.floor((ordinal-1)/4),q=ordinal-(yr*4);
  return {fiscalYear:yr,fiscalQuarter:q,
    operatingIncome:100,incomeTaxExpense:20,incomeBeforeTax:80,
    investedCapital:1000};
});
test('rolling ROIC completeness requires 5, 24 or 44 sequential quarters',()=>{
  for(const [n,needed] of [[1,5],[20,24],[40,44]]) {
    const result=rollingRoicCoverage(rows,n);
    assert.equal(result.ready,true);
    assert.equal(result.requiredQuarters,needed);
    assert.equal(rollingRoicCoverage(rows.slice(0,needed-1),n).ready,false);
  }
});
test('ROIC readiness rejects missing capital, broken quarters and invalid tax bases',()=>{
  const missing=structuredClone(rows);missing[32].investedCapital=null;
  assert.equal(rollingRoicCoverage(missing,40).ready,false);
  assert.ok(rollingRoicCoverage(missing,40).missing.some(m=>m.field==='investedCapital'));
  const skipped=structuredClone(rows);skipped[8].fiscalQuarter=1;
  assert.equal(rollingRoicCoverage(skipped,20).ready,false);
  const tax=structuredClone(rows);tax[0].incomeBeforeTax=-1000;
  assert.equal(rollingRoicCoverage(tax,1).ready,false);
});
