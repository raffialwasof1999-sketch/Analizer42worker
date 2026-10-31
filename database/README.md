# Active Analyzer database: handoff and continuation guide

Document version: 1. Last updated: 2026-10-31.

## Read this first

This guide is the starting point for another model. Read `AGENTS.md`,
`CLAUDE.md`, this file, then the numbered SQL migrations before editing.
Keep this guide and the D1 `project_documentation` / `handoff` row current
after every relevant change. Update version, timestamp, actual status,
validation results, owner decisions and next steps together. Verify the
database copy's SHA-256 against this file. A completed local test, open PR,
merged commit, deployed Worker and successful sheet refresh are separate
states; never substitute one for another.

## Owner requirements and decisions

- One unified Cloudflare D1 database, shared across companies. No table or
  spreadsheet tab per ticker.
- Shared financial tables, with specialized extensions for banks and insurers.
- Keep the existing dashboard's historical performance, assumptions and
  results layout unchanged during database integration.
- Financial amounts come from SEC reports. Keep source filing, unit,
  currency, period and share basis with the facts.
- Calculate ROIC, ROE, margins, TTM totals and valuation ratios from their
  underlying facts with explicit definitions and completeness checks.
  Industry-specific metrics must not silently reuse unsuitable formulas.
- Raw missing facts remain missing. The existing dashboard's rule that
  missing dividend amounts count as zero is a presentation/model policy;
  it does not establish a reported SEC zero.
- Dividend Payer is a separate provider lookup. Provider comparisons retain
  their own definitions and are not SEC facts.
- Preserve the current projection timing: selected years from today,
  without an adjustment for the gap since the latest quarter end.
- Fixed annual dividend dollars per share, with no reinvestment, remain
  the current projection assumption.
- Scripts must not create or restore hover notes.

## Entity and key structure

| Table | Primary key | Relationship and purpose |
|---|---|---|
| companies | company_id | One issuer; unique ten-digit SEC CIK. |
| instruments | instrument_id | Many tickers/share classes/ADRs can reference one company_id. Ticker + exchange is unique. |
| financial_periods | period_id | Company, fiscal year/quarter, actual dates and quarter/annual/YTD/instant type. |
| filings | filing_id | Company plus unique SEC accession, report date, filed date and source URL. |
| financial_facts | fact_id | Metric, value, unit, currency, source tag/context/dimensions and share basis for a period and filing. |
| bank_period_metrics | period_id + filing_id | Bank extension for a common company/period/filing. |
| insurance_period_metrics | period_id + filing_id | Insurance extension for a common company/period/filing. |
| schema_migrations | version | Applied numbered database migrations. |
| project_documentation | document_key | Versioned instructions; `handoff` stores this guide and its checksum. |

The company is not the traded instrument. Alphabet's GOOG and GOOGL must
share issuer financials, while retaining distinct ticker/share-class records.
Instrument price and per-share data must use the correct class/ADR basis.
Point-in-time shares outstanding and weighted-average basic/diluted shares
are distinct metrics. Never substitute one silently for another.

Composite foreign keys prevent linking one issuer's facts to another
issuer's period or filing. Fact uniqueness preserves separate filings and
share bases instead of overwriting a historical disclosure with a restatement.
Dates use ISO YYYY-MM-DD, times use UTC ISO strings. Currency is explicit;
store monetary amounts in currency units, counts in shares and ratios as
fractions. Apply XBRL scaling once, before insertion. `dimensions_json`
must be canonical JSON with stable ordering so equivalent contexts deduplicate.

## Import and calculation rules

1. Resolve issuer CIK and instrument identity first.
2. Record the actual SEC filing and fiscal period; preserve fiscal calendars.
3. Validate finite values, units, currency, duration/instant context and issuer.
   Store reported facts with their source tag and share basis. Never convert
   an absent field into a fact with value zero.
4. Quarterize cumulative cash-flow facts using compatible year-to-date
   disclosures; do not sum YTD figures as separate quarters.
5. Preserve later filings/restatements as additional source observations.
   Selecting the applicable version requires an explicit as-of policy.
