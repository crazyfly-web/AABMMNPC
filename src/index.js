const TICKERS = ['NVDA', 'MSFT', 'AVGO', 'GOOGL', 'AMZN', 'META', 'PLTR'];
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (url.pathname === '/api/portfolio' && request.method === 'GET') return getPortfolio(env);
      if (url.pathname === '/api/transactions' && request.method === 'GET') return getTransactions(env);
      if (url.pathname === '/api/transactions' && request.method === 'POST') {
        requireAdmin(request, env);
        return addTransaction(request, env);
      }
      if (url.pathname === '/api/cash' && request.method === 'POST') {
        requireAdmin(request, env);
        return setCash(request, env);
      }
      if (url.pathname === '/api/prices/refresh' && request.method === 'POST') {
        requireAdmin(request, env);
        const result = await refreshPrices(env);
        return reply(result);
      }
      return reply({ error: 'Not found' }, 404);
    } catch (error) {
      return reply({ error: error.message || 'Unexpected error' }, error.status || 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshPrices(env));
  }
};

function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw httpError(500, '尚未設定 ADMIN_TOKEN');
  const token = request.headers.get('x-admin-token');
  if (!token || token !== env.ADMIN_TOKEN) throw httpError(401, '管理密碼錯誤');
}

async function getPortfolio(env) {
  const { results } = await env.DB.prepare(`
    SELECT a.ticker, a.name, a.target_weight, a.display_order,
           COALESCE(h.shares, 0) shares, COALESCE(h.cost_basis, 0) cost_basis,
           p.price, p.price_date, p.fetched_at
    FROM assets a
    LEFT JOIN holdings h ON h.ticker = a.ticker
    LEFT JOIN prices p ON p.ticker = a.ticker
    ORDER BY a.display_order
  `).all();

  const settingRows = await env.DB.prepare("SELECT key, value FROM settings").all();
  const settings = Object.fromEntries(settingRows.results.map(r => [r.key, r.value]));
  const cash = Number(settings.cash_balance || 0);

  const stockRows = results.filter(r => r.ticker !== 'CASH').map(r => {
    const price = Number(r.price || 0);
    const shares = Number(r.shares || 0);
    const costBasis = Number(r.cost_basis || 0);
    const marketValue = price * shares;
    const gain = marketValue - costBasis;
    return { ...r, price, shares, cost_basis: costBasis, market_value: marketValue, gain, return_pct: costBasis ? gain / costBasis * 100 : 0 };
  });

  const stockValue = stockRows.reduce((sum, r) => sum + r.market_value, 0);
  const totalValue = stockValue + cash;
  const stockCost = stockRows.reduce((sum, r) => sum + r.cost_basis, 0);
  const totalGain = stockRows.reduce((sum, r) => sum + r.gain, 0);

  const rows = stockRows.map(r => ({ ...r, current_weight: totalValue ? r.market_value / totalValue * 100 : 0 }));
  rows.push({
    ticker: 'CASH', name: '現金', target_weight: 10, shares: null, cost_basis: cash,
    price: 1, market_value: cash, gain: 0, return_pct: 0,
    current_weight: totalValue ? cash / totalValue * 100 : 0, price_date: null, fetched_at: null
  });

  return reply({
    rows,
    summary: {
      total_value: totalValue,
      stock_value: stockValue,
      cash,
      total_cost: stockCost,
      total_gain: totalGain,
      total_return_pct: stockCost ? totalGain / stockCost * 100 : 0,
      rebalance_threshold: Number(settings.rebalance_threshold || 3),
      last_price_update: settings.last_price_update || null
    }
  });
}

async function getTransactions(env) {
  const { results } = await env.DB.prepare(`
    SELECT id, trade_date, action, ticker, shares, total_amount, price_per_share, note, created_at
    FROM transactions ORDER BY trade_date DESC, id DESC LIMIT 300
  `).all();
  return reply({ transactions: results });
}

