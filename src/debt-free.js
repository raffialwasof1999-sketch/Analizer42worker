/**
 * Evidence that a company had no interest-bearing debt at a period end.
 * A debt-free company never files a debt line, so its total debt (and
 * ROIC, which needs invested capital) would otherwise stay blank (The Trade
 * Desk). A missing line is read as 0 only when the period's own 10-Q/10-K
 * (the filing that first reported that balance sheet) contains no positive
 * debt-like balance of any kind, for any date: borrowings, notes, lines of
 * credit, commercial paper, finance leases, or debt footnote amounts.
 * A filing that shows a revolver drawn at any date shown (TTD in 2020)
 * keeps that period unknown.
 */
const DEBT_LIKE=/(Debt|Borrowing|LineOfCredit|NotesPayable|CommercialPaper|FinanceLease(Liabilit|Obligation)|CapitalLeaseObligation|LoansPayable|ConvertibleNotes|SeniorNotes)/;
const NOT_DEBT=/(Securities|Investment|Receivable|HeldToMaturity|AvailableForSale|Capacity|Remaining|Commitment|Fee|Rate|Percentage|IssuanceCost|Discount|Premium|Forgiv|Extinguish|Covenant|Payments|Proceeds|Repayment|InstrumentTerm|Number|Ratio)/;

export function isDebtLikeTag(tag) {
  return DEBT_LIKE.test(tag) && !NOT_DEBT.test(tag);
}

/**
 * @param gaap us-gaap Company Facts
 * @returns (end, forms, assetsFacts) => true when that period's filing has no debt
 */
export function debtFreeEvidence(gaap) {
  const withDebt=new Set();
  for (const [tag,concept] of Object.entries(gaap||{})) {
    if (!isDebtLikeTag(tag)) continue;
    for (const f of concept?.units?.USD||[])
      if (!f.start && typeof f.val==='number' && f.val>0 && f.accn) withDebt.add(f.accn);
  }
  return (end,forms,assetsFacts)=>{
    const first=(assetsFacts||[])
      .filter(f=>f.end===end && !f.start && forms.includes(f.form) && f.accn)
      .sort((a,b)=>String(a.filed||'').localeCompare(String(b.filed||'')))[0];
    return !!first && !withDebt.has(first.accn);
  };
}
