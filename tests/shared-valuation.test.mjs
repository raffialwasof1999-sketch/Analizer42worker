import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
const source=readFileSync(new URL('../apps-script/SharedValuation.gs',import.meta.url),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
const bounds=a=>{const p=a.split(':').map(s=>{const m=s.match(/^([A-Z]+)(\d+)$/);return [+m[2],m[1].split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)];});return [p[0][0],p[0][1],(p[1]||p[0])[0],(p[1]||p[0])[1]];};
const name=(r,c)=>String.fromCharCode(64+c)+r;
const overlaps=(a,b)=>{a=bounds(a);b=bounds(b);return a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];};
class Range {
 constructor(sheet,a){this.s=sheet;this.a=a;this.b=bounds(a);}
 getA1Notation(){return this.a;} getSheet(){return this.s;}
 getNumRows(){return this.b[2]-this.b[0]+1;} getNumColumns(){return this.b[3]-this.b[1]+1;}
 cells(fn){const out=[];for(let r=this.b[0];r<=this.b[2];r++){const row=[];for(let c=this.b[1];c<=this.b[3];c++)row.push(fn(this.s.cell(name(r,c)),r-this.b[0],c-this.b[1]));out.push(row);}return out;}
 getValue(){return this.s.cell(name(this.b[0],this.b[1])).value;}
 getValues(){return this.cells(c=>c.value);}
 getFormulas(){return this.cells(c=>typeof c.value==='string'&&c.value.startsWith('=')?c.value:'');}
 getNotes(){return this.cells(c=>c.note);}
 getNumberFormats(){return this.cells(c=>c.format);}
 setValue(v){this.s.write(this.a);this.s.cell(name(this.b[0],this.b[1])).value=v;return this;}
 setValues(v){this.s.write(this.a);this.cells((c,i,j)=>c.value=v[i][j]);return this;}
 setNote(v){this.s.write(this.a);this.cells(c=>c.note=v);return this;}
 setNotes(v){this.s.write(this.a);this.cells((c,i,j)=>c.note=v[i][j]);return this;}
 setNumberFormats(v){this.s.write(this.a);this.cells((c,i,j)=>c.format=v[i][j]);return this;}
 clearContent(){this.s.write(this.a);this.cells(c=>c.value='');return this;}
 clearNote(){return this.setNote('');}
 getMergedRanges(){return this.s.merges.filter(m=>overlaps(m,this.a)).map(m=>new Range(this.s,m));}
 breakApart(){this.s.write(this.a);this.s.merges=this.s.merges.filter(m=>!overlaps(m,this.a));return this;}
 merge(){this.s.write(this.a);assert.equal(this.getMergedRanges().length,0,'overlapping merge '+this.a);this.cells((c,i,j)=>{if(i||j){c.value='';c.note='';}});this.s.merges.push(this.a);return this;}
 setBorder(){this.s.write(this.a);return this;}
}
function setup(){
 const sheet={title:'Analyzer',grid:{},merges:['A18:D18','A19:D19','A25:D25','A26:D26'],writes:[],fail:null,
  getName(){return this.title;},getSheetId(){return 1;},getRange(a){return new Range(this,a);},
  cell(a){return this.grid[a]??={value:'',note:'',format:'0.00'};},
  write(a){if(this.fail&&this.fail(a)){this.fail=null;throw Error('injected failure');}this.writes.push(a);}};
 for(const [a,v] of Object.entries({D12:'Shared Profit / FCF Margin',E12:'Separate',A18:'P/E label',A19:'FCF label',A25:'Earnings result',A26:'FCF result',A16:'Profit Margin',A17:'Free Cash Flow Margin',H18:'Unrelated metric',B17:0.12}))sheet.cell(a).value=v;
 for(const c of ['E','F','G'])for(const [r,v] of [[16,0.2],[17,0.13],[18,20],[19,16],[25,'=profitCalculation'],[26,'=IF($E$12="Shared","",fcfCalculation)'],[27,'=returnCalculation'],[28,'=dividendCalculation']])sheet.cell(c+r).value=v;
 sheet.cell('A19').note='FCF multiple note';sheet.cell('A26').note='FCF result note';
 const storage=new Map(),props={getProperty:k=>storage.get(k)??null,setProperty(k,v){storage.set(k,v);},deleteProperty(k){storage.delete(k);}};
 let locked=true,released=0;const toasts=[];
 const ctx=vm.createContext({console,PropertiesService:{getDocumentProperties:()=>props},LockService:{getDocumentLock:()=>({tryLock:()=>locked,releaseLock(){released++;}})},SpreadsheetApp:{flush(){}}});
 vm.runInContext(source,ctx);
 return {sheet,props,storage,ctx,toasts,setLocked:v=>locked=v,released:()=>released,
  toggle(v){sheet.cell('E12').value=v?'Shared':'Separate';return ctx.aaSvSetMode_(sheet,props,v);},
  edit(a='E12'){return ctx.onEdit({range:sheet.getRange(a),source:{toast:(...x)=>toasts.push(x)}});}};
}
test('enabling makes exactly one margin, multiple and result per scenario',()=>{const x=setup();x.toggle(true);assert.equal(x.sheet.merges.length,11);for(const c of ['E','F','G']){assert.equal(x.sheet.cell(c+'16').value,0.2);assert.equal(x.sheet.cell(c+'17').value,'');assert.equal(x.sheet.cell(c+'18').value,20);assert.equal(x.sheet.cell(c+'19').value,'');assert.equal(x.sheet.cell(c+'25').value,'=profitCalculation');assert.equal(x.sheet.cell(c+'26').value,'');}assert.equal(x.storage.size,1);});
test('uncheck restores all independent inputs, formulas, labels and formats',()=>{const x=setup();const before=plain(x.ctx.aaSvCapture_(x.sheet));x.toggle(true);x.toggle(false);assert.deepEqual(plain(x.ctx.aaSvCapture_(x.sheet)),before);assert.equal(x.storage.size,0);assert.deepEqual(x.sheet.merges,['A18:D18','A19:D19','A25:D25','A26:D26']);});
test('shared edits stay in profit inputs; old independent FCF values are restored',()=>{const x=setup();x.toggle(true);x.sheet.cell('F16').value=0.25;x.sheet.cell('F18').value=30;x.toggle(false);assert.equal(x.sheet.cell('F16').value,0.25);assert.equal(x.sheet.cell('F18').value,30);assert.equal(x.sheet.cell('F17').value,0.13);assert.equal(x.sheet.cell('F19').value,16);});
test('repeat enable never overwrites independent backup',()=>{const x=setup();x.toggle(true);const saved=[...x.storage.values()][0];x.toggle(true);assert.equal([...x.storage.values()][0],saved);x.toggle(false);assert.equal(x.sheet.cell('E17').value,0.13);});
test('history, comparison metrics, returns and refresh controls are untouched',()=>{const x=setup();x.toggle(true);x.toggle(false);for(const a of x.sheet.writes){const b=bounds(a);assert.ok(b[3]<=7);assert.ok(!overlaps(a,'A16:D17'));assert.ok(!overlaps(a,'A1:L11'));assert.ok(!overlaps(a,'A27:L28'));}assert.equal(x.sheet.cell('B17').value,0.12);});
test('blank, zero, unequal and formula-backed FCF inputs round-trip',()=>{const x=setup();x.sheet.cell('E17').value=0;x.sheet.cell('F17').value='';x.sheet.cell('G17').value='=0.21';x.sheet.cell('F19').value=11;const before=plain(x.ctx.aaSvCapture_(x.sheet));x.toggle(true);x.toggle(false);assert.deepEqual(plain(x.ctx.aaSvCapture_(x.sheet)),before);});
test('backup failure makes no destructive writes',()=>{const x=setup();x.props.setProperty=()=>{throw Error('storage failed');};assert.throws(()=>x.toggle(true),/storage failed/);assert.equal(x.sheet.cell('E17').value,0.13);assert.equal(x.sheet.cell('E12').value,'Separate');assert.deepEqual(x.sheet.merges,['A18:D18','A19:D19','A25:D25','A26:D26']);});
test('mid-operation failure rolls back completely',()=>{const x=setup();const before=plain(x.ctx.aaSvCapture_(x.sheet));x.sheet.fail=a=>a==='A25';assert.throws(()=>x.toggle(true),/restored/);assert.deepEqual(plain(x.ctx.aaSvCapture_(x.sheet)),before);assert.equal(x.sheet.cell('E12').value,'Separate');assert.equal(x.storage.size,0);});
test('unexpected merged layout is rejected without erasing inputs',()=>{const x=setup();x.sheet.merges.push('E16:F16');assert.throws(()=>x.toggle(true),/layout changed/);assert.equal(x.sheet.cell('F17').value,0.13);assert.equal(x.sheet.cell('E12').value,'Separate');});
test('simple trigger ignores other cells and tabs',()=>{const x=setup();x.edit('B2');x.edit('B6');x.sheet.title='Other';x.edit();assert.equal(x.sheet.writes.length,0);assert.equal(x.storage.size,0);});
test('trigger uses latest dropdown state and releases document lock',()=>{const x=setup();x.sheet.cell('E12').value='Shared';x.edit();assert.equal(x.sheet.merges.length,11);assert.equal(x.released(),1);x.sheet.cell('E12').value='Separate';x.edit();assert.equal(x.sheet.merges.length,4);assert.equal(x.released(),2);});
test('busy lock reverts dropdown without modifying financial data',()=>{const x=setup();x.setLocked(false);x.sheet.cell('E12').value='Shared';x.edit();assert.equal(x.sheet.cell('E12').value,'Separate');assert.equal(x.storage.size,0);assert.equal(x.toasts.length,1);});
test('missing backup never invents independent values',()=>{const x=setup();x.toggle(true);x.storage.clear();assert.throws(()=>x.toggle(false),/unavailable/);assert.equal(x.sheet.cell('E12').value,'Shared');assert.equal(x.sheet.cell('E17').value,'');});
test('large backup fails before merge',()=>{const x=setup();x.sheet.cell('A26').value='x'.repeat(9000);assert.throws(()=>x.toggle(true),/too large/);assert.equal(x.sheet.cell('E12').value,'Separate');assert.equal(x.sheet.merges.length,4);});
test('module cannot invoke SEC refresh or access any external service',()=>{assert.doesNotMatch(source,/UrlFetchApp|refreshStockAnalyzer\s*\(|\.hideRows\(|\.deleteRows\(|\.insertRows\(/);assert.doesNotMatch(source,/function\s+(?:aaTickerEdited|onOpen)\s*\(/);});

const assertNoNotes=sheet=>{for(const [address,cell] of Object.entries(sheet.grid))assert.equal(cell.note,'','Unexpected hover note at '+address);};
test('both toggle directions and repeated cycles remain note-free',()=>{
 const x=setup();x.sheet.cell('A18').note='old shared multiple note';x.sheet.cell('A25').note='old shared result note';
 for(const enabled of [true,true,false,true,false]){x.toggle(enabled);assertNoNotes(x.sheet);}
});
test('new backups never include notes or consume note storage',()=>{
 const x=setup();x.sheet.cell('A26').note='old note'.repeat(2000);x.toggle(true);
 const saved=JSON.parse([...x.storage.values()][0]);
 for(const entry of Object.values(saved.entries))assert.equal(Object.hasOwn(entry,'notes'),false);
 x.toggle(false);assertNoNotes(x.sheet);
});
function seedLegacyNotes(x){
 const key=[...x.storage.keys()][0],snapshot=JSON.parse(x.storage.get(key));
 for(const entry of Object.values(snapshot.entries))entry.notes=entry.data.map(row=>row.map(()=>'legacy hover note'));
 x.storage.set(key,JSON.stringify(snapshot));
 x.sheet.cell('A18').note='legacy checked-mode note';x.sheet.cell('A25').note='legacy checked-mode note';
}
test('uncheck accepts an old backup but never restores its notes',()=>{
 const x=setup(),before=plain(x.ctx.aaSvCapture_(x.sheet));x.toggle(true);seedLegacyNotes(x);x.toggle(false);
 assert.deepEqual(plain(x.ctx.aaSvCapture_(x.sheet)),before);assertNoNotes(x.sheet);assert.equal(x.storage.size,0);
});
test('rollback also ignores legacy backup notes while restoring inputs',()=>{
 const x=setup(),before=plain(x.ctx.aaSvCapture_(x.sheet));x.toggle(true);seedLegacyNotes(x);
 x.sheet.fail=a=>a==='A25';assert.throws(()=>x.toggle(true),/restored/);
 assert.deepEqual(plain(x.ctx.aaSvCapture_(x.sheet)),before);assertNoNotes(x.sheet);assert.equal(x.sheet.cell('E12').value,'Separate');
});
test('reference tab notes are never touched by the dropdown handler',()=>{
 const x=setup();x.sheet.title='Analyzer with hover notes';const before=plain(x.sheet.grid);
 x.edit();assert.deepEqual(plain(x.sheet.grid),before);assert.equal(x.sheet.writes.length,0);assert.equal(x.storage.size,0);
});
test('all deployable Apps Script sources prohibit cell-note writing',()=>{
 const dir=new URL('../apps-script/',import.meta.url);
 const files=readdirSync(dir,{recursive:true}).filter(f=>/\.(?:gs|js|html)$/.test(f));
 for(const required of ['Code.gs','SharedValuation.gs','TickerSearch.gs','TickerSearch2.html'])assert.ok(files.includes(required));
 for(const file of files){
  const text=readFileSync(new URL(file,dir),'utf8');
  assert.doesNotMatch(text,/\bsetNotes?\s*\(/,file+' must not create or restore cell notes');
  assert.doesNotMatch(text,/\[\s*['"]setNotes?['"]\s*\]\s*\(/,file+' must not write cell notes indirectly');
  assert.doesNotMatch(text,/(?:\bnote|['"]note['"])\s*:/,file+' must not write a Sheets API CellData.note field');
 }
});
