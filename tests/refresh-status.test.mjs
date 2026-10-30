import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8');
function setup() {
  const cells=new Map([['B2','MSFT'],['B7','=old status']]);
  const events=[];
  const d={getRange(address){return {
    getDisplayValue:()=>cells.get(address)||'',
    getValue:()=>cells.get(address)||'',
    getFormula:()=>String(cells.get(address)||'').startsWith('=')?cells.get(address):'',
    setValue(v){cells.set(address,v); events.push(['value',address,v]);return this;},
    setFormula(v){cells.set(address,v);events.push(['formula',address,v]);return this;},
    getFormulas:()=>[['=1+2','']],
    getCell(r,c){return d.getRange(address+':'+r+':'+c);}
  };}};
  const q={getRange:a=>({getDisplayValue:()=>a==='Y2'?'MSFT':'10/29/2026 4:52 PM'})};
  const ss={getSheetByName:n=>n==='Analyzer'?d:q,toast(){}};
  const ctx=vm.createContext({console,SpreadsheetApp:{flush(){events.push(['flush']);}},LockService:{getDocumentLock:()=>({tryLock:()=>true,releaseLock(){}})}});
  vm.runInContext(source,ctx);
  vm.runInContext('aaSheets_=()=>testSheets; aaCheckDashboard_=()=>{};',ctx);
  ctx.testSheets={ss,d,a:{},q};
  return {ctx,cells,events,d,ss};
}
test('same-ticker fetch failure hides valuations and retains last successful timestamp',()=>{
  const {ctx,cells,events}=setup();
  ctx.aaFetch_=()=>{assert.match(cells.get('B7'),/^SEC REFRESHING/);throw Error('Worker HTTP 503: unavailable');};
  assert.throws(()=>ctx.refreshStockAnalyzer(),/503/);
  assert.match(cells.get('B7'),/SEC IMPORT FAILED/);
  assert.match(cells.get('B7'),/MSFT \| 10\/29\/2026 4:52 PM/);
  assert.match(cells.get('B7'),/Valuations are hidden/);
  assert.ok(events.some(e=>e[0]==='flush'));
});
test('layout validation failure also replaces successful status',()=>{
  const {ctx,cells}=setup();ctx.aaCheckDashboard_=()=>{throw Error('Layout changed');};
  assert.throws(()=>ctx.refreshStockAnalyzer(),/Layout changed/);
  assert.match(cells.get('B7'),/SEC IMPORT FAILED/);
});
test('ticker changed during fetch fails closed rather than leaving refreshing forever',()=>{
  const {ctx,cells,ss}=setup();ctx.aaShowFailedImport_(ss,'Ticker changed during fetch; retry the latest ticker.');
  assert.match(cells.get('B7'),/SEC IMPORT FAILED/);
});
test('another refresh owning the lock keeps its status',()=>{
  const {ctx,cells,ss}=setup();const before=cells.get('B7');
  ctx.aaShowFailedImport_(ss,'Another SEC refresh is in progress.');assert.equal(cells.get('B7'),before);
});
test('refresh failure preserves a guarded calculation moved outside the old dashboard ranges',()=>{
  const {ctx,cells,events}=setup();
  const moved='=IF(LEFT($B$7,14)="SEC snapshot: ",SUM(M50:M53),"")';
  cells.set('L45',moved);
  ctx.aaFetch_=()=>{throw Error('Worker HTTP 503: unavailable');};
  assert.throws(()=>ctx.refreshStockAnalyzer(),/503/);
  assert.equal(cells.get('L45'),moved);
  assert.match(cells.get('B7'),/SEC IMPORT FAILED/);
  assert.ok(!events.some(e=>e[0]==='formula'));
});

test('successful refresh and ticker changes use only core dashboard cells and preserve moved formulas',()=>{
  const {ctx,cells,events}=setup();
  const moved='=IF(LEFT($B$7,14)="SEC snapshot: ",SUM(M50:M53),"")';
  cells.set('L45',moved);
  const dataSheet=quarter=>({getLastRow:()=>2,getRange(address){return {
    getDisplayValue:()=>address==='Y2'?(cells.get('sourceTicker')||'MSFT'):'10/29/2026 4:52 PM',
    getValue:()=>'',getValues:()=>[['']],
    clearContent(){return this;},
    setValues(rows){if(quarter && typeof address==='number')cells.set('sourceTicker',rows[0][24]);return this;},
    setValue(){return this;},setNumberFormat(){return this;}
  };}});
  ctx.testSheets.a=dataSheet(false);ctx.testSheets.q=dataSheet(true);
  ctx.testSheets.ss.getSheetByName=n=>n==='Analyzer'?ctx.testSheets.d:ctx.testSheets.q;
  ctx.aaFetch_=ticker=>({ticker,companyName:ticker+' Company',exchange:'Nasdaq'});
  ctx.aaValidatePayload_=(p,ticker)=>({annual:[[2026]],quarter:[[...Array(24).fill(null),ticker]],annualOnly:false,currency:'USD'});
  for(const ticker of ['MSFT','AAPL','MSFT']) {
    cells.set('B2',ticker);
    const result=ctx.refreshStockAnalyzer();
    assert.equal(result.ticker,ticker);
    assert.equal(cells.get('B4'),ticker+' Company');
    assert.equal(cells.get('E2'),'Nasdaq');
    assert.match(cells.get('B7'),/^=IF/);
    assert.equal(cells.get('L45'),moved);
  }
  const writes=events.filter(e=>e[0]==='value'||e[0]==='formula');
  assert.ok(writes.every(e=>['B4','E2','B7'].includes(e[1])));
});
