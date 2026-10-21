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
