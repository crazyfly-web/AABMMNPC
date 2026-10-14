import assert from 'node:assert/strict';
import {
  DRAWDOWN_CONFIG,currentLevel,crossedUntriggeredLevels,cumulativeAllocation,nextUntriggeredLevel,distanceToNextLevel,splitAdjustSeries,normalizePriceScaleSeries,findSuspiciousDiscontinuity,simulateDrawdownHistory,buildHistoryWindows,mergeHistoricalParts,historyDensityStats,historySourceIsSufficient,finalizedMarketBars,needsSameDayCorrection,replayCorrectedDrawdownDay
} from '../src/drawdown-domain.js';

const approx=(actual,expected,tol=0.02,msg='')=>assert.ok(Math.abs(actual-expected)<=tol,`${msg} expected ${expected}, got ${actual}`);
const bars=prices=>prices.map((close,i)=>({date:`2026-01-${String(i+1).padStart(2,'0')}`,close}));

// ATH
let s=simulateDrawdownHistory('VOO',bars([100,105]));
assert.equal(s.ath,105); assert.equal(s.ath_date,'2026-01-02'); approx(s.current_drawdown_pct,0);

// Normal Drawdown
s=simulateDrawdownHistory('VOO',bars([105,100]));
approx(s.current_drawdown_pct,-4.7619,0.01);assert.equal(s.current_level,'NORMAL');assert.deepEqual(s.triggered_ids,[]);

// BUY1
s=simulateDrawdownHistory('VOO',bars([100,89]));
assert.equal(s.current_level,'BUY1');assert.deepEqual(s.triggered_ids,['BUY1']);assert.equal(s.cumulative_allocation_pct,10);

// Gap through multiple levels: 100 -> 79 crosses -10,-15,-20.
s=simulateDrawdownHistory('VOO',bars([100,79]));
assert.equal(s.current_level,'BUY3');assert.deepEqual(s.triggered_ids,['BUY1','BUY2','BUY3']);assert.equal(s.cumulative_allocation_pct,45);assert.equal(s.trigger_events.length,3);

// Recovery preserves triggered BUY1.
s=simulateDrawdownHistory('VOO',bars([100,89,96]));
assert.equal(s.current_level,'RECOVERED');assert.deepEqual(s.triggered_ids,['BUY1']);assert.equal(s.cumulative_allocation_pct,10);

// Revisit must not trigger BUY1 twice.
s=simulateDrawdownHistory('VOO',bars([100,89,96,89]));
assert.deepEqual(s.triggered_ids,['BUY1']);assert.equal(s.trigger_events.filter(x=>x.level_id==='BUY1').length,1);

// New ATH resets the entire cycle.
s=simulateDrawdownHistory('VOO',bars([100,89,101]));
assert.equal(s.ath,101);assert.equal(s.ath_date,'2026-01-03');assert.equal(s.current_level,'NORMAL');assert.deepEqual(s.triggered_ids,[]);assert.equal(s.cumulative_allocation_pct,0);

// Cycle Low Recovery: 100 -> 75 -> 84.
s=simulateDrawdownHistory('VOO',bars([100,75,84]));
approx(s.current_drawdown_pct,-16,0.001);approx(s.recovery_from_low_pct,12,0.001);assert.notEqual(s.current_drawdown_pct,s.recovery_from_low_pct);

// Split: a 2:1 split must not create fake -50% DD.
const splitAdjusted=splitAdjustSeries([
  {date:'2026-01-01',close:100},{date:'2026-01-02',close:104},{date:'2026-01-03',close:52},{date:'2026-01-04',close:53}
],[{date:'2026-01-03',numerator:2,denominator:1}]);
assert.deepEqual(splitAdjusted.map(x=>x.close_split_adjusted),[50,52,52,53]);
s=simulateDrawdownHistory('VOO',splitAdjusted.map(x=>({date:x.date,close:x.close_split_adjusted})));
approx(s.current_drawdown_pct,0);assert.deepEqual(s.triggered_ids,[]);

// Reverse split: 1:10 must not create fake +900% regime discontinuity.
const reverseAdjusted=splitAdjustSeries([
  {date:'2026-01-01',close:10},{date:'2026-01-02',close:9.5},{date:'2026-01-03',close:95},{date:'2026-01-04',close:96}
],[{date:'2026-01-03',numerator:1,denominator:10}]);
assert.deepEqual(reverseAdjusted.map(x=>x.close_split_adjusted),[100,95,95,96]);
s=simulateDrawdownHistory('VOO',reverseAdjusted.map(x=>({date:x.date,close:x.close_split_adjusted})));
approx(s.current_drawdown_pct,-4);assert.deepEqual(s.triggered_ids,[]);

// Adaptive normalization: declared split is applied when raw close shows the matching scale break.
let norm=normalizePriceScaleSeries([
  {date:'2024-03-05',close:600},{date:'2024-03-06',close:606},{date:'2024-03-07',close:202},{date:'2024-03-08',close:204}
],[{date:'2024-03-07',numerator:3,denominator:1}]);
assert.deepEqual(norm.bars.map(x=>x.close_split_adjusted),[200,202,202,204]);
assert.equal(norm.normalizations[0].action,'applied');

