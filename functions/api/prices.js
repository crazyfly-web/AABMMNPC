export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const start = url.searchParams.get("start");
  if (!symbols.length || !start) {
    return json({ error: "缺少 symbols 或 start 參數" }, 400);
  }

  const period1 = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400;

  try {
    const entries = await Promise.all(symbols.map(async symbol => {
      const endpoint = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
      endpoint.searchParams.set("period1", String(period1));
      endpoint.searchParams.set("period2", String(period2));
      endpoint.searchParams.set("interval", "1d");
      endpoint.searchParams.set("events", "history");
      endpoint.searchParams.set("includeAdjustedClose", "true");

      const response = await fetch(endpoint.toString(), {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json"
        }
      });
      if (!response.ok) throw new Error(`${symbol}: HTTP ${response.status}`);

      const payload = await response.json();
      const result = payload?.chart?.result?.[0];
      if (!result) throw new Error(`${symbol}: 無資料`);

      const timestamps = result.timestamp || [];
      const quote = result.indicators?.quote?.[0]?.close || [];
      const adj = result.indicators?.adjclose?.[0]?.adjclose || [];

      const points = timestamps.map((ts, i) => {
        const close = Number.isFinite(adj[i]) ? adj[i] : quote[i];
        return {
          date: new Date(ts * 1000).toISOString().slice(0, 10),
          close
        };
      }).filter(p => Number.isFinite(p.close));

      return [symbol, points];
    }));

    return json({
      updatedAt: new Date().toISOString(),
      series: Object.fromEntries(entries)
    });
  } catch (error) {
    return json({ error: error.message || "資料載入失敗" }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=900"
    }
  });
}
