# Active Analyzer: worker, Apps Script and sheet

Three parts work together. **Every change must stay compatible with all
three and survive both a refresh and a ticker change.** Before any change,
check it against `apps-script/Code.gs` and this file, and say how it was
checked.

| Part | Where | How it changes |
|---|---|---|
| Cloudflare Worker (SEC data) | `src/` | PR → merge → Cloudflare deploys |
| Apps Script bound to the sheet | `apps-script/` | PR → merge → `.github/workflows/apps-script-deploy.yml` uploads it (backup first, verified after). Never edit in Google's editor: the next deploy refuses to overwrite an out-of-band edit |
| Google Sheet "Active Analyzer 10" (`1ryLKPxrVoxSVhac7HpVR_l8ARSjn0E65DhTz082PlXY`) | Google Sheets connector | Direct edits; verify after a refresh |

Merging is done by the owner; this session cannot merge. Whenever asking the
owner to merge, give the full PR link.

## What every refresh (and ticker change) overwrites

Both run `refreshStockAnalyzer()` in `apps-script/Code.gs`.

- **Financial Data** columns A:AE, rows 2+ (`AA_ANNUAL_FIELDS`), and
  **Quarterly Data** columns A:Y, rows 2+ (`AA_QUARTER_FIELDS`), plus Z1/Z2
  (import time) and Z3:Z10 (`reportingCurrency` / currency code,
  `dataBasis` / `annual` or `quarterly`, `sharesOutstanding` /
  `sharesOutstandingAsOf`: cover-page ordinary shares, annual mode only). Cleared and rewritten, with
  number formats.
- **Analyzer** B4 (company), E2 (exchange), B6 (unticked), the **B7
  formula** (`aaStatusFormula_`), and the **notes on F2-F7, C5 and A7**
  (`aaHeaderNotes_`).

Changing any of these in the sheet alone is undone by the next refresh:
change the script instead (and the sheet, for an immediate effect).

## What makes every refresh fail

`aaCheckDashboard_` stops the import if any of these change. It checks only
labels next to cells the refresh reads or writes:

- Labels in `AA_LABELS`: A2 `Stock Ticker`, A4 `Company Name`, A6
  `↻ Refresh SEC Data`, A7 `SEC Data Status`, C2 `Exchange`, C5
  `Enterprise Value`, and F2:F7 (the six "Latest ..." labels).
- B6 must stay a checkbox.
- Safety net for the results (not written by the refresh, kept by choice):
  A25:A28 label wording, and E25:G28 formulas must keep referencing their
  inputs (E15/E16/E18/E20, $G$2, $G$6 (also within the B21 share selector), $B$3, $E$3, and the calculated dividend-yield reference...).
- Data-tab header rows must match the field lists; Quarterly Data Z1 is
  `lastImportedAt` or empty.

The dividend-yield reference is resolved by its unique `Dividend Yield (TTM)` or `Dividend Yield (Latest FY)` label in column H; its calculated value must remain next to it in column I. Move complete H:L metric rows together. This avoids a fixed dividend-yield row in the refresh validator.

Renaming or moving any of the other checked cells needs the matching script change in the
same PR. Nothing else is checked: the history table and assumptions
(A3, A12:G20, B13:D13, E24:G24) and the metrics table (H2:J23) can be
renamed or edited in the sheet. To reorder metrics, cut and paste each H
cell together with its I and J cells (never copy, never insert whole rows).

## Safe to change in the sheet

