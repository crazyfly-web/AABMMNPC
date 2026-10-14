const $ = id => document.getElementById(id);
const colors = ['#5b8ff9','#61d9a1','#65789b','#f6bd16','#7262fd','#78d3f8','#9661bc','#a7b2bd'];
let portfolio = null;
let drawdown = null;

const usd = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(Number(n||0));
const num = (n,d=2) => new Intl.NumberFormat('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(n||0));
const pct = n => `${Number(n||0).toFixed(2)}%`;
const signedUsd = n => `${Number(n||0)>=0?'+':''}${usd(n)}`;
const money = text => `<span class="money-value">${text}</span>`;
const marketPnLClass = (market,value) => market==='TW' ? (Number(value)>=0?'tw-profit':'tw-loss') : (Number(value)>=0?'us-profit':'us-loss');
const returnLabel = (value,free) => free?'FREE':signedPct(value);
let wealthPrivacy = localStorage.getItem('capitalos_wealth_privacy')==='1';
let radarPrivacy = localStorage.getItem('capitalos_radar_privacy')==='1';

async function api(path, options={}){
  const response = await fetch(path, options);
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function load(){
  try{
    const [p,t,m] = await Promise.all([api('/api/portfolio'),api('/api/transactions'),api('/api/momentum')]);
    portfolio=p; renderPortfolio(p); renderLogs(t.transactions); renderMomentum(m);
  }catch(e){ $('updatedAt').textContent=`載入失敗：${e.message}`; }
}

function needClass(value){
  if(value > 500) return 'glow';
  if(value > 0) return 'near';
  if(value < -0.01) return 'over';
  return 'zero';
}

function needText(value){
  if(Math.abs(value) < 0.01) return usd(0);
  return `${value>0?'+':''}${usd(value)}`;
}

function prefillBuy(ticker, amount){
  if(!(amount > 0)) return;
  $('action').value='BUY';
  $('action').dispatchEvent(new Event('change'));
  $('ticker').value=ticker;
  $('totalAmount').value=amount.toFixed(2);
  $('note').value=`依目標配置加碼 ${ticker}`;
  $('transactionForm').scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>$('shares').focus(),350);
}

function renderPortfolio(data){
  const s=data.summary;
  $('totalValue').innerHTML=money(usd(s.total_value));
  $('totalGain').innerHTML=money(`${s.total_gain>=0?'+':''}${usd(s.total_gain)}`);
  $('totalGain').className=s.total_gain>=0?'positive':'negative';
  $('totalReturn').textContent=`${s.total_return_pct>=0?'+':''}${pct(s.total_return_pct)}`;
  $('stockCost').innerHTML=money(usd(s.total_cost));
  $('stockValue').innerHTML=money(usd(s.stock_value));
  $('stockGain').innerHTML=money(`${s.total_gain>=0?'+':''}${usd(s.total_gain)}`);
  $('stockGain').className=s.total_gain>=0?'positive':'negative';
  $('stockReturn').textContent=`${s.total_return_pct>=0?'+':''}${pct(s.total_return_pct)}`;
  $('stockReturn').className=s.total_return_pct>=0?'positive':'negative';
  $('cashValue').innerHTML=money(usd(s.cash));
  $('cashWeight').textContent=`目前 ${pct(data.rows.find(r=>r.ticker==='CASH')?.current_weight)}`;
  $('updatedAt').textContent=s.last_price_update?`收盤價最後更新：${new Date(s.last_price_update).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}`:'尚未取得收盤價，部署後請按「更新股價」';
  const health=s.data_health||{};
  const healthy=Number(health.failure_count||0)===0 && Number(health.success_count||0)===7;
  $('dataHealth').innerHTML=`<span class="health-dot ${healthy?'ok':'warn'}"></span><span>來源：${health.source||'Yahoo Finance'}</span><span>價格日期：${s.latest_price_date||'—'}</span><span>成功 ${Number(health.success_count||0)}/7</span><span>每日 06:30 自動更新</span><span>目標規模：${money(usd(s.target_portfolio_value_usd))}</span>`;

  const alerts=data.rows.filter(r=>Math.abs(r.current_weight-r.target_weight)>=s.rebalance_threshold);
  $('rebalanceStatus').textContent=alerts.length?`${alerts.length} 項偏離`:'配置正常';
  $('rebalanceStatus').className=alerts.length?'negative':'positive';

  const stocks=data.rows.filter(r=>r.ticker!=='CASH');
  const priorities=[...stocks].filter(r=>r.amount_needed>0).sort((a,b)=>b.amount_needed-a.amount_needed).slice(0,3);
  $('priorityList').innerHTML=priorities.length?priorities.map((r,i)=>`<button type="button" class="priority-item" data-ticker="${r.ticker}" data-amount="${r.amount_needed}"><span><span class="priority-rank">優先 ${i+1}</span><span class="priority-ticker">${r.ticker}</span></span><span class="priority-amount">${money('+'+usd(r.amount_needed))}</span></button>`).join(''):'<p class="muted">所有股票都已達到目標投入額。</p>';
  document.querySelectorAll('.priority-item').forEach(el=>el.addEventListener('click',()=>prefillBuy(el.dataset.ticker,Number(el.dataset.amount))));

  $('portfolioBody').innerHTML=data.rows.map(r=>{
    const delta=r.current_weight-r.target_weight;
    const alert=Math.abs(delta)>=s.rebalance_threshold;
    const isCash=r.ticker==='CASH';
    const ytd = Number(r.ytd_return_pct || 0);
    const ytdClass = ytd > 20 ? 'ytd-box ytd-highlight' : (ytd >= 0 ? 'positive' : 'negative');
    return `<tr><td><span class="ticker">${r.ticker}</span><span class="company">${r.name}</span></td>
      <td>${isCash?'—':r.price?usd(r.price):'尚無資料'}</td>
      <td>${isCash?'—':`<span class="${ytdClass}">${ytd>=0?'+':''}${pct(ytd)}</span>`}</td>
      <td>${isCash?'—':r.average_cost?money(usd(r.average_cost)):'—'}</td>
      <td><span class="sensitive-units">${isCash?'—':num(r.shares,4).replace(/\.0+$/,'')}</span></td>
      <td class="${r.gain>=0?'positive':'negative'}">${isCash?'—':money(`${r.gain>=0?'+':''}${usd(r.gain)}`)}</td>
      <td class="${r.return_pct>=0?'positive':'negative'}">${isCash?'—':`${r.return_pct>=0?'+':''}${pct(r.return_pct)}`}</td>

      <td>${money(usd(r.market_value))}</td><td>${pct(r.target_weight)}</td>
      <td class="${alert?'weight-alert':''}">${pct(r.current_weight)}<span class="company">${delta>=0?'+':''}${pct(delta)}</span></td>
      <td>${money(usd(r.target_investment))}</td>
      <td>${isCash?money(usd(r.amount_needed)):`<button type="button" class="need-box ${needClass(r.amount_needed)}" data-ticker="${r.ticker}" data-amount="${r.amount_needed}" title="點擊帶入買進表單">${needText(r.amount_needed)}</button>`}</td></tr>`;
  }).join('');
  document.querySelectorAll('.need-box').forEach(el=>el.addEventListener('click',()=>prefillBuy(el.dataset.ticker,Number(el.dataset.amount))));

  const total=data.rows.reduce((a,r)=>a+r.current_weight,0)||100;
  $('allocationBar').innerHTML=data.rows.map((r,i)=>{
    const alert=Math.abs(r.current_weight-r.target_weight)>=s.rebalance_threshold;
    return `<div class="segment ${alert?'alert':''}" title="${r.ticker} ${pct(r.current_weight)}" style="width:${r.current_weight/total*100}%;background:${colors[i]}"></div>`;
  }).join('');
  $('allocationLegend').innerHTML=data.rows.map((r,i)=>{
    const delta=r.current_weight-r.target_weight;
    const alert=Math.abs(delta)>=s.rebalance_threshold;
    return `<div class="legend-item"><span class="dot" style="background:${colors[i]}"></span><strong>${r.ticker}</strong><span class="${alert?'weight-alert':''}">${pct(r.current_weight)}</span><small>目標 ${pct(r.target_weight)} · 偏離 ${delta>=0?'+':''}${pct(delta)} · 尚需 ${money(needText(r.amount_needed))}</small></div>`;
  }).join('');
}

function applyRadarPrivacy(){
  $('radarPage').classList.toggle('radar-privacy-on',radarPrivacy);
  $('radarPrivacyBtn').textContent=radarPrivacy?'🙈 顯示資產':'👁 隱私模式';
}

function renderMomentum(data){
  const rows=data.rows||[];
  $('portfolioMomentum').textContent=data.portfolio_momentum==null?'—':`${Math.round(data.portfolio_momentum)} / 100`;
  const pTrail=(data.portfolio_trail||[]).map(x=>Math.round(Number(x.score))).join(' · ');
  $('portfolioMomentumTrail').textContent=pTrail||'—';
  $('momentumDate').textContent=data.trade_date?`資料日 ${data.trade_date}`:'尚無資料';
  $('momentumBrief').textContent=data.brief||'尚無動能資料。';
  if(!rows.length){$('momentumHeatmap').innerHTML='<p class="muted">請按「更新股價」建立第一筆 Momentum 8 資料。</p>';$('momentumBody').innerHTML='';return;}
  const stateClass=s=>String(s||'').toLowerCase();
  $('momentumHeatmap').innerHTML=rows.map(r=>`<div class="momentum-chip ${stateClass(r.state)}"><strong>${r.ticker}${r.ticker==='MU'?'<span class="challenger">CHALLENGER</span>':''}</strong><span class="chip-score">${Math.round(r.momentum_score)} ${r.trend}</span><span>Entry ${Math.round(r.entry_score)} · ${r.state}</span></div>`).join('');
  $('momentumBody').innerHTML=rows.map((r,i)=>{
    const m=Number(r.momentum_score),e=Number(r.entry_score),trendClass=r.trend==='↑'?'trend-up':r.trend==='↓'?'trend-down':'trend-flat';
    const mClass=m>=88&&e<65?'hot':m>=80?'high':'';
    const trail=(r.trail||[]).map(x=>Math.round(Number(x))).join('·');
    return `<tr><td>${i+1}</td><td><span class="ticker">${r.ticker}</span>${r.ticker==='MU'?'<span class="challenger">候補</span>':''}</td><td>${usd(r.price)}</td><td><span class="score-pill ${mClass}">${Math.round(m)}</span><span class="cell-trail">${trail}</span></td><td class="${trendClass}">${r.trend} ${r.score_change?`${r.score_change>0?'+':''}${Number(r.score_change).toFixed(0)}`:''}</td><td><span class="score-pill ${e>=80?'high':''}">${Math.round(e)}</span></td><td><span class="state-tag ${stateClass(r.state)}">${r.state}</span></td><td>${num(r.rsv,1)}</td><td>${num(r.k,1)}</td><td>${num(r.d,1)}</td><td>${usd(r.ma20)}</td><td>${usd(r.ma60)}</td><td class="${Number(r.distance_ma20_pct)>15?'negative':''}">${Number(r.distance_ma20_pct)>=0?'+':''}${pct(r.distance_ma20_pct)}</td><td>${num(r.volume_ratio20,2)}×</td><td class="${Number(r.rs20_qqq)>=0?'positive':'negative'}">${Number(r.rs20_qqq)>=0?'+':''}${pct(r.rs20_qqq)}</td></tr>`;
  }).join('');
  applyRadarPrivacy();
}

function renderLogs(rows){
  if(!rows.length){$('logList').innerHTML='<p class="muted">尚無紀錄</p>';return;}
  const names={BUY:'買進',SELL:'賣出',CASH_ADD:'增加現金',CASH_REMOVE:'提領現金',ADJUST:'初始持倉'};
  $('logList').innerHTML=rows.map(r=>`<div class="log-row"><time>${r.trade_date}</time><div class="log-action">${names[r.action]||r.action}</div><div><strong>${r.ticker||'CASH'} ${r.shares?`<span class="sensitive-units">${num(r.shares,4).replace(/\.0+$/,'')} 股</span>`:''}</strong><div class="log-note">${r.note||'—'}</div></div><div>${money(usd(r.total_amount))}</div></div>`).join('');
}

function getToken(){return sessionStorage.getItem('big7_admin_token')||''}
async function ensureToken(){
  if(getToken()) return getToken();
  return new Promise(resolve=>{
    const d=$('authDialog'); d.showModal();
    $('saveTokenBtn').onclick=()=>{const v=$('adminToken').value.trim();if(v)sessionStorage.setItem('big7_admin_token',v);resolve(v)};
    d.addEventListener('close',()=>resolve(getToken()),{once:true});
  });
}

$('action').addEventListener('change',()=>{
  const cash=$('action').value.startsWith('CASH');
  $('tickerField').hidden=cash; $('sharesField').hidden=cash;
  $('shares').required=!cash;
});
$('tradeDate').value=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});

