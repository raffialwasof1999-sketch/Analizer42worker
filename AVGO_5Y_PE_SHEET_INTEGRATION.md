# AVGO five-year average P/E: Google Sheets integration (staged; not applied)

The SEC Worker correction in this branch fills AVGO's split-adjusted quarterly **basic** EPS for fiscal 2020 Q4 through 2026 Q3. The production Sheets importer continues to read `?basicEpsCsv=quarterly` on the published Worker, so **do not activate these formulas until the Worker branch has passed live SEC smoke testing and been explicitly approved for production deployment.** Existing annual/quarterly schemas remain unchanged.

## Historical P/E Data ledger

The price window starts in October 2021. To compute TTM basic EPS at that date, we need 2020 Q4 plus 2021 Q1–Q3. The historical ledger currently starts at row 5 (2021 Q1), and its basic TTM and lookup are artificially hardcoded to begin at row 8 (2021 Q4), even though the needed SEC periods exist. Add one baseline quarter in the unused H4, M4 cells and enable N7 (2021 Q3 TTM).

- **H4**: `=IFERROR(DATEVALUE('Quarterly Data'!X25),"")` — FY2020 Q4 original earnings release date, from the SEC-derived disclosure metadata. This date must be present and numeric.
- **M4**: `=IFERROR(IF(ISNUMBER('Quarterly Data'!AA25),'Quarterly Data'!AA25,""),"")` — FY2020 Q4 basic EPS, converted to latest SEC-verified split basis by the Worker. Do not fabricate a value if unavailable.
- **N7**: `=IF(COUNT(M4:M7)=4,SUM(M4:M7),"")` — Basic EPS TTM for 2021 Q3, known September 2021.
- **C5**: Change **both** `$H$8:$H$27` and `$N$8:$N$27` to `$H$7:$H$27` and `$N$7:$N$27` respectively, keeping the existing entire `MAP(A5:A1500,...)` formula. This makes the first 2021 trading dates resolve to 2021 Q3 TTM basic EPS.
- **E5**: Change both instances of `$H$8:$H$27` to `$H$7:$H$27` and the guard `d<$H$8` to `d<$H$7`; keep the existing entire `MAP(A5:A1500,...)` formula.

Leave the `Analyzer!I5` five-year average formula unchanged: it intentionally demands at least 1,000 valid price/EPS ratios and requires both the beginning and end of the five-year range. Do not substitute a provisional average.

## Historical prices: independent transient failure

During verification on October 20, 2026, `'Historical P/E Data'!A4` contained the existing `GOOGLEFINANCE(...,"close",EDATE(TODAY(),-60),TODAY(),"DAILY")` formula wrapped in `IFERROR(...,"")`, but its current calculated spill temporarily returned **no historical price rows**, and `L2=0`. Earlier the same day it returned ~1,250 prices and 463 valid P/E days. This is a separate Google Finance feed/calculation issue; do not publish any five-year P/E value when the price source is empty. Check the underlying unwrapped `GOOGLEFINANCE` error in a scratch **test copy** before changing production formulas.

## Production acceptance criteria

1. Updated production Worker SEC quarterly CSV has numeric basic EPS for AVGO 2020 Q4 through 2026 Q3, including 2021 and 2023 Q4 estimates **clearly labeled in the API audit metadata**. Verify 2024 ten-for-one restatement and no double division.
2. Confirm `'Quarterly Data'!AA25` and all later relevant quarterly cells are numeric once the CSV is refreshed.
3. Confirm `'Historical P/E Data'!A4:B` spills the five years of legitimate Google Finance prices; no substitute or guessed prices.
4. Apply the **H4/M4/N7/C5/E5** ledger changes above, then verify `N7` is numeric, historical `C5:D` spills, `L2>=1000`, and daily ratios exist before `EDATE(TODAY(),-59)` and after `EDATE(TODAY(),-1)`.
5. Only after these checks should `Analyzer!I5` display the genuine five-year daily basic-EPS P/E average. No main merge, Worker production deployment, or live-sheet change is part of this draft.

All main-line data and the current live sheet remain unchanged.