Analyzer H2:L23 (headings, names, formulas, notes), B14:D17, H23+, the
hidden Annual View tab,
rows 29+ (the "NOTES" block, from the worker's `?blankReasons=1`), notes on
cells not listed above, the Historical P/E Data tab, Financial Data AF+ and
Quarterly Data AA+ (one `IMPORTDATA` in AA2, `quarterlyExtrasCsv=1`, fills
AA basic EPS, AB split-adjusted FCF per diluted share, AC net acquisitions).

## Comparison columns J, K, L (sheet only; no script or worker part)

- **J, Google Finance:** the GOOGLEFINANCE formula where it offers the
  figure (J4 P/E, J23 EPS/price, market cap in J6); otherwise `IMPORTXML`
  of google.com/finance/quote/TICKER:EXCHANGE (B2, E2): J6 revenue (last
  four quarters from the income-statement table), J9 net income / revenue,
  J16 the "Dividend" line (a forward-rate yield). Everything else is `N/A`
  (Google never offers it); `-` means no value for this company right now.
- **K, Stock Analysis** and **L, Finviz:** looked up in the hidden **Web
  Data** tab, which fetches each site's page once per ticker (A2: Stock
  Analysis statistics rows, label in A, text in C, number in E; G2: Finviz
  snapshot cells, label then value, number for the label in H). Add a new
  figure by looking it up there rather than adding another `IMPORTXML`.
  Definitions that differ from ours (PEG horizon, ROIC, Stock Analysis's
  annual-rate dividends, Finviz FCF = market cap / P/FCF) are in the notes.
- These read web pages, so a site redesign or block turns cells to `-`.
  Yahoo Finance and Macrotrends block Google Sheets (tested).
- Dividend Yield / Per Share (TTM) in column I sum the last four *filed*
  quarters, so after a dividend change they lag the sites until the next
  report (Nvidia's raise, Whirlpool's cut); that is expected.

## Worker rules (checked by `tests/sheet-compatibility.test.mjs`)

- `VERSION` in `src/index.js` must equal `AA.schema` in `Code.gs`; changing
  it needs a paired script change.
- At most 20 annual and 60 quarterly rows, newest first, no duplicate
  periods; latest revenue and net income must be numbers.
- Every field the script writes must be a finite number or null (dates as
  `YYYY-MM-DD` strings). A string or boolean in one of them fails the
  refresh.
- A new field reaches the sheet only if it is added to the worker's field
  list, the script's field list and the data tab's header row, in one PR.
- Extra response fields are ignored by the script and are safe.
- The IMPORTDATA feeds reuse the
  import's calculation for 5 minutes (`routeRequest` in `src/index.js`);
  four separate calculations per refresh exceeded Cloudflare's resource
  limits. Keep feed output derived from the main JSON. The sheet uses three
  feeds per refresh (four requests with the import): `basicEpsCsv=annual`
  (Financial Data AF2), `quarterlyExtrasCsv=1` (Quarterly Data AA2, three
  columns) and `blankReasons=1` (Analyzer A30). A new quarterly column
  belongs in `QUARTERLY_EXTRAS` (appended), not in a new feed. The single
  feeds (`basicEpsCsv=quarterly`, `fcfPerShareCsv`, `netAcquisitionsCsv`)
  remain for inspection. Each numeric import retries once at `&retry=1` if
  its first fetch fails.
- Historical P/E Data!H4:H31 dates each quarter by Quarterly Data X
  (8-K earnings release), falling back to W (10-Q/10-K filing). Heavy
  filers' older quarters get W from Company Facts
  (`fillFilingDatesFromFacts`).
- Price / FCF (5-Year Avg.) (Analyzer I15): Historical P/E Data P4:P31 =
  Quarterly Data AB (`fcfPerShare`, oldest first), Q = known TTM, R = TTM
  known on each trading date, S = daily price / FCF, R2/S2 = average and
  day count. Same window and checks as the 5-year P/E (I5, columns C/D,
  K2/L2). The tab has 19 columns (A:S).
- Net Acquisitions (5-Year Total) (Analyzer I22) = SUM of Quarterly Data
  AC2:AC21 (`netAcquisitions`), with the ticker-match and 20-consecutive-
  quarter checks. A missing acquisitions/divestitures line counts as $0
  only when safe (`acquisitionsBasis` in `netAcquisitionsQuarter`);
  otherwise the quarter is null and I22 shows "-".
- Sheets caches IMPORTDATA by URL: when a feed's output changes without a
  new import, bump its `&release=` tag.