$('transactionForm').addEventListener('submit',async e=>{
  e.preventDefault(); const token=await ensureToken(); if(!token)return;
  const button=e.submitter; button.disabled=true; $('formMessage').textContent='正在儲存…';
  try{
    const action=$('action').value;
    const body={trade_date:$('tradeDate').value,action,ticker:action.startsWith('CASH')?null:$('ticker').value,shares:action.startsWith('CASH')?0:Number($('shares').value),total_amount:Number($('totalAmount').value),note:$('note').value};
    await api('/api/transactions',{method:'POST',headers:{'content-type':'application/json','x-admin-token':token},body:JSON.stringify(body)});
    $('formMessage').textContent='已儲存。'; $('shares').value='';$('totalAmount').value='';$('note').value=''; await load();
  }catch(err){$('formMessage').textContent=err.message;if(err.message.includes('密碼'))sessionStorage.removeItem('big7_admin_token')}
  finally{button.disabled=false}
});

$('refreshBtn').addEventListener('click',async()=>{
  const token=await ensureToken();if(!token)return;
  $('refreshBtn').disabled=true;$('refreshBtn').textContent='更新中…';
  try{const r=await api('/api/prices/refresh',{method:'POST',headers:{'x-admin-token':token}});if(r.errors?.length)alert(`Yahoo 暫時限制部分報價更新（${r.errors.length} 項）。系統已保留前次成功資料，可稍後再更新。`);await load()}catch(e){alert(e.message)}finally{$('refreshBtn').disabled=false;$('refreshBtn').textContent='更新股價'}
});

