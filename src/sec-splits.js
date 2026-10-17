/**
 * SEC-only split evidence collector.
 * The GAAP ratio concept describes a split but is not guaranteed for all issuers.
 * This XBRL concept is duration-based: its period end is NOT an event date.
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
  const cik = Number(submissions?.cik);
  const validCik = Number.isSafeInteger(cik) && cik > 0;
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
    const accessionCompact = accession.replaceAll('-', '');
    const primaryDocument = recent.primaryDocument?.[i];
    const safePrimary = typeof primaryDocument === 'string' &&
      /^[A-Za-z0-9_.-]+\.(?:htm|html|txt)$/i.test(primaryDocument);
    const filingDocumentUrl = validCik && safePrimary
      ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionCompact}/${primaryDocument}`
      : null;
    const filingIndexUrl = validCik
      ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionCompact}/`
      : null;
    // All eligible filings are candidates, not verified split announcements.
    found.push({
      accession, filed, form, filingIndexUrl, filingDocumentUrl,
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
  // Prioritize filings with structured split evidence; remaining documents
  // are discovery candidates only and MUST NOT be counted as split events.
  return found.sort((a,b) =>
    Number(b.splitRatioFacts.length > 0) - Number(a.splitRatioFacts.length > 0) ||
    b.filed.localeCompare(a.filed)
  );
}

/**
 * Extract reviewable split statements from SEC filing text.
 * This is a discovery aid, not an event verifier: a filing may describe
 * a proposed, historical, rescinded, or hypothetical split.
 * Never send these candidates directly to normalizeVerifiedPerShare.
 */
export function detectSplitStatements(text, accession) {
  if (typeof text !== 'string' || text.length > 2_000_000) {
    throw Error('SEC filing text must be a bounded string');
  }
  if (typeof accession !== 'string' ||
      !/^\d{10}-\d{2}-\d{6}$/.test(accession)) {
    throw Error('Valid SEC accession required');
  }
  const normalized = text.replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ');
  const findings = [];
  const patterns = [
    /\b(\d{1,3})\s*(?:-\s*for\s*-|for\s*)\s*(\d{1,3})\s+(?:forward\s+|reverse\s+)?stock split\b/gi,
    /\b(?:forward|reverse)\s+stock split\s+(?:of|at|on a basis of)\s+(\d{1,3})\s*(?:-\s*for\s*-|for\s*)\s*(\d{1,3})\b/gi
  ];
  for (const pattern of patterns) {
    for (const m of normalized.matchAll(pattern)) {
      const after = Number(m[1]), before = Number(m[2]);
      if (!(after > 0 && before > 0) || after === before) continue;
      const context = normalized.slice(Math.max(0,m.index-180),
        Math.min(normalized.length,m.index+m[0].length+180));
      const key = [m.index,after,before].join(':');
      findings.push({
        accession,
        sharesAfterPerBefore: after/before,
        ratioText: m[0],
        context,
        textOffset: m.index,
        verified: false,
        effectiveDate: null,
        status: 'filing-text-review-needed',
        key
      });
    }
  }
  return findings.sort((a,b)=>a.textOffset-b.textOffset);
}

/**
 * Identify explicit execution-date phrases near a split statement.
 * Returns possible dates only. Boilerplate, comparisons and proposals can
 * contain dates: human/independent filing corroboration is still required.
 */
export function splitDateCandidates(statement) {
  if (!statement || typeof statement.context !== 'string') return [];
  const text = statement.context;
  const months = {
    january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12
  };
  const found = [];
  const pattern = /\b(?:effective|effected|became effective|began trading|commenced trading|trading began|split-adjusted trading began|on|as of)\s+(?:on\s+)?(?:the\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/gi;
  for (const m of text.matchAll(pattern)) {
    const year = Number(m[3]), month = months[m[1].toLowerCase()], day = Number(m[2]);
    const date = new Date(Date.UTC(year,month-1,day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month-1 ||
        date.getUTCDate() !== day) continue;
    found.push({date:date.toISOString().slice(0,10),
      phrase:m[0],sourceAccession:statement.accession,
      verified:false,status:'review-required'});
  }
  return [...new Map(found.map(x=>[x.date,x])).values()];
}

/**
 * Classify whether a financial observation can be normalized.
 * SEC CompanyFacts does not explicitly annotate the split basis of each EPS
 * observation. Filing date alone is insufficient: a post-split filing can
 * include retroactively restated earlier EPS.
 */
export function assessSplitBasis(observation, verifiedEvents) {
  if (!observation || !Array.isArray(verifiedEvents)) {
    throw Error('Observation and split events are required');
  }
  const relevant = verifiedEvents.filter(e =>
    e?.verified === true && typeof e.effectiveDate === 'string' &&
    typeof observation.end === 'string' && e.effectiveDate > observation.end
  );
  const explicitlyVerifiedBasis =
    observation.basisVerified === true &&
    typeof observation.basisThrough === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(observation.basisThrough) &&
    typeof observation.basisSecAccession === 'string' &&
    /^\d{10}-\d{2}-\d{6}$/.test(observation.basisSecAccession);
  return {
    eligible: explicitlyVerifiedBasis,
    status: explicitlyVerifiedBasis ? 'basis-proven' : 'basis-unknown',
    potentialLaterSplits: relevant.map(e=>({
      effectiveDate:e.effectiveDate,
      sharesAfterPerBefore:e.sharesAfterPerBefore
    })),
    reason: explicitlyVerifiedBasis
      ? 'Observation basis has separately verified SEC provenance'
      : 'SEC facts do not specify which later split restatements this value already incorporates'
  };
}

/**
 * The sole permitted entry point for changing a reported per-share number.
 * Provenance is checked here, not merely reported as advisory metadata.
 * Callers must provide an independently verified split history AND basis proof.
 */
export function normalizeProvenObservation(observation, targetDate, verifiedEvents) {
  if (!observation || typeof observation !== 'object') {
    throw Error('SEC observation required');
  }
  const basis = assessSplitBasis(observation, verifiedEvents);
  if (!basis.eligible) throw Error('Cannot adjust EPS: SEC reporting basis unverified');
  if (!observation.accn || observation.accn !== observation.basisSecAccession) {
    throw Error('Observation and basis proof refer to different SEC filings');
  }
  if (!['dilutedEPS','basicEPS','dilutedShares','basicShares','dividendsPerShare']
    .includes(observation.metric)) throw Error('Unsupported per-share metric');
  return normalizeVerifiedPerShare({
    value: observation.val,
    metric: observation.metric,
    basisThrough: observation.basisThrough,
    targetDate,
    verifiedEvents
  });
}
