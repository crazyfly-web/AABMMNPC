CREATE TABLE IF NOT EXISTS assets (
  ticker TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_weight REAL NOT NULL,
  display_order INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD'
);

CREATE TABLE IF NOT EXISTS holdings (
  ticker TEXT PRIMARY KEY,
  shares REAL NOT NULL DEFAULT 0,
  cost_basis REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (ticker) REFERENCES assets(ticker)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prices (
  ticker TEXT PRIMARY KEY,
  price REAL NOT NULL,
  price_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'Yahoo Finance',
  FOREIGN KEY (ticker) REFERENCES assets(ticker)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('BUY','SELL','CASH_ADD','CASH_REMOVE','ADJUST')),
  ticker TEXT,
  shares REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  price_per_share REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_trade_date ON transactions(trade_date DESC, id DESC);

INSERT OR IGNORE INTO assets (ticker, name, target_weight, display_order) VALUES
('NVDA', 'NVIDIA', 18, 1),
('MSFT', 'Microsoft', 16, 2),
('AVGO', 'Broadcom', 14, 3),
('GOOGL', 'Alphabet', 14, 4),
('AMZN', 'Amazon', 10, 5),
('META', 'Meta', 10, 6),
('PLTR', 'Palantir', 8, 7),
('CASH', '現金', 10, 8);

INSERT OR IGNORE INTO holdings (ticker, shares, cost_basis, updated_at) VALUES
('NVDA', 5, 980.98, datetime('now')),
('MSFT', 5, 2242.14, datetime('now')),
('AVGO', 0, 0, datetime('now')),
('GOOGL', 13, 4248.24, datetime('now')),
('AMZN', 6, 1423.42, datetime('now')),
('META', 5, 2866.86, datetime('now')),
('PLTR', 10, 1212.41, datetime('now')),
('CASH', 0, 0, datetime('now'));

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
('cash_balance', '0', datetime('now')),
('rebalance_threshold', '3', datetime('now')),
('last_price_update', '', datetime('now'));

INSERT INTO transactions (trade_date, action, ticker, shares, total_amount, price_per_share, note, created_at)
SELECT '2026-07-31', 'ADJUST', 'AMZN', 6, 1423.42, 237.2366667, '初始持倉', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM transactions);
INSERT INTO transactions (trade_date, action, ticker, shares, total_amount, price_per_share, note, created_at)
SELECT '2026-07-31', 'ADJUST', 'GOOGL', 13, 4248.24, 326.7876923, '初始持倉', datetime('now')
WHERE (SELECT COUNT(*) FROM transactions) = 1;
INSERT INTO transactions (trade_date, action, ticker, shares, total_amount, price_per_share, note, created_at)
SELECT '2026-07-31', 'ADJUST', 'META', 5, 2866.86, 573.372, '初始持倉', datetime('now')
WHERE (SELECT COUNT(*) FROM transactions) = 2;
INSERT INTO transactions (trade_date, action, ticker, shares, total_amount, price_per_share, note, created_at)
SELECT '2026-07-31', 'ADJUST', 'MSFT', 5, 2242.14, 448.428, '初始持倉', datetime('now')
WHERE (SELECT COUNT(*) FROM transactions) = 3;
INSERT INTO transactions (trade_date, action, ticker, shares, total_amount, price_per_share, note, created_at)
SELECT '2026-07-31', 'ADJUST', 'NVDA', 5, 980.98, 196.196, '初始持倉', datetime('now')
WHERE (SELECT COUNT(*) FROM transactions) = 4;
INSERT INTO transactions (trade_date, action, ticker, shares, total_amount, price_per_share, note, created_at)
SELECT '2026-07-31', 'ADJUST', 'PLTR', 10, 1212.41, 121.241, '初始持倉', datetime('now')
WHERE (SELECT COUNT(*) FROM transactions) = 5;
