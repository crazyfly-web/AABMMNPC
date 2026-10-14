CREATE TABLE IF NOT EXISTS wealth_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO wealth_settings (key,value,updated_at) VALUES
('freedom_target_twd','30000000',datetime('now')),
('cash_twd','0',datetime('now')),
('cash_usd','0',datetime('now'));

CREATE TABLE IF NOT EXISTS wealth_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market TEXT NOT NULL CHECK(market IN ('TW','US')),
  broker TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  shares REAL NOT NULL DEFAULT 0,
  cost_native REAL NOT NULL DEFAULT 0,
  cost_twd REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  price_date TEXT,
  price_source TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE(market,broker,ticker)
);
CREATE INDEX IF NOT EXISTS idx_wealth_positions_market ON wealth_positions(market,broker,ticker);

CREATE TABLE IF NOT EXISTS wealth_snapshots (
  snapshot_date TEXT PRIMARY KEY,
  tw_market_value_twd REAL NOT NULL DEFAULT 0,
  us_market_value_usd REAL NOT NULL DEFAULT 0,
  us_market_value_twd REAL NOT NULL DEFAULT 0,
  cash_twd REAL NOT NULL DEFAULT 0,
  cash_usd REAL NOT NULL DEFAULT 0,
  usd_twd REAL NOT NULL DEFAULT 0,
  total_value_twd REAL NOT NULL DEFAULT 0,
  total_cost_twd REAL NOT NULL DEFAULT 0,
  total_gain_twd REAL NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fx_rates (
  pair TEXT PRIMARY KEY,
  rate REAL NOT NULL,
  rate_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source TEXT NOT NULL
);
