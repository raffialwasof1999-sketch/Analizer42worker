import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
function setup({checkbox=true,annualHeader='fiscalYear',quarterHeader='fiscalYear',z='lastImportedAt'}={}) {
  const ctx=vm.createContext({SpreadsheetApp:{DataValidationCriteria:{CHECKBOX:'CHECKBOX'}}});
  vm.runInContext(source+';globalThis.config=AA;globalThis.fields=[AA_ANNUAL_FIELDS,AA_QUARTER_FIELDS];',ctx);
  const reads=[];
  const d={getRange(address){
    reads.push(address);
    // Any lookup of labels, results or metric positions is a regression.
    assert.equal(address,'B6');
    return {getDataValidation:()=>checkbox?{getCriteriaType:()=> 'CHECKBOX'}:null};
  }};
  const data=(fields,first)=>({getName:()=> 'data',getRange(...args){
    if(args[0]==='Z1')return {getDisplayValue:()=>z};
    assert.deepEqual(args,[1,1,1,fields.length]);
    return {getDisplayValues:()=>[[first,...fields.slice(1)]]};
  }});
  return {ctx,reads,run:()=>ctx.aaCheckDashboard_(d,data(ctx.fields[0],annualHeader),data(ctx.fields[1],quarterHeader))};
}
test('only the five core dashboard locations remain fixed',()=>{
  const {ctx}=setup();
  assert.deepEqual([ctx.config.tickerCell,ctx.config.companyCell,ctx.config.exchangeCell,ctx.config.refreshCheckbox],['B2','B4','E2','B6']);
  assert.ok(source.includes("getRange('B7')"));
});
test('renaming labels, moving results and omitting dividend labels cannot block import',()=>{
  const {run,reads}=setup();run();assert.deepEqual(reads,['B6']);
});
test('B6 must still be a checkbox',()=>assert.throws(()=>setup({checkbox:false}).run(),/Refresh checkbox missing at Analyzer!B6/));
test('data-tab field order remains checked',()=>{
  assert.throws(()=>setup({annualHeader:'wrong'}).run(),/header 1 changed/);
  assert.throws(()=>setup({quarterHeader:'wrong'}).run(),/header 1 changed/);
});
test('import timestamp header still rejects unrelated data',()=>{
  assert.throws(()=>setup({z:'unrelated'}).run(),/unrelated field/);
  setup({z:''}).run();
});
