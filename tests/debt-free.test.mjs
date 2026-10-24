import test from 'node:test';
import assert from 'node:assert/strict';
import { isDebtLikeTag, debtFreeEvidence } from '../src/debt-free.js';

test('debt-like tags: borrowings and credit lines yes; investments, capacity, flows no', () => {
  for (const t of ['LongTermDebt','LongTermLineOfCredit','LineOfCreditFacilityFairValueOfAmountOutstanding','CommercialPaper',
    'ConvertibleNotesPayable','FinanceLeaseLiabilityNoncurrent','DebtInstrumentCarryingAmount','ShortTermBorrowings'])
    assert.ok(isDebtLikeTag(t),t);
  for (const t of ['AvailableForSaleSecuritiesDebtSecurities','LineOfCreditFacilityMaximumBorrowingCapacity','PaymentsOfDebtIssuanceCosts',
    'RepaymentsOfLongTermLinesOfCredit','OperatingLeaseLiability','DebtInstrumentInterestRateStatedPercentage','LineOfCreditFacilityRemainingBorrowingCapacity'])
    assert.ok(!isDebtLikeTag(t),t);
});

test('a period is debt-free only if its own filing shows no positive debt balance (The Trade Desk)', () => {
  const gaap={LongTermLineOfCredit:{units:{USD:[
    {end:'2020-09-30',val:72000000,accn:'q3-2020',form:'10-Q',filed:'2020-11-06'},
    {end:'2019-12-31',val:0,accn:'k-2020',form:'10-K',filed:'2021-02-18'}]}}};
  const assets=[
    {end:'2020-09-30',val:1,accn:'q3-2020',form:'10-Q',filed:'2020-11-06'},
    {end:'2020-12-31',val:1,accn:'k-2020',form:'10-K',filed:'2021-02-18'},
    {end:'2020-12-31',val:1,accn:'q1-2021',form:'10-Q',filed:'2021-05-10'},
    {end:'2026-06-30',val:1,accn:'q2-2026',form:'10-Q',filed:'2026-08-06'}];
  const free=debtFreeEvidence(gaap);
  assert.equal(free('2020-09-30',['10-Q'],assets),false);          // revolver drawn
  assert.equal(free('2020-12-31',['10-K'],assets),true);           // repaid; a 0 balance is not debt
  assert.equal(free('2026-06-30',['10-Q'],assets),true);
  assert.equal(free('2026-03-31',['10-Q'],assets),false);          // no balance sheet filed: unknown
});
