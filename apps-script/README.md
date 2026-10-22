# Active Analyzer Apps Script

The Google Apps Script bound to the **Active Analyzer 10** spreadsheet
(Script ID `1OjO2rJxCB6jXC5BMeb-JxyvUx4pcdzwcJh16eHFzJIfGQvo3GJW8doab`).
It imports the Cloudflare Worker's SEC data into the sheet when the ticker
changes or "↻ Refresh SEC Data" is ticked.

| File | What it does |
|---|---|
| `Code.gs` | Menu, refresh (`refreshStockAnalyzer`), ticker-edit trigger, validation and writes to Financial Data / Quarterly Data, the SEC Data Status formula in Analyzer!B7 (`aaStatusFormula_`) and the hover notes on F2–F7, C5 and A7 (`aaHeaderNotes_`) |
| `TickerSearch.gs` | "Ticker Search" menu: loads Nasdaq Trader's public symbol lists and sets Analyzer!B2 |
| `TickerSearch2.html` | The ticker search sidebar |

## Keeping GitHub and Google in sync

The live copy is the one in Google's Apps Script editor; the sheet does not
run code from GitHub. Sync is manual:

1. Edit and save in the Apps Script editor (Extensions → Apps Script).
2. Paste the changed file over the copy here, in the same pull request as
   any related Worker change.

Cells the refresh rewrites every time — B7 and the notes above — must be
changed **in the script**, or the next refresh reverts them. Everything
else on the Analyzer tab (formulas, notes in columns H–J and rows 14–29)
is left alone.

See `docs/apps-script-sync.md` for the planned automated sync.
