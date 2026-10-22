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

Merging is done by the owner; this session cannot merge.

## What every refresh (and ticker change) overwrites

Both run `refreshStockAnalyzer()` in `apps-script/Code.gs`.

- **Financial Data** columns A:AE, rows 2+ (`AA_ANNUAL_FIELDS`), and
  **Quarterly Data** columns A:Y, rows 2+ (`AA_QUARTER_FIELDS`), plus Z1/Z2
  (import time). Cleared and rewritten, with number formats.
- **Analyzer** B4 (company), E2 (exchange), B6 (unticked), the **B7
  formula** (`aaStatusFormula_`), and the **notes on F2-F7, C5 and A7**
  (`aaHeaderNotes_`).

Changing any of these in the sheet alone is undone by the next refresh:
change the script instead (and the sheet, for an immediate effect).

## What makes every refresh fail

`aaCheckDashboard_` stops the import if any of these change:

- Labels in `AA_LABELS` (A2:A23, C2:C5, F2:F7, H2, J2), I2's text, E24:G24
  `Low|Mid|High`, B13:D13 `1 Year|5 Years|10 Years`.
- **H4:H22 must equal `AA_METRICS` exactly**: no renaming, reordering or
  inserting rows inside it. B6 must stay a checkbox.
- A25:A28 label wording; E25:G28 formulas must keep referencing their
  inputs (E15/E16/E18/E20, $G$2, $G$6, $B$3, $E$3, $I$16...).
- Data-tab header rows must match the field lists; Quarterly Data Z1 is
  `lastImportedAt` or empty.

Renaming or moving any of these needs the matching script change in the
same PR.

## Safe to change in the sheet

Formulas and notes in Analyzer I/J (except I2's text), B14:D17, H23+,
rows 29+ (the "NOTES" block, from the worker's `?blankReasons=1`), notes on
cells not listed above, the Historical P/E Data tab, Financial Data AF+ and
Quarterly Data AA+ (the basic-EPS `IMPORTDATA` columns).

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

## Checklist for every requested change

1. Which part(s) does it touch? Is any target cell in the overwrite or
   refuse-to-refresh lists above?
2. Script-written cells → change `apps-script/`; layout-checked cells →
   update `AA_LABELS` / `AA_METRICS` / formula checks in the same PR.
3. Worker change → `npm test` (includes the compatibility test) and the
   live coverage audit on the PR.
4. After merging or editing: refresh the sheet **and** change the ticker
   once (then back), and confirm the change is still there.
