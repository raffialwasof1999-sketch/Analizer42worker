# Analyzer42 — SEC-only stock split normalization

## Default Worker behavior

`GET /?ticker=AAPL` preserves the **AA_SEC_V3** annual/quarterly field names, order, and spreadsheet interface.

For U.S. GAAP issuers, the Worker compares *the same reporting periods* as reported in successive SEC CompanyFacts filings. A forward or reverse split rescales **diluted weighted-average shares** and **diluted EPS** reciprocally, but does not change net income, revenue, operating cash flow, or other dollar totals.

When at least two overlapping periods support a non-unit factor, and the share-basis graph contains no contradictions:

- Historical annual diluted EPS and weighted-average shares are automatically normalized to the latest connected annual filing's share basis.
- Annual values whose basis cannot be linked are left **null**, not guessed.
- Quarterly values are replaced only if the entire quarterly result can be normalized from connected SEC evidence. Otherwise, reported quarterly values remain unchanged to avoid disrupting the latest four-quarter P/E calculation.
- `stockSplitAudit.companyFactsNormalization` exposes the proof and any coverage gaps.

**This is not guaranteed complete stock-split history for every issuer.** The anchor is the most recent connected annual SEC filing, not necessarily today's first split-adjusted trading day. Additional newly effective or uncaptured events require separate verification.

## Audit routes

`GET /?ticker=AAPL&basisAudit=1` — Returns the original annual/quarterly financials, the independent SEC share-basis graph, inferred cross-filing factor edges, verified-only adjusted financials, and per-period gaps.

`GET /?ticker=AAPL&discoverSplits=1&maxDocuments=8` — Uses free SEC current and archived submissions and reads a bounded selection of primary SEC filings. It extracts ratio mentions, unverified date candidates, and a very narrow class of explicit completed split disclosures. Includes a preview only for filings with explicit retrospective per-share basis proof. Ordinary requests do not download 30 archived documents.

`GET /?ticker=AAPL&inspectSplitAccession=ACCESSION` — Inspects a single accession from the issuer's SEC submissions. Does not change the financial results.

## Key safety invariants

1. An XBRL split-ratio tag's period end is **not** the execution date.
2. The corporate/legal date and first split-adjusted trading day are separate concepts.
3. An SEC fact repeated in a later filing may already be restated; never blindly divide EPS by a historical split ratio.
4. Do not change historical cash flow, net income, revenue, or actual cover-page shares outstanding as of their stated dates.
5. Do not treat proposed, conditional, or announced splits as completed.
6. Do not create a split-adjusted value when reports do not provide enough overlapping evidence.

## Testing and deployment

Run `npm test` using Node 22. Automated regressions include forward, reverse, multiple, conditional, no-split, filing provenance, date distinction, and original-versus-restated EPS cases. The PR's Cloudflare preview is independently tested against live SEC feeds on Apple, NVIDIA, Tesla, GE, and Microsoft.

The project's existing GitHub-to-Cloudflare deployment connection handles preview builds. Merging into main triggers production deployment; do not merge until the live preview and compatibility checks pass.

No paid financial data APIs are required.
