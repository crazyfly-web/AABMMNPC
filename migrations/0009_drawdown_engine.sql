CREATE TABLE IF NOT EXISTS drawdown_sources (
  asset_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  source_symbol TEXT NOT NULL,
  source_name TEXT NOT NULL DEFAULT 'Yahoo Finance',
  is_proxy INTEGER NOT NULL DEFAULT 0,
  earliest_date TEXT,
  latest_date TEXT,
  history_years REAL NOT NULL DEFAULT 0,
  history_rows INTEGER NOT NULL DEFAULT 0,
  initialized_at TEXT,
  last_success_at TEXT,
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS drawdown_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL,
  ath REAL NOT NULL,
  ath_date TEXT NOT NULL,
  cycle_low REAL NOT NULL,
  cycle_low_date TEXT NOT NULL,
  max_drawdown_pct REAL NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_drawdown_cycles_asset_active ON drawdown_cycles(asset_id,is_active,id DESC);

CREATE TABLE IF NOT EXISTS drawdown_triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  level_id TEXT NOT NULL,
  threshold_pct REAL NOT NULL,
  allocation_pct REAL NOT NULL,
  trigger_date TEXT NOT NULL,
  trigger_close REAL NOT NULL,
  trigger_drawdown_pct REAL NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(cycle_id,level_id)
);
CREATE INDEX IF NOT EXISTS idx_drawdown_triggers_asset_cycle ON drawdown_triggers(asset_id,cycle_id,id);

CREATE TABLE IF NOT EXISTS drawdown_daily (
  asset_id TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  close REAL NOT NULL,
  ath REAL NOT NULL,
  ath_date TEXT NOT NULL,
  current_drawdown_pct REAL NOT NULL,
  cycle_low REAL NOT NULL,
  cycle_low_date TEXT NOT NULL,
  max_cycle_drawdown_pct REAL NOT NULL,
  recovery_from_low_pct REAL NOT NULL,
  current_level TEXT NOT NULL,
  cumulative_allocation_pct REAL NOT NULL DEFAULT 0,
  cycle_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY(asset_id,trade_date)
);
CREATE INDEX IF NOT EXISTS idx_drawdown_daily_asset_date ON drawdown_daily(asset_id,trade_date DESC);

CREATE TABLE IF NOT EXISTS drawdown_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL,
  cycle_id INTEGER NOT NULL,
  level_id TEXT NOT NULL,
  trigger_date TEXT NOT NULL,
  trigger_drawdown_pct REAL NOT NULL,
  allocation_pct REAL NOT NULL,
  cumulative_allocation_pct REAL NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(cycle_id,level_id)
);
CREATE INDEX IF NOT EXISTS idx_drawdown_alerts_created ON drawdown_alerts(created_at DESC);
