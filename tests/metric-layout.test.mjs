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
test('result guard supports fixed-dollar RATE and the old yield model during rollout',()=>{
 assert.ok(source.includes("items:[col+'27']"));
 assert.ok(source.includes("[dividendPerShare,'$E$3','$B$3']"));
 assert.ok(source.includes("!formula.includes('RATE(') && formula.includes(dividendYield)"));
});
vm.runInContext(';globalThis.dps=aaDividendPerShareReference_;',context);
test('finds trailing dividend dollars per share after row movement',()=>assert.equal(context.dps(sheet({21:'Dividend Per Share (TTM)'})),'$I$21'));
test('finds annual dividend dollars per share',()=>assert.equal(context.dps(sheet({35:'Dividend Per Share (Latest FY)'})),'$I$35'));
test('missing or duplicate DPS does not silently use yield',()=>{
 assert.throws(()=>context.dps(sheet({19:'Dividend Yield (TTM)'})),/exactly one/);
 assert.throws(()=>context.dps(sheet({21:'Dividend Per Share (TTM)',30:'Dividend Per Share (TTM)'})),/exactly one/);
});

