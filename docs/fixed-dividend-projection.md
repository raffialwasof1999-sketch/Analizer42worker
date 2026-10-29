# Fixed dividend per-share projection

Approved model: hold the imported trailing dividend dollars per share constant for the selected projection period, paid at each year end, without reinvestment. Calculate the annualized cash-flow return using RATE; do not add dividend yield to price CAGR.

## Rollout

1. Merge and verify Apps Script deployment. The validator remains compatible with the existing dashboard during this step.
2. Read Analyzer!A28 and E28:G28 again, then apply the following formulas in place. Preserve formatting, conditional formatting and other dashboard formulas.
3. Update A28 to `Current Stock Price — Projected Annual Return Including Dividends\n(Fixed Annual Dividend Per Share; No Reinvestment)` and its note to describe annual year-end cash payments and RATE, sourced from I21. Update result-cell notes accordingly.
4. Read back E28:G28 and confirm missing dividends remain a dash. No SEC refresh or ticker change is required for these formula edits. Do not claim a live refresh test before one is performed.

### Analyzer!E28

```excel
=IFERROR(IF(AND(ISNUMBER(E27),ISNUMBER($I$21),$I$21>=0,ISNUMBER($E$3),$E$3>0,ISNUMBER($B$3),$B$3>0,1+E27>0),IF($I$21=0,E27,RATE($B$3,$I$21,-$E$3,$E$3*(1+E27)^$B$3,0,E27)),"-"),"-")
```

### Analyzer!F28

```excel
=IFERROR(IF(AND(ISNUMBER(F27),ISNUMBER($I$21),$I$21>=0,ISNUMBER($E$3),$E$3>0,ISNUMBER($B$3),$B$3>0,1+F27>0),IF($I$21=0,F27,RATE($B$3,$I$21,-$E$3,$E$3*(1+F27)^$B$3,0,F27)),"-"),"-")
```

### Analyzer!G28

```excel
=IFERROR(IF(AND(ISNUMBER(G27),ISNUMBER($I$21),$I$21>=0,ISNUMBER($E$3),$E$3>0,ISNUMBER($B$3),$B$3>0,1+G27>0),IF($I$21=0,G27,RATE($B$3,$I$21,-$E$3,$E$3*(1+G27)^$B$3,0,G27)),"-"),"-")
```

## Verification

All 248 local regression tests passed. Eight temporary native Google Sheets cases were read back and their discounted cash flows independently reconciled: zero dividends, flat terminal price, one-year return, rising terminal price, falling terminal price, missing dividends, zero purchase price, negative dividend. The temporary test tab was removed. Positive and negative return cases matched purchase price to within $0.000001. Missing/invalid cases returned a dash. These validate the formula, not the unresolved SEC evidence retrieval.

The two ten-year positive-dividend examples returned 8.2831940946% with 5% price growth and -3.6586520660% with -10% price growth, from $100 initial cost and $4 annual cash dividends. These are internal verification fixtures, not investment forecasts.
