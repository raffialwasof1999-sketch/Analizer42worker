/**
 * SEC-only split evidence collector.
 * The GAAP ratio concept describes a split but is not guaranteed for all issuers.\n * This XBRL concept is duration-based: its period end is NOT an event date.
 * Treat the XBRL fact period end as an evidence date, NOT a confirmed trading effective date.
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
          periodStart: r.start || null,
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

/**
 * Convert an independently verified per-share observation to a target basis.
 * All inputs MUST have evidence from filings: split effective dates, source
 * observation's restatement cutoff, and desired target date. Guessing a cutoff
 * from the period end or SEC filing date can double-adjust EPS.
 *
 * The report basis cutoff represents the latest effective split already reflected
 * in the number, not simply the date on which the report was filed.
 *
 * Shares multiply by the forward split factor; EPS and per-share dividends divide.
 * Dollar totals (net income, revenue, etc.) must NEVER be transformed here.
 */
export function normalizeVerifiedPerShare({
  value, metric, basisThrough, targetDate, verifiedEvents
}) {
  if (!['dilutedEPS','basicEPS','dilutedShares','basicShares','dividendsPerShare']
      .includes(metric)) throw Error('Unsupported per-share metric');
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw Error('Numeric reported value required');
  }
  const valid = d => typeof d === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
  if (!valid(basisThrough) || !valid(targetDate) || targetDate < basisThrough) {
    throw Error('Verified basisThrough and later targetDate required');
  }
  if (!Array.isArray(verifiedEvents)) throw Error('Verified event array required');
  let factor = 1;
  const seen = new Set();
  for (const event of verifiedEvents) {
    if (!valid(event.effectiveDate) ||
        !Number.isFinite(event.sharesAfterPerBefore) ||
        event.sharesAfterPerBefore <= 0 ||
        event.verified !== true ||
        !event.secAccession) throw Error('Unverified split event');
    const key = event.effectiveDate + ':' + event.sharesAfterPerBefore;
    if (seen.has(key)) throw Error('Repeated split event');
    seen.add(key);
    if (event.effectiveDate > basisThrough && event.effectiveDate <= targetDate) {
      factor *= event.sharesAfterPerBefore;
    }
  }
  if (!Number.isFinite(factor) || factor <= 0) throw Error('Invalid cumulative factor');
  return {
    original: value,
    adjusted: metric.endsWith('Shares') ? value * factor : value / factor,
    cumulativeFactor: factor,
    metric,
    basisThrough,
    targetDate,
    verified: true
  };
}

/**
 * SEC submissions contain filing dates and accession numbers, NOT split dates.
 * Return auditable filing candidates for subsequent exhibit/filing review.
 * 8-K Item 5.03 may describe amended share capitalization, but isn't itself
 * proof of a split. 10-K/10-Q disclosure can also identify split events.
 */
export function secSplitFilingCandidates(submissions, evidence = []) {
  const recent = submissions?.filings?.recent || {};
  const found = [];
  const count = Array.isArray(recent.form) ? recent.form.length : 0;
  for (let i = 0; i < count; i++) {
    const form = recent.form[i];
    const accession = recent.accessionNumber?.[i];
    const filed = recent.filingDate?.[i];
    if (!['8-K','8-K/A','10-K','10-K/A','10-Q','10-Q/A'].includes(form) ||
        typeof accession !== 'string' ||
        !/^\d{10}-\d{2}-\d{6}$/.test(accession) ||
        typeof filed !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(filed)) continue;
    const sameFilingRatioFacts = evidence.filter(e => e.accession === accession);
    // All eligible filings are candidates, not verified split announcements.
    found.push({
      accession, filed, form,
      reportDate: recent.reportDate?.[i] || null,
      items: recent.items?.[i] || '',
      splitRatioFacts: sameFilingRatioFacts.map(e => ({
        sharesAfterPerBefore: e.sharesAfterPerBefore,
        periodStart: e.periodStart,
        evidenceDate: e.evidenceDate
      })),
      verifiedSplit: false
    });
  }
  return found.sort((a,b) => b.filed.localeCompare(a.filed));
}