$('setCashBtn').addEventListener('click',async()=>{
  const current=portfolio?.summary?.cash||0; const value=prompt('輸入目前現金餘額（USD）',String(current));if(value===null)return;
  const amount=Number(value);if(!Number.isFinite(amount)||amount<0){alert('金額不正確');return}
  const token=await ensureToken();if(!token)return;
  try{await api('/api/cash',{method:'POST',headers:{'content-type':'application/json','x-admin-token':token},body:JSON.stringify({amount})});await load()}catch(e){alert(e.message)}
});

load();

// v2.4 Wealth Dashboard
let wealth = null;
const twd = n => new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0}).format(Number(n||0));
const twPrice = n => new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(n||0));
const signedTwd = n => `${Number(n)>=0?'+':''}${twd(n)}`;
const signedPct = n => `${Number(n)>=0?'+':''}${pct(n)}`;

document.querySelectorAll('.app-tab').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.app-tab').forEach(x=>x.classList.toggle('active',x===btn));
  $('radarPage').classList.toggle('active',btn.dataset.tab==='radar');
  $('wealthPage').classList.toggle('active',btn.dataset.tab==='wealth');
  $('drawdownPage').classList.toggle('active',btn.dataset.tab==='drawdown');
  if(btn.dataset.tab==='wealth') loadWealth();
  if(btn.dataset.tab==='drawdown') loadDrawdown();
}));

