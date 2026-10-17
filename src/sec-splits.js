/**
 * SEC-only split evidence collector.
 * The GAAP ratio concept describes a split but is not guaranteed for all issuers.
 * Treat the fact's instant end as an evidence date, NOT a confirmed trading effective date.
 * Never apply a split factor to historical EPS without establishing its reporting basis.
 */
export function secSplitEvidence(companyFacts) {
  const gaap = companyFacts?.facts?.['us-gaap'] || {};
  const concepts = [
    'StockholdersEquityNoteStockSplitConversionRatio1',
    'StockholdersEquityNoteStockSplitConversionRatio'
  ];
  const evidence = [];
  for (const concept of concepts) {
    const units = gaap[concept]?.units || {};
    for (const [unit, records] of Object.entries(units)) {
      if (unit !== 'pure' || !Array.isArray(records)) continue;
      for (const r of records) {
        if (typeof r.val !== 'number' || !Number.isFinite(r.val) ||
            r.val <= 0 || r.val === 1 ||
            !/^\d{4}-\d{2}-\d{2}$/.test(r.end || '') ||
            !['10-K','10-Q','10-K/A','10-Q/A'].includes(r.form)) continue;
        evidence.push({
          evidenceDate: r.end,
          sharesAfterPerBefore: r.val,
          concept,
          accession: r.accn || null,
          filed: r.filed || null,
          source: 'SEC CompanyFacts',
          status: 'unverified-effective-date'
        });
      }
    }
  }
  // The same underlying split may be repeated across many later filings.
  // Deduplication is by concept + reported fact date + ratio, NOT filing date.
  const dedup = new Map();
  for (const e of evidence) {
    const key = [e.evidenceDate, e.sharesAfterPerBefore].join('|');
    const prev = dedup.get(key);
    if (!prev || (e.filed || '') < (prev.filed || '')) dedup.set(key, e);
  }
  return [...dedup.values()].sort((a,b)=>a.evidenceDate.localeCompare(b.evidenceDate));
}

export function splitAudit(companyFacts) {
  const candidates = secSplitEvidence(companyFacts);
  return {
    candidates,
    verifiedEvents: [],
    normalizationApplied: false,
    status: candidates.length ? 'requires-filing-verification' : 'no-structured-split-evidence',
    note: 'SEC XBRL split ratios are incomplete and evidence dates are not necessarily execution dates. Reported EPS and share counts remain unchanged until split timing and per-filing restatement basis are verified.'
  };
}