// If the provider already returns split-normalized close, do not double-adjust it.
norm=normalizePriceScaleSeries([
  {date:'2024-03-05',close:200},{date:'2024-03-06',close:202},{date:'2024-03-07',close:202},{date:'2024-03-08',close:204}
],[{date:'2024-03-07',numerator:3,denominator:1}]);
assert.deepEqual(norm.bars.map(x=>x.close_split_adjusted),[200,202,202,204]);
assert.equal(norm.normalizations[0].action,'already_adjusted');

// Missing provider metadata: a persistent ~4:1 scale break can be repaired, but is labelled
// as a provider scale break rather than claimed to be a real corporate action.
norm=normalizePriceScaleSeries([
  {date:'2013-12-31',close:200},{date:'2014-01-01',close:204},{date:'2014-01-02',close:50.8},{date:'2014-01-03',close:51.2}
],[]);
assert.ok(Math.abs(norm.bars[1].close_split_adjusted-51)<1e-9);
assert.equal(norm.normalizations.at(-1).type,'provider_scale_break');
assert.equal(findSuspiciousDiscontinuity(norm.bars.map(x=>({date:x.date,close:x.close_split_adjusted}))),null);

// A real large market drawdown that does not resemble a common split ratio must NOT be normalized away.
norm=normalizePriceScaleSeries([{date:'2026-01-01',close:100},{date:'2026-01-02',close:58}],[]);
assert.equal(norm.normalizations.length,0);
assert.ok(findSuspiciousDiscontinuity(norm.bars.map(x=>({date:x.date,close:x.close_split_adjusted}))));

// Missing split metadata should be detected as a suspicious discontinuity instead of silently triggering a crash ladder.
const missingSplit=[{date:'2026-01-01',close:104},{date:'2026-01-02',close:52}];
assert.ok(findSuspiciousDiscontinuity(missingSplit));
assert.equal(findSuspiciousDiscontinuity([{date:'2026-01-01',close:100},{date:'2026-01-02',close:82}]),null);

// Exact threshold boundaries.
const expected={
  SOXX:[[-14.9,null],[-15,'BUY1'],[-22,'BUY2'],[-30,'BUY3'],[-38,'BUY4'],[-48,'BUY5'],[-60,'CRISIS']],
  QQQ:[[-11.9,null],[-12,'BUY1'],[-18,'BUY2'],[-25,'BUY3'],[-32,'BUY4'],[-40,'BUY5'],[-50,'CRISIS']],
  '0050':[[-9.9,null],[-10,'BUY1'],[-15,'BUY2'],[-20,'BUY3'],[-25,'BUY4'],[-30,'BUY5'],[-40,'CRISIS'],[-50,'EXTREME']],
  VOO:[[-9.9,null],[-10,'BUY1'],[-15,'BUY2'],[-20,'BUY3'],[-25,'BUY4'],[-30,'BUY5'],[-40,'CRISIS']]
};
for(const [asset,cases] of Object.entries(expected))for(const [dd,id] of cases)assert.equal(currentLevel(asset,dd)?.id||null,id,`${asset} ${dd}%`);

// Distance is percentage points, not relative price percent.
assert.equal(distanceToNextLevel(-20.6,{threshold:-22}),1.3999999999999986);
approx(distanceToNextLevel(-20.6,{threshold:-22}),1.4,1e-9);

// Untriggered crossing and allocation ledger semantics.
assert.deepEqual(crossedUntriggeredLevels('VOO',-21,['BUY1']).map(x=>x.id),['BUY2','BUY3']);
assert.equal(cumulativeAllocation('VOO',['BUY1','BUY2','BUY3']),45);
assert.equal(nextUntriggeredLevel('VOO',['BUY1','BUY2','BUY3']).id,'BUY4');

// Locked V1 allocation totals.
for(const [asset,cfg] of Object.entries(DRAWDOWN_CONFIG))assert.equal(cfg.levels.reduce((a,x)=>a+x.allocationPct,0),100,`${asset} reserve ladder must total 100%`);


// Segmented history helpers: windows must cover the requested range without overlap gaps.
const windows=buildHistoryWindows('2004-01-01','2026-01-01',4);
assert.equal(windows[0].start,'2004-01-01');assert.equal(windows.at(-1).end,'2026-01-01');
for(let i=1;i<windows.length;i++)assert.equal(windows[i-1].end,windows[i].start);

// Merging overlapping chunks must de-duplicate dates and split events.
const merged=mergeHistoricalParts([
  {bars:[{date:'2020-01-02',close:10},{date:'2020-01-03',close:11}],splits:[{date:'2020-01-03',numerator:2,denominator:1}]},
  {bars:[{date:'2020-01-03',close:11},{date:'2020-01-06',close:12}],splits:[{date:'2020-01-03',numerator:2,denominator:1}]}
]);
assert.deepEqual(merged.bars.map(x=>x.date),['2020-01-02','2020-01-03','2020-01-06']);assert.equal(merged.splits.length,1);