async function loadWealth(){
  try{wealth=await api('/api/wealth');renderWealth(wealth)}catch(e){$('wealthUpdatedAt').textContent=`載入失敗：${e.message}`}
}
function applyWealthPrivacy(){
  $('wealthPage').classList.toggle('privacy-on',wealthPrivacy);
  $('wealthPrivacyBtn').textContent=wealthPrivacy?'🙈 顯示金額':'👁 隱藏金額';
}
function renderWealth(data){
  const s=data.summary,fx=Number(data.fx?.rate||0),jpyFx=Number(data.jpy_fx?.rate||0),target=Number(data.settings.freedom_target_twd||0);
  $('wealthTotal').innerHTML=money(twd(s.total_value_twd));
  $('wealthTotalGain').innerHTML=`<span class="wealth-gain-label">投資損益</span><span class="wealth-gain-amount">${money(signedTwd(s.investment_gain_twd))}</span><span class="wealth-gain-pct">${signedPct(s.investment_return_pct)}</span>`;
  $('wealthTotalGain').className=s.investment_gain_twd>=0?'positive':'negative';
  $('freedomTarget').innerHTML=money(twd(target));$('freedomRemaining').innerHTML=`<span class="wealth-remaining-label">尚差</span><span class="wealth-remaining-amount">${money(twd(s.freedom_remaining_twd))}</span>`;
  $('freedomPct').textContent=`${Number(s.freedom_pct||0).toFixed(1)}%`;$('goalProgress').style.width=`${Math.min(100,Math.max(0,s.freedom_pct||0))}%`;
  $('fxRate').textContent=fx?`1 USD = NT$${fx.toFixed(3)}`:'—';$('fxDate').textContent=data.fx?`${data.fx.rate_date} · ${data.fx.source}`:'尚無匯率資料';
  $('jpyFxRate').textContent=jpyFx?`1 JPY = NT$${jpyFx.toFixed(4)}`:'—';$('jpyFxDate').textContent=data.jpy_fx?`${data.jpy_fx.rate_date} · ${data.jpy_fx.source}`:'尚無匯率資料';
  const dates=data.rows.map(r=>r.price_date).filter(Boolean).sort();$('wealthUpdatedAt').textContent=dates.length?`最新正式價格日：${dates.at(-1)} · 資產曲線採每日收盤快照`:'尚未建立庫存或取得收盤價';
  const twRows=data.rows.filter(r=>r.market==='TW'),usRows=data.rows.filter(r=>r.market==='US');
  renderInventoryStats('TW',twRows);renderInventoryStats('US',usRows);
  $('twWealthBody').innerHTML=twRows.length?twRows.map(r=>`<tr><td><span class="ticker">${r.ticker}${r.free_position?'<span class="free-badge">FREE</span>':''}</span><span class="company">${r.broker}${r.name?` · ${r.name}`:''}${r.free_position?` · 本金回收 ${pct(r.capital_recovery_pct)}`:''}</span></td><td><span class="sensitive-units">${num(r.shares,4).replace(/\.0+$/,'')}</span></td><td>${money(twd(r.cost_twd))}</td><td>${r.price?money(twPrice(r.price)):'—'}</td><td>${money(twd(r.current_twd))}</td><td class="${marketPnLClass('TW',r.twd_gain)}">${money(signedTwd(r.twd_gain))}</td><td class="${marketPnLClass('TW',r.twd_return_pct)}">${signedPct(r.twd_return_pct)}</td><td>${r.price_date||'—'}<span class="company">${r.price_source||''}</span></td></tr>`).join(''):'<tr><td colspan="8" class="empty-cell">尚未加入台股庫存</td></tr>';
  $('usWealthBody').innerHTML=usRows.length?usRows.map(r=>`<tr><td><span class="ticker">${r.ticker}${r.free_position?'<span class="free-badge">FREE</span>':''}</span><span class="company">${r.broker}${r.name?` · ${r.name}`:''}${r.free_position?` · 本金回收 ${pct(r.capital_recovery_pct)}`:''}</span></td><td><span class="sensitive-units">${num(r.shares,4).replace(/\.0+$/,'')}</span></td><td>${money(usd(r.cost_native))}</td><td>${money(usd(r.native_value))}</td><td class="${marketPnLClass('US',r.native_gain)}"><span class="pnl-stack">${money(signedUsd(r.native_gain))}<small>${returnLabel(r.native_return_pct,r.free_position)}</small></span></td><td>${money(twd(r.cost_twd))}<span class="company">成本匯率 ${r.cost_fx?num(r.cost_fx,3):'—'}</span></td><td>${money(twd(r.current_twd))}</td><td class="${marketPnLClass('US',r.twd_gain)}"><span class="pnl-stack">${money(signedTwd(r.twd_gain))}<small>${returnLabel(r.twd_return_pct,r.free_position)}</small></span></td><td class="${marketPnLClass('US',r.fx_impact_twd)}">${money(signedTwd(r.fx_impact_twd))}</td></tr>`).join(''):'<tr><td colspan="9" class="empty-cell">尚未加入美股庫存</td></tr>';
  renderWealthAllocation(s);renderWealthPerformance(data);renderWealthChart(data.snapshots||[]);renderWealthLedger(data.transactions||[]);applyWealthPrivacy();
}


