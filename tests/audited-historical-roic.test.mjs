import test from 'node:test';
import assert from 'node:assert/strict';
import {secTotalDebt,auditedAbsentCurrentDebtProof} from '../src/sec-debt.js';
import {secNopat} from '../src/sec-roic.js';

const audited=[
 ['2015-12-31',2371362000],
 ['2016-12-31',3364311000],
 ['2017-12-31',6499432000],
 ['2018-12-31',10360058000]
];
test('SEC audited Netflix 2015-2018 balance-sheet no-current-debt disclosures',()=>{
  for(const [periodEnd,long] of audited){
    const context={cik:'0001065280',periodEnd,form:'10-K'};
    const get=key=>key==='longTermDebt'?long:null;
    assert.equal(secTotalDebt(get,context),long);
    const proof=auditedAbsentCurrentDebtProof(context,long);
    assert.equal(proof.status,'audited-zero-current-debt');
    assert.match(proof.source,/^https:\/\/www\.sec\.gov\//);
  }
});
test('no audited zero exception for other issuers, years or unverifiable amounts',()=>{
  const get=k=>k==='longTermDebt'?10360058000:null;
  assert.equal(secTotalDebt(get,{cik:'123456',periodEnd:'2018-12-31',form:'10-K'}),null);
  assert.equal(secTotalDebt(get,{cik:'1065280',periodEnd:'2019-12-31',form:'10-K'}),null);
  assert.equal(secTotalDebt(get,{cik:'1065280',periodEnd:'2018-12-31',form:'10-Q'}),null);
  assert.equal(secTotalDebt(get,{cik:'1065280',periodEnd:'2017-12-31',form:'10-K'}),null);
});
test('verified old debt does not override actually reported short-term debt',()=>{
  const get=k=>({longTermDebt:10360058000,shortTermDebt:500000000})[k]??null;
  assert.equal(secTotalDebt(get,{cik:'1065280',periodEnd:'2018-12-31',form:'10-K'}),10860058000);
});
test('Netflix 2017 negative actual tax expense is accepted in NOPAT',()=>{
  const x=secNopat({operatingIncome:838679000,incomeTaxExpense:-73608000,
    incomeBeforeTax:485321000});
  assert.ok(x>838679000);
  assert.ok(Math.abs(x-(838679000*(1+73608000/485321000)))<1e-5);
});
test('positive taxes retain previous NOPAT formula',()=>{
  assert.equal(secNopat({operatingIncome:1000,incomeTaxExpense:200,incomeBeforeTax:800}),750);
});
test('never invent NOPAT without reported taxes or positive pretax earnings',()=>{
  assert.equal(secNopat({operatingIncome:1000,incomeBeforeTax:800}),null);
  assert.equal(secNopat({operatingIncome:1000,incomeTaxExpense:200,incomeBeforeTax:0}),null);
  assert.equal(secNopat({operatingIncome:1000,incomeTaxExpense:200,incomeBeforeTax:-50}),null);
  assert.equal(secNopat({operatingIncome:1000,incomeTaxExpense:-1000,incomeBeforeTax:500}),null);
});
