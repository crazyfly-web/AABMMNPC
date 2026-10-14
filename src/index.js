import { DRAWDOWN_CONFIG, getDrawdownConfig, currentLevel, crossedUntriggeredLevels, cumulativeAllocation, nextUntriggeredLevel, distanceToNextLevel, splitAdjustSeries, normalizePriceScaleSeries, findSuspiciousDiscontinuity, historyCoverageYears, simulateDrawdownHistory, mergeHistoricalParts, buildHistoryWindows, historyDensityStats, historySourceIsSufficient, finalizedMarketBars, needsSameDayCorrection, replayCorrectedDrawdownDay } from './drawdown-domain.js';
const TICKERS = ['NVDA', 'MSFT', 'AVGO', 'GOOGL', 'AMZN', 'META', 'PLTR'];
const MOMENTUM_TICKERS = [...TICKERS, 'MU'];
const BENCHMARK = 'QQQ';
const DRAWDOWN_ASSET_ORDER = ['0050','VOO','QQQ','SOXX'];
const DRAWDOWN_SOURCES = {
  '0050': {preferred:'0050.TW', fallbacks:[], market:'TW', historyMode:'inception'},
  VOO: {preferred:'VOO', fallbacks:[], market:'US', historyMode:'inception'},
  QQQ: {preferred:'QQQ', fallbacks:[], market:'US', historyMode:'inception'},
  SOXX: {preferred:'SOXX', fallbacks:[], market:'US', historyMode:'inception'}
};
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/portfolio' && request.method === 'GET') return getPortfolio(env);
      if (url.pathname === '/api/momentum' && request.method === 'GET') return getMomentum(env);
      if (url.pathname === '/api/transactions' && request.method === 'GET') return getTransactions(env);
      if (url.pathname === '/api/transactions' && request.method === 'POST') { requireAdmin(request, env); return addTransaction(request, env); }
      if (url.pathname === '/api/cash' && request.method === 'POST') { requireAdmin(request, env); return setCash(request, env); }
      if (url.pathname === '/api/prices/refresh' && request.method === 'POST') { requireAdmin(request, env); return reply(await refreshPricesAndDrawdown(env)); }
      if (url.pathname === '/api/wealth' && request.method === 'GET') return getWealth(env);
      if (url.pathname === '/api/drawdown' && request.method === 'GET') return getDrawdown(env);
      if (url.pathname === '/api/drawdown/refresh' && request.method === 'POST') { requireAdmin(request, env); return reply(await refreshDrawdown(env,'all')); }
      if (url.pathname === '/api/wealth/transactions' && request.method === 'POST') { requireAdmin(request, env); return saveWealthTransaction(request, env); }
      const wealthTxMatch = url.pathname.match(/^\/api\/wealth\/transactions\/(\d+)$/);
      if (wealthTxMatch && request.method === 'PUT') { requireAdmin(request, env); return updateWealthTransaction(request, env, Number(wealthTxMatch[1])); }
      if (wealthTxMatch && request.method === 'DELETE') { requireAdmin(request, env); return deleteWealthTransaction(env, Number(wealthTxMatch[1])); }
      if (url.pathname === '/api/wealth/settings' && request.method === 'POST') { requireAdmin(request, env); return saveWealthSettings(request, env); }
      if (url.pathname === '/api/wealth/refresh' && request.method === 'POST') { requireAdmin(request, env); const wealth=await refreshWealth(env,'all'); const drawdown=await refreshDrawdown(env,'all'); return reply({...wealth,drawdown}); }
      return reply({ error: 'Not found' }, 404);
    } catch (error) { return reply({ error: error.message || 'Unexpected error' }, error.status || 500); }
  },
  async scheduled(event, env, ctx) {
    if (event.cron === '5 6 * * 1-5') ctx.waitUntil((async()=>{await refreshWealth(env,'tw');await refreshDrawdown(env,'tw')})());
    else ctx.waitUntil((async()=>{await refreshPrices(env);await refreshDrawdown(env,'us');await refreshWealth(env,'us')})());
  }
};

function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw httpError(500, '尚未設定 ADMIN_TOKEN');
  const token = request.headers.get('x-admin-token');
  if (!token || token !== env.ADMIN_TOKEN) throw httpError(401, '管理密碼錯誤');
}

async function getPortfolio(env) {
  const { results } = await env.DB.prepare(`SELECT a.ticker,a.name,a.target_weight,a.display_order,COALESCE(h.shares,0) shares,COALESCE(h.cost_basis,0) cost_basis,p.price,p.price_date,p.fetched_at,p.source,COALESCE(p.ytd_return_pct,0) ytd_return_pct FROM assets a LEFT JOIN holdings h ON h.ticker=a.ticker LEFT JOIN prices p ON p.ticker=a.ticker ORDER BY a.display_order`).all();
  const settingRows = await env.DB.prepare('SELECT key,value FROM settings').all();
  const settings = Object.fromEntries(settingRows.results.map(r => [r.key, r.value]));
  const cash = Number(settings.cash_balance || 0), targetCapital = Number(settings.target_portfolio_value_usd || 33333.33);
  const stockRows = results.filter(r=>r.ticker!=='CASH').map(r=>{ const price=Number(r.price||0),shares=Number(r.shares||0),costBasis=Number(r.cost_basis||0),marketValue=price*shares,gain=marketValue-costBasis,targetInvestment=targetCapital*Number(r.target_weight||0)/100; return {...r,price,shares,cost_basis:costBasis,average_cost:shares?costBasis/shares:0,market_value:marketValue,gain,return_pct:costBasis?gain/costBasis*100:0,ytd_return_pct:Number(r.ytd_return_pct||0),target_investment:targetInvestment,amount_needed:targetInvestment-costBasis}; });
  const stockValue=stockRows.reduce((s,r)=>s+r.market_value,0),totalValue=stockValue+cash,stockCost=stockRows.reduce((s,r)=>s+r.cost_basis,0),totalGain=stockRows.reduce((s,r)=>s+r.gain,0);
  const rows=stockRows.map(r=>({...r,current_weight:totalValue?r.market_value/totalValue*100:0}));
  rows.push({ticker:'CASH',name:'現金',target_weight:10,shares:null,cost_basis:cash,price:1,average_cost:null,market_value:cash,gain:0,return_pct:0,ytd_return_pct:0,current_weight:totalValue?cash/totalValue*100:0,target_investment:targetCapital*.1,amount_needed:targetCapital*.1-cash,price_date:null,fetched_at:null});
  const latestRun=await env.DB.prepare('SELECT fetched_at,source,success_count,failure_count,errors FROM price_refresh_runs ORDER BY id DESC LIMIT 1').first();
  const priceDates=stockRows.map(r=>r.price_date).filter(Boolean).sort();
  return reply({rows,summary:{total_value:totalValue,stock_value:stockValue,cash,total_cost:stockCost,total_gain:totalGain,total_return_pct:stockCost?totalGain/stockCost*100:0,target_portfolio_value_usd:targetCapital,rebalance_threshold:Number(settings.rebalance_threshold||3),last_price_update:settings.last_price_update||null,latest_price_date:priceDates.at(-1)||null,data_health:latestRun||{fetched_at:settings.last_price_update||null,source:'Yahoo Finance',success_count:stockRows.filter(r=>r.price>0).length,failure_count:stockRows.filter(r=>!r.price).length,errors:''}}});
}

async function getMomentum(env) {
  const latest = await env.DB.prepare('SELECT MAX(trade_date) trade_date FROM momentum_daily').first();
  if (!latest?.trade_date) return reply({trade_date:null,rows:[],brief:'尚無動能資料，請先執行更新股價。',portfolio_momentum:null,portfolio_trail:[]});
  const {results}=await env.DB.prepare(`SELECT * FROM momentum_daily WHERE trade_date=? ORDER BY momentum_score DESC`).bind(latest.trade_date).all();
  const dates=(await env.DB.prepare('SELECT DISTINCT trade_date FROM momentum_daily WHERE trade_date<=? ORDER BY trade_date DESC LIMIT 5').bind(latest.trade_date).all()).results.map(r=>r.trade_date).reverse();
  const historyRows=dates.length?(await env.DB.prepare(`SELECT ticker,trade_date,momentum_score,rs20_qqq,state FROM momentum_daily WHERE trade_date IN (${dates.map(()=>'?').join(',')}) ORDER BY trade_date`).bind(...dates).all()).results:[];
  const byTicker={};for(const r of historyRows)(byTicker[r.ticker]??=[]).push(r);
  const rows=results.map(r=>{
    const h=byTicker[r.ticker]||[],trail=h.map(x=>Number(x.momentum_score));
    const prior=trail.length>1?trail.at(-2):null,change=prior==null?0:Number(r.momentum_score)-prior;
    const slope=trail.length>1?(trail.at(-1)-trail[0])/(trail.length-1):0;
    const trend=prior==null?'→':change>1?'↑':change<-1?'↓':'→';
    const acceleration=slope>=3?'↑↑':slope>=1?'↑':slope<=-3?'↓↓':slope<=-1?'↓':'→';
    return {...r,trend,score_change:change,trail,slope_5d:slope,acceleration};
  });
  const weights={NVDA:18,MSFT:16,AVGO:14,GOOGL:14,AMZN:10,META:10,PLTR:8};
  const weighted=rows.filter(r=>weights[r.ticker]).reduce((a,r)=>({sum:a.sum+Number(r.momentum_score)*weights[r.ticker],w:a.w+weights[r.ticker]}),{sum:0,w:0});
  const portfolioTrail=dates.map(date=>{const day=historyRows.filter(r=>r.trade_date===date&&weights[r.ticker]);const x=day.reduce((a,r)=>({sum:a.sum+Number(r.momentum_score)*weights[r.ticker],w:a.w+weights[r.ticker]}),{sum:0,w:0});return{date,score:x.w?x.sum/x.w:null}}).filter(x=>x.score!=null);
  const portfolioChange=portfolioTrail.length>1?portfolioTrail.at(-1).score-portfolioTrail.at(-2).score:0;
  return reply({trade_date:latest.trade_date,rows,portfolio_momentum:weighted.w?weighted.sum/weighted.w:null,portfolio_trail:portfolioTrail,portfolio_change:portfolioChange,brief:buildBrief(rows)});
}

