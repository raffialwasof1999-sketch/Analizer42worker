# Active Analyzer Apps Script

The Google Apps Script bound to the **Active Analyzer** spreadsheet
(Script ID `1OjO2rJxCB6jXC5BMeb-JxyvUx4pcdzwcJh16eHFzJIfGQvo3GJW8doab`).
It imports the Cloudflare Worker's SEC data into the sheet when the ticker
changes or "Refresh SEC Data" is ticked.

| File | What it does |
|---|---|
| `Code.gs` | Menu, refresh (`refreshStockAnalyzer`), ticker-edit trigger, validation and writes to Financial Data / Quarterly Data, and the SEC Data Status formula in Analyzer!B7 (`aaStatusFormula_`) |
| `SharedValuation.gs` | Analyzer!D12 shares only valuation multiples while keeping profit/FCF margins and purchase-price results separate; restores legacy merged margins from the saved backup |
| `TickerSearch.gs` | "Ticker Search" menu: loads Nasdaq Trader's public symbol lists and sets Analyzer!B2 |
| `TickerSearch2.html` | The ticker search sidebar |

## Owner requirement: scripts must not write cell notes

Do not create, recreate, or restore Google Sheets cell hover notes on any
tab. This applies to refresh, checkbox toggles, setup, recovery and rollback.
The working **Analyzer** tab must stay free of script-generated hover notes.
Existing notes on **Analyzer with hover notes** are a manually maintained
reference; scripts must leave that tab untouched.

The shared-mode backup retains independent inputs, formulas, labels and
number formats, but no notes. Existing version-1 backups remain compatible:
their old notes are ignored rather than restored. Clearing obsolete notes
on the checkbox's working ranges is allowed; creating new notes is not.

`tests/shared-valuation.test.mjs` checks note-free toggles, legacy-backup
restoration, rollback, reference-tab isolation and all deployable Apps Script
sources for note-writing calls. Ordinary status-cell values, source-code
comments and existing visible dashboard explanations are not hover notes.

## How changes reach the sheet

GitHub is the source of truth. Change a file here in a pull request; the
pull request is syntax-checked and previewed, and **merging deploys it to
the live script automatically** (backup first, verified after). Workflow:
`.github/workflows/apps-script-deploy.yml`.

Avoid editing in Google's Apps Script editor: if the live script no longer
matches GitHub, the next deploy stops instead of overwriting it, and the
edit has to be copied here first.

The refresh updates the company name (B4), exchange (E2), SEC import status
(B7) and supporting data tabs. Dashboard assumptions and calculation
formulas remain owned by the sheet, not the importer.

See `docs/apps-script-sync.md` for details.
