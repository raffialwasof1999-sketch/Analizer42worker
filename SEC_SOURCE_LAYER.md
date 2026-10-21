# SEC original-facts layer (first implementation stage)

The Analyzer dashboard remains untouched. Google Sheets currently imports its
normalized numbers through the pre-existing `annualFinancials` and
`quarterlyFinancials` arrays. Their shape, ordering and calculations are
unchanged.

This release adds a **read-only, company-independent source layer** to the
same Worker:

- `?ticker=AAPL&secCatalog=1&page=1&pageSize=100`: paginated inventory of
  every concept supplied by the SEC Company Facts API for the issuer.
  `search=debt` filters names, labels and descriptions.
- `?ticker=AAPL&secFact=us-gaap:Assets&offset=0&limit=100`: original
  individual SEC observations, with original `val`, period boundaries,
  form, accession, filed date, frame and unit preserved.
- Normalized Worker responses include `sourceFactsAccess` indicating
  these routes and their **nonpersistent** state.

This avoids forcing the Google Sheet to process thousands of raw accounting
observations, and provides unmodified evidence before designing tag mapping.
Missing and distinct concepts are **not** silently mapped or converted to zero.

**Known limits:**

1. The SEC Company Facts API only includes applicable standardized tags.
   Company extension tags and note details need an additional filing-level
   iXBRL extractor with explicit semantic verification.
2. The route is a live paginated view; **not** a permanent archive. There is
   currently no Cloudflare R2/D1/KV binding in `wrangler.toml`. Durable
   snapshots, deduplication, origin tracking and a backfill/reprocessing
   workflow must be implemented and provisioned before calling it an archive.
3. Changing the user-facing Google Sheets data tabs, or adding a source
   catalog tab, should be done only once the production endpoint and importer
   are connected and validated. Do not change Analyzer/dashboard cells.
4. SEC does not publish all non-GAAP metrics as dedicated reported tags.
   ROIC, margins and other derived values must remain clearly computed.

Verification: `npm test`; a deployed Cloudflare endpoint needs separate
production verification after merging.

## Raw-first refresh extension

The Worker downloads the selected issuer's entire SEC Company Facts JSON on
each ticker refresh *before* matching the dashboard's known tags. It does not
discard unrecognized standardized concepts in that source response.

- `?ticker=AAPL&secRawFacts=1&offset=0&limit=100`: page through every
  reported observation across all standard taxonomies and units, including
  concepts not currently used in the Analyzer. Each page includes the
  original SEC fact object, taxonomy, tag, label, and unit.
- The normal refresh response additionally supplies `sourceFactsSummary`
  with SEC concept counts and a distinction between known and unmapped tags.
  Source pagination is exposed in `sourceFactsAccess.secRawFacts`.
- The dashboard-facing `annualFinancials` and `quarterlyFinancials` arrays,
  headers, SEC-refresh trigger and Sheets formatting remain unchanged.

**Scope remains explicitly incomplete:** Company Facts omits issuer-specific
extensions, some dimensional data and narrative disclosures. The next stage
must use a safe SEC filing-by-filing XBRL/iXBRL extractor and validate
contexts/units/definitions before using extension facts in calculations.
This raw-first route is not a universal original-filing parser, does not
promise that every SEC disclosure has been imported, and adds no long-term
storage. Missing or conflicting facts must not be converted to zero.
