export const DRAWDOWN_CONFIG = Object.freeze({
  '0050': Object.freeze({
    id: '0050', label: '0050', fullName: '元大台灣50', market: 'TW',
    levels: Object.freeze([
      level('BUY1', -10, 10, 'BUY 1', 'buy1'),
      level('BUY2', -15, 15, 'BUY 2', 'buy2'),
      level('BUY3', -20, 20, 'BUY 3', 'buy3'),
      level('BUY4', -25, 20, 'BUY 4', 'buy4'),
      level('BUY5', -30, 20, 'BUY 5', 'buy5'),
      level('CRISIS', -40, 10, 'CRISIS', 'crisis'),
      level('EXTREME', -50, 5, 'EXTREME', 'extreme')
    ])
  }),
  VOO: Object.freeze({
    id: 'VOO', label: 'VOO', fullName: 'Vanguard S&P 500 ETF', market: 'US',
    levels: Object.freeze([
      level('BUY1', -10, 10, 'BUY 1', 'buy1'),
      level('BUY2', -15, 15, 'BUY 2', 'buy2'),
      level('BUY3', -20, 20, 'BUY 3', 'buy3'),
      level('BUY4', -25, 20, 'BUY 4', 'buy4'),
      level('BUY5', -30, 20, 'BUY 5', 'buy5'),
      level('CRISIS', -40, 15, 'CRISIS', 'crisis')
    ])
  }),
  QQQ: Object.freeze({
    id: 'QQQ', label: 'QQQ', fullName: 'Invesco QQQ ETF', market: 'US',
    levels: Object.freeze([
      level('BUY1', -12, 10, 'BUY 1', 'buy1'),
      level('BUY2', -18, 15, 'BUY 2', 'buy2'),
      level('BUY3', -25, 20, 'BUY 3', 'buy3'),
      level('BUY4', -32, 20, 'BUY 4', 'buy4'),
      level('BUY5', -40, 20, 'BUY 5', 'buy5'),
      level('CRISIS', -50, 15, 'CRISIS', 'crisis')
    ])
  }),
  SOXX: Object.freeze({
    id: 'SOXX', label: 'SOXX', fullName: 'iShares Semiconductor ETF', market: 'US',
    levels: Object.freeze([
      level('BUY1', -15, 10, 'BUY 1', 'buy1'),
      level('BUY2', -22, 15, 'BUY 2', 'buy2'),
      level('BUY3', -30, 20, 'BUY 3', 'buy3'),
      level('BUY4', -38, 20, 'BUY 4', 'buy4'),
      level('BUY5', -48, 20, 'BUY 5', 'buy5'),
      level('CRISIS', -60, 15, 'CRISIS', 'crisis')
    ])
  })
});

function level(id, threshold, allocationPct, label, severity){
  return Object.freeze({id, threshold, allocationPct, label, severity});
}

export function getDrawdownConfig(assetId){
  const cfg=DRAWDOWN_CONFIG[assetId];
  if(!cfg)throw new Error(`Unknown drawdown asset: ${assetId}`);
  return cfg;
}

export function currentLevel(assetId, drawdownPct){
  const cfg=getDrawdownConfig(assetId);
  let hit=null;
  for(const item of cfg.levels){
    if(drawdownPct<=item.threshold+1e-9)hit=item;
    else break;
  }
  return hit;
}

export function crossedUntriggeredLevels(assetId, drawdownPct, triggeredIds=[]){
  const triggered=new Set(triggeredIds);
  return getDrawdownConfig(assetId).levels.filter(x=>drawdownPct<=x.threshold+1e-9&&!triggered.has(x.id));
}

export function cumulativeAllocation(assetId, triggeredIds=[]){
  const triggered=new Set(triggeredIds);
  return getDrawdownConfig(assetId).levels.reduce((sum,x)=>sum+(triggered.has(x.id)?x.allocationPct:0),0);
}

export function nextUntriggeredLevel(assetId, triggeredIds=[]){
  const triggered=new Set(triggeredIds);
  return getDrawdownConfig(assetId).levels.find(x=>!triggered.has(x.id))||null;
}

export function distanceToNextLevel(drawdownPct, nextLevel){
  if(!nextLevel)return null;
  return Math.max(0, drawdownPct-nextLevel.threshold);
}

export function normalizeSplitRatio(split){
  if(Number.isFinite(Number(split?.ratio))&&Number(split.ratio)>0)return Number(split.ratio);
  const numerator=Number(split?.numerator),denominator=Number(split?.denominator);
  if(numerator>0&&denominator>0)return numerator/denominator;
  const text=String(split?.splitRatio||split?.ratioText||'');
  const m=text.match(/^\s*([\d.]+)\s*:\s*([\d.]+)\s*$/);
  if(m&&Number(m[1])>0&&Number(m[2])>0)return Number(m[1])/Number(m[2]);
  return null;
}

