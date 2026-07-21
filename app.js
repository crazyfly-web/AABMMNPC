const ASSETS = [
  { symbol: "NVDA", name: "NVIDIA", weight: 15 },
  { symbol: "MSFT", name: "Microsoft", weight: 15 },
  { symbol: "AVGO", name: "Broadcom", weight: 15 },
  { symbol: "GOOGL", name: "Alphabet", weight: 15 },
  { symbol: "AMZN", name: "Amazon", weight: 10 },
  { symbol: "META", name: "Meta", weight: 10 },
  { symbol: "PLTR", name: "Palantir", weight: 10 },
  { symbol: "CASH", name: "預備資金池", weight: 10 }
];

const BENCHMARK = "00757.TW";
const FX = "TWD=X";
let priceData = null;
let performanceChart = null;
let weightsChart = null;

const els = {
  startDate: document.querySelector("#startDate"),
  rebalanceMode: document.querySelector("#rebalanceMode"),
  thresholdWrap: document.querySelector("#thresholdWrap"),
  threshold: document.querySelector("#threshold"),
  initialCapital: document.querySelector("#initialCapital"),
  weights: document.querySelector("#weights"),
  weightTotal: document.querySelector("#weightTotal"),
  refreshBtn: document.querySelector("#refreshBtn"),
  status: document.querySelector("#status"),
  dailyRows: document.querySelector("#dailyRows"),
  portfolioReturn: document.querySelector("#portfolioReturn"),
  benchmarkReturn: document.querySelector("#benchmarkReturn"),
  excessReturn: document.querySelector("#excessReturn"),
  rebalanceCount: document.querySelector("#rebalanceCount"),
  weightTemplate: document.querySelector("#weightTemplate")
};

function init() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  els.startDate.value = d.toISOString().slice(0, 10);

  renderWeightInputs();
  bindEvents();
  refresh();
}

function renderWeightInputs() {
  els.weights.innerHTML = "";
  ASSETS.forEach(asset => {
    const node = els.weightTemplate.content.cloneNode(true);
    const row = node.querySelector(".weight-row");
    row.dataset.symbol = asset.symbol;
    node.querySelector(".symbol").textContent = asset.symbol;
    node.querySelector(".name").textContent = asset.name;
    const input = node.querySelector(".weight-input");
    input.value = asset.weight;
    input.addEventListener("input", () => {
      asset.weight = Number(input.value || 0);
      updateWeightTotal();
      if (priceData) runSimulation();
    });
    els.weights.appendChild(node);
  });
  updateWeightTotal();
}

function updateWeightTotal() {
  const total = ASSETS.reduce((sum, a) => sum + a.weight, 0);
  els.weightTotal.textContent = `合計 ${total.toFixed(0)}%`;
  els.weightTotal.className = Math.abs(total - 100) < 0.001 ? "positive" : "negative";
}

function bindEvents() {
  els.refreshBtn.addEventListener("click", refresh);
  els.startDate.addEventListener("change", refresh);
  els.rebalanceMode.addEventListener("change", () => {
    els.thresholdWrap.classList.toggle("hidden", els.rebalanceMode.value !== "threshold");
    if (priceData) runSimulation();
  });
  els.threshold.addEventListener("input", () => priceData && runSimulation());
  els.initialCapital.addEventListener("input", () => priceData && runSimulation());
}