async function addTransaction(request, env) {
  const body = await request.json();
  const action = String(body.action || '').toUpperCase();
  const ticker = body.ticker ? String(body.ticker).toUpperCase() : null;
  const shares = Number(body.shares || 0);
  const totalAmount = Number(body.total_amount || 0);
  const tradeDate = String(body.trade_date || '').slice(0, 10);
  const note = String(body.note || '').slice(0, 300);

  if (!['BUY', 'SELL', 'CASH_ADD', 'CASH_REMOVE'].includes(action)) throw httpError(400, '不支援的動作');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw httpError(400, '日期格式錯誤');
  if (!(totalAmount > 0)) throw httpError(400, '交易總額必須大於 0');

  const now = new Date().toISOString();
  if (action === 'CASH_ADD' || action === 'CASH_REMOVE') {
    const current = await getCash(env);
    const next = action === 'CASH_ADD' ? current + totalAmount : current - totalAmount;
    if (next < -0.005) throw httpError(400, '現金餘額不足');
    await env.DB.batch([
      env.DB.prepare("UPDATE settings SET value=?, updated_at=? WHERE key='cash_balance'").bind(String(next), now),
      env.DB.prepare(`INSERT INTO transactions (trade_date, action, ticker, shares, total_amount, price_per_share, note, created_at)
                      VALUES (?, ?, NULL, 0, ?, 0, ?, ?)`)
        .bind(tradeDate, action, totalAmount, note, now)
    ]);
    return reply({ ok: true });
  }

  if (!TICKERS.includes(ticker)) throw httpError(400, '股票代號錯誤');
  if (!(shares > 0)) throw httpError(400, '股數必須大於 0');

  const holding = await env.DB.prepare("SELECT shares, cost_basis FROM holdings WHERE ticker=?").bind(ticker).first();
  if (!holding) throw httpError(404, '找不到持股');
  const oldShares = Number(holding.shares);
  const oldCost = Number(holding.cost_basis);
  let newShares, newCost;

  if (action === 'BUY') {
    newShares = oldShares + shares;
    newCost = oldCost + totalAmount;
  } else {
    if (shares > oldShares + 1e-9) throw httpError(400, '賣出股數超過目前持股');
    const avgCost = oldShares ? oldCost / oldShares : 0;
    newShares = oldShares - shares;
    newCost = Math.max(0, oldCost - avgCost * shares);
  }

  const cash = await getCash(env);
  const nextCash = action === 'BUY' ? cash - totalAmount : cash + totalAmount;
  if (action === 'BUY' && nextCash < -0.005) throw httpError(400, '現金餘額不足；請先新增現金，或修正交易金額');

  await env.DB.batch([
    env.DB.prepare("UPDATE holdings SET shares=?, cost_basis=?, updated_at=? WHERE ticker=?")
      .bind(newShares, newCost, now, ticker),
    env.DB.prepare("UPDATE settings SET value=?, updated_at=? WHERE key='cash_balance'")
      .bind(String(nextCash), now),
    env.DB.prepare(`INSERT INTO transactions (trade_date, action, ticker, shares, total_amount, price_per_share, note, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(tradeDate, action, ticker, shares, totalAmount, totalAmount / shares, note, now)
  ]);

  return reply({ ok: true });
}

async function setCash(request, env) {
  const body = await request.json();
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) throw httpError(400, '現金金額不正確');
  await env.DB.prepare("UPDATE settings SET value=?, updated_at=? WHERE key='cash_balance'")
    .bind(String(amount), new Date().toISOString()).run();
  return reply({ ok: true });
}

async function getCash(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key='cash_balance'").first();
  return Number(row?.value || 0);
}

async function refreshPrices(env) {
  const now = new Date().toISOString();
  const updates = [];
  const errors = [];

  for (const ticker of TICKERS) {
    try {
      const quote = await fetchYahooQuote(ticker);
      updates.push(env.DB.prepare(`
        INSERT INTO prices (ticker, price, price_date, fetched_at, source)
        VALUES (?, ?, ?, ?, 'Yahoo Finance')
        ON CONFLICT(ticker) DO UPDATE SET price=excluded.price, price_date=excluded.price_date,
          fetched_at=excluded.fetched_at, source=excluded.source
      `).bind(ticker, quote.price, quote.date, now));
    } catch (error) {
      errors.push(`${ticker}: ${error.message}`);
    }
  }

  if (updates.length) {
    updates.push(env.DB.prepare("UPDATE settings SET value=?, updated_at=? WHERE key='last_price_update'").bind(now, now));
    await env.DB.batch(updates);
  }
  return { ok: errors.length === 0, updated: updates.length ? updates.length - 1 : 0, errors, fetched_at: now };
}

async function fetchYahooQuote(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d&events=history`;
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 Big7Portfolio/1.0', 'accept': 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('沒有報價資料');
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  for (let i = closes.length - 1; i >= 0; i--) {
    if (Number.isFinite(closes[i])) {
      return { price: closes[i], date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10) };
    }
  }
  throw new Error('沒有有效收盤價');
}

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}
function httpError(status, message) {
  const error = new Error(message); error.status = status; return error;
}