// Convert every historical raw close to the most recent share basis.
// Cash dividends are intentionally ignored; only split / reverse-split events alter price history.
export function splitAdjustSeries(bars, splits=[]){
  const validSplits=splits.map(s=>({date:String(s.date).slice(0,10),ratio:normalizeSplitRatio(s)})).filter(s=>/^\d{4}-\d{2}-\d{2}$/.test(s.date)&&s.ratio>0).sort((a,b)=>a.date.localeCompare(b.date));
  return bars.map(bar=>{
    let futureFactor=1;
    for(const split of validSplits)if(split.date>bar.date)futureFactor*=split.ratio;
    return {...bar,close_split_adjusted:Number(bar.close)/futureFactor};
  });
}

// Normalize ETF price-scale changes without using dividend-adjusted close.
// 1) Declared split events are applied only when raw closes actually show the matching scale jump.
//    This avoids double-adjusting providers that already return split-normalized `close`.
// 2) If split metadata is missing, an extreme one-day scale break may be repaired only when the
//    implied ratio is very close to a common split-like ratio. The repair is recorded as
//    `provider_scale_break`, not asserted to be a corporate action.
export function normalizePriceScaleSeries(bars, splits=[], {ratioTolerance=0.06}={}){
  const ordered=(bars||[]).filter(x=>x?.date&&Number(x.close)>0).map(x=>({...x,close:Number(x.close)})).sort((a,b)=>a.date.localeCompare(b.date));
  if(!ordered.length)return{bars:[],normalizations:[]};
  let out=ordered.map(x=>({...x,close_split_adjusted:x.close}));
  const normalizations=[];
  const validSplits=(splits||[]).map(s=>({...s,date:String(s.date||'').slice(0,10),ratio:normalizeSplitRatio(s)})).filter(s=>/^\d{4}-\d{2}-\d{2}$/.test(s.date)&&s.ratio>0).sort((a,b)=>a.date.localeCompare(b.date));
  const applyPrior=(date,ratio)=>{out=out.map(x=>x.date<date?{...x,close_split_adjusted:x.close_split_adjusted/ratio}:x)};
  const around=(date)=>{let before=null,after=null;for(const x of out){if(x.date<date)before=x;else if(!after)after=x}return{before,after}};
  for(const split of validSplits){
    const {before,after}=around(split.date);if(!before||!after)continue;
    const observed=before.close_split_adjusted/after.close_split_adjusted;
    const matches=Math.abs(observed/split.ratio-1)<=ratioTolerance;
    const alreadyContinuous=Math.abs(after.close_split_adjusted/before.close_split_adjusted-1)<0.35;
    if(matches){applyPrior(split.date,split.ratio);normalizations.push({date:split.date,ratio:split.ratio,type:'declared_split',action:'applied'});}
    else if(alreadyContinuous)normalizations.push({date:split.date,ratio:split.ratio,type:'declared_split',action:'already_adjusted'});
    else normalizations.push({date:split.date,ratio:split.ratio,type:'declared_split',action:'unverified'});
  }
  const common=[0.1,0.2,0.25,1/3,0.5,2,3,4,5,10];
  for(let pass=0;pass<4;pass++){
    const hit=findSuspiciousDiscontinuity(out.map(x=>({date:x.date,close:x.close_split_adjusted})));
    if(!hit)break;
    const observed=hit.previous_close/hit.close;
    let best=null;for(const ratio of common){const err=Math.abs(observed/ratio-1);if(!best||err<best.err)best={ratio,err}}
    if(!best||best.err>ratioTolerance)break;
    applyPrior(hit.date,best.ratio);
    normalizations.push({date:hit.date,ratio:best.ratio,type:'provider_scale_break',action:'inferred',observed_ratio:observed,error_pct:best.err*100});
  }
  return{bars:out,normalizations};
}

export function findSuspiciousDiscontinuity(bars,{maxDownPct=-40,maxUpPct=70}={}){
  for(let i=1;i<(bars||[]).length;i++){
    const prev=Number(bars[i-1].close),curr=Number(bars[i].close);
    if(!(prev>0&&curr>0))continue;
    const change=(curr/prev-1)*100;
    if(change<=maxDownPct||change>=maxUpPct)return{date:bars[i].date,previous_close:prev,close:curr,change_pct:change};
  }
  return null;
}

export function historyCoverageYears(bars){
  if(!bars?.length)return 0;
  const first=new Date(`${bars[0].date}T00:00:00Z`).getTime(),last=new Date(`${bars.at(-1).date}T00:00:00Z`).getTime();
  return Math.max(0,(last-first)/(365.2425*24*3600*1000));
}


