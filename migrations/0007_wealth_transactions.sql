CREATE TABLE IF NOT EXISTS wealth_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('OPENING','BUY','SELL','DIVIDEND')),
  market TEXT NOT NULL CHECK(market IN ('TW','US')),
  broker TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  shares REAL NOT NULL DEFAULT 0,
  amount_native REAL NOT NULL DEFAULT 0,
  amount_twd REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  source_position_id INTEGER UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wealth_tx_date ON wealth_transactions(trade_date DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_wealth_tx_position ON wealth_transactions(market,broker,ticker,trade_date,id);

-- Preserve all v2.4 positions already entered by converting each one into an editable opening record.
INSERT OR IGNORE INTO wealth_transactions
(trade_date,type,market,broker,ticker,name,shares,amount_native,amount_twd,note,source_position_id,created_at,updated_at)
SELECT
  substr(COALESCE(updated_at,datetime('now')),1,10),
  'OPENING',market,broker,ticker,name,shares,cost_native,cost_twd,
  'v2.4 既有庫存轉入',id,COALESCE(updated_at,datetime('now')),COALESCE(updated_at,datetime('now'))
FROM wealth_positions;
