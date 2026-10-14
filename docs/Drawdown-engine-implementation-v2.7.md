# Drawdown Buy Ladder Engine — v2.7.1 Implementation Report

## Scope

Added an independent `回撤加碼 / Drawdown` tab for 0050, S&P 500, Nasdaq-100 and SOXX. The existing Momentum / Entry formulas are unchanged. The only shared-market-data change is refactoring the Yahoo chart fetcher so Drawdown can request a different historical range and split events while Momentum continues to request the same 2-year daily series.

## Data source strategy

Preferred symbols:

- 0050: `0050.TW`
- S&P 500: `^GSPC` (fallback only if needed: `SPY`)
- Nasdaq-100: `^NDX` (fallback only if needed: `QQQ`)
- SOXX: `SOXX`

Every initialized asset stores and exposes its actual `source_symbol`, whether it is a proxy, earliest/latest date, number of rows and coverage in years. A preferred index source is accepted only when it provides ~20 years of history. S&P 500 / Nasdaq-100 proxy fallback is explicit, never silent.

This execution environment cannot make outbound Yahoo requests, so live provider coverage could not be verified here. `npm run probe:drawdown` is included for an explicit source probe on a network-enabled machine. Production initialization performs the same safety check and refuses insufficient history rather than silently creating an incorrect ATH.

## Price definition and split handling

Drawdown is Price Drawdown, not Total Return.

- Uses raw daily closing price.
- Applies split / reverse-split events only.
- Does not use dividend-adjusted close for ATH / drawdown.
- Rebuilds the asset from complete history when a newly observed split event occurs after the latest stored Drawdown state.
- Adds a discontinuity guard. A very large price jump/drop that remains after split adjustment is treated as suspected missing split metadata and does not silently trigger the ladder.

## Domain model

Thresholds are centralized in `src/drawdown-domain.js`. UI contains no V1 threshold constants.

Each level contains:

- `id`
- `threshold`
- `allocationPct`
- `label`
- `severity`

V1 thresholds and allocation percentages are unchanged from the locked specification.

## Drawdown cycle semantics

A new closing ATH creates a new cycle and re-arms every level.

For every valid daily close:

- `ATH = max(previous ATH, close)`
- `Current DD = close / ATH - 1`
- `Cycle Low = min(close since cycle ATH)`
- `Recovery From Low = close / Cycle Low - 1`
- `Maximum Cycle DD = minimum DD observed during the cycle`

Triggered levels are persisted separately from the current range. Recovery does not un-trigger a level. A revisit cannot trigger the same level again because `(cycle_id, level_id)` is unique.

A gap through multiple levels triggers every crossed, untriggered level. Example S&P 100 → 79 records BUY1, BUY2 and BUY3, cumulative 45%.

## Database changes

Migration: `migrations/0009_drawdown_engine.sql`

New tables:

- `drawdown_sources`
- `drawdown_cycles`
- `drawdown_triggers`
- `drawdown_daily`
- `drawdown_alerts`

No existing Momentum, Wealth or transaction table is altered.

## Update integration

Existing schedules are preserved.

- Taiwan afternoon flow: Wealth TW update → Drawdown 0050 update.
- US morning flow: Momentum / prices update → Drawdown SP500 / NDX / SOXX update → Wealth US update.
- Existing `更新股價` now also updates Drawdown.
- Wealth manual refresh also performs Drawdown refresh.
- Drawdown page includes its own explicit refresh button for diagnostics / first initialization.

Missing trading days and Taiwan/US holiday differences are naturally handled because each asset advances only when its own provider supplies a new trade date. Stale quotes do not overwrite current state.

## Alerts

New levels create one persisted trigger and one alert event. Historical bootstrap reconstructs current-cycle triggers but intentionally does not generate fake “new” alerts for old historical events.

Recent new alerts are shown prominently on the Drawdown page. Gap-through events are grouped by asset in the UI.

## UI

Third navigation tab: `回撤加碼`.

Four independent cards show:

- Current close
- Data date
- ATH and ATH date
- Current drawdown
- Cycle low and date
- Recovery from low
- Maximum drawdown of current cycle
- Current status
- Current-level allocation
- Cumulative allocation
- Remaining reserve
- Next level
- Distance to next level in percentage points
- Triggered levels for the current cycle
- Actual Yahoo source symbol / proxy marker
- History coverage metadata

Mobile uses a single-column card stack; no horizontal scrolling is required to understand the primary state.

## Tests

`npm run test:drawdown`

Regression coverage includes:

- New ATH
- Normal drawdown
- BUY1
- Gap through multiple levels
- Recovery
- Revisit
- New ATH reset
- Cycle-low recovery vs current drawdown
- 2:1 split
- reverse split
- missing split discontinuity guard
- all S&P V1 boundaries
- all Nasdaq-100 V1 boundaries
- all SOXX V1 boundaries
- all 0050 V1 boundaries
- percentage-point distance
- cumulative allocation / next untriggered level
- every ladder totals exactly 100% reserve

Existing Momentum regression was also run separately and still passes.

## Validation performed in this environment

- `node --check src/index.js` — PASS
- `node --check src/drawdown-domain.js` — PASS
- `node --check public/app.js` — PASS
- `npm run test:drawdown` — PASS
- `python3 tests/momentum-entry-regression.py` — PASS
- Fresh SQLite execution of migrations `0001` through `0009` — PASS

Wrangler dry-run could not be completed because package installation / external network access timed out in this environment. No deployment was attempted.

## Deployment precondition

Because v2.7 adds migration `0009_drawdown_engine.sql`, production deployment must apply D1 migration before the Worker is used with the new API.

Recommended local sequence after review:

1. `npm install`
2. `npm run test:drawdown`
3. `python3 tests/momentum-entry-regression.py`
4. `npm run db:remote`
5. `npm run deploy`
6. Open `回撤加碼` or press `更新股價` to initialize history.

This report does not claim deployment was performed.
