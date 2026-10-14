import {buildHistoryWindows,mergeHistoricalParts,historyDensityStats,historyCoverageYears,normalizePriceScaleSeries,findSuspiciousDiscontinuity,historySourceIsSufficient} from '../src/drawdown-domain.js';

const targets=[
  {id:'0050',symbols:['0050.TW'],mode:'inception'},
  {id:'VOO',symbols:['VOO'],mode:'inception'},
  {id:'QQQ',symbols:['QQQ'],mode:'inception'},
  {id:'SOXX',symbols:['SOXX'],mode:'inception'}
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ymd=d=>d.toISOString().slice(0,10);
function yearsAgoDate(years){const d=new Date();d.setUTCFullYear(d.getUTCFullYear()-years);d.setUTCDate(d.getUTCDate()-7);return ymd(d)}
function tomorrow(){const d=new Date();d.setUTCDate(d.getUTCDate()+1);return ymd(d)}
async function fetchChart(symbol,{range=null,start=null,end=null}={}){
  const encoded=encodeURIComponent(symbol),hosts=['query1.finance.yahoo.com','query2.finance.yahoo.com'];let last;
  for(let i=0;i<4;i++){
    const q=start&&end?`period1=${Math.floor(new Date(`${start}T00:00:00Z`).getTime()/1000)}&period2=${Math.floor(new Date(`${end}T00:00:00Z`).getTime()/1000)}`:`range=${encodeURIComponent(range||'max')}`;
    try{
      const r=await fetch(`https://${hosts[i%2]}/v8/finance/chart/${encoded}?${q}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`,{headers:{'user-agent':'Mozilla/5.0 CapitalOS-Drawdown-Probe/2.7.2','accept':'application/json'}});
      if(r.status===429){last=new Error('HTTP 429');await sleep(600*(i+1));continue}
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const j=await r.json(),x=j?.chart?.result?.[0];if(!x)throw new Error('no chart result');
      const q0=x.indicators?.quote?.[0]||{},bars=[];
      for(let k=0;k<(x.timestamp||[]).length;k++){const close=Number(q0.close?.[k]);if(Number.isFinite(close))bars.push({date:ymd(new Date(x.timestamp[k]*1000)),close})}
      const splits=Object.values(x.events?.splits||{}).map(s=>({date:ymd(new Date(Number(s.date)*1000)),numerator:Number(s.numerator),denominator:Number(s.denominator),splitRatio:s.splitRatio}));
      return{bars,splits,meta:x.meta||{}};
    }catch(e){last=e;await sleep(350*(i+1))}
  }
  throw last||new Error('fetch failed');
}
async function probe(symbol,mode){
  const meta=await fetchChart(symbol,{range:'max'}),firstTrade=meta.meta?.firstTradeDate?ymd(new Date(Number(meta.meta.firstTradeDate)*1000)):null;
  const start=mode==='inception'&&firstTrade?firstTrade:yearsAgoDate(22),end=tomorrow(),windows=buildHistoryWindows(start,end,4),parts=[];
  for(const w of windows){parts.push(await fetchChart(symbol,{start:w.start,end:w.end}));await sleep(250)}
  const merged=mergeHistoricalParts(parts),stats=historyDensityStats(merged.bars),coverage=historyCoverageYears(merged.bars),first=merged.bars[0]?.date,last=merged.bars.at(-1)?.date;
  const inceptionComplete=firstTrade&&first&&Math.abs(new Date(`${first}T00:00:00Z`)-new Date(`${firstTrade}T00:00:00Z`))<=45*86400000;
  const normalized=normalizePriceScaleSeries(merged.bars,merged.splits),anomaly=findSuspiciousDiscontinuity(normalized.bars.map(x=>({date:x.date,close:x.close_split_adjusted})));
  return{symbol,first,last,coverage,rows:merged.bars.length,splits:merged.splits.length,stats,firstTrade,inceptionComplete,windows:windows.length,normalizations:normalized.normalizations,anomaly};
}
for(const t of targets){
  let ok=null;
  for(const symbol of t.symbols){
    try{
      const r=await probe(symbol,t.mode),sufficient=historySourceIsSufficient({densityOk:r.stats.ok,coverageYears:r.coverage,inceptionComplete:r.inceptionComplete});
      console.log(`${t.id}\t${symbol}\t${r.first}→${r.last}\t${r.coverage.toFixed(1)}y\t${r.rows} daily rows\t${r.stats.rowsPerYear.toFixed(0)} rows/y\tmaxGap ${r.stats.maxGapDays.toFixed(0)}d\t${r.splits} splits\t${r.windows} windows\t${sufficient?'PASS':'FAIL'}`);
      if(r.firstTrade)console.log(`${t.id}\tfirstTrade=${r.firstTrade}\tinceptionComplete=${Boolean(r.inceptionComplete)}`);
      if(r.normalizations.length)console.log(`${t.id}\tnormalization=${r.normalizations.map(x=>`${x.date}:${x.type}:${x.action}:ratio=${Number(x.ratio).toFixed(4)}`).join(', ')}`);
      if(r.anomaly)console.log(`${t.id}\tANOMALY AFTER NORMALIZATION ${r.anomaly.date} ${r.anomaly.change_pct.toFixed(1)}%`);
      if(sufficient){ok=r;break}
    }catch(e){console.log(`${t.id}\t${symbol}\tERROR\t${e.message}`)}
  }
  if(!ok)console.log(`${t.id}\tWARNING: no verified dense daily source meeting the configured history requirement; production will refuse initialization.`);
}
