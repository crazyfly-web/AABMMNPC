# Drawdown ETF Price-Scale Integrity Fix — v2.7.2

## Scope
Only the Drawdown historical/current price-normalization layer and its regression/probe tooling changed. Momentum, Entry, V1 ladder thresholds, UI structure, and D1 schema are unchanged.

## Production finding
v2.7.1 initialized S&P 500 and Nasdaq-100 but rejected 0050 and SOXX at the discontinuity safety gate. 0050 showed a provider-scale break around 2014-01-02 (~-75.1%). SOXX has a declared split event in the Yahoo history and required protection against double-adjustment.

## Fix
`normalizePriceScaleSeries()` now:
1. Applies a declared split only when raw closes exhibit a matching split-scale discontinuity.
2. Leaves already split-normalized raw closes unchanged, preventing double adjustment.
3. Repairs missing-provider-metadata scale breaks only when an extreme discontinuity is within 6% of a common split-like ratio (1:10, 1:5, 1:4, 1:3, 1:2, 2:1, 3:1, 4:1, 5:1, 10:1).
4. Labels inferred repairs `provider_scale_break`; it does not claim they are real corporate actions.
5. Keeps the existing discontinuity safety gate after normalization. A large genuine move that does not match a split-like ratio is still rejected.

Cash dividends remain excluded. Yahoo Adjusted Close is not used as the Drawdown price series.

## External cross-check
BlackRock documents SOXX's 3-for-1 split effective on a split-adjusted basis March 7, 2024. Taiwan Stock Exchange's current 0050 split/reverse-split table reports no split record; therefore the 2014 0050 repair is deliberately classified as a provider historical price-scale break, not a verified fund split.

## Regression
- Declared 3:1 raw split: normalized correctly.
- Provider-already-adjusted 3:1: no double adjustment.
- Missing metadata ~4:1 scale break: repaired and labeled provider_scale_break.
- Genuine -42% move not close to a common ratio: not normalized away; safety gate still catches it.
- Existing Drawdown regression: PASS.
- Existing Momentum/Entry semantic regression: PASS.

No new migration is required after `0009_drawdown_engine.sql`.
