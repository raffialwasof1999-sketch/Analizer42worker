import test from 'node:test';
import assert from 'node:assert/strict';
import {alignQuarterlyDilutedEPS} from '../src/diluted-eps-share-basis.js';
import {recoverSECReportedEPS} from '../src/sec-reported-eps.js';

// Newest first. Q4 FY2018 is pre-4:1-split (Apple reported basic 2.94,
// diluted 2.91); basic EPS normalization proved a factor of 4 for it.
const raw=[
  {fiscalPeriodEnd:'2026-06-27',basicEPS:2.03,dilutedEPS:2.02,dilutedShares:14.9e9},
  {fiscalPeriodEnd:'2018-09-29',basicEPS:2.94,dilutedEPS:2.91,dilutedShares:4.85e9},
  {fiscalPeriodEnd:'2017-07-01',basicEPS:1.68,dilutedEPS:1.67,dilutedShares:5.25e9},
  {fiscalPeriodEnd:'2016-06-25',basicEPS:1.43,dilutedEPS:1.42,dilutedShares:5.5e9},
  {fiscalPeriodEnd:'2024-06-29',basicEPS:1.40,dilutedEPS:1.40,dilutedShares:15.4e9}
];
const graphRows=raw.map((r,i)=>({...r,dilutedEPS:i===2?1.67/4:null}));
const basicFactors=[1,4,null,null,null];

test('diluted EPS follows the split basis proven for basic EPS',()=>{
  const {rows,findings}=alignQuarterlyDilutedEPS(raw,raw,graphRows,basicFactors,true);
  assert.equal(rows[0].dilutedEPS,2.02);          // current basis, factor 1
  assert.equal(rows[1].dilutedEPS,2.91/4);        // basic factor applied
  assert.equal(rows[2].dilutedEPS,1.67/4);        // graph-proven diluted
  assert.equal(rows[3].dilutedEPS,null);          // pre-split, unprovable
  assert.equal(rows[4].dilutedEPS,1.40);          // share count shows current basis
  assert.deepEqual(findings.unverified,['2016-06-25']);
  assert.equal(raw[1].dilutedEPS,2.91);           // input untouched
});

test('basic factor is not applied when raw diluted is on a different basis',()=>{
  const odd=[raw[0],{...raw[1],dilutedEPS:0.73}]; // already split-adjusted diluted
  const {rows}=alignQuarterlyDilutedEPS(odd,odd,[{},{}],[1,4],true);
  assert.equal(rows[1].dilutedEPS,null);
});

test('no split detected leaves diluted EPS unchanged',()=>{
  const {rows}=alignQuarterlyDilutedEPS(raw,raw,[],[],false);
  assert.deepEqual(rows.map(r=>r.dilutedEPS),raw.map(r=>r.dilutedEPS));
});

// Apple Q4 FY2024 (accession 0000320193-24-000120): reported basic and
// diluted EPS 0.97, net income 14,736 million; the worker estimated 0.98.
const fy24=`<table>
<tr><td></td><td colspan="2">Three Months Ended</td></tr>
<tr><td></td><td>September 28, 2024</td><td>September 30, 2023</td></tr>
<tr><td>Net income</td><td>14,736</td><td>22,956</td></tr>
<tr><td>Earnings per share:</td><td></td><td></td></tr>
<tr><td>Basic</td><td>0.97</td><td>1.47</td></tr>
<tr><td>Diluted</td><td>0.97</td><td>1.46</td></tr>
<tr><td>Shares used in computing earnings per share:</td><td></td><td></td></tr>
<tr><td>Basic</td><td>15,171,990</td><td>15,599,434</td></tr>
</table>`;
const filing={form:'8-K',filed:'2024-10-31',items:'2.02,9.01',accession:'0000320193-24-000120'};
const listing=async()=>({directory:{item:[{name:'a8-kex991q4202409282024.htm'}]}});
const q4={fiscalPeriodEnd:'2024-09-28',fiscalQuarter:4,basicEPS:0.98,dilutedEPS:null,netIncome:14736000000};

test('reported exhibit replaces an estimated Q4 basic EPS a cent off',async()=>{
  const result=await recoverSECReportedEPS([q4],[filing],320193,listing,async()=>fy24,['2024-09-28']);
  assert.equal(result.rows[0].dilutedEPS,0.97);
  assert.equal(result.rows[0].basicEPS,0.97);
  assert.deepEqual(result.audit.findings[0].fields,['basicEPS','dilutedEPS']);
});

test('estimated Q4 still rejects a different split basis or net income',async()=>{
  for(const row of [{...q4,basicEPS:0.98*4},{...q4,netIncome:20e9}]){
    const result=await recoverSECReportedEPS([row],[filing],320193,listing,async()=>fy24,['2024-09-28']);
    assert.equal(result.rows[0].dilutedEPS,null);
  }
});

test('without the estimated flag a cent difference is still rejected',async()=>{
  const result=await recoverSECReportedEPS([q4],[filing],320193,listing,async()=>fy24);
  assert.equal(result.rows[0].dilutedEPS,null);
});