function renderInventoryStats(market,rows){
  const el=$(market==='TW'?'twInventoryStats':'usInventoryStats');if(!el)return;
  const invested=rows.reduce((a,r)=>a+Number(r.cost_twd||0),0);
  const current=rows.reduce((a,r)=>a+Number(r.current_twd||0),0);
  const gain=current-invested;
  const rate=invested>0?gain/invested*100:null;
  const cls=marketPnLClass(market,gain);
  const rateText=rate===null?'FREE':signedPct(rate);
  el.innerHTML=`<span>累計投入：${money(twd(invested))}</span><span>目前總值：${money(twd(current))}</span><span class="${cls}">累計報酬：${money(signedTwd(gain))}（報酬率：${rateText}）</span>`;
}

function renderWealthLedger(rows){
  const labels={OPENING:'期初',BUY:'買入',SELL:'賣出',DIVIDEND:'配息'};
  $('wealthLedgerBody').innerHTML=rows.length?rows.map(r=>`<tr><td>${r.trade_date}</td><td><span class="tx-badge ${String(r.type).toLowerCase()}">${labels[r.type]||r.type}</span></td><td><span class="ticker">${r.ticker}</span><span class="company">${r.broker} · ${r.market}</span></td><td><span class="sensitive-units">${r.type==='DIVIDEND'?'—':num(r.shares,4).replace(/\.0+$/,'')}</span></td><td>${r.type==='DIVIDEND'?'—':money(r.market==='US'?usd(r.amount_native):twd(r.amount_native))}</td><td>${money(twd(r.amount_twd))}</td><td>${r.note||''}</td><td><div class="ledger-actions"><button class="mini-btn wealth-edit-btn" data-id="${r.id}">修改</button><button class="mini-btn danger wealth-delete-btn" data-id="${r.id}">刪除</button></div></td></tr>`).join(''):'<tr><td colspan="8" class="empty-cell">尚無投資流水紀錄</td></tr>';
  document.querySelectorAll('.wealth-edit-btn').forEach(b=>b.addEventListener('click',()=>startWealthEdit(Number(b.dataset.id))));
  document.querySelectorAll('.wealth-delete-btn').forEach(b=>b.addEventListener('click',()=>deleteWealthTx(Number(b.dataset.id))));
}
async function deleteWealthTx(id){
  const r=(wealth?.transactions||[]).find(x=>Number(x.id)===id);if(!r)return;
  if(!confirm(`確定刪除 ${r.trade_date} ${r.ticker} 的${({OPENING:'期初',BUY:'買入',SELL:'賣出',DIVIDEND:'配息'})[r.type]||r.type}紀錄？
刪除後會重新計算庫存與現金。`))return;
  const token=await ensureToken();if(!token)return;
  try{await api(`/api/wealth/transactions/${id}`,{method:'DELETE',headers:{'x-admin-token':token}});resetWealthForm();await loadWealth()}catch(e){alert(e.message)}
}