async function refresh() {
  try {
    setStatus("載入中…");
    const symbols = [...ASSETS.filter(a => a.symbol !== "CASH").map(a => a.symbol), FX, BENCHMARK];
    const url = `/api/prices?symbols=${encodeURIComponent(symbols.join(","))}&start=${els.startDate.value}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    priceData = await response.json();
    if (priceData.error) throw new Error(priceData.error);
    runSimulation();
    setStatus(`已更新 ${new Date().toLocaleString("zh-TW")}`);
  } catch (error) {
    console.error(error);
    setStatus(`更新失敗：${error.message}`, true);
  }
}

function runSimulation() {
  const totalWeight = ASSETS.reduce((sum, a) => sum + a.weight, 0);
  if (Math.abs(totalWeight - 100) > 0.001) {
    setStatus("權重合計必須為 100%", true);
    return;
  }

  const aligned = alignData(priceData.series);
  if (aligned.length < 2) {
    setStatus("可用資料不足", true);
    return;
  }

  const initialCapital = Number(els.initialCapital.value || 1000000);
  const targetWeights = Object.fromEntries(ASSETS.map(a => [a.symbol, a.weight / 100]));
  const units = {};
  const start = aligned[0];

  ASSETS.forEach(asset => {
    if (asset.symbol === "CASH") {
      units.CASH = initialCapital * targetWeights.CASH;
    } else {
      const twdPrice = start[asset.symbol] * start[FX];
      units[asset.symbol] = (initialCapital * targetWeights[asset.symbol]) / twdPrice;
    }
  });

  let benchmarkUnits = initialCapital / start[BENCHMARK];
  let lastRebalanceDate = start.date;
  let rebalanceCount = 0;
  const rows = [];

  aligned.forEach((day, index) => {
    let values = getAssetValues(units, day);
    let portfolioValue = sumValues(values);

    if (index > 0 && shouldRebalance(els.rebalanceMode.value, lastRebalanceDate, day.date, values, portfolioValue, targetWeights)) {
      ASSETS.forEach(asset => {
        if (asset.symbol === "CASH") {
          units.CASH = portfolioValue * targetWeights.CASH;
        } else {
          units[asset.symbol] = (portfolioValue * targetWeights[asset.symbol]) / (day[asset.symbol] * day[FX]);
        }
      });
      lastRebalanceDate = day.date;
      rebalanceCount++;
      values = getAssetValues(units, day);
      portfolioValue = sumValues(values);
    }

    const benchmarkValue = benchmarkUnits * day[BENCHMARK];
    rows.push({
      ...day,
      portfolioValue,
      benchmarkValue,
      portfolioIndex: portfolioValue / initialCapital * 100,
      benchmarkIndex: benchmarkValue / initialCapital * 100,
      weights: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v / portfolioValue]))
    });
  });

  renderSummary(rows, rebalanceCount);
  renderCharts(rows);
  renderTable(rows);
}

function getAssetValues(units, day) {
  const values = {};
  ASSETS.forEach(asset => {
    values[asset.symbol] = asset.symbol === "CASH"
      ? units.CASH
      : units[asset.symbol] * day[asset.symbol] * day[FX];
  });
  return values;
}

function sumValues(values) {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

function shouldRebalance(mode, lastDate, currentDate, values, portfolioValue, targetWeights) {
  if (mode === "none") return false;

  if (mode === "threshold") {
    const threshold = Number(els.threshold.value || 5) / 100;
    return Object.keys(targetWeights).some(symbol => {
      const currentWeight = values[symbol] / portfolioValue;
      return Math.abs(currentWeight - targetWeights[symbol]) >= threshold;
    });
  }

  const last = new Date(lastDate + "T00:00:00Z");
  const current = new Date(currentDate + "T00:00:00Z");
  const monthDiff = (current.getUTCFullYear() - last.getUTCFullYear()) * 12 +
                    current.getUTCMonth() - last.getUTCMonth();

  const requiredMonths = {
    monthly: 1,
    quarterly: 3,
    semiannual: 6,
    annual: 12
  }[mode];

  return monthDiff >= requiredMonths;
}

function alignData(series) {
  const symbols = [...ASSETS.filter(a => a.symbol !== "CASH").map(a => a.symbol), FX, BENCHMARK];
  const dateSet = new Set();
  symbols.forEach(symbol => {
    (series[symbol] || []).forEach(p => dateSet.add(p.date));
  });

  const dates = [...dateSet].sort();
  const maps = Object.fromEntries(symbols.map(symbol => [
    symbol,
    new Map((series[symbol] || []).map(p => [p.date, p.close]))
  ]));

  const last = {};
  const result = [];

  for (const date of dates) {
    symbols.forEach(symbol => {
      if (maps[symbol].has(date)) last[symbol] = maps[symbol].get(date);
    });

    const ready = symbols.every(symbol => Number.isFinite(last[symbol]));
    if (ready) {
      const row = { date };
      symbols.forEach(symbol => row[symbol] = last[symbol]);
      result.push(row);
    }
  }
  return result;
}

function renderSummary(rows, rebalanceCount) {
  const last = rows.at(-1);
  const p = last.portfolioIndex - 100;
  const b = last.benchmarkIndex - 100;
  setMetric(els.portfolioReturn, p);
  setMetric(els.benchmarkReturn, b);
  setMetric(els.excessReturn, p - b);
  els.rebalanceCount.textContent = rebalanceCount.toString();
}

function setMetric(el, value) {
  el.textContent = `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  el.className = value >= 0 ? "positive" : "negative";
}

function renderCharts(rows) {
  const labels = rows.map(r => r.date);

  if (performanceChart) performanceChart.destroy();
  performanceChart = new Chart(document.querySelector("#performanceChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "AI 7 精選組合",
          data: rows.map(r => r.portfolioIndex),
          borderWidth: 2.4,
          pointRadius: 0,
          tension: .15
        },
        {
          label: "00757",
          data: rows.map(r => r.benchmarkIndex),
          borderWidth: 2.4,
          pointRadius: 0,
          tension: .15
        }
      ]
    },
    options: chartOptions()
  });

  const latestWeights = rows.at(-1).weights;
  if (weightsChart) weightsChart.destroy();
  weightsChart = new Chart(document.querySelector("#weightsChart"), {
    type: "bar",
    data: {
      labels: ASSETS.map(a => a.symbol),
      datasets: [
        {
          label: "目前權重",
          data: ASSETS.map(a => latestWeights[a.symbol] * 100)
        },
        {
          label: "目標權重",
          data: ASSETS.map(a => a.weight)
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#c9d6e5" } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw.toFixed(2)}%` } }
      },
      scales: {
        x: { ticks: { color: "#92a6bf" }, grid: { color: "rgba(255,255,255,.05)" } },
        y: {
          beginAtZero: true,
          ticks: { color: "#92a6bf", callback: v => `${v}%` },
          grid: { color: "rgba(255,255,255,.08)" }
        }
      }
    }
  });
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: "#c9d6e5" } },
      tooltip: {
        callbacks: {
          label: ctx => `${ctx.dataset.label}: ${ctx.raw.toFixed(2)}`
        }
      }
    },
    scales: {
      x: {
        ticks: { color: "#92a6bf", maxTicksLimit: 10 },
        grid: { color: "rgba(255,255,255,.04)" }
      },
      y: {
        ticks: { color: "#92a6bf" },
        grid: { color: "rgba(255,255,255,.08)" }
      }
    }
  };
}

function renderTable(rows) {
  const visible = [...rows].reverse().slice(0, 260);
  els.dailyRows.innerHTML = visible.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${fmt(r.NVDA)}</td>
      <td>${fmt(r.MSFT)}</td>
      <td>${fmt(r.AVGO)}</td>
      <td>${fmt(r.GOOGL)}</td>
      <td>${fmt(r.AMZN)}</td>
      <td>${fmt(r.META)}</td>
      <td>${fmt(r.PLTR)}</td>
      <td>${fmt(r[FX], 3)}</td>
      <td>${fmt(r[BENCHMARK])}</td>
      <td class="${r.portfolioIndex >= 100 ? "positive" : "negative"}">${fmt(r.portfolioIndex)}%</td>
      <td class="${r.benchmarkIndex >= 100 ? "positive" : "negative"}">${fmt(r.benchmarkIndex)}%</td>
    </tr>
  `).join("");
}

function fmt(value, digits = 2) {
  return Number(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.style.color = isError ? "var(--bad)" : "var(--muted)";
}

init();