// A true weekday-like daily sequence passes density; monthly/sparse history fails.
const dense=[];for(let d=new Date('2020-01-01T00:00:00Z');d<new Date('2022-01-01T00:00:00Z');d.setUTCDate(d.getUTCDate()+1)){const day=d.getUTCDay();if(day!==0&&day!==6)dense.push({date:d.toISOString().slice(0,10),close:100})}
assert.equal(historyDensityStats(dense).ok,true);
const sparse=[];for(let m=0;m<24;m++){const d=new Date(Date.UTC(2020,m,1));sparse.push({date:d.toISOString().slice(0,10),close:100})}
assert.equal(historyDensityStats(sparse).ok,false);


// Historical source gate: dense 20y+ OR dense complete inception history.
assert.equal(historySourceIsSufficient({densityOk:true,coverageYears:22,inceptionComplete:false}),true);
assert.equal(historySourceIsSufficient({densityOk:true,coverageYears:16,inceptionComplete:true}),true); // VOO
assert.equal(historySourceIsSufficient({densityOk:true,coverageYears:17.7,inceptionComplete:true}),true); // 0050
assert.equal(historySourceIsSufficient({densityOk:true,coverageYears:16,inceptionComplete:false}),false);
assert.equal(historySourceIsSufficient({densityOk:false,coverageYears:30,inceptionComplete:true}),false);

// Provisional candles must not enter the persisted closing-price ladder.
const recentBars=[{date:'2026-10-13',close:100},{date:'2026-10-14',close:99}];
assert.deepEqual(finalizedMarketBars(recentBars,'US',new Date('2026-10-14T19:30:00Z')).map(x=>x.date),['2026-10-13']); // 15:30 EDT
assert.deepEqual(finalizedMarketBars(recentBars,'US',new Date('2026-10-14T21:01:00Z')).map(x=>x.date),['2026-10-13','2026-10-14']); // 17:01 EDT
assert.deepEqual(finalizedMarketBars([{date:'2026-12-14',close:99}],'US',new Date('2026-12-14T21:30:00Z')),[]); // 16:30 EST
assert.equal(finalizedMarketBars([{date:'2026-12-14',close:99}],'US',new Date('2026-12-14T22:01:00Z')).length,1); // 17:01 EST
assert.deepEqual(finalizedMarketBars(recentBars,'TW',new Date('2026-10-14T05:55:00Z')).map(x=>x.date),['2026-10-13']); // 13:55 TST
assert.equal(finalizedMarketBars(recentBars,'TW',new Date('2026-10-14T06:06:00Z')).length,2); // 14:06 TST
assert.equal(finalizedMarketBars([{date:'2026-10-15',close:99}],'US',new Date('2026-10-14T22:00:00Z')).length,0); // future candle

// A revised close with the SAME trade date must trigger correction.
assert.equal(needsSameDayCorrection({trade_date:'2026-10-14',close:532.41},[{date:'2026-10-14',close:519.42}]),true);
assert.equal(needsSameDayCorrection({trade_date:'2026-10-14',close:532.41},[{date:'2026-10-14',close:532.41}]),false);
assert.equal(needsSameDayCorrection({trade_date:'2026-10-14',close:532.41},[{date:'2026-10-13',close:519.42}]),false);

// Replay from the previous day, preserving historical triggers and cycle low.
const previous={ath:100,ath_date:'2026-01-01',cycle_low:80,cycle_low_date:'2026-01-02',max_cycle_drawdown_pct:-20};
let corrected=replayCorrectedDrawdownDay('SOXX',previous,'2026-01-03',79,['BUY1']);
approx(corrected.current_drawdown_pct,-21);
assert.equal(corrected.newCycle,false);assert.equal(corrected.newHits.length,0);
assert.equal(corrected.cumulative_allocation_pct,10);
corrected=replayCorrectedDrawdownDay('SOXX',previous,'2026-01-03',75,['BUY1']);
approx(corrected.current_drawdown_pct,-25);
assert.deepEqual(corrected.newHits.map(x=>x.id),['BUY2']);
assert.equal(corrected.cumulative_allocation_pct,25);
assert.equal(corrected.cycle_low,75);
corrected=replayCorrectedDrawdownDay('SOXX',previous,'2026-01-03',105,['BUY1']);
assert.equal(corrected.newCycle,true);assert.equal(corrected.ath,105);
assert.equal(corrected.cumulative_allocation_pct,0);
corrected=replayCorrectedDrawdownDay('SOXX',previous,'2026-01-03',88,['BUY1']);
assert.equal(corrected.current_level,'RECOVERED');assert.equal(corrected.cycle_low,80);
assert.equal(corrected.cumulative_allocation_pct,10);

console.log('PASS: Drawdown Engine regression tests');
console.log('ATH / gap / recovery / revisit / new ATH reset / cycle-low recovery / split / reverse split / threshold boundaries all passed.');
