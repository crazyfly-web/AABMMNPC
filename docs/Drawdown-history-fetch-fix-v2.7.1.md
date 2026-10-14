# Drawdown History Fetch Fix — v2.7.1

## Problem found by source probe

The initial v2.7.0 probe used Yahoo `range=max&interval=1d`. Yahoo returned multi-decade date ranges but only 165–303 rows for some symbols, proving that the response had been downsampled and was not trustworthy daily history for ATH/drawdown initialization.

Observed example:
- ^GSPC: 41.8 years, 169 rows
- ^NDX: 40.9 years, 165 rows
- SOXX: 25.1 years, 303 rows
- 0050.TW: 17.7 years, 214 rows

This is rejected as historical daily coverage.

## v2.7.1 fix

1. `range=max` is now used only to read Yahoo metadata such as `firstTradeDate`.
2. Historical daily bars are fetched with bounded `period1` / `period2` windows, four years at a time, always requesting `interval=1d`.
3. Chunks are merged and de-duplicated by trade date.
4. Split events are merged and de-duplicated separately.
5. Data quality now has a density gate in addition to a year-coverage gate:
   - at least 220 daily rows per covered calendar year;
   - no unexplained gap greater than 14 calendar days;
   - at least 1000 daily rows before initialization.
6. S&P 500 and Nasdaq-100 request roughly 22 years, providing a buffer above the 20-year requirement.
7. 0050 and SOXX request from provider `firstTradeDate` so the engine can verify inception coverage rather than silently treating a partial series as complete.
8. 0050 may pass with full inception history even if an instrument genuinely has less than 20 years; incomplete inception history is rejected.
9. S&P 500 / Nasdaq-100 proxy fallback remains exactly as specified: ^GSPC→SPY and ^NDX→QQQ only after the preferred source fails validation.
10. No Momentum, Entry, threshold, Drawdown UI, D1 schema, or scheduling logic was changed.

## Added regression coverage

Pure tests now verify:
- segmented history windows are contiguous;
- overlapping chunks are de-duplicated;
- split events are de-duplicated;
- dense weekday-like daily data passes validation;
- sparse monthly/downsampled data fails validation.

## Required pre-deployment gate

Run:

```bash
npm run probe:drawdown
```

Every production source must report `PASS` with thousands of daily rows and healthy rows/year density. If any asset reports `FAIL` or `WARNING`, do not run the D1 migration or deploy Drawdown initialization yet.