function renderWealthAllocation(s){
  const items=[['台股',s.tw_value_twd],['美股',s.us_value_twd],['現金',s.cash_value_twd]],total=Number(s.total_value_twd||0),parts=items.map(x=>total?x[1]/total*100:0),grad=`conic-gradient(#246bfe 0 ${parts[0]}%,#61d9a1 ${parts[0]}% ${parts[0]+parts[1]}%,#a7b2bd ${parts[0]+parts[1]}% 100%)`;
  $('wealthAllocation').innerHTML=`<div class="donut" style="background:${grad}"><div><strong>${money(twd(total))}</strong><span>總資產</span></div></div><div class="donut-legend">${items.map((x,i)=>`<div><i class="allocation-dot d${i}"></i><span>${x[0]}</span><strong>${total?pct(x[1]/total*100):'0.00%'}</strong><small>${money(twd(x[1]))}</small></div>`).join('')}</div>`;
}
function renderWealthPerformance(data){const s=data.summary,fxImpact=data.rows.filter(r=>r.market==='US').reduce((a,r)=>a+Number(r.fx_impact_twd||0),0);$('wealthPerformance').innerHTML=`<div><span>累積投入</span><strong>${money(twd(s.invested_cost_twd))}</strong></div><div><span>投資損益</span><strong class="${s.investment_gain_twd>=0?'positive':'negative'}">${money(signedTwd(s.investment_gain_twd))}</strong></div><div><span>累積報酬</span><strong class="${s.investment_return_pct>=0?'positive':'negative'}">${signedPct(s.investment_return_pct)}</strong></div><div><span>美股匯率影響</span><strong class="${fxImpact>=0?'positive':'negative'}">${money(signedTwd(fxImpact))}</strong></div><div><span>累計配息入帳</span><strong class="positive">${money(twd(s.dividend_income_twd||0))}</strong></div>`}

function renderWealthChart(rows){
  if(rows.length<2){$('wealthChart').innerHTML='<div class="chart-empty">每日收盤快照累積 2 天後開始顯示資產成長折線。</div>';return}
  const data=rows.slice(-60),last=data.at(-1),prev=data.at(-2),daily=Number(last.total_value_twd)-Number(prev.total_value_twd),dailyPct=Number(prev.total_value_twd)?daily/Number(prev.total_value_twd)*100:0,W=1000,H=260,pad=34,vals=data.flatMap(r=>[Number(r.total_value_twd),Number(r.total_cost_twd)]),min=Math.min(...vals)*.98,max=Math.max(...vals)*1.02,range=max-min||1;
  const pts=(key)=>data.map((r,i)=>`${pad+i*(W-pad*2)/(data.length-1)},${H-pad-(Number(r[key])-min)/range*(H-pad*2)}`).join(' ');
  $('wealthChart').innerHTML=`<div class="daily-change ${daily>=0?'positive':'negative'}"><span>較前一日</span><strong>${money(signedTwd(daily))}</strong><small>${signedPct(dailyPct)}</small></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="資產成長折線圖"><line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" class="chart-axis"/><polyline points="${pts('total_cost_twd')}" class="chart-line cost"/><polyline points="${pts('total_value_twd')}" class="chart-line value"/></svg><div class="chart-legend"><span><i class="line-key value"></i>總資產</span><span><i class="line-key cost"></i>累積投入</span><small>${data[0].snapshot_date} → ${data.at(-1).snapshot_date}</small></div>`;
}
function todayTaipei(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())}
function updateWealthTxLabels(){const type=$('wealthTxType').value,div=type==='DIVIDEND',sell=type==='SELL';$('wealthSharesLabel').firstChild.textContent=div?'股數（配息可留空）':'股數';$('wealthNativeLabel').firstChild.textContent=div?'原幣股息（可留空）':sell?'賣出金額（原幣）':'投入成本（原幣）';$('wealthTwdLabel').firstChild.textContent=div?'實際入帳（TWD）':sell?'實際入帳（TWD）':'實際投入（TWD）';$('wealthShares').required=!div;$('wealthCostTwd').required=div;}
function resetWealthForm(){ $('wealthEditId').value='';$('wealthTransactionForm').reset();$('wealthTradeDate').value=todayTaipei();$('wealthTxType').value='BUY';$('wealthSaveTxBtn').textContent='新增紀錄';$('wealthCancelEditBtn').hidden=true;updateWealthTxLabels(); }
function startWealthEdit(id){const r=(wealth?.transactions||[]).find(x=>Number(x.id)===id);if(!r)return;$('wealthEditId').value=String(id);$('wealthTradeDate').value=r.trade_date;$('wealthTxType').value=r.type;$('wealthMarket').value=r.market;$('wealthBroker').value=r.broker;$('wealthTicker').value=r.ticker;$('wealthName').value=r.name||'';$('wealthShares').value=Number(r.shares||0)||'';$('wealthCostNative').value=Number(r.amount_native||0)||'';$('wealthCostTwd').value=Number(r.amount_twd||0)||'';$('wealthNote').value=r.note||'';$('wealthSaveTxBtn').textContent='儲存修改';$('wealthCancelEditBtn').hidden=false;updateWealthTxLabels();$('wealthTransactionForm').scrollIntoView({behavior:'smooth',block:'center'});}
$('wealthTxType').addEventListener('change',updateWealthTxLabels);
$('wealthCancelEditBtn').addEventListener('click',resetWealthForm);
$('wealthTransactionForm').addEventListener('submit',async e=>{e.preventDefault();const token=await ensureToken();if(!token)return;const id=$('wealthEditId').value,button=e.submitter;button.disabled=true;$('wealthFormMessage').textContent=id?'正在修改…':'正在新增…';const body={trade_date:$('wealthTradeDate').value,type:$('wealthTxType').value,market:$('wealthMarket').value,broker:$('wealthBroker').value,ticker:$('wealthTicker').value,name:$('wealthName').value,shares:Number($('wealthShares').value||0),amount_native:Number($('wealthCostNative').value||0),amount_twd:Number($('wealthCostTwd').value||0),note:$('wealthNote').value};try{await api(id?`/api/wealth/transactions/${id}`:'/api/wealth/transactions',{method:id?'PUT':'POST',headers:{'content-type':'application/json','x-admin-token':token},body:JSON.stringify(body)});$('wealthFormMessage').textContent=id?'紀錄已修改並重新計算庫存。':'紀錄已新增並更新資產。';resetWealthForm();await loadWealth()}catch(err){$('wealthFormMessage').textContent=err.message}finally{button.disabled=false}});
resetWealthForm();
$('wealthSettingsBtn').addEventListener('click',async()=>{const current=wealth?.settings||{};const target=prompt('財富自由目標（TWD）',String(current.freedom_target_twd||30000000));if(target===null)return;const cashTwd=prompt('台幣現金（TWD）',String(current.cash_twd||0));if(cashTwd===null)return;const cashUsd=prompt('美元現金（USD）',String(current.cash_usd||0));if(cashUsd===null)return;const cashJpy=prompt('日圓現金（JPY）',String(current.cash_jpy||0));if(cashJpy===null)return;const token=await ensureToken();if(!token)return;try{await api('/api/wealth/settings',{method:'POST',headers:{'content-type':'application/json','x-admin-token':token},body:JSON.stringify({freedom_target_twd:Number(target),cash_twd:Number(cashTwd),cash_usd:Number(cashUsd),cash_jpy:Number(cashJpy)})});await loadWealth()}catch(e){alert(e.message)}});
$('wealthPrivacyBtn').addEventListener('click',()=>{wealthPrivacy=!wealthPrivacy;localStorage.setItem('capitalos_wealth_privacy',wealthPrivacy?'1':'0');applyWealthPrivacy();});
$('wealthRefreshBtn').addEventListener('click',async()=>{const token=await ensureToken();if(!token)return;$('wealthRefreshBtn').disabled=true;$('wealthRefreshBtn').textContent='更新中…';try{const r=await api('/api/wealth/refresh',{method:'POST',headers:{'x-admin-token':token}});if(r.errors?.length)alert(`部分報價暫時未更新（${r.errors.length} 項），多半是 Yahoo Finance 暫時限流。系統已沿用前次成功價格，不會清空庫存。稍後再按更新即可。`);await loadWealth()}catch(e){alert(e.message)}finally{$('wealthRefreshBtn').disabled=false;$('wealthRefreshBtn').textContent='更新資產收盤價'}});

