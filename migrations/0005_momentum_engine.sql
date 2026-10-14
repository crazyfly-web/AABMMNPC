CREATE TABLE IF NOT EXISTS momentum_daily (
  trade_date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  price REAL NOT NULL,
  daily_return_pct REAL NOT NULL DEFAULT 0,
  ma5 REAL, ma20 REAL, ma60 REAL, ma200 REAL,
  rsv REAL, k REAL, d REAL,
  volume REAL NOT NULL DEFAULT 0,
  volume_ratio20 REAL NOT NULL DEFAULT 0,
  distance_ma20_pct REAL NOT NULL DEFAULT 0,
  distance_high20_pct REAL NOT NULL DEFAULT 0,
  return20_pct REAL NOT NULL DEFAULT 0,
  return60_pct REAL NOT NULL DEFAULT 0,
  rs20_qqq REAL NOT NULL DEFAULT 0,
  rs60_qqq REAL NOT NULL DEFAULT 0,
  momentum_score REAL NOT NULL DEFAULT 0,
  entry_score REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'Neutral',
  captured_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_momentum_daily_date ON momentum_daily(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_momentum_daily_ticker ON momentum_daily(ticker, trade_date DESC);