export function mergeHistoricalParts(parts=[]){
  const byDate=new Map(), splitByKey=new Map();
  let meta={};
  for(const part of parts||[]){
    if(part?.meta&&Object.keys(part.meta).length)meta={...meta,...part.meta};
    for(const bar of part?.bars||[]){
      if(!bar?.date||!Number.isFinite(Number(bar.close)))continue;
      byDate.set(String(bar.date).slice(0,10),{...bar,date:String(bar.date).slice(0,10),close:Number(bar.close)});
    }
    for(const split of part?.splits||[]){
      const date=String(split?.date||'').slice(0,10),ratio=normalizeSplitRatio(split);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!(ratio>0))continue;
      splitByKey.set(`${date}|${ratio}`,{...split,date,ratio});
    }
  }
  return{
    bars:[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)),
    splits:[...splitByKey.values()].sort((a,b)=>a.date.localeCompare(b.date)),
    meta
  };
}

export function buildHistoryWindows(startDate,endDate,chunkYears=4){
  const start=new Date(`${startDate}T00:00:00Z`),end=new Date(`${endDate}T00:00:00Z`);
  if(!(start<end))throw new Error('Invalid history window');
  const out=[];let cur=new Date(start);
  while(cur<end){
    const next=new Date(cur);next.setUTCFullYear(next.getUTCFullYear()+chunkYears);
    if(next>end)next.setTime(end.getTime());
    out.push({start:cur.toISOString().slice(0,10),end:next.toISOString().slice(0,10)});
    cur=next;
  }
  return out;
}


export function historySourceIsSufficient({densityOk,coverageYears,inceptionComplete,minCoverageYears=19.5}={}){
  return Boolean(densityOk) && (Number(coverageYears)>=Number(minCoverageYears) || Boolean(inceptionComplete));
}

export function historyDensityStats(bars,{minRowsPerYear=220,maxGapDays=14}={}){
  if(!bars?.length)return{ok:false,rows:0,coverageYears:0,rowsPerYear:0,maxGapDays:null,reason:'no rows'};
  const ordered=[...bars].sort((a,b)=>a.date.localeCompare(b.date)),coverageYears=historyCoverageYears(ordered);
  const rowsPerYear=coverageYears>0?ordered.length/coverageYears:ordered.length;
  let largestGap=0;
  for(let i=1;i<ordered.length;i++){
    const a=new Date(`${ordered[i-1].date}T00:00:00Z`),b=new Date(`${ordered[i].date}T00:00:00Z`),gap=(b-a)/86400000;
    if(gap>largestGap)largestGap=gap;
  }
  const ok=rowsPerYear>=minRowsPerYear&&largestGap<=maxGapDays;
  return{ok,rows:ordered.length,coverageYears,rowsPerYear,maxGapDays:largestGap,reason:ok?'':`history is not dense daily coverage (${rowsPerYear.toFixed(1)} rows/year, max gap ${largestGap.toFixed(0)}d)`};
}

export function simulateDrawdownHistory(assetId,bars){
  if(!bars?.length)throw new Error('Drawdown history is empty');
  const ordered=[...bars].filter(x=>Number.isFinite(Number(x.close))).sort((a,b)=>a.date.localeCompare(b.date));
  if(!ordered.length)throw new Error('Drawdown history has no valid closes');
  let state=null,triggered=new Set(),triggerEvents=[];
  for(const bar of ordered){
    const close=Number(bar.close);
    if(!state||close>state.ath+1e-9){
      state={asset_id:assetId,trade_date:bar.date,close,ath:close,ath_date:bar.date,cycle_low:close,cycle_low_date:bar.date,max_cycle_drawdown_pct:0,current_drawdown_pct:0,recovery_from_low_pct:0,cycle_started_at:bar.date};
      triggered=new Set();triggerEvents=[];
      continue;
    }
    state.trade_date=bar.date;state.close=close;
    if(close<state.cycle_low){state.cycle_low=close;state.cycle_low_date=bar.date}
    state.current_drawdown_pct=(close/state.ath-1)*100;
    state.max_cycle_drawdown_pct=Math.min(state.max_cycle_drawdown_pct,state.current_drawdown_pct);
    state.recovery_from_low_pct=(close/state.cycle_low-1)*100;
    for(const hit of crossedUntriggeredLevels(assetId,state.current_drawdown_pct,[...triggered])){
      triggered.add(hit.id);triggerEvents.push({level_id:hit.id,threshold_pct:hit.threshold,allocation_pct:hit.allocationPct,trigger_date:bar.date,trigger_close:close,trigger_drawdown_pct:state.current_drawdown_pct});
    }
  }
  const levelNow=currentLevel(assetId,state.current_drawdown_pct);
  const triggeredIds=[...triggered];
  return {...state,current_level:levelNow?.id||(triggeredIds.length?'RECOVERED':'NORMAL'),triggered_ids:triggeredIds,trigger_events:triggerEvents,cumulative_allocation_pct:cumulativeAllocation(assetId,triggeredIds)};
}
