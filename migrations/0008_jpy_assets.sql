INSERT OR IGNORE INTO wealth_settings (key,value,updated_at) VALUES ('cash_jpy','0',datetime('now'));
ALTER TABLE wealth_snapshots ADD COLUMN cash_jpy REAL NOT NULL DEFAULT 0;
ALTER TABLE wealth_snapshots ADD COLUMN jpy_twd REAL NOT NULL DEFAULT 0;
