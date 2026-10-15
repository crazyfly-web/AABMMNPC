# big7-portfolio v2.8.3

## Final-close integrity / same-day correction

- US drawdown daily candles are finalized after 17:00 America/New_York; TW after 14:05 Asia/Taipei. Provisional same-day Yahoo chart values are ignored.
- A revised close for the same trading date is reconciled from the previous day's persisted snapshot. The existing D1 daily history and earlier-cycle BUY triggers remain intact.
- If the previous-day snapshot does not exist, the engine rebuilds from complete historical Yahoo daily data merged with the fresh recent chart, so the 24h history cache cannot override a corrected close.
- Recalculate cycle ATH, low, maximum drawdown, and same-day BUY triggers. Keep prior-day alerts and timestamps for still-valid same-day alerts.
- Cards now display the latest successful data-sync time in Taiwan local time.
- An invalid cached admin token is cleared after an authentication failure, allowing a new entry on the next attempt.
- No new D1 migration; existing DB and portfolio ledger are unchanged.
- Run `npm run test:drawdown` before deployment. The release is not deployed automatically by this branch.

# big7-portfolio v2.8.1

Execution Asset Inception Gate Fix: dense daily history passes when it either covers >=19.5 years or reaches the ETF/provider firstTradeDate (inceptionComplete). Probe and production now use one shared domain helper. No D1 migration. Drawdown thresholds/trigger logic/Momentum Entry unchanged.

## v2.7.2 Drawdown Buy Ladder

- Added independent `回撤加碼 / Drawdown` tab for 0050, VOO, QQQ and SOXX.
- Added split-only adjusted Price Drawdown history, cycle state, trigger persistence, alert banners, mobile-first cards and regression tests.
- Added migration `0009_drawdown_engine.sql`.
- Momentum / Entry formulas are unchanged.
- Full implementation report: `docs/Drawdown-engine-implementation-v2.7.md`.

## v2.5.3 Wealth Summary Parity Hotfix

- 目前總資產、投資損益、財富自由目標、尚差的標題與數字，改成與完成度相同的視覺層級。
- 大螢幕使用同級主數字字級；較窄畫面才自動縮小避免溢出。
- Cache-busting 更新至 v2.5.3。

# Capital OS · Big7 v2.4 Wealth Dashboard

本版在 v2.3 Momentum 8 基礎上新增第二活頁「我的資產」。第一活頁的 Momentum 8 + Big7 投資累計維持原功能。

## v2.4 新增
- 財富自由目標與完成度
- 台股 / 美股庫存分開管理
- 美股同時顯示 USD 投資績效、TWD 真實績效與匯率影響
- USD/TWD 每日更新
- 台股收盤價優先使用 TWSE 官方 STOCK_DAY
- 美股收盤價沿用 Yahoo Finance
- 每日正式資產快照與資產成長折線
- 資產配置圖、累積投入、累積損益與匯率影響摘要

## 更新排程（台灣時間）
- 台股：約 14:05（UTC 06:05，週一至週五）
- 美股 / USD-TWD / Momentum 8：約 06:30（UTC 22:30，週一至週五）
- 手動更新只供需要時刷新；歷史曲線以每日 snapshot 為準。

## 部署
```bash
npm install
npm run db:remote
npm run deploy
```

Migration `0006_wealth_dashboard.sql` 只新增 Wealth Dashboard 所需資料表，不刪除既有 Big7 / Momentum 資料。


## v2.4.1 Wealth Transaction Ledger

- Existing v2.4 wealth positions are preserved and migrated into editable `OPENING` records by migration `0007_wealth_transactions.sql`.
- Wealth transactions support dated OPENING / BUY / SELL / DIVIDEND records.
- Every record can be edited; position shares and remaining weighted-average cost basis are recalculated from the ledger.
- SELL reduces position shares/cost basis and adds proceeds to TWD cash when actual TWD proceeds are supplied; US sells without TWD proceeds add USD cash.
- DIVIDEND requires actual received TWD and automatically adds that amount to TWD cash while preserving cumulative dividend history.


## v2.4.2 — Momentum Trail & Wealth Maintenance

- Momentum 8: 5-day score trail, portfolio trail, state hysteresis, Recovering state, 5-day slope/acceleration metadata, improved Daily Brief.
- Yahoo Finance resilience: stable 2-year chart URL, query1/query2 retry/fallback, short backoff, reduced duplicate requests, graceful reuse of previous successful prices on HTTP 429.
- Wealth: privacy mode (amounts hidden, percentages remain), Taiwan/US gain-loss color conventions, zero-share positions hidden/removed, FREE capital-recovery badge, stacked USD/TWD gain amount + percentage.
- Ledger: transaction delete with position/cash recalculation.
- No new D1 migration is required beyond 0007.

## v2.4.3 — Readability Pass

- Enlarged typography across Wealth summary cards, performance cards, allocation legend, Momentum cards, tables, tabs, labels and helper text.
- Uses the existing whitespace inside cards rather than increasing dashboard width.
- Mobile typography is also increased, but with separate caps to avoid unnecessary horizontal overflow.
- No D1 migration and no data-model change are required.


## v2.5.1
- Wealth summary visual hierarchy: total assets and freedom target promoted; FX cards reduced.
- Momentum 8 manual is bundled at `public/docs/Big7_v2.5_Momentum8_使用說明.pdf` and linked from the radar page.


## v2.5.3 UI hotfix
- Wealth summary primary numbers now use explicit classes and larger typography.
- Investment gain and remaining target are split into visual hierarchy lines.
- FX rates are reduced one level.
- CSS/JS URLs include v2.5.3 cache-busting query strings.


## v2.5.5 Responsive Typography
- Wealth summary headline values now use CSS clamp() to scale smoothly with viewport width.
- Desktop keeps the large 52px hierarchy; phone layouts reduce monetary values to about 24–26px as needed.
- FX and Momentum radar headline values also scale responsively.
- No database migration.


## v2.6.0 Momentum / Entry engine audit

- Momentum formula retained after audit.
- Entry rebuilt around ATR-normalized location, support distance, reward/risk, volume confirmation, weekly stochastic position, and setup stage.
- Entry no longer reads Momentum score.
- Extended state can trigger when Momentum >= 80 and Entry <= 60.
- No D1 migration, UI layout, fetch schedule, or wealth/accounting changes.
- Audit: `docs/Momentum8-engine-audit-v2.6.md`
- Regression test: `npm run test:momentum`
