import test from 'node:test';
import assert from 'node:assert/strict';
import {reportedQuarterEPS,recoverSECReportedEPS} from '../src/sec-reported-eps.js';

// Microsoft FY2025 Q4 exhibit 99.1 (accession 0000950170-25-100226) puts
// "Three Months Ended June 30," in one header row and the years in the next.
// Quarter: net income 27,233m, basic 3.66, diluted 3.65 (FY2024 Q4: 22,036m,
// 2.96, 2.95). Twelve-month columns end on the same dates and must be ignored.
const spanned=`<table>
<tr><td colspan="3"></td><td colspan="8">Three Months Ended June 30,</td><td colspan="8">Twelve Months Ended June 30,</td></tr>
<tr><td colspan="3"></td><td colspan="4">2025</td><td colspan="4">2024</td><td colspan="4">2025</td><td colspan="4">2024</td></tr>
<tr><td colspan="3">Net income</td><td>$</td><td>27,233</td><td></td><td></td><td>$</td><td>22,036</td><td></td><td></td><td>$</td><td>101,832</td><td></td><td></td><td>$</td><td>88,136</td><td></td><td></td></tr>
<tr><td colspan="3">Earnings per share:</td></tr>
<tr><td colspan="3">Basic</td><td>$</td><td>3.66</td><td></td><td></td><td>$</td><td>2.96</td><td></td><td></td><td>$</td><td>13.70</td><td></td><td></td><td>$</td><td>11.86</td><td></td><td></td></tr>
<tr><td colspan="3">Diluted</td><td>$</td><td>3.65</td><td></td><td></td><td>$</td><td>2.95</td><td></td><td></td><td>$</td><td>13.64</td><td></td><td></td><td>$</td><td>11.80</td><td></td><td></td></tr>
<tr><td colspan="3">Weighted average shares outstanding:</td></tr>
<tr><td colspan="3">Basic</td><td></td><td>7,432</td><td></td><td></td><td></td><td>7,433</td><td></td><td></td><td></td><td>7,433</td><td></td><td></td><td></td><td>7,431</td><td></td><td></td></tr>
</table>`;

// The same statement without spanning cells: each header and value in its
// own column, year cells aligned with the value cells.
const flat=`<table>
<tr><td></td><td>Three Months Ended June 30,</td><td></td><td>Twelve Months Ended June 30,</td><td></td></tr>
<tr><td></td><td>2025</td><td>2024</td><td>2025</td><td>2024</td></tr>
<tr><td>Net income</td><td>27,233</td><td>22,036</td><td>101,832</td><td>88,136</td></tr>
<tr><td>Earnings per share:</td></tr>
<tr><td>Basic</td><td>3.66</td><td>2.96</td><td>13.70</td><td>11.86</td></tr>
<tr><td>Diluted</td><td>3.65</td><td>2.95</td><td>13.64</td><td>11.80</td></tr>
<tr><td>Weighted average shares outstanding:</td></tr>
<tr><td>Basic</td><td>7,432</td><td>7,433</td><td>7,433</td><td>7,431</td></tr>
</table>`;

for(const [name,html] of [['spanning',spanned],['flat',flat]]){
  test(`year-only headers resolve to the quarter (${name} cells)`,()=>{
    assert.deepEqual(reportedQuarterEPS(html,'2025-06-30'),{netIncome:27233,basicEPS:3.66,dilutedEPS:3.65});
    assert.deepEqual(reportedQuarterEPS(html,'2024-06-30'),{netIncome:22036,basicEPS:2.96,dilutedEPS:2.95});
    assert.equal(reportedQuarterEPS(html,'2025-03-31'),null);
  });
}

test('twelve-month year columns alone never count as a quarter',()=>{
  const annualOnly=flat.replace('Three Months Ended June 30,','');
  assert.equal(reportedQuarterEPS(annualOnly,'2025-06-30'),null);
});

test('recovers Microsoft Q4 diluted EPS end to end',async()=>{
  const row={fiscalPeriodEnd:'2025-06-30',fiscalQuarter:4,basicEPS:3.66,dilutedEPS:null,netIncome:27233000000};
  const filing={form:'8-K',filed:'2025-07-30',items:'2.02,9.01',accession:'0000950170-25-100226'};
  const listing=async()=>({directory:{item:[{name:'msft-20250730.htm'},{name:'msft-ex99_1.htm'}]}});
  const result=await recoverSECReportedEPS([row],[filing],789019,listing,async()=>spanned,['2025-06-30']);
  assert.equal(result.rows[0].dilutedEPS,3.65);
  assert.equal(result.rows[0].basicEPS,3.66);
});
