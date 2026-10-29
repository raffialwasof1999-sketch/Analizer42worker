import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source+'\n;globalThis.helper=aaDividendYieldReference_;',context);
function sheet(labels) {return {
 getLastRow:()=>100,
 getRange:(r,c,n,w)=>{assert.deepEqual([r,c,n,w],[4,8,97,1]);return {getDisplayValues:()=>Array.from({length:97},(_,i)=>[labels[i+4]||''])};}
};}
test('finds current dividend yield at I20',()=>assert.equal(context.helper(sheet({20:'Dividend Yield (TTM)'})),'$I$20'));
test('moving dividend yield preserves its semantic reference',()=>assert.equal(context.helper(sheet({31:'Dividend Yield (TTM)'})),'$I$31'));
test('annual mode uses latest fiscal-year label',()=>assert.equal(context.helper(sheet({22:'Dividend Yield (Latest FY)'})),'$I$22'));
test('missing dividend yield stops refresh safely',()=>assert.throws(()=>context.helper(sheet({})),/exactly one/));
test('duplicate dividend yield stops refresh safely',()=>assert.throws(()=>context.helper(sheet({20:'Dividend Yield (TTM)',22:'Dividend Yield (TTM)'})),/exactly one/));
test('forward yield cannot substitute for trailing yield',()=>assert.throws(()=>context.helper(sheet({23:'Forward Dividend Yield'})),/exactly one/));
test('result guard uses the resolved reference',()=>{assert.ok(source.includes("items:[col+'27',dividendYield]"));assert.ok(!source.includes("items:[col+'27','$I$16']"));});
