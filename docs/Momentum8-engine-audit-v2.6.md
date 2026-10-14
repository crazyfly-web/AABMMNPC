# Momentum 8 Engine Audit - v2.6

## 1. Executive finding

The current Momentum score is broadly fit for its purpose: it answers trend strength. The structural defect is primarily in Entry. Entry starts from 82, adds +8 for a very wide -3% to +8% band around the 20-day moving average, penalizes only distance from the 20-day average, uses daily stochastic for overheat, and contains no explicit support-distance or reward/risk calculation. As a result, a strong but extended stock can remain in the 80s.

The new Entry model is independent of Momentum score. It uses ATR-normalized location, support proximity, visible resistance/reward-risk, volume behavior, weekly stochastic position, and setup stage. Momentum itself remains unchanged to avoid changing a component that has not shown a structural failure.

## 2. Current Momentum formula (0-100)

### Trend structure - max 25
- Price > 20MA: +6
- Price > 60MA: +6
- 20MA > 60MA: +5
- 60MA > 200MA: +4
- Current 20MA > average close of the 20-day block ending five sessions ago: +4

### Relative strength vs QQQ - max 25
`relative = clamp(12.5 + 0.70 * RS20 + 0.35 * RS60, 0, 25)`

RS20 = ticker 20-session return - QQQ 20-session return.
RS60 = ticker 60-session return - QQQ 60-session return.

### Breakout / proximity to 20-day high - max 20
`breakout = clamp(14 + 0.8 * distanceHigh20Pct, 0, 20)`
If price is within 2% of the rolling 20-day high, score is floored at 17.

Note: because the rolling high includes the current bar, distanceHigh20Pct normally cannot be positive. This means the practical breakout score is mostly a near-high score, not a true post-breakout score.

### Volume / daily direction - max 15
`volume = clamp(7 + max(0, volumeRatio20 - 1) * 5 + (upDay ? 3 : -3), 0, 15)`

### Stochastic momentum - max 15
The variable was historically named `weekly`, but the actual implementation uses daily 9-day stochastic smoothed K/D:
`dailyMomentum = clamp(7.5 + 0.35*(K-D) + 0.12*(K-50), 0, 15)`

### Final Momentum
`Momentum = round(clamp(trend + relative + breakout + volume + dailyMomentum, 0, 100))`

## 3. Current Entry formula

Entry starts at 82:
- subtract 2.2 points for every percentage point that price is more than 5% above 20MA.
- subtract 1.5 points for every percentage point that price is more than 5% below 20MA.
- within 1% of rolling 20-day high: -8.
- daily RSV > 90: -8.
- daily K > 85: -5.
- price < 60MA: -10.
- Momentum < 55: -8.
- distance from 20MA between -3% and +8%: +8.
- volume ratio > 1.2 and up day: +4.
- final score clamped to 0-100.

## 4. Overlap audit

| Factor | Momentum | Old Entry | Audit finding |
|---|---|---|---|
| Price above 20/60/200MA | direct | indirectly via p<60MA / 20MA band | overlap exists, but Entry effect was too permissive |
| 20MA > 60MA / MA direction | direct | no direct score | no direct duplicate |
| Near recent high | direct + strong floor | -8 only inside 1% | same observation used with opposite intent, but Entry penalty is too small/discontinuous |
| Daily RSV/KD | positive when K strong/rising | penalty only at RSV>90 or K>85 | overlap and threshold mismatch; misses weekly extension |
| Relative strength | up to 25 | none | correctly separated |
| Momentum score | output | -8 only if Momentum<55 | direct coupling; weak trends are penalized, high Momentum is not explicitly rewarded |
| Volume | participation score | +4 only on high-volume up day | overlap, but old Entry has no low-volume breakout penalty |

The main issue is not that every shared market fact must be removed from Entry. The issue is that shared facts must answer a different question. In the new design, moving averages in Entry are used only to locate support/risk, not to reward trend strength.

## 5. PLTR old 87 / 85 reconstruction

Snapshot supplied: P=186.38, 20MA=174.059, 60MA=142.7598, 200MA~150, 20-day/nearby high=188.37, volume ratio to 20-day average ~0.451, weekly RSV=97.177, weekly K=88.095, weekly D=73.691.

The current engine uses DAILY stochastic, not the supplied weekly stochastic. Reconstructing the recent daily stochastic from Yahoo OHLC yields approximately daily RSV 89.78, K 80.33, D 72.15. That distinction explains why the old Entry does not apply the weekly-overheat penalties.