$('radarPrivacyBtn').addEventListener('click',()=>{radarPrivacy=!radarPrivacy;localStorage.setItem('capitalos_radar_privacy',radarPrivacy?'1':'0');applyRadarPrivacy();});
applyRadarPrivacy();


// v2.7 Drawdown Buy Ladder
const drawdownStatusMeta = level => ({
  NORMAL:['🟢','NORMAL','normal'],RECOVERED:['🟢','RECOVERED / NORMAL RANGE','normal'],
  BUY1:['🟡','BUY 1','buy1'],BUY2:['🟠','BUY 2','buy2'],BUY3:['🟠','BUY 3','buy3'],
  BUY4:['🔴','BUY 4','buy4'],BUY5:['🔴','BUY 5','buy5'],CRISIS:['🟣','CRISIS','crisis'],EXTREME:['🟣','EXTREME','extreme']
}[level]||['⚪',level||'—','normal']);
const ddPct = n => `${Number(n)>=0?'+':''}${Number(n||0).toFixed(2)}%`;
const pricePlain = n => new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));

async function loadDrawdown(){
  try{drawdown=await api('/api/drawdown');renderDrawdown(drawdown)}catch(e){$('drawdownGrid').innerHTML=`<article class="card drawdown-placeholder">載入失敗：${e.message}</article>`}
}