async function getTransactions(env){ const {results}=await env.DB.prepare('SELECT id,trade_date,action,ticker,shares,total_amount,price_per_share,note,created_at FROM transactions ORDER BY trade_date DESC,id DESC LIMIT 300').all(); return reply({transactions:results}); }
async function addTransaction(request,env){
  const body=await request.json(),action=String(body.action||'').toUpperCase(),ticker=body.ticker?String(body.ticker).toUpperCase():null,shares=Number(body.shares||0),totalAmount=Number(body.total_amount||0),tradeDate=String(body.trade_date||'').slice(0,10),note=String(body.note||'').slice(0,300);
  if(!['BUY','SELL','CASH_ADD','CASH_REMOVE'].includes(action))throw httpError(400,'不支援的動作'); if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate))throw httpError(400,'日期格式錯誤'); if(!(totalAmount>0))throw httpError(400,'交易總額必須大於 0');
  const now=new Date().toISOString();
  if(action.startsWith('CASH')){const current=await getCash(env),next=action==='CASH_ADD'?current+totalAmount:current-totalAmount;if(next<-.005)throw httpError(400,'現金餘額不足');await env.DB.batch([env.DB.prepare("UPDATE settings SET value=?,updated_at=? WHERE key='cash_balance'").bind(String(next),now),env.DB.prepare('INSERT INTO transactions (trade_date,action,ticker,shares,total_amount,price_per_share,note,created_at) VALUES (?,?,NULL,0,?,0,?,?)').bind(tradeDate,action,totalAmount,note,now)]);return reply({ok:true});}
  if(!TICKERS.includes(ticker))throw httpError(400,'股票代號錯誤'); if(!(shares>0))throw httpError(400,'股數必須大於 0'); const holding=await env.DB.prepare('SELECT shares,cost_basis FROM holdings WHERE ticker=?').bind(ticker).first(); if(!holding)throw httpError(404,'找不到持股');
  const oldShares=Number(holding.shares),oldCost=Number(holding.cost_basis);let newShares,newCost;if(action==='BUY'){newShares=oldShares+shares;newCost=oldCost+totalAmount}else{if(shares>oldShares+1e-9)throw httpError(400,'賣出股數超過目前持股');const avg=oldShares?oldCost/oldShares:0;newShares=oldShares-shares;newCost=Math.max(0,oldCost-avg*shares)}
  const cash=await getCash(env),nextCash=action==='BUY'?cash-totalAmount:cash+totalAmount;if(action==='BUY'&&nextCash<-.005)throw httpError(400,'現金餘額不足；請先新增現金，或修正交易金額');await env.DB.batch([env.DB.prepare('UPDATE holdings SET shares=?,cost_basis=?,updated_at=? WHERE ticker=?').bind(newShares,newCost,now,ticker),env.DB.prepare("UPDATE settings SET value=?,updated_at=? WHERE key='cash_balance'").bind(String(nextCash),now),env.DB.prepare('INSERT INTO transactions (trade_date,action,ticker,shares,total_amount,price_per_share,note,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(tradeDate,action,ticker,shares,totalAmount,totalAmount/shares,note,now)]);return reply({ok:true});
}
async function setCash(request,env){const body=await request.json(),amount=Number(body.amount);if(!Number.isFinite(amount)||amount<0)throw httpError(400,'現金金額不正確');await env.DB.prepare("UPDATE settings SET value=?,updated_at=? WHERE key='cash_balance'").bind(String(amount),new Date().toISOString()).run();return reply({ok:true})}
async function getCash(env){const row=await env.DB.prepare("SELECT value FROM settings WHERE key='cash_balance'").first();return Number(row?.value||0)}

async function refreshPricesAndDrawdown(env){
  const prices=await refreshPrices(env);
  const drawdown=await refreshDrawdown(env,'all');
  return {...prices,drawdown,errors:[...(prices.errors||[]),...(drawdown.errors||[]).map(x=>`Drawdown: ${x}`)]};
}

async function refreshPrices(env){
  const now=new Date().toISOString(),source='Yahoo Finance',seriesMap=new Map(),updates=[],errors=[];
  for(const ticker of [...MOMENTUM_TICKERS,BENCHMARK]){try{seriesMap.set(ticker,await fetchYahooSeries(ticker))}catch(e){errors.push(`${ticker}: ${e.message}`)}}
  for(const ticker of TICKERS){const series=seriesMap.get(ticker);if(!series)continue;const quote=quoteFromSeries(series);updates.push(env.DB.prepare(`INSERT INTO prices (ticker,price,price_date,fetched_at,source,ytd_return_pct) VALUES (?,?,?,?,?,?) ON CONFLICT(ticker) DO UPDATE SET price=excluded.price,price_date=excluded.price_date,fetched_at=excluded.fetched_at,source=excluded.source,ytd_return_pct=excluded.ytd_return_pct`).bind(ticker,quote.price,quote.date,now,source,quote.ytdReturnPct));}
  const benchmark=seriesMap.get(BENCHMARK);
  for(const ticker of MOMENTUM_TICKERS){const series=seriesMap.get(ticker);if(!series||!benchmark)continue;const m=calculateMomentum(ticker,series,benchmark);m.state=await classifyMomentumState(env,m);updates.push(env.DB.prepare(`INSERT INTO momentum_daily (trade_date,ticker,price,daily_return_pct,ma5,ma20,ma60,ma200,rsv,k,d,volume,volume_ratio20,distance_ma20_pct,distance_high20_pct,return20_pct,return60_pct,rs20_qqq,rs60_qqq,momentum_score,entry_score,state,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(trade_date,ticker) DO UPDATE SET price=excluded.price,daily_return_pct=excluded.daily_return_pct,ma5=excluded.ma5,ma20=excluded.ma20,ma60=excluded.ma60,ma200=excluded.ma200,rsv=excluded.rsv,k=excluded.k,d=excluded.d,volume=excluded.volume,volume_ratio20=excluded.volume_ratio20,distance_ma20_pct=excluded.distance_ma20_pct,distance_high20_pct=excluded.distance_high20_pct,return20_pct=excluded.return20_pct,return60_pct=excluded.return60_pct,rs20_qqq=excluded.rs20_qqq,rs60_qqq=excluded.rs60_qqq,momentum_score=excluded.momentum_score,entry_score=excluded.entry_score,state=excluded.state,captured_at=excluded.captured_at`).bind(m.trade_date,ticker,m.price,m.daily_return_pct,m.ma5,m.ma20,m.ma60,m.ma200,m.rsv,m.k,m.d,m.volume,m.volume_ratio20,m.distance_ma20_pct,m.distance_high20_pct,m.return20_pct,m.return60_pct,m.rs20_qqq,m.rs60_qqq,m.momentum_score,m.entry_score,m.state,now));}
  const success=TICKERS.filter(t=>seriesMap.has(t)).length;updates.push(env.DB.prepare('INSERT INTO price_refresh_runs (fetched_at,source,success_count,failure_count,errors) VALUES (?,?,?,?,?)').bind(now,source,success,TICKERS.length-success,errors.join('\n')));
  if(success){updates.push(env.DB.prepare("UPDATE settings SET value=?,updated_at=? WHERE key='last_price_update'").bind(now,now));const {results:holdings}=await env.DB.prepare(`SELECT a.ticker,COALESCE(h.shares,0) shares,COALESCE(h.cost_basis,0) cost_basis,COALESCE(p.price,0) stored_price FROM assets a LEFT JOIN holdings h ON h.ticker=a.ticker LEFT JOIN prices p ON p.ticker=a.ticker WHERE a.ticker<>'CASH' ORDER BY a.display_order`).all();const cash=await getCash(env);const values=holdings.map(h=>{const s=seriesMap.get(h.ticker),price=s?s.at(-1).close:Number(h.stored_price||0),shares=Number(h.shares||0);return{ticker:h.ticker,price,shares,cost_basis:Number(h.cost_basis||0),market_value:price*shares}});const total=values.reduce((s,r)=>s+r.market_value,cash),date=values.map(v=>seriesMap.get(v.ticker)?.at(-1)?.date).filter(Boolean).sort().at(-1)||now.slice(0,10);for(const r of values)updates.push(env.DB.prepare(`INSERT INTO daily_snapshots (snapshot_date,ticker,price,shares,market_value,cost_basis,current_weight,total_portfolio_value,captured_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(snapshot_date,ticker) DO UPDATE SET price=excluded.price,shares=excluded.shares,market_value=excluded.market_value,cost_basis=excluded.cost_basis,current_weight=excluded.current_weight,total_portfolio_value=excluded.total_portfolio_value,captured_at=excluded.captured_at`).bind(date,r.ticker,r.price,r.shares,r.market_value,r.cost_basis,total?r.market_value/total*100:0,total,now));updates.push(env.DB.prepare(`INSERT INTO daily_snapshots (snapshot_date,ticker,price,shares,market_value,cost_basis,current_weight,total_portfolio_value,captured_at) VALUES (?,'CASH',1,0,?,?,?,?,?) ON CONFLICT(snapshot_date,ticker) DO UPDATE SET market_value=excluded.market_value,cost_basis=excluded.cost_basis,current_weight=excluded.current_weight,total_portfolio_value=excluded.total_portfolio_value,captured_at=excluded.captured_at`).bind(date,cash,cash,total?cash/total*100:0,total,now));}
  if(updates.length)await env.DB.batch(updates);return{ok:errors.length===0,updated:success,momentum_updated:MOMENTUM_TICKERS.filter(t=>seriesMap.has(t)).length,errors,fetched_at:now,source};
}

async function fetchYahooChart(ticker,{range='2y',period1=null,period2=null,cacheTtl=300}={}){
  const encoded=encodeURIComponent(ticker),hosts=['query1.finance.yahoo.com','query2.finance.yahoo.com'];
  let lastError=null;
  for(let attempt=0;attempt<4;attempt++){
    const host=hosts[attempt%hosts.length];
    const timeQuery=period1&&period2?`period1=${Math.floor(new Date(`${period1}T00:00:00Z`).getTime()/1000)}&period2=${Math.floor(new Date(`${period2}T00:00:00Z`).getTime()/1000)}`:`range=${encodeURIComponent(range)}`;
    const url=`https://${host}/v8/finance/chart/${encoded}?${timeQuery}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
    try{
      const response=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 CapitalOS/2.7.2','accept':'application/json'},cf:{cacheTtl,cacheEverything:true}});
      if(response.status===429){lastError=new Error('Yahoo 暫時限流 HTTP 429');await sleep(500*(attempt+1));continue}
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json(),result=data?.chart?.result?.[0];if(!result)throw new Error('沒有報價資料');
      const ts=result.timestamp||[],q=result.indicators?.quote?.[0]||{},adj=result.indicators?.adjclose?.[0]?.adjclose||[],bars=[];
      for(let i=0;i<ts.length;i++){const close=Number(q.close?.[i]);if(Number.isFinite(close))bars.push({date:new Date(ts[i]*1000).toISOString().slice(0,10),close,adj:Number.isFinite(Number(adj[i]))?Number(adj[i]):close,high:Number(q.high?.[i]??close),low:Number(q.low?.[i]??close),volume:Number(q.volume?.[i]||0)})}
      const splits=Object.values(result.events?.splits||{}).map(x=>({date:new Date(Number(x.date)*1000).toISOString().slice(0,10),numerator:Number(x.numerator),denominator:Number(x.denominator),splitRatio:x.splitRatio}));
      return{bars,splits,meta:result.meta||{}};
    }catch(e){lastError=e;if(attempt<3)await sleep(350*(attempt+1));}
  }
  throw lastError||new Error('Yahoo 報價暫時無法取得');
}

function yearsAgoDate(years){const d=new Date();d.setUTCFullYear(d.getUTCFullYear()-years);d.setUTCDate(d.getUTCDate()-7);return d.toISOString().slice(0,10)}
function tomorrowUtcDate(){const d=new Date();d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
async function fetchYahooHistoryDaily(ticker,{mode='recent22y',cacheTtl=86400}={}){
  // `range=max&interval=1d` can be silently downsampled by Yahoo. We use it only for metadata,
  // then fetch bounded period1/period2 windows where interval=1d is honored.
  const metaProbe=await fetchYahooChart(ticker,{range:'max',cacheTtl});
  const firstTrade=metaProbe.meta?.firstTradeDate?new Date(Number(metaProbe.meta.firstTradeDate)*1000).toISOString().slice(0,10):null;
  const end=tomorrowUtcDate();
  const start=mode==='inception'&&firstTrade?firstTrade:yearsAgoDate(22);
  const windows=buildHistoryWindows(start,end,4),parts=[];
  for(const w of windows){parts.push(await fetchYahooChart(ticker,{period1:w.start,period2:w.end,cacheTtl}));await sleep(220)}
  const merged=mergeHistoricalParts(parts);merged.meta={...metaProbe.meta,...merged.meta,firstTradeDate:metaProbe.meta?.firstTradeDate};
  return{...merged,windows,requestedStart:start,requestedEnd:end,firstTrade};
}

async function fetchYahooSeries(ticker){
  const {bars}=await fetchYahooChart(ticker,{range:'2y',cacheTtl:300});
  if(bars.length<60)throw new Error('歷史資料不足');
  return bars;
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

function quoteFromSeries(s){const latest=s.at(-1),year=latest.date.slice(0,4),first=s.find(x=>x.date.startsWith(year))||s[0];return{price:latest.close,date:latest.date,ytdReturnPct:first.adj?(latest.adj/first.adj-1)*100:0}}
function avg(arr){const a=arr.filter(Number.isFinite);return a.length?a.reduce((s,v)=>s+v,0)/a.length:null}function ma(s,n){return s.length>=n?avg(s.slice(-n).map(x=>x.close)):null}function ret(s,n){return s.length>n?(s.at(-1).adj/s.at(-(n+1)).adj-1)*100:0}function clamp(v,a=0,b=100){return Math.max(a,Math.min(b,v))}
function stochastic(s){let k=50,d=50,rsv=50;for(let i=0;i<s.length;i++){const w=s.slice(Math.max(0,i-8),i+1),hh=Math.max(...w.map(x=>x.high)),ll=Math.min(...w.map(x=>x.low));rsv=hh===ll?50:(s[i].close-ll)/(hh-ll)*100;k=(2*k+rsv)/3;d=(2*d+k)/3}return{rsv,k,d}}
function atr(s,n=14){if(s.length<2)return 0;const tr=[];for(let i=1;i<s.length;i++){const x=s[i],pc=s[i-1].close;tr.push(Math.max(x.high-x.low,Math.abs(x.high-pc),Math.abs(x.low-pc)))}return avg(tr.slice(-n))||0}
function weeklyBars(s){const out=[];for(const x of s){const d=new Date(x.date+'T00:00:00Z'),day=(d.getUTCDay()+6)%7,mon=new Date(d);mon.setUTCDate(d.getUTCDate()-day);const key=mon.toISOString().slice(0,10),last=out.at(-1);if(last&&last.key===key){last.high=Math.max(last.high,x.high);last.low=Math.min(last.low,x.low);last.close=x.close;last.adj=x.adj;last.volume+=x.volume}else out.push({key,date:x.date,close:x.close,adj:x.adj,high:x.high,low:x.low,volume:x.volume})}return out}
function risingMA(s,n,lookback=5){if(s.length<n+lookback)return false;const now=ma(s,n),past=avg(s.slice(-(n+lookback),-lookback).map(x=>x.close));return Number.isFinite(now)&&Number.isFinite(past)&&now>past}
function scoreEntryV2(s,{p,ma5,ma20,ma60,ma200,volumeRatio}){
  const a=Math.max(atr(s,14),p*.005),wst=stochastic(weeklyBars(s)),prior=s.slice(-21,-1),prior50=s.slice(-51,-1),priorHigh20=prior.length?Math.max(...prior.map(x=>x.high)):p,priorHigh50=prior50.length?Math.max(...prior50.map(x=>x.high)):priorHigh20,recentLow10=Math.min(...s.slice(-10).map(x=>x.low));
  const z20=ma20?(p-ma20)/a:0,z60=ma60?(p-ma60)/a:0,z200=ma200?(p-ma200)/a:0;
  let structure=0;structure+=p>=ma20?4:0;structure+=p>=ma60?4:0;structure+=p>=ma200?3:0;structure+=ma20>=ma60?3:0;structure+=risingMA(s,20)?3:0;structure+=risingMA(s,60)?3:0;
  let loc20=z20<-2?2:z20<-1?7:z20<=.75?18:z20<=1.5?14:z20<=2.25?9:z20<=3?5:1;
  let loc60=p<ma60?0:z60<=3?5:z60<=5?4:z60<=7?2:0;let loc200=p>=ma200?2:0;const location=clamp(loc20+loc60+loc200,0,25);
  const supportCandidates=[ma20,ma60,ma200,recentLow10,p>=priorHigh20?priorHigh20:null].filter(x=>Number.isFinite(x)&&x<=p),support=supportCandidates.length?Math.max(...supportCandidates):recentLow10,supportAtr=Math.max(0,(p-support)/a);
  const supportScore=supportAtr<=.5?15:supportAtr<=1?13:supportAtr<=1.5?10:supportAtr<=2?7:supportAtr<=3?4:1;
  const resistCandidates=[priorHigh20,priorHigh50].filter(x=>Number.isFinite(x)&&x>p),resistance=resistCandidates.length?Math.min(...resistCandidates):null,resistAtr=resistance?(resistance-p)/a:null,riskAtr=Math.max(.5,(p-(support-.35*a))/a);
  const rewardAtr=resistance?Math.max(0,resistAtr):(volumeRatio>=1.2?2:1.25),rr=rewardAtr/riskAtr,rrScore=rr>=3?15:rr>=2?13:rr>=1.5?11:rr>=1?8:rr>=.7?6:rr>=.4?4:3;
  const nearResistance=resistAtr!=null&&resistAtr<=.75,isBreakout=p>priorHigh20,pullback=Math.abs(z20)<=.75||p<ma5;let volumeScore;if(nearResistance||isBreakout)volumeScore=volumeRatio>=1.2?10:volumeRatio>=1?8:volumeRatio>=.8?6:volumeRatio>=.6?4:2;else if(pullback)volumeScore=volumeRatio<=.8?10:volumeRatio<=1?8:volumeRatio<=1.2?6:4;else volumeScore=volumeRatio>=1?7:volumeRatio>=.7?6:5;
  let weeklyScore=wst.rsv>95?2:wst.rsv>90?4:wst.rsv>85?6:wst.rsv>75?8:wst.rsv>=30?10:wst.rsv>=20?7:5;if(wst.k>90)weeklyScore=Math.min(weeklyScore,3);else if(wst.k>85)weeklyScore=Math.min(weeklyScore,4);
  const broken=p<ma60||ma20<ma60,healthyPullback=p>=ma60&&Math.abs(z20)<=.75,retest=isBreakout&&Math.abs(p-priorHigh20)/a<=.75&&volumeRatio<=.9,confirmedBreakout=isBreakout&&volumeRatio>=1.2,prebreakout=!isBreakout&&nearResistance&&supportAtr<=1.5,extended=z20>2||z60>5||(wst.rsv>90&&z20>1.25);let stageScore=broken?1:(retest||confirmedBreakout||healthyPullback)?5:prebreakout?4:extended?3:3;
  let raw=structure+location+supportScore+rrScore+volumeScore+weeklyScore+stageScore,cap=100;
  if(wst.rsv>95&&z20>1.5)cap=Math.min(cap,65);if(z60>5&&z20>1.25)cap=Math.min(cap,65);if(nearResistance&&volumeRatio<.8)cap=Math.min(cap,60);if(isBreakout&&volumeRatio<.9&&!retest)cap=Math.min(cap,65);if(z20>3||z60>8)cap=Math.min(cap,50);if(p<ma60&&ma20<ma60)cap=Math.min(cap,45);
  return{score:Math.round(clamp(Math.min(raw,cap))),raw,cap,atr14:a,weekly:wst,structure,location,support:supportScore,rr:rrScore,volume:volumeScore,weeklyPosition:weeklyScore,stage:stageScore,z20,z60,z200,supportAtr,resistanceAtr:resistAtr,riskAtr,rewardAtr,rrRatio:rr,priorHigh20};
}
function calculateMomentum(ticker,s,b){const p=s.at(-1).close,prev=s.at(-2)?.close||p,ma5=ma(s,5),ma20=ma(s,20),ma60=ma(s,60),ma200=ma(s,200),st=stochastic(s),v20=avg(s.slice(-20).map(x=>x.volume))||1,high20=Math.max(...s.slice(-20).map(x=>x.high)),r20=ret(s,20),r60=ret(s,60),br20=ret(b,20),br60=ret(b,60),rs20=r20-br20,rs60=r60-br60,dist20=ma20?(p/ma20-1)*100:0,distHigh=(p/high20-1)*100;
  let trend=0;trend+=p>ma20?6:0;trend+=p>ma60?6:0;trend+=ma20>ma60?5:0;trend+=ma60&&ma200&&ma60>ma200?4:0;trend+=ma20&&s.length>25&&ma20>avg(s.slice(-25,-5).map(x=>x.close))?4:0;
  const relative=clamp(12.5+rs20*.7+rs60*.35,0,25);let breakout=clamp(14+distHigh*.8,0,20);if(distHigh>-2)breakout=Math.max(breakout,17);const volumeRatio=s.at(-1).volume/v20;let volume=clamp(7+Math.max(0,volumeRatio-1)*5+(p>prev?3:-3),0,15);let dailyMomentum=clamp(7.5+(st.k-st.d)*.35+(st.k-50)*.12,0,15);const momentum=Math.round(clamp(trend+relative+breakout+volume+dailyMomentum));
  const entryDetail=scoreEntryV2(s,{p,ma5,ma20,ma60,ma200,volumeRatio}),entry=entryDetail.score;
  return{trade_date:s.at(-1).date,ticker,price:p,daily_return_pct:(p/prev-1)*100,ma5,ma20,ma60,ma200,rsv:st.rsv,k:st.k,d:st.d,volume:s.at(-1).volume,volume_ratio20:volumeRatio,distance_ma20_pct:dist20,distance_high20_pct:distHigh,return20_pct:r20,return60_pct:r60,rs20_qqq:rs20,rs60_qqq:rs60,momentum_score:momentum,entry_score:entry,state:'Neutral'}
}
async function classifyMomentumState(env,m){
  const prev=await env.DB.prepare('SELECT momentum_score,entry_score,rs20_qqq,state FROM momentum_daily WHERE ticker=? AND trade_date<? ORDER BY trade_date DESC LIMIT 1').bind(m.ticker,m.trade_date).first();
  const score=Number(m.momentum_score),entry=Number(m.entry_score),rs=Number(m.rs20_qqq),pScore=prev?Number(prev.momentum_score):null,pRs=prev?Number(prev.rs20_qqq):null,change=pScore==null?0:score-pScore,prevState=String(prev?.state||'');
  if(score>=80&&entry<=60)return'Extended';
  if(score>=85)return'Strong';
  if(score>=72){if(prevState==='Strong'||prevState==='Extended')return score>=70?'Confirmed':'Cooling';return'Confirmed'}
  if(score>=58){const confirmed=prevState==='Emerging'||prevState==='Confirmed'||prevState==='Strong'||prevState==='Extended'||(pScore!=null&&pScore>=58)||(change>=5&&rs>0);return confirmed?'Emerging':'Cooling'}
  const repairing=(prevState==='Broken'||prevState==='Recovering')&&pScore!=null&&change>=3&&pRs!=null&&rs>pRs;
  if(score>=25&&repairing)return'Recovering';
  if(score>=45)return'Cooling';
  return'Broken';
}
function buildBrief(rows){
  if(!rows.length)return'尚無動能資料。';
  const top=[...rows].sort((a,b)=>b.momentum_score-a.momentum_score),leader=top[0],sweet=rows.filter(r=>r.momentum_score>=60&&r.momentum_score<=80&&r.entry_score>80&&r.trend==='↑'&&r.rs20_qqq>0).sort((a,b)=>b.entry_score-a.entry_score||b.score_change-a.score_change)[0],rising=rows.filter(r=>r.trend==='↑').sort((a,b)=>b.score_change-a.score_change)[0],recovering=rows.find(r=>r.state==='Recovering'),weak=top.at(-1);
  const parts=[`${leader.ticker} 動能領先 ${Math.round(leader.momentum_score)} 分`];
  if(sweet)parts.push(`${sweet.ticker} 進入 Sweet Spot：Momentum ${Math.round(sweet.momentum_score)}、Entry ${Math.round(sweet.entry_score)}`);
  else if(rising&&rising.ticker!==leader.ticker)parts.push(`${rising.ticker} 動能升溫 ${rising.score_change>0?'+':''}${Math.round(rising.score_change)} 分`);
  if(recovering)parts.push(`${recovering.ticker} 處於修復中`);
  if(weak)parts.push(`${weak.ticker} 目前偏弱`);
  return parts.join('；')+'。分數僅作趨勢與進場品質參考，不代表買賣訊號。';
}


async function getDrawdown(env){
  const sourceRows=(await env.DB.prepare('SELECT * FROM drawdown_sources').all()).results;
  const dailyRows=(await env.DB.prepare(`SELECT d.* FROM drawdown_daily d JOIN (SELECT asset_id,MAX(trade_date) trade_date FROM drawdown_daily GROUP BY asset_id) x ON x.asset_id=d.asset_id AND x.trade_date=d.trade_date`).all()).results;
  const cycleRows=(await env.DB.prepare('SELECT * FROM drawdown_cycles WHERE is_active=1').all()).results;
  const triggerRows=(await env.DB.prepare(`SELECT t.* FROM drawdown_triggers t JOIN drawdown_cycles c ON c.id=t.cycle_id WHERE c.is_active=1 ORDER BY t.trigger_date,t.id`).all()).results;
  const alertCandidates=(await env.DB.prepare(`SELECT * FROM drawdown_alerts ORDER BY id DESC LIMIT 24`).all()).results,alerts=alertCandidates.filter(a=>Date.now()-new Date(a.created_at).getTime()<=48*3600*1000).slice(0,12);
  const sourceBy=Object.fromEntries(sourceRows.map(r=>[r.asset_id,r])),dailyBy=Object.fromEntries(dailyRows.map(r=>[r.asset_id,r])),cycleBy=Object.fromEntries(cycleRows.map(r=>[r.asset_id,r]));
  const cards=DRAWDOWN_ASSET_ORDER.map(assetId=>{
    const cfg=getDrawdownConfig(assetId),source=sourceBy[assetId]||null,state=dailyBy[assetId]||null,cycle=cycleBy[assetId]||null;
    const triggers=triggerRows.filter(r=>r.asset_id===assetId&&(!cycle||Number(r.cycle_id)===Number(cycle.id))),triggeredIds=triggers.map(r=>r.level_id);
    if(!state)return{asset_id:assetId,label:cfg.label,full_name:cfg.fullName,market:cfg.market,initialized:false,source,last_error:source?.last_error||'',levels:cfg.levels};
    const hit=cfg.levels.find(x=>x.id===state.current_level)||null,next=nextUntriggeredLevel(assetId,triggeredIds),cum=cumulativeAllocation(assetId,triggeredIds);
    return{asset_id:assetId,label:cfg.label,full_name:cfg.fullName,market:cfg.market,initialized:true,trade_date:state.trade_date,current_close:Number(state.close),ath:Number(state.ath),ath_date:state.ath_date,current_drawdown_pct:Number(state.current_drawdown_pct),cycle_low:Number(state.cycle_low),cycle_low_date:state.cycle_low_date,max_cycle_drawdown_pct:Number(state.max_cycle_drawdown_pct),recovery_from_low_pct:Number(state.recovery_from_low_pct),current_level:state.current_level,current_level_label:hit?.label||(state.current_level==='RECOVERED'?'RECOVERED / NORMAL RANGE':'NORMAL'),current_allocation_pct:hit?.allocationPct||0,cumulative_allocation_pct:cum,remaining_reserve_pct:Math.max(0,100-cum),next_level:next?{id:next.id,label:next.label,threshold_pct:next.threshold,allocation_pct:next.allocationPct,distance_pp:distanceToNextLevel(Number(state.current_drawdown_pct),next)}:null,triggered_levels:cfg.levels.map(x=>({id:x.id,label:x.label,threshold_pct:x.threshold,allocation_pct:x.allocationPct,triggered:triggeredIds.includes(x.id),trigger_date:triggers.find(t=>t.level_id===x.id)?.trigger_date||null})),source,last_error:source?.last_error||''};
  });
  return reply({cards,alerts,updated_at:new Date().toISOString()});
}

async function refreshDrawdown(env,scope='all'){
  const targets=DRAWDOWN_ASSET_ORDER.filter(id=>scope==='all'||DRAWDOWN_SOURCES[id].market===scope.toUpperCase()),errors=[],results=[];
  for(const assetId of targets){
    try{results.push(await refreshDrawdownAsset(env,assetId));}
    catch(e){errors.push(`${assetId}: ${e.message}`);await recordDrawdownSourceError(env,assetId,e.message);}
    await sleep(120);
  }
  return{ok:errors.length===0,scope,updated:results.filter(x=>x.updated).length,initialized:results.filter(x=>x.initialized).length,results,errors,fetched_at:new Date().toISOString()};
}

async function recordDrawdownSourceError(env,assetId,message){
  const cfg=getDrawdownConfig(assetId),src=DRAWDOWN_SOURCES[assetId],now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO drawdown_sources (asset_id,label,source_symbol,source_name,is_proxy,last_error) VALUES (?,?,?,'Yahoo Finance',0,?) ON CONFLICT(asset_id) DO UPDATE SET last_error=excluded.last_error`).bind(assetId,cfg.label,src.preferred,String(message).slice(0,500)).run();
}

// Reconcile a corrected final close without deleting historical daily snapshots.
// D1.batch runs the state, cycle and trigger updates as one transaction.
async function correctDrawdownSameDay(env,assetId,state,correctedBar,latestChart){
  const previous=await env.DB.prepare('SELECT * FROM drawdown_daily WHERE asset_id=? AND trade_date<? ORDER BY trade_date DESC LIMIT 1').bind(assetId,state.trade_date).first();
  if(!previous)return initializeDrawdownAsset(env,assetId,{reason:'corrected-close-history-replay',latestChart});
  const previousCycleId=Number(previous.cycle_id),currentCycleId=Number(state.cycle_id);
  const previousCycle=await env.DB.prepare('SELECT id FROM drawdown_cycles WHERE id=? AND asset_id=?').bind(previousCycleId,assetId).first();
  if(!previousCycle)throw new Error('找不到前一交易日回撤週期，已停止修正以保護紀錄');
  const priorTriggers=(await env.DB.prepare('SELECT level_id FROM drawdown_triggers WHERE cycle_id=? AND trigger_date<?').bind(previousCycleId,state.trade_date).all()).results.map(x=>x.level_id);
  const oldAlerts=(await env.DB.prepare('SELECT * FROM drawdown_alerts WHERE asset_id=? AND trigger_date=?').bind(assetId,state.trade_date).all()).results;
  const oldAlertByLevel=new Map(oldAlerts.map(x=>[x.level_id,x]));
  const corrected=replayCorrectedDrawdownDay(assetId,previous,state.trade_date,correctedBar.close,priorTriggers);
  const now=new Date().toISOString(),statements=[];
  if(currentCycleId!==previousCycleId){
    // The provisional candle created a new ATH cycle. Remove only that day's cycle.
    statements.push(env.DB.prepare('DELETE FROM drawdown_alerts WHERE cycle_id=?').bind(currentCycleId));
    statements.push(env.DB.prepare('DELETE FROM drawdown_triggers WHERE cycle_id=?').bind(currentCycleId));
    statements.push(env.DB.prepare('DELETE FROM drawdown_cycles WHERE id=? AND asset_id=?').bind(currentCycleId,assetId));
  }
  statements.push(env.DB.prepare('DELETE FROM drawdown_alerts WHERE cycle_id=? AND trigger_date=?').bind(previousCycleId,state.trade_date));
  statements.push(env.DB.prepare('DELETE FROM drawdown_triggers WHERE cycle_id=? AND trigger_date=?').bind(previousCycleId,state.trade_date));
  let cycleExpr='?';
  const dailyValues=[corrected.close,corrected.ath,corrected.ath_date,corrected.current_drawdown_pct,corrected.cycle_low,corrected.cycle_low_date,corrected.max_cycle_drawdown_pct,corrected.recovery_from_low_pct,corrected.current_level,corrected.cumulative_allocation_pct];
  if(corrected.newCycle){
    statements.push(env.DB.prepare('UPDATE drawdown_cycles SET ended_at=?,is_active=0,ath=?,ath_date=?,cycle_low=?,cycle_low_date=?,max_drawdown_pct=? WHERE id=?').bind(state.trade_date,previous.ath,previous.ath_date,previous.cycle_low,previous.cycle_low_date,previous.max_cycle_drawdown_pct,previousCycleId));
    statements.push(env.DB.prepare('INSERT INTO drawdown_cycles (asset_id,ath,ath_date,cycle_low,cycle_low_date,max_drawdown_pct,started_at,is_active) VALUES (?,?,?,?,?,?,?,1)').bind(assetId,corrected.ath,corrected.ath_date,corrected.cycle_low,corrected.cycle_low_date,0,state.trade_date));
    cycleExpr='(SELECT id FROM drawdown_cycles WHERE asset_id=? AND is_active=1 ORDER BY id DESC LIMIT 1)';
    dailyValues.push(assetId);
  }else{
    statements.push(env.DB.prepare('UPDATE drawdown_cycles SET ended_at=NULL,is_active=1,ath=?,ath_date=?,cycle_low=?,cycle_low_date=?,max_drawdown_pct=? WHERE id=?').bind(corrected.ath,corrected.ath_date,corrected.cycle_low,corrected.cycle_low_date,corrected.max_cycle_drawdown_pct,previousCycleId));
    dailyValues.push(previousCycleId);
    for(const hit of corrected.newHits){
      const alert=oldAlertByLevel.get(hit.id);
      statements.push(env.DB.prepare('INSERT INTO drawdown_triggers (cycle_id,asset_id,level_id,threshold_pct,allocation_pct,trigger_date,trigger_close,trigger_drawdown_pct,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(previousCycleId,assetId,hit.id,hit.threshold,hit.allocationPct,state.trade_date,corrected.close,corrected.current_drawdown_pct,alert?.created_at||now));
      statements.push(env.DB.prepare('INSERT INTO drawdown_alerts (asset_id,cycle_id,level_id,trigger_date,trigger_drawdown_pct,allocation_pct,cumulative_allocation_pct,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(assetId,previousCycleId,hit.id,state.trade_date,corrected.current_drawdown_pct,hit.allocationPct,cumulativeAllocation(assetId,[...priorTriggers,...corrected.newHits.filter(x=>x.threshold>=hit.threshold).map(x=>x.id)]),alert?.created_at||now));
    }
  }
  statements.push(env.DB.prepare('UPDATE drawdown_daily SET close=?,ath=?,ath_date=?,current_drawdown_pct=?,cycle_low=?,cycle_low_date=?,max_cycle_drawdown_pct=?,recovery_from_low_pct=?,current_level=?,cumulative_allocation_pct=?,cycle_id='+cycleExpr+',captured_at=? WHERE asset_id=? AND trade_date=?').bind(...dailyValues,now,assetId,state.trade_date));
  statements.push(env.DB.prepare("UPDATE drawdown_sources SET latest_date=?,last_success_at=?,last_error='' WHERE asset_id=?").bind(state.trade_date,now,assetId));
  await env.DB.batch(statements);
  return{asset_id:assetId,updated:true,corrected:true,trade_date:state.trade_date,previous_close:Number(state.close),close:corrected.close,current_drawdown_pct:corrected.current_drawdown_pct,current_level:corrected.current_level};
}

async function refreshDrawdownAsset(env,assetId){
  let source=await env.DB.prepare('SELECT * FROM drawdown_sources WHERE asset_id=?').bind(assetId).first();
  let state=await env.DB.prepare('SELECT * FROM drawdown_daily WHERE asset_id=? ORDER BY trade_date DESC LIMIT 1').bind(assetId).first();
  if(!source?.initialized_at||!state)return initializeDrawdownAsset(env,assetId);
  const cycle=await env.DB.prepare('SELECT * FROM drawdown_cycles WHERE asset_id=? AND is_active=1 ORDER BY id DESC LIMIT 1').bind(assetId).first();
  if(!cycle)return initializeDrawdownAsset(env,assetId);
  const ageDays=Math.max(0,(Date.now()-new Date(`${state.trade_date}T00:00:00Z`).getTime())/(86400000));
  const range=ageDays>350?'max':ageDays>80?'1y':'3mo';
  const chart=await fetchYahooChart(source.source_symbol,{range,cacheTtl:300});
  if(!chart.bars.length)throw new Error('沒有最新收盤資料');
  const hasNewSplit=chart.splits.some(x=>x.date>state.trade_date);
  if(hasNewSplit)return initializeDrawdownAsset(env,assetId,{reason:'split-rebuild'});
  const recentNormalized=normalizePriceScaleSeries(chart.bars,chart.splits);
  const recentAdjusted=recentNormalized.bars.map(x=>({...x,close:x.close_split_adjusted}));
  const suspicious=findSuspiciousDiscontinuity(recentAdjusted);if(suspicious)throw new Error(`疑似未調整 split / 價格斷層：${suspicious.date} ${suspicious.change_pct.toFixed(1)}%`);
  const finalized=finalizedMarketBars(recentAdjusted,getDrawdownConfig(assetId).market);
  if(needsSameDayCorrection(state,finalized)){
    const correctedBar=finalized.find(x=>x.date===state.trade_date);
    const correction=await correctDrawdownSameDay(env,assetId,state,correctedBar,chart);
    if(finalized.some(x=>x.date>state.trade_date))return refreshDrawdownAsset(env,assetId);
    return correction;
  }
  const adjusted=finalized.filter(x=>x.date>state.trade_date);
  if(!adjusted.length){
    if(!finalized.length||finalized.at(-1).date<state.trade_date)
      return{asset_id:assetId,updated:false,stale:true,reason:'waiting-for-final-close',trade_date:state.trade_date};
    await env.DB.prepare(`UPDATE drawdown_sources SET latest_date=?,last_success_at=?,last_error='' WHERE asset_id=?`).bind(state.trade_date,new Date().toISOString(),assetId).run();
    return{asset_id:assetId,updated:false,stale:true,trade_date:state.trade_date};
  }
  let activeCycle={...cycle},triggered=new Set((await env.DB.prepare('SELECT level_id FROM drawdown_triggers WHERE cycle_id=?').bind(activeCycle.id).all()).results.map(r=>r.level_id));
  let current={...state,ath:Number(state.ath),cycle_low:Number(state.cycle_low),max_cycle_drawdown_pct:Number(state.max_cycle_drawdown_pct)};
  const now=new Date().toISOString();
  for(const bar of adjusted){
    const close=Number(bar.close);
    if(close>current.ath+1e-9){
      await env.DB.prepare('UPDATE drawdown_cycles SET ended_at=?,is_active=0 WHERE id=?').bind(bar.date,activeCycle.id).run();
      const created=await env.DB.prepare(`INSERT INTO drawdown_cycles (asset_id,ath,ath_date,cycle_low,cycle_low_date,max_drawdown_pct,started_at,is_active) VALUES (?,?,?,?,?,?,?,1) RETURNING id`).bind(assetId,close,bar.date,close,bar.date,0,bar.date).first();
      activeCycle={id:Number(created.id),asset_id:assetId,ath:close,ath_date:bar.date,cycle_low:close,cycle_low_date:bar.date,max_drawdown_pct:0,started_at:bar.date,is_active:1};
      triggered=new Set();
      current={asset_id:assetId,trade_date:bar.date,close,ath:close,ath_date:bar.date,current_drawdown_pct:0,cycle_low:close,cycle_low_date:bar.date,max_cycle_drawdown_pct:0,recovery_from_low_pct:0,current_level:'NORMAL',cumulative_allocation_pct:0,cycle_id:activeCycle.id};
    }else{
      current.trade_date=bar.date;current.close=close;
      if(close<current.cycle_low){current.cycle_low=close;current.cycle_low_date=bar.date}
      current.current_drawdown_pct=(close/current.ath-1)*100;
      current.max_cycle_drawdown_pct=Math.min(Number(current.max_cycle_drawdown_pct||0),current.current_drawdown_pct);
      current.recovery_from_low_pct=(close/current.cycle_low-1)*100;
      const newHits=crossedUntriggeredLevels(assetId,current.current_drawdown_pct,[...triggered]);
      for(const hit of newHits){
        triggered.add(hit.id);
        const cum=cumulativeAllocation(assetId,[...triggered]);
        await env.DB.batch([
          env.DB.prepare(`INSERT OR IGNORE INTO drawdown_triggers (cycle_id,asset_id,level_id,threshold_pct,allocation_pct,trigger_date,trigger_close,trigger_drawdown_pct,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(activeCycle.id,assetId,hit.id,hit.threshold,hit.allocationPct,bar.date,close,current.current_drawdown_pct,now),
          env.DB.prepare(`INSERT OR IGNORE INTO drawdown_alerts (asset_id,cycle_id,level_id,trigger_date,trigger_drawdown_pct,allocation_pct,cumulative_allocation_pct,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(assetId,activeCycle.id,hit.id,bar.date,current.current_drawdown_pct,hit.allocationPct,cum,now)
        ]);
      }
      const hit=currentLevel(assetId,current.current_drawdown_pct);
      current.current_level=hit?.id||(triggered.size?'RECOVERED':'NORMAL');
      current.cumulative_allocation_pct=cumulativeAllocation(assetId,[...triggered]);
      current.cycle_id=activeCycle.id;
    }
    await env.DB.batch([
      env.DB.prepare(`UPDATE drawdown_cycles SET ath=?,ath_date=?,cycle_low=?,cycle_low_date=?,max_drawdown_pct=? WHERE id=?`).bind(current.ath,current.ath_date,current.cycle_low,current.cycle_low_date,current.max_cycle_drawdown_pct,activeCycle.id),
      env.DB.prepare(`INSERT INTO drawdown_daily (asset_id,trade_date,close,ath,ath_date,current_drawdown_pct,cycle_low,cycle_low_date,max_cycle_drawdown_pct,recovery_from_low_pct,current_level,cumulative_allocation_pct,cycle_id,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_id,trade_date) DO UPDATE SET close=excluded.close,ath=excluded.ath,ath_date=excluded.ath_date,current_drawdown_pct=excluded.current_drawdown_pct,cycle_low=excluded.cycle_low,cycle_low_date=excluded.cycle_low_date,max_cycle_drawdown_pct=excluded.max_cycle_drawdown_pct,recovery_from_low_pct=excluded.recovery_from_low_pct,current_level=excluded.current_level,cumulative_allocation_pct=excluded.cumulative_allocation_pct,cycle_id=excluded.cycle_id,captured_at=excluded.captured_at`).bind(assetId,current.trade_date,current.close,current.ath,current.ath_date,current.current_drawdown_pct,current.cycle_low,current.cycle_low_date,current.max_cycle_drawdown_pct,current.recovery_from_low_pct,current.current_level,current.cumulative_allocation_pct,current.cycle_id,now)
    ]);
  }
  await env.DB.prepare(`UPDATE drawdown_sources SET latest_date=?,last_success_at=?,last_error='' WHERE asset_id=?`).bind(current.trade_date,now,assetId).run();
  return{asset_id:assetId,updated:true,trade_date:current.trade_date,current_drawdown_pct:current.current_drawdown_pct,current_level:current.current_level};
}

async function initializeDrawdownAsset(env,assetId,{reason='initial',latestChart=null}={}){
  const selected=await selectDrawdownHistory(assetId);
  // The long-history fetch can be cached for 24h. Merge a fresh short chart
  // so a corrected close overrides any provisional candle in that cache.
  const combined=latestChart?mergeHistoricalParts([selected.chart,latestChart]):selected.chart;
  const normalized=normalizePriceScaleSeries(combined.bars,combined.splits);
  const adjusted=finalizedMarketBars(normalized.bars.map(x=>({date:x.date,close:x.close_split_adjusted})),getDrawdownConfig(assetId).market);
  if(!adjusted.length)throw new Error('市場尚未收盤，沒有可確認的收盤價');
  const suspicious=findSuspiciousDiscontinuity(adjusted);if(suspicious)throw new Error(`疑似未調整 split / 價格斷層：${suspicious.date} ${suspicious.change_pct.toFixed(1)}%`);
  const simulation=simulateDrawdownHistory(assetId,adjusted),now=new Date().toISOString(),cfg=getDrawdownConfig(assetId);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM drawdown_alerts WHERE asset_id=?').bind(assetId),
    env.DB.prepare('DELETE FROM drawdown_triggers WHERE asset_id=?').bind(assetId),
    env.DB.prepare('DELETE FROM drawdown_cycles WHERE asset_id=?').bind(assetId),
    env.DB.prepare('DELETE FROM drawdown_daily WHERE asset_id=?').bind(assetId)
  ]);
  const cycle=await env.DB.prepare(`INSERT INTO drawdown_cycles (asset_id,ath,ath_date,cycle_low,cycle_low_date,max_drawdown_pct,started_at,is_active) VALUES (?,?,?,?,?,?,?,1) RETURNING id`).bind(assetId,simulation.ath,simulation.ath_date,simulation.cycle_low,simulation.cycle_low_date,simulation.max_cycle_drawdown_pct,simulation.cycle_started_at).first();
  const cycleId=Number(cycle.id),triggerStatements=simulation.trigger_events.map(t=>env.DB.prepare(`INSERT INTO drawdown_triggers (cycle_id,asset_id,level_id,threshold_pct,allocation_pct,trigger_date,trigger_close,trigger_drawdown_pct,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(cycleId,assetId,t.level_id,t.threshold_pct,t.allocation_pct,t.trigger_date,t.trigger_close,t.trigger_drawdown_pct,now));
  const sourceStatement=env.DB.prepare(`INSERT INTO drawdown_sources (asset_id,label,source_symbol,source_name,is_proxy,earliest_date,latest_date,history_years,history_rows,initialized_at,last_success_at,last_error) VALUES (?,?,?,'Yahoo Finance',?,?,?,?,?,?,?,'') ON CONFLICT(asset_id) DO UPDATE SET label=excluded.label,source_symbol=excluded.source_symbol,source_name=excluded.source_name,is_proxy=excluded.is_proxy,earliest_date=excluded.earliest_date,latest_date=excluded.latest_date,history_years=excluded.history_years,history_rows=excluded.history_rows,initialized_at=excluded.initialized_at,last_success_at=excluded.last_success_at,last_error=''`).bind(assetId,cfg.label,selected.symbol,selected.isProxy?1:0,adjusted[0].date,adjusted.at(-1).date,selected.coverageYears,adjusted.length,now,now);
  const dailyStatement=env.DB.prepare(`INSERT INTO drawdown_daily (asset_id,trade_date,close,ath,ath_date,current_drawdown_pct,cycle_low,cycle_low_date,max_cycle_drawdown_pct,recovery_from_low_pct,current_level,cumulative_allocation_pct,cycle_id,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(assetId,simulation.trade_date,simulation.close,simulation.ath,simulation.ath_date,simulation.current_drawdown_pct,simulation.cycle_low,simulation.cycle_low_date,simulation.max_cycle_drawdown_pct,simulation.recovery_from_low_pct,simulation.current_level,simulation.cumulative_allocation_pct,cycleId,now);
  await env.DB.batch([sourceStatement,dailyStatement,...triggerStatements]);
  return{asset_id:assetId,initialized:true,updated:true,reason,trade_date:simulation.trade_date,current_drawdown_pct:simulation.current_drawdown_pct,current_level:simulation.current_level,source_symbol:selected.symbol,is_proxy:selected.isProxy,history_years:selected.coverageYears,history_rows:adjusted.length,price_normalizations:normalized.normalizations};
}

async function selectDrawdownHistory(assetId){
  const src=DRAWDOWN_SOURCES[assetId],symbols=[src.preferred,...src.fallbacks],attempts=[];
  for(const symbol of symbols){
    try{
      const chart=await fetchYahooHistoryDaily(symbol,{mode:src.historyMode,cacheTtl:86400});
      if(chart.bars.length<1000)throw new Error(`歷史日線筆數不足 (${chart.bars.length})`);
      const density=historyDensityStats(chart.bars);if(!density.ok)throw new Error(density.reason);
      const normalized=normalizePriceScaleSeries(chart.bars,chart.splits),adjusted=normalized.bars,coverage=historyCoverageYears(adjusted),firstDate=adjusted[0]?.date,lastDate=adjusted.at(-1)?.date,firstTrade=chart.firstTrade;
      const inceptionComplete=firstTrade&&Math.abs(new Date(`${firstDate}T00:00:00Z`)-new Date(`${firstTrade}T00:00:00Z`))<=45*86400000;
      const sufficient=historySourceIsSufficient({densityOk:density.ok,coverageYears:coverage,inceptionComplete});
      attempts.push(`${symbol}: ${coverage.toFixed(1)}年 / ${adjusted.length}日線 / ${density.rowsPerYear.toFixed(0)}筆/年 / ${firstDate}→${lastDate}`);
      if(sufficient)return{symbol,chart,coverageYears:coverage,isProxy:symbol!==src.preferred,inceptionComplete,attempts,density};
      throw new Error(`coverage insufficient (${coverage.toFixed(1)}y, inceptionComplete=${Boolean(inceptionComplete)})`);
    }catch(e){attempts.push(`${symbol}: ${e.message}`)}
    await sleep(300);
  }
  throw new Error(`無法取得足夠且密集的 daily history；${attempts.join('；')}`);
}

async function getWealth(env){
  const settingsRows=await env.DB.prepare('SELECT key,value FROM wealth_settings').all();
  const settings=Object.fromEntries(settingsRows.results.map(r=>[r.key,r.value]));
  const fxRow=await env.DB.prepare("SELECT * FROM fx_rates WHERE pair='USDTWD'").first();
  const jpyFxRow=await env.DB.prepare("SELECT * FROM fx_rates WHERE pair='JPYTWD'").first();
  const fx=Number(fxRow?.rate||0),jpyFx=Number(jpyFxRow?.rate||0);
  const {results}=await env.DB.prepare('SELECT * FROM wealth_positions WHERE shares>0.00000001 ORDER BY market,broker,ticker').all();
  const tx=await env.DB.prepare('SELECT * FROM wealth_transactions ORDER BY trade_date DESC,id DESC LIMIT 500').all();
  const allTx=tx.results;
  const rows=results.map(r=>{
    const shares=Number(r.shares||0),costNative=Number(r.cost_native||0),costTwd=Number(r.cost_twd||0),price=Number(r.price||0);
    const nativeValue=shares*price,currentTwd=r.market==='US'?nativeValue*fx:nativeValue;
    const nativeGain=nativeValue-costNative,nativeReturn=costNative?nativeGain/costNative*100:0,twdGain=currentTwd-costTwd,twdReturn=costTwd?twdGain/costTwd*100:0;
    const costFx=r.market==='US'&&costNative?costTwd/costNative:0;
    const priceContributionTwd=r.market==='US'?nativeGain*costFx:twdGain;
    const fxImpactTwd=r.market==='US'?twdGain-priceContributionTwd:0;
    const ownTx=allTx.filter(x=>x.market===r.market&&x.broker===r.broker&&x.ticker===r.ticker),invested=ownTx.filter(x=>x.type==='OPENING'||x.type==='BUY').reduce((a,x)=>a+Number(x.amount_twd||0),0),recovered=ownTx.filter(x=>x.type==='SELL').reduce((a,x)=>a+(r.market==='TW'?Number(x.amount_twd||x.amount_native||0):Number(x.amount_twd||0)),0),recoveryPct=invested?recovered/invested*100:0,capitalAtRisk=Math.max(0,invested-recovered),freePosition=shares>0&&((invested>0&&recovered+0.01>=invested)||(costTwd===0&&costNative===0));
    return {...r,shares,cost_native:costNative,cost_twd:costTwd,price,native_value:nativeValue,current_twd:currentTwd,native_gain:nativeGain,native_return_pct:nativeReturn,twd_gain:twdGain,twd_return_pct:twdReturn,cost_fx:costFx,fx_impact_twd:fxImpactTwd,capital_in_twd:invested,capital_recovered_twd:recovered,capital_recovery_pct:recoveryPct,capital_at_risk_twd:capitalAtRisk,free_position:freePosition};
  });
  const cashTwd=Number(settings.cash_twd||0),cashUsd=Number(settings.cash_usd||0),cashJpy=Number(settings.cash_jpy||0),cashUsdTwd=cashUsd*fx,cashJpyTwd=cashJpy*jpyFx;
  const twValue=rows.filter(r=>r.market==='TW').reduce((a,r)=>a+r.current_twd,0),usUsd=rows.filter(r=>r.market==='US').reduce((a,r)=>a+r.native_value,0),usTwd=rows.filter(r=>r.market==='US').reduce((a,r)=>a+r.current_twd,0);
  const cost=rows.reduce((a,r)=>a+r.cost_twd,0),total=twValue+usTwd+cashTwd+cashUsdTwd+cashJpyTwd,gain=(twValue+usTwd)-cost,target=Number(settings.freedom_target_twd||0);
  const snaps=await env.DB.prepare('SELECT * FROM wealth_snapshots ORDER BY snapshot_date DESC LIMIT 120').all();
  const dividends=allTx.filter(r=>r.type==='DIVIDEND').reduce((a,r)=>a+Number(r.amount_twd||0),0);
  return reply({rows,transactions:allTx,settings:{freedom_target_twd:target,cash_twd:cashTwd,cash_usd:cashUsd,cash_jpy:cashJpy},fx:fxRow||null,jpy_fx:jpyFxRow||null,summary:{total_value_twd:total,invested_cost_twd:cost,investment_gain_twd:gain,investment_return_pct:cost?gain/cost*100:0,tw_value_twd:twValue,us_value_usd:usUsd,us_value_twd:usTwd,cash_value_twd:cashTwd+cashUsdTwd+cashJpyTwd,cash_jpy_twd:cashJpyTwd,dividend_income_twd:dividends,freedom_pct:target?total/target*100:0,freedom_remaining_twd:Math.max(0,target-total)},snapshots:snaps.results.reverse()});
}

function normalizeWealthTx(b){
  const type=String(b.type||'').toUpperCase(),market=String(b.market||'').toUpperCase(),broker=String(b.broker||'').trim().slice(0,60),ticker=String(b.ticker||'').trim().toUpperCase().slice(0,20),name=String(b.name||'').trim().slice(0,100),tradeDate=String(b.trade_date||'').slice(0,10),shares=Number(b.shares||0),amountNative=Number(b.amount_native||0),amountTwd=Number(b.amount_twd||0),note=String(b.note||'').trim().slice(0,300);
  if(!['OPENING','BUY','SELL','DIVIDEND'].includes(type))throw httpError(400,'紀錄類型錯誤');
  if(!['TW','US'].includes(market)||!broker||!ticker)throw httpError(400,'市場、券商與股票代號為必填');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate))throw httpError(400,'日期格式錯誤');
  if(![shares,amountNative,amountTwd].every(Number.isFinite)||shares<0||amountNative<0||amountTwd<0)throw httpError(400,'股數或金額格式錯誤');
  if(type==='DIVIDEND'&&!(amountTwd>0))throw httpError(400,'配息請輸入實際入帳台幣金額');
  if(type!=='DIVIDEND'&&!(shares>0))throw httpError(400,'股數必須大於 0');
  if(['OPENING','BUY'].includes(type)&&!(amountNative>=0&&amountTwd>=0))throw httpError(400,'成本金額錯誤');
  if(type==='SELL'&&!(amountNative>0||amountTwd>0))throw httpError(400,'賣出請輸入成交／入帳金額');
  return{type,market,broker,ticker,name,trade_date:tradeDate,shares,amount_native:amountNative,amount_twd:amountTwd,note};
}
function calculateWealthPosition(tx){
  let shares=0,costNative=0,costTwd=0;
  for(const r of [...tx].sort((a,b)=>String(a.trade_date).localeCompare(String(b.trade_date))||Number(a.id||0)-Number(b.id||0))){
    const q=Number(r.shares||0),an=Number(r.amount_native||0),at=Number(r.amount_twd||0);
    if(r.type==='OPENING'||r.type==='BUY'){shares+=q;costNative+=an;costTwd+=at}
    else if(r.type==='SELL'){if(q>shares+1e-8)throw httpError(400,`${r.trade_date} 賣出股數超過當時庫存`);const avgN=shares?costNative/shares:0,avgT=shares?costTwd/shares:0;shares-=q;costNative=Math.max(0,costNative-avgN*q);costTwd=Math.max(0,costTwd-avgT*q)}
  }
  return{shares:Math.max(0,shares),cost_native:Math.max(0,costNative),cost_twd:Math.max(0,costTwd)};
}
function wealthCashImpact(r){
  if(r.type==='DIVIDEND')return{twd:Number(r.amount_twd||0),usd:0};
  if(r.type!=='SELL')return{twd:0,usd:0};
  if(r.market==='TW')return{twd:Number(r.amount_twd||r.amount_native||0),usd:0};
  return Number(r.amount_twd||0)>0?{twd:Number(r.amount_twd),usd:0}:{twd:0,usd:Number(r.amount_native||0)};
}
async function validateAndBuildPosition(env,newTx,editingId=null){
  const q=await env.DB.prepare('SELECT * FROM wealth_transactions WHERE market=? AND broker=? AND ticker=? ORDER BY trade_date,id').bind(newTx.market,newTx.broker,newTx.ticker).all();
  const list=q.results.filter(r=>Number(r.id)!==Number(editingId));
  if(newTx.type!=='DIVIDEND')list.push({...newTx,id:editingId||Number.MAX_SAFE_INTEGER});
  return calculateWealthPosition(list);
}
async function upsertCalculatedPosition(env,tx,pos,now){
  if(Number(pos.shares||0)<=0.00000001){await env.DB.prepare('DELETE FROM wealth_positions WHERE market=? AND broker=? AND ticker=?').bind(tx.market,tx.broker,tx.ticker).run();return;}
  const old=await env.DB.prepare('SELECT price,price_date,price_source FROM wealth_positions WHERE market=? AND broker=? AND ticker=?').bind(tx.market,tx.broker,tx.ticker).first();
  await env.DB.prepare(`INSERT INTO wealth_positions (market,broker,ticker,name,shares,cost_native,cost_twd,price,price_date,price_source,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(market,broker,ticker) DO UPDATE SET name=excluded.name,shares=excluded.shares,cost_native=excluded.cost_native,cost_twd=excluded.cost_twd,updated_at=excluded.updated_at`).bind(tx.market,tx.broker,tx.ticker,tx.name,pos.shares,pos.cost_native,pos.cost_twd,Number(old?.price||0),old?.price_date||null,old?.price_source||'',now).run();
}

async function adjustWealthCash(env,deltaTwd,deltaUsd,now){
  if(Math.abs(deltaTwd)<1e-9&&Math.abs(deltaUsd)<1e-9)return;
  const rows=await env.DB.prepare("SELECT key,value FROM wealth_settings WHERE key IN ('cash_twd','cash_usd')").all(),m=Object.fromEntries(rows.results.map(r=>[r.key,Number(r.value||0)]));
  const nextT=Math.max(0,(m.cash_twd||0)+deltaTwd),nextU=Math.max(0,(m.cash_usd||0)+deltaUsd);
  await env.DB.batch([env.DB.prepare("UPDATE wealth_settings SET value=?,updated_at=? WHERE key='cash_twd'").bind(String(nextT),now),env.DB.prepare("UPDATE wealth_settings SET value=?,updated_at=? WHERE key='cash_usd'").bind(String(nextU),now)]);
}
async function saveWealthTransaction(request,env){
  const tx=normalizeWealthTx(await request.json()),now=new Date().toISOString(),pos=await validateAndBuildPosition(env,tx);
  const ins=await env.DB.prepare(`INSERT INTO wealth_transactions (trade_date,type,market,broker,ticker,name,shares,amount_native,amount_twd,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).bind(tx.trade_date,tx.type,tx.market,tx.broker,tx.ticker,tx.name,tx.shares,tx.amount_native,tx.amount_twd,tx.note,now,now).first();
  if(tx.type!=='DIVIDEND')await upsertCalculatedPosition(env,tx,pos,now);
  const impact=wealthCashImpact(tx);await adjustWealthCash(env,impact.twd,impact.usd,now);
  return reply({ok:true,id:ins?.id});
}
async function updateWealthTransaction(request,env,id){
  const old=await env.DB.prepare('SELECT * FROM wealth_transactions WHERE id=?').bind(id).first();if(!old)throw httpError(404,'找不到這筆紀錄');
  const tx=normalizeWealthTx(await request.json()),now=new Date().toISOString();
  const oldKey=`${old.market}|${old.broker}|${old.ticker}`,newKey=`${tx.market}|${tx.broker}|${tx.ticker}`;
  const newPos=await validateAndBuildPosition(env,tx,id);
  let oldPos=null;if(oldKey!==newKey){const q=await env.DB.prepare('SELECT * FROM wealth_transactions WHERE market=? AND broker=? AND ticker=? AND id<>? ORDER BY trade_date,id').bind(old.market,old.broker,old.ticker,id).all();oldPos=calculateWealthPosition(q.results)}
  await env.DB.prepare(`UPDATE wealth_transactions SET trade_date=?,type=?,market=?,broker=?,ticker=?,name=?,shares=?,amount_native=?,amount_twd=?,note=?,updated_at=? WHERE id=?`).bind(tx.trade_date,tx.type,tx.market,tx.broker,tx.ticker,tx.name,tx.shares,tx.amount_native,tx.amount_twd,tx.note,now,id).run();
  if(oldKey!==newKey)await upsertCalculatedPosition(env,old,oldPos,now);
  await upsertCalculatedPosition(env,tx,newPos,now);
  const oi=wealthCashImpact(old),ni=wealthCashImpact(tx);await adjustWealthCash(env,ni.twd-oi.twd,ni.usd-oi.usd,now);
  return reply({ok:true});
}
async function deleteWealthTransaction(env,id){
  const old=await env.DB.prepare('SELECT * FROM wealth_transactions WHERE id=?').bind(id).first();if(!old)throw httpError(404,'找不到這筆紀錄');
  const now=new Date().toISOString();
  let pos=null;
  if(old.type!=='DIVIDEND'){
    const q=await env.DB.prepare('SELECT * FROM wealth_transactions WHERE market=? AND broker=? AND ticker=? AND id<>? ORDER BY trade_date,id').bind(old.market,old.broker,old.ticker,id).all();
    pos=calculateWealthPosition(q.results);
  }
  await env.DB.prepare('DELETE FROM wealth_transactions WHERE id=?').bind(id).run();
  if(old.type!=='DIVIDEND')await upsertCalculatedPosition(env,old,pos,now);
  const impact=wealthCashImpact(old);await adjustWealthCash(env,-impact.twd,-impact.usd,now);
  return reply({ok:true});
}
async function saveWealthSettings(request,env){
  const b=await request.json(),now=new Date().toISOString(),pairs=[['freedom_target_twd',Number(b.freedom_target_twd)],['cash_twd',Number(b.cash_twd)],['cash_usd',Number(b.cash_usd)],['cash_jpy',Number(b.cash_jpy||0)]];
  if(pairs.some(([,v])=>!Number.isFinite(v)||v<0))throw httpError(400,'設定金額不正確');
  await env.DB.batch(pairs.map(([k,v])=>env.DB.prepare(`INSERT INTO wealth_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(k,String(v),now)));return reply({ok:true});
}
async function refreshWealth(env,scope='all'){
  const now=new Date().toISOString(),positions=(await env.DB.prepare('SELECT * FROM wealth_positions WHERE shares>0.00000001 ORDER BY id').all()).results,updates=[],errors=[];
  let fxRow=await env.DB.prepare("SELECT * FROM fx_rates WHERE pair='USDTWD'").first();
  if(scope!=='tw')try{const s=await fetchYahooSeries('TWD=X');const q=quoteFromSeries(s);fxRow={pair:'USDTWD',rate:q.price,rate_date:q.date,fetched_at:now,source:'Yahoo Finance'};updates.push(env.DB.prepare(`INSERT INTO fx_rates (pair,rate,rate_date,fetched_at,source) VALUES ('USDTWD',?,?,?,?) ON CONFLICT(pair) DO UPDATE SET rate=excluded.rate,rate_date=excluded.rate_date,fetched_at=excluded.fetched_at,source=excluded.source`).bind(q.price,q.date,now,'Yahoo Finance'))}catch(e){errors.push('USD/TWD: '+e.message+'（沿用前次匯率）')}
  if(scope!=='tw')try{const s=await fetchYahooSeries('JPY=X');const q=quoteFromSeries(s),usdTwd=Number(fxRow?.rate||0);if(!(usdTwd>0&&q.price>0))throw new Error('匯率格式錯誤');const rate=usdTwd/q.price;updates.push(env.DB.prepare(`INSERT INTO fx_rates (pair,rate,rate_date,fetched_at,source) VALUES ('JPYTWD',?,?,?,?) ON CONFLICT(pair) DO UPDATE SET rate=excluded.rate,rate_date=excluded.rate_date,fetched_at=excluded.fetched_at,source=excluded.source`).bind(rate,q.date,now,'Yahoo Finance'))}catch(e){errors.push('JPY/TWD: '+e.message+'（沿用前次匯率）')}
  const quoteCache=new Map();
  for(const r of positions){
    if(scope==='tw'&&r.market!=='TW')continue;if(scope==='us'&&r.market!=='US')continue;
    try{
      let q,source;
      if(r.market==='US'){
        if(!quoteCache.has(r.ticker)){
          const stored=await env.DB.prepare('SELECT price,price_date,fetched_at,source FROM prices WHERE ticker=?').bind(r.ticker).first();
          const fresh=stored?.fetched_at&&(Date.now()-new Date(stored.fetched_at).getTime())<30*60*1000&&Number(stored.price)>0;
          if(fresh)quoteCache.set(r.ticker,{price:Number(stored.price),date:stored.price_date});
          else{quoteCache.set(r.ticker,quoteFromSeries(await fetchYahooSeries(r.ticker)));await sleep(120)}
        }
        q=quoteCache.get(r.ticker);source='Yahoo Finance';
      }else{q=await fetchTwseClose(r.ticker);source=q.source}
      updates.push(env.DB.prepare('UPDATE wealth_positions SET price=?,price_date=?,price_source=?,updated_at=? WHERE id=?').bind(q.price,q.date,source,now,r.id));
    }catch(e){errors.push(`${r.ticker}: ${e.message}（沿用前次價格）`)}
  }
  if(updates.length)await env.DB.batch(updates);
  await writeWealthSnapshot(env,now);return{ok:errors.length===0,errors,fetched_at:now,scope,updated:updates.length};
}

async function fetchTwseClose(ticker){
  const d=new Date(),date=`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}01`,url=`https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(ticker)}`;
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 CapitalOS/2.4','accept':'application/json'}});if(!r.ok)throw new Error(`TWSE HTTP ${r.status}`);const j=await r.json();if(j.stat!=='OK'||!j.data?.length)throw new Error('TWSE 無收盤資料');const row=j.data.at(-1),parts=row[0].split('/').map(Number),price=Number(String(row[6]).replace(/,/g,''));if(!Number.isFinite(price))throw new Error('TWSE 價格格式錯誤');return{price,date:`${parts[0]+1911}-${String(parts[1]).padStart(2,'0')}-${String(parts[2]).padStart(2,'0')}`,source:'TWSE'};
}
async function writeWealthSnapshot(env,now){
  const settingsRows=await env.DB.prepare('SELECT key,value FROM wealth_settings').all(),settings=Object.fromEntries(settingsRows.results.map(r=>[r.key,r.value])),fx=Number((await env.DB.prepare("SELECT rate FROM fx_rates WHERE pair='USDTWD'").first())?.rate||0),jpyFx=Number((await env.DB.prepare("SELECT rate FROM fx_rates WHERE pair='JPYTWD'").first())?.rate||0),positions=(await env.DB.prepare('SELECT * FROM wealth_positions').all()).results;
  const tw=positions.filter(r=>r.market==='TW').reduce((a,r)=>a+Number(r.shares)*Number(r.price),0),usUsd=positions.filter(r=>r.market==='US').reduce((a,r)=>a+Number(r.shares)*Number(r.price),0),usTwd=usUsd*fx,cashTwd=Number(settings.cash_twd||0),cashUsd=Number(settings.cash_usd||0),cashJpy=Number(settings.cash_jpy||0),cost=positions.reduce((a,r)=>a+Number(r.cost_twd||0),0),total=tw+usTwd+cashTwd+cashUsd*fx+cashJpy*jpyFx,gain=tw+usTwd-cost,date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(now));
  await env.DB.prepare(`INSERT INTO wealth_snapshots (snapshot_date,tw_market_value_twd,us_market_value_usd,us_market_value_twd,cash_twd,cash_usd,usd_twd,total_value_twd,total_cost_twd,total_gain_twd,captured_at,cash_jpy,jpy_twd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(snapshot_date) DO UPDATE SET tw_market_value_twd=excluded.tw_market_value_twd,us_market_value_usd=excluded.us_market_value_usd,us_market_value_twd=excluded.us_market_value_twd,cash_twd=excluded.cash_twd,cash_usd=excluded.cash_usd,usd_twd=excluded.usd_twd,total_value_twd=excluded.total_value_twd,total_cost_twd=excluded.total_cost_twd,total_gain_twd=excluded.total_gain_twd,captured_at=excluded.captured_at,cash_jpy=excluded.cash_jpy,jpy_twd=excluded.jpy_twd`).bind(date,tw,usUsd,usTwd,cashTwd,cashUsd,fx,total,cost,gain,now,cashJpy,jpyFx).run();
}

function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers:jsonHeaders})}function httpError(status,message){const e=new Error(message);e.status=status;return e}
