CREATE TABLE IF NOT EXISTS price_refresh_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at TEXT NOT NULL,
  source TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_price_refresh_runs_fetched_at
ON price_refresh_runs(fetched_at DESC);

CREATE TABLE IF NOT EXISTS daily_snapshots (
  snapshot_date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  shares REAL NOT NULL DEFAULT 0,
  market_value REAL NOT NULL DEFAULT 0,
  cost_basis REAL NOT NULL DEFAULT 0,
  current_weight REAL NOT NULL DEFAULT 0,
  total_portfolio_value REAL NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_date, ticker)
);

CREATE INDEX IF NOT EXISTS idx_daily_snapshots_date
ON daily_snapshots(snapshot_date DESC);