function renderDrawdown(data){
  const alerts=data.alerts||[],groups=Object.values(alerts.reduce((m,a)=>{(m[a.asset_id]??=[]).push(a);return m},{}));
  $('drawdownAlerts').innerHTML=groups.length?groups.map(group=>{
    const a=group.reduce((best,x)=>Number(x.cumulative_allocation_pct)>Number(best.cumulative_allocation_pct)?x:best,group[0]);
    const card=(data.cards||[]).find(x=>x.asset_id===a.asset_id),meta=drawdownStatusMeta(a.level_id),next=card?.next_level;
    const crossed=[...group].sort((x,y)=>Number(x.cumulative_allocation_pct)-Number(y.cumulative_allocation_pct)).map(x=>x.level_id.replace('BUY','BUY ')).join('、');
    return `<article class="drawdown-alert"><strong>⚠️ ${card?.label||a.asset_id} 加碼提醒</strong><span>目前回撤 ${ddPct(a.trigger_drawdown_pct)} · 已進入 ${meta[0]} ${meta[1]}</span><span>本次觸發：${crossed} · 本輪累計 ${num(a.cumulative_allocation_pct,0)}%</span><span>本級建議：投入預備資金 ${num(a.allocation_pct,0)}%</span>${next?`<span>下一級：${next.label} / ${next.threshold_pct}% · 距下一級 ${num(next.distance_pp,2)} 個百分點</span>`:''}</article>`;
  }).join(''):'';
  $('drawdownGrid').innerHTML=(data.cards||[]).map(renderDrawdownCard).join('');
}

function renderDrawdownCard(c){
  if(!c.initialized){
    return `<article class="card drawdown-card unavailable"><div class="drawdown-card-head"><div><h2>${c.label}</h2><p>${c.full_name}</p></div><span class="drawdown-status normal">⚪ 尚未初始化</span></div><p class="drawdown-error">${c.last_error||'第一次更新時會自動取得完整歷史資料並建立 ATH。'}</p></article>`;
  }
  const [icon,label,cls]=drawdownStatusMeta(c.current_level),source=c.source||{},next=c.next_level,triggered=c.triggered_levels||[];
  const proxy=Number(source.is_proxy)===1;
  return `<article class="card drawdown-card ${cls}">
    <div class="drawdown-card-head"><div><h2>${c.label}</h2><p>${c.full_name}</p></div><span class="drawdown-status ${cls}">${icon} ${label}</span></div>
    <div class="drawdown-primary"><span>距歷史最高收盤價</span><strong>${c.current_drawdown_pct<0?'🔻 ':''}${ddPct(c.current_drawdown_pct)}</strong><small>目前價格 ${pricePlain(c.current_close)} · 資料截至 ${c.trade_date}</small></div>
    <div class="drawdown-details">
      <div><span>歷史最高收盤</span><strong>${pricePlain(c.ath)}</strong><small>${c.ath_date}</small></div>
      <div><span>本輪最低</span><strong>${pricePlain(c.cycle_low)}</strong><small>${c.cycle_low_date}</small></div>
      <div><span>自本輪低點反彈</span><strong class="positive">⬆ ${ddPct(c.recovery_from_low_pct)}</strong></div>
      <div><span>本輪最大回撤</span><strong class="negative">🔻 ${ddPct(c.max_cycle_drawdown_pct)}</strong></div>
      <div><span>目前新增投入</span><strong>${num(c.current_allocation_pct,0)}%</strong><small>依目前所在回撤級距</small></div>
      <div><span>本輪累計建議投入</span><strong>${num(c.cumulative_allocation_pct,0)}%</strong><small>剩餘 ${num(c.remaining_reserve_pct,0)}%</small></div>
    </div>
    <div class="drawdown-next">${next?`<span>下一級</span><strong>${next.label}：${next.threshold_pct}%</strong><small>距下一級 <b>${num(next.distance_pp,2)} 個百分點</b> · 下一級新增投入 ${num(next.allocation_pct,0)}%</small>`:'<span>下一級</span><strong>本輪預備金已全數配置</strong>'}</div>
    <div class="drawdown-trigger-strip"><span>本輪：</span>${triggered.map(x=>`<span class="trigger-pill ${x.triggered?'done':''}">${x.label} ${x.triggered?'✅':'—'}</span>`).join('')}</div>
    <div class="drawdown-source"><span>Data: ${source.source_name||'Yahoo Finance'} · ${source.source_symbol||'—'}${proxy?' · PROXY':''}</span><span>歷史 ${Number(source.history_years||0).toFixed(1)} 年 · ${Number(source.history_rows||0).toLocaleString('en-US')} 日線</span>${source.last_success_at?`<span>最後成功同步：${new Date(source.last_success_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}（台灣時間）</span>`:''}${c.last_error?`<span class="negative">最近更新警告：${c.last_error}</span>`:''}</div>
  </article>`;
}

$('drawdownRefreshBtn').addEventListener('click',async()=>{
  const token=await ensureToken();if(!token)return;
  const btn=$('drawdownRefreshBtn');btn.disabled=true;btn.textContent='更新中…';
  try{const r=await api('/api/drawdown/refresh',{method:'POST',headers:{'x-admin-token':token}});if(r.errors?.length)alert(`部分回撤資料未更新（${r.errors.length} 項），系統已保留最後有效資料。`);await loadDrawdown()}catch(e){if(e.message.includes('管理密碼')){sessionStorage.removeItem('big7_admin_token');alert('管理密碼錯誤，已清除舊密碼；再次按更新即可重新輸入。')}else alert(e.message)}finally{btn.disabled=false;btn.textContent='更新回撤資料'}
});
