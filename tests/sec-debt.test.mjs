import test from 'node:test';
import assert from 'node:assert/strict';
import {secTotalDebt} from '../src/sec-debt.js';
const run=o=>secTotalDebt(key=>Object.prototype.hasOwnProperty.call(o,key)?o[key]:null);
test('Netflix June 2026 short-term plus noncurrent debt recovers total',()=>{
  const debt=run({longTermDebt:11825548000,shortTermDebt:2483758000});
  assert.equal(debt,14309306000);
});
test('Netflix December 2025 short-term plus long-term balance',()=>{
  assert.equal(run({longTermDebt:13463971000,shortTermDebt:998865000}),14462836000);
});
test('current portion of long-term debt with noncurrent debt is sufficient',()=>{
  assert.equal(run({longTermDebt:1000,currentPortionLongTermDebt:120}),1120);
});
test('separate short-term borrowings and current long-term debt both count',()=>{
  assert.equal(run({longTermDebt:1000,shortTermDebt:60,currentPortionLongTermDebt:120}),1180);
});
test('explicit reported total takes precedence to prevent double counting',()=>{
  assert.equal(run({totalDebt:1300,longTermDebt:1000,shortTermDebt:200,
    currentPortionLongTermDebt:100}),1300);
});
test('missing all current debt disclosure remains unknown, not zero',()=>{
  assert.equal(run({longTermDebt:1000}),null);
});
test('missing noncurrent debt and missing all debt tags remain unknown',()=>{
  assert.equal(run({shortTermDebt:50}),null);
  assert.equal(run({}),null);
});
test('zero current debt is a valid explicitly reported figure',()=>{
  assert.equal(run({longTermDebt:1000,shortTermDebt:0}),1000);
});
test('do not accept negative, infinite or nonnumeric debt as reported',()=>{
  assert.equal(run({longTermDebt:-100,shortTermDebt:50}),null);
  assert.equal(run({longTermDebt:1000,shortTermDebt:Infinity}),null);
  assert.equal(run({longTermDebt:1000,shortTermDebt:'120'}),null);
});

// Latest-quarter balance-sheet tags as filed (billions), from the coverage audit.
const B=1e9;
test('DebtCurrent plus noncurrent debt (Intel, UnitedHealth)',()=>{
  assert.equal(run({longTermDebt:48.55*B,debtCurrent:1.99*B}),50.54*B);
});
test('DebtCurrent is not added on top of its own components',()=>{
  assert.equal(run({longTermDebt:100,debtCurrent:30,currentPortionLongTermDebt:20,shortTermDebt:10}),130);
});
test('commercial paper counts when no short-term borrowings line exists (Home Depot)',()=>{
  assert.equal(run({longTermDebt:43.95*B,currentPortionLongTermDebt:4.70*B,otherShortTermBorrowings:4.25*B}),52.90*B);
});
test('short-term borrowings line wins over a commercial paper component (PepsiCo)',()=>{
  assert.equal(run({longTermDebt:42.66*B,shortTermDebt:9.22*B,otherShortTermBorrowings:4.80*B}),51.88*B);
});
test('noncurrent only, proven by total long-term debt or carrying amount (Meta, McDonald\'s)',()=>{
  assert.equal(run({longTermDebt:83.66*B,longTermDebtTotal:83.66*B,debtCarrying:84.00*B}),83.66*B);
  assert.equal(run({longTermDebt:39.86*B,debtCarrying:39.90*B}),39.86*B);
  assert.equal(run({longTermDebt:39.86*B,debtCarrying:45*B}),null);   // unexplained gap: unknown
});
test('unclassified bank long-term debt plus short-term borrowings (Bank of America)',()=>{
  assert.equal(run({longTermDebtTotal:339.86*B,otherShortTermBorrowings:59.98*B}),399.84*B);
});
test('ambiguous LongTermDebt with DebtCurrent needs the carrying amount (Tesla vs Adobe)',()=>{
  assert.equal(run({longTermDebtTotal:7.72*B,debtCurrent:1.34*B,debtCarrying:9.08*B}),9.06*B);
  assert.equal(run({longTermDebtTotal:4.77*B,debtCurrent:1.60*B}),null);
});
test('a combined long- and short-term total is used directly (GE)',()=>{
  assert.equal(run({totalDebt:19.33*B,debtCurrent:2.33*B,longTermDebt:16.99*B}),19.33*B);
});

const runCtx=(o,ctx)=>secTotalDebt(key=>Object.prototype.hasOwnProperty.call(o,key)?o[key]:null,ctx);
test('noncurrent only counts as total when no current debt was filed nearby (Meta 10-Qs)',()=>{
  assert.equal(runCtx({longTermDebt:58.75*B},{noCurrentDebtNearby:true}),58.75*B);
  assert.equal(runCtx({longTermDebt:58.75*B},{noCurrentDebtNearby:false}),null);
});
test('carrying amount confirms a sum within 2% (Tesla Q1 2024)',()=>{
  assert.equal(run({longTermDebtTotal:2.74*B,debtCurrent:2.13*B,debtCarrying:4.90*B}),4.87*B);
  assert.equal(run({longTermDebtTotal:4.80*B,debtCurrent:2.13*B,debtCarrying:4.90*B}),null); // LTD was the total
});