## Filling unknown ROIC inputs (fills nulls only)

- Total debt 0 when the period's own filing shows no debt of any kind
  (`src/debt-free.js`, The Trade Desk).
- Total debt from the same date in a later 10-Q/10-K, else noncurrent debt
  + principal due within 12 months when no standard current-debt line
  exists (`fillUnknownDebt`, PayPal).
- Pre-tax income = net income + income tax when no pre-tax tag is filed
  (`decorate`, PayPal since 2019).

## Foreign companies (annual mode)

- Issuers that file 20-F/40-F and no 10-K/10-Q (ASML, TSMC, Novo Nordisk,
  SAP, Toronto-Dominion) go through `buildForeignAnnual` (`src/index.js`,
  helpers in `src/foreign-annual.js`): the same `buildAnnual` with the
  us-gaap list (ASML) or `IFRS_TAGS`, in the **reporting currency**
  (the unit with comparatives; TSMC's USD convenience translation loses).
  The response has `dataBasis:'annual'`, `reportingCurrency`,
  `reportingStandard`, `annualReportForm` and `quarterlyFinancials: []`.
- Per-share figures and share counts are put on the newest report's basis
  (`reportBasis`: overlapping years between reports prove a split; Novo
  Nordisk 2023). Shares are ordinary shares, not ADRs (TSMC ADR = 5).
- The script accepts no quarters only with `dataBasis:'annual'` and a
  currency, writes Quarterly Data Y2 = ticker (so ticker checks work) and
  Z3:Z6, and B7 shows the annual status. Converting to US dollars and ADR
  shares is the sheet's job.
- **Sheet side:** E5, G2:G7, the history table B14:D17 and column I
  (I4-I7, I9, I12-I18, I22, I23) are each wrapped as
  `=IF('Quarterly Data'!$Z$6="annual",'Annual View'!$Bn,<US formula>)`,
  so US companies run the unchanged formula. The hidden **Annual View** tab
  holds the annual versions: latest fiscal year x live exchange rate (B4),
  ADR ratio (B9: the editable table at A43:B, else SEC diluted shares /
  (Google market cap / price) within 5% of a clean ratio), market value
  (B19 = price x diluted shares / ratio; Google's market cap is wrong for
  some ADRs, e.g. TSMC), which P/E, P/S, P/FCF, EV and yields use,
  freshness (B7: year ended within 500 days, else valuations show "-"),
  daily 5-year P/E and P/FCF from price and rate history in H:N (shown in
  the Sheets UI only; the API can't read GOOGLEFINANCE history), and the
  history table in B37:D40. The "(TTM)" labels in column H switch to
  "(Latest FY)". A new column-I metric needs an annual branch there too.
- Full-year figures may come from a 6-K (Novo Nordisk files its annual
  report as a 6-K first); the latest filing wins.
- IFRS debt with no Borrowings total is composed from noncurrent bonds +
  bank loans + the larger current line (`composedIfrsDebt`, TSMC).
  us-gaap foreign filers also read `PaymentsOfOrdinaryDividends` (ASML;
  US tag lists unchanged). A year without a per-share dividend uses
  dividends paid / diluted shares (`dividendsPerShareFromPaid` lists them).
  Cover-page shares outstanding (`sharesOutstanding`, summed share classes)
  feed Analyzer G5 through Quarterly Data Z8.
- Known gaps: SEC's data has no TSMC FY2025 yet; Toronto-Dominion also
  files 6-K quarters, which annual mode ignores.

## Checklist for every requested change

1. Which part(s) does it touch? Is any target cell in the overwrite or
   refuse-to-refresh lists above?
2. Script-written cells → change `apps-script/`; layout-checked cells →
   update `AA_LABELS` (or the header checks) in the same PR.
3. Worker change → `npm test` (includes the compatibility test) and the
   live coverage audit on the PR.
4. After merging or editing: refresh the sheet **and** change the ticker
   once (then back), and confirm the change is still there.
