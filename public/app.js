const $ = id => document.getElementById(id);
const colors = ['#5b8ff9','#61d9a1','#65789b','#f6bd16','#7262fd','#78d3f8','#9661bc','#a7b2bd'];
let portfolio = null;

const usd = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(Number(n||0));
const num = (n,d=2) => new Intl.NumberFormat('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(n||0));
const pct = n => `${Number(n||0).toFixed(2)}%`;

async function api(path, options={}){
  const response = await fetch(path, options);
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function load(){
  try{
    const [p,t] = await Promise.all([api('/api/portfolio'),api('/api/transactions')]);
    portfolio=p; renderPortfolio(p); renderLogs(t.transactions);
  }catch(e){ $('updatedAt').textContent=`載入失敗：${e.message}`; }
}

function renderPortfolio(data){
  const s=data.summary;
  $('totalValue').textContent=usd(s.total_value);
  $('totalGain').textContent=`${s.total_gain>=0?'+':''}${usd(s.total_gain)}`;
  $('totalGain').className=s.total_gain>=0?'positive':'negative';
  $('totalReturn').textContent=`${s.total_return_pct>=0?'+':''}${pct(s.total_return_pct)}`;
  $('cashValue').textContent=usd(s.cash);
  $('cashWeight').textContent=`目前 ${pct(data.rows.find(r=>r.ticker==='CASH')?.current_weight)}`;
  $('updatedAt').textContent=s.last_price_update?`收盤價最後更新：${new Date(s.last_price_update).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}`:'尚未取得收盤價，部署後請按「更新股價」';

  const alerts=data.rows.filter(r=>Math.abs(r.current_weight-r.target_weight)>=s.rebalance_threshold);
  $('rebalanceStatus').textContent=alerts.length?`${alerts.length} 項偏離`:'配置正常';
  $('rebalanceStatus').className=alerts.length?'negative':'positive';

  $('portfolioBody').innerHTML=data.rows.map(r=>{
    const delta=r.current_weight-r.target_weight;
    const alert=Math.abs(delta)>=s.rebalance_threshold;
    return `<tr><td><span class="ticker">${r.ticker}</span><span class="company">${r.name}</span></td>
      <td>${r.ticker==='CASH'?'—':r.price?usd(r.price):'尚無資料'}</td>
      <td>${r.ticker==='CASH'?'—':num(r.shares,4).replace(/\.0+$/,'')}</td>
      <td>${usd(r.market_value)}</td><td>${pct(r.target_weight)}</td>
      <td class="${alert?'weight-alert':''}">${pct(r.current_weight)}<span class="company">${delta>=0?'+':''}${pct(delta)}</span></td>
      <td class="${r.gain>=0?'positive':'negative'}">${r.ticker==='CASH'?'—':`${r.gain>=0?'+':''}${usd(r.gain)}`}</td>
      <td class="${r.return_pct>=0?'positive':'negative'}">${r.ticker==='CASH'?'—':`${r.return_pct>=0?'+':''}${pct(r.return_pct)}`}</td></tr>`;
  }).join('');

  const total=data.rows.reduce((a,r)=>a+r.current_weight,0)||100;
  $('allocationBar').innerHTML=data.rows.map((r,i)=>{
    const alert=Math.abs(r.current_weight-r.target_weight)>=s.rebalance_threshold;
    return `<div class="segment ${alert?'alert':''}" title="${r.ticker} ${pct(r.current_weight)}" style="width:${r.current_weight/total*100}%;background:${colors[i]}"></div>`;
  }).join('');
  $('allocationLegend').innerHTML=data.rows.map((r,i)=>{
    const delta=r.current_weight-r.target_weight;
    const alert=Math.abs(delta)>=s.rebalance_threshold;
    return `<div class="legend-item"><span class="dot" style="background:${colors[i]}"></span><strong>${r.ticker}</strong><span class="${alert?'weight-alert':''}">${pct(r.current_weight)}</span><small>目標 ${pct(r.target_weight)} · 偏離 ${delta>=0?'+':''}${pct(delta)}</small></div>`;
  }).join('');
}

function renderLogs(rows){
  if(!rows.length){$('logList').innerHTML='<p class="muted">尚無紀錄</p>';return;}
  const names={BUY:'買進',SELL:'賣出',CASH_ADD:'增加現金',CASH_REMOVE:'提領現金',ADJUST:'初始持倉'};
  $('logList').innerHTML=rows.map(r=>`<div class="log-row"><time>${r.trade_date}</time><div class="log-action">${names[r.action]||r.action}</div><div><strong>${r.ticker||'CASH'} ${r.shares?`${num(r.shares,4).replace(/\.0+$/,'')} 股`:''}</strong><div class="log-note">${r.note||'—'}</div></div><div>${usd(r.total_amount)}</div></div>`).join('');
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
  try{const r=await api('/api/prices/refresh',{method:'POST',headers:{'x-admin-token':token}});if(r.errors?.length)alert(r.errors.join('\n'));await load()}catch(e){alert(e.message)}finally{$('refreshBtn').disabled=false;$('refreshBtn').textContent='更新股價'}
});

$('setCashBtn').addEventListener('click',async()=>{
  const current=portfolio?.summary?.cash||0; const value=prompt('輸入目前現金餘額（USD）',String(current));if(value===null)return;
  const amount=Number(value);if(!Number.isFinite(amount)||amount<0){alert('金額不正確');return}
  const token=await ensureToken();if(!token)return;
  try{await api('/api/cash',{method:'POST',headers:{'content-type':'application/json','x-admin-token':token},body:JSON.stringify({amount})});await load()}catch(e){alert(e.message)}
});

load();