### Momentum
- Trend: 21/25 (price>20MA +6, price>60MA +6, 20MA>60MA +5, 60MA>200MA +0, 20MA rising +4)
- Relative strength: 25/25 (capped; PLTR's 20-day relative performance vs QQQ is already large enough to hit the cap)
- Breakout/near-high: 17/20 (within 2% of rolling high)
- Volume/direction: 10/15 (volume below 20D average, but positive day still adds +3 to the base 7)
- Daily stochastic momentum: about 14/15
- Total: ~87 -> 87

### Entry
Distance above 20MA = about +7.08%.
- base: 82
- >5% above 20MA penalty: -(7.08-5)*2.2 = -4.58
- within 1% of high: 0, because the observed distance is about -1.06%, just outside the hard threshold
- daily RSV >90: 0 (daily RSV ~89.78)
- daily K >85: 0 (daily K ~80.33)
- below 60MA: 0
- Momentum <55: 0
- inside -3% to +8% from 20MA: +8
- high-volume up-day bonus: 0
- total: 82 - 4.58 + 8 = 85.42 -> 85

This is the root-cause demonstration: weekly extension is invisible to Entry; 7.08% above 20MA still receives the broad +8 proximity bonus; the high-price penalty is only ~4.6; and being 1.06% below the recent high avoids the entire -8 pressure penalty.

## 6. New Entry architecture (0-100)

Entry no longer reads Momentum score.

### A. Trend integrity - 20
Purpose: prevent a broken trend from receiving a very high Entry merely because price is low.
- price >= 20MA: 4
- price >= 60MA: 4
- price >= 200MA: 3
- 20MA >= 60MA: 3
- 20MA slope positive: 3
- 60MA slope positive: 3

### B. ATR-normalized location - 25
ATR14 is calculated from true range. Distance to 20MA and 60MA is measured in ATR units. The 20MA component is non-linear: maximum score is near support; score decays rapidly after 1.5-2.25 ATR of extension. 60MA and 200MA add smaller structural location points.

### C. Effective support proximity - 15
Nearest valid support is selected from 20MA, 60MA, 200MA, recent 10-day low, and a prior breakout level when it is below price. Score decreases non-linearly as the support distance expands in ATR units.

### D. Visible reward/risk - 15
Risk uses the nearest support with a 0.35 ATR failure buffer. Reward uses the nearest visible prior 20/50-day high above price; if the stock has already broken out, an ATR-based reward allowance is used. Score is based on reward/risk ratio.

### E. Volume quality - 10
- Near resistance or on breakout: higher volume is rewarded, low volume is penalized.
- On pullback/retest: lower volume is rewarded.
- Away from those stages: neutral participation scale.

### F. Weekly stochastic position - 10
Weekly bars are aggregated from daily Yahoo data, then a 9-week stochastic is calculated. High levels are not a Momentum penalty, but they reduce Entry because they represent extension. RSV >95 and K >85 are therefore meaningful to Entry.

### G. Setup stage - 5
Highest score: healthy 20MA pullback, confirmed breakout, or low-volume retest. Lower score: pre-breakout. Extended or structurally broken setups receive low stage scores.

### Conditional caps
Caps require combinations of conditions and are applied after the component score:
- weekly RSV >95 AND price >20MA by >1.5 ATR: max 65.
- price >60MA by >5 ATR AND >20MA by >1.25 ATR: max 65.
- within 0.75 ATR of visible resistance AND volume ratio <0.8: max 60.
- breakout with volume ratio <0.9 and no retest: max 65.
- >3 ATR above 20MA or >8 ATR above 60MA: max 50.
- below 60MA while 20MA<60MA: max 45.

## 7. PLTR under the new Entry model

Using ATR14 around 6.79 from the recent OHLC sequence and the supplied weekly data:
- trend integrity: 20/20
- ATR location: 13/25 (about +1.81 ATR vs 20MA; +6.42 ATR vs 60MA)
- support proximity: 7/15 (20MA about 1.81 ATR below)
- reward/risk: 3/15 (188.37 resistance only about 0.29 ATR above versus >2 ATR structural downside)
- volume quality: 2/10 (near resistance with volume ratio ~0.45)
- weekly position: 2/10 (weekly RSV 97.177, K 88.095)
- setup stage: 3/5 (extended/late-stage rather than low-risk retest)
- raw Entry: 50
- conditional cap: 60 (near resistance + weak volume; weekly extension)
- final Entry: 50

Momentum remains approximately 87. State becomes Extended because Momentum >=80 while Entry <=60.

## 8. Regression validation fixtures

These are deterministic scenario fixtures designed around the named market states. PLTR uses the supplied live snapshot; the other rows are regression fixtures representing the requested state, not claims of exact live D1 values.

| Symbol/state | Old Entry | New Entry | Expected semantic result |
|---|---:|---:|---|
| PLTR - strong / extended | 85 | 50 | high Momentum, low-to-mid Entry |
| GLD - strong / extended | 79 | 57 | trend strong, chasing less attractive |
| MSFT - strong near support | 90 | 95 | high-quality low-risk setup |
| GOOGL - early turn | 90 | 85 | early strength near support can score high |
| SOXX - pullback/base | 90 | 91 | healthy pullback can retain high Entry |
| META - broken / oversold | 64 | 45 | falling price does not auto-create a great Entry |
| VOO - low-volatility steady rise | 90 | 86 | normal uptrend can remain medium-high Entry |
| MU - high-volatility support retest | 90 | 95 | ATR normalization avoids unfair fixed-% treatment |

## 9. Boundary tests

Automated assertions cover:
- PLTR old Entry reconstructs exactly 85.
- PLTR new Entry stays in 48-60.
- broken-trend fixture cannot exceed 45.
- healthy support/retest fixtures can exceed 80.
- low-volatility ETF fixture remains in the medium-high range.
- high-volatility stock near support is not penalized merely for a larger absolute percentage move.

## 10. Change boundary

Production changes are restricted to:
- Entry calculation and supporting ATR/weekly/support/reward-risk helpers.
- State classification threshold for `Extended` so high Momentum + low Entry can be represented correctly.
- linked manual content is refreshed so documentation does not become stale.

No changes are made to:
- Yahoo/TWSE update schedules or fetch routes.
- D1 schema or migrations.
- transaction/wealth data.
- UI layout or CSS.
- portfolio/accounting calculations.
- Momentum score formula itself.