6. Compute derived metrics only when periods and required inputs are complete.
   FCF means operating cash flow minus cash purchases of property/equipment
   under the existing documented SEC tag rules. Keep point and duration
   measures distinct. ROIC and ROE require an explicit average-capital or
   average-equity definition.
7. Preserve the current Worker JSON schema and Apps Script field order when
   eventually serving the sheet from D1. Compare the database-backed response
   with the existing SEC calculation before switching production reads.

Bank/insurance extensions are a schema foundation, not finished extraction
or calculation support. Their populated fields must also have traceable
underlying `financial_facts` entries. Do not claim these industries are
supported until their imports, definitions and tests are implemented.

## Current status

- The unified schema is defined in `migrations/0001_foundation.sql`.
- Standing documentation maintenance is defined in root `AGENTS.md`.
- Cloudflare returned zero existing D1 databases in this account on
  2026-10-31. The proposed database `active-analyzer-financials` has NOT been
  created. Automatic approval review requires explicit owner approval to
  provision this named persistent resource; no remote SQL was applied.
- Local validation passed with `python database/check_schema.py`: repeat
  migration, multiple share classes, cross-issuer isolation, duplicate
  rejection, restatement preservation, foreign keys and SQLite integrity.
- No financial history has been loaded into D1 by this foundation.
- No D1 binding, ingest endpoint, schedule, admin page or dashboard cutover
  is implemented by this foundation. The existing Worker still supplies SEC
  data to Sheets through the existing refresh flow.
- Worker PR #74 is merged and production-deployed. It fills missing latest
  common shares from primary SEC cover facts, including share-class totals.
  Its 280 tests and the 58-ticker comparison completed; the comparison's
  flagged string changes were newly filled as-of dates, not lost facts.
- Fifty-eight historical/annual sheet formulas were updated from retired
  J2 to the Basic/Diluted dropdown at I2, with both modes checked.
- The current sheet has loaded GOOGL's recovered 12,294,000,000 shares as of
  2026-10-21 after refresh. GOOGL TTM FCF is $19.747B through 2026-09-30;
  the previous TTM through 2026-06-30 is $53.273B. These are reference
  checks, not permanent current-market facts.
- Five-year Price/FCF remains diluted and excluded from the basis control,
  as previously deferred by the owner. Do not expand that scope unasked.

## Safe continuation checklist

1. Read this guide from GitHub and D1; verify version and checksum. Inspect
   actual schema/migration rows and current bindings rather than assuming
   that a prior model's intended next step was completed.
2. Make additive numbered migrations. Do not rewrite an already applied
   migration, drop data, or recreate the database as a shortcut.
3. Keep credentials in provider secrets, never in this guide or SQL files.
4. Validate source identity, cross-company isolation, deduplication,
   restatement preservation, units, quarter boundaries and missing values.
5. For Worker changes run `npm test` and the repository live SEC audits.
   Preserve ticker changes, refresh, annual-only issuers and the dashboard.
6. Update this guide and the D1 documentation row in the same work item.
   Record exact tests and live checks, limitations and next steps.
7. Merge only when the owner explicitly asks and relevant checks pass.
   Confirm deployment separately from merge and refresh separately from both.

## Next steps

Obtain approval to create `active-analyzer-financials`, apply migration 0001,
record its returned database ID in `deployment.json`, store this guide as the
`project_documentation` row keyed `handoff` with its version and SHA-256, and
verify the remote schema and documentation checksum. Until then the database
copy of these instructions is pending, not current.

Implement and test an idempotent SEC ingestion adapter mapping existing
validated Worker data and provenance into these shared tables. Start with
GOOGL and a dividend payer, then bank/insurance fixtures and annual-only
foreign issuers. Record exact metric definitions and reconcile all stored
facts before adding the D1 Worker binding or switching any dashboard reads.
The requested searchable/private read-only admin view is still a future step.

## Infrastructure record

Repository: raffialwasof1999-sketch/Analizer42worker.
Worker: analyzer42-sec. Schema contract: AA_SEC_V3.
Spreadsheet: 1ryLKPxrVoxSVhac7HpVR_l8ARSjn0E65DhTz082PlXY.
Cloudflare account: bfae19c1263a27502f05bab61037aa2e.
Database name/ID and verified migration status are recorded in `deployment.json`.
