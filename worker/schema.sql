-- Database voor de Investeringstracker (Cloudflare D1)
CREATE TABLE IF NOT EXISTS intraday (
  ts INTEGER NOT NULL,          -- tijdstip in ms sinds 1970 (UTC)
  ticker TEXT NOT NULL,
  name TEXT,
  value REAL,                   -- waarde van de positie in EUR
  unrealized REAL,              -- ongerealiseerd resultaat in EUR
  price REAL,                   -- koers in de valuta van het instrument
  qty REAL,
  PRIMARY KEY (ts, ticker)
);
CREATE TABLE IF NOT EXISTS hours (
  hour INTEGER NOT NULL,        -- begin van het uur in ms sinds 1970 (UTC)
  ticker TEXT NOT NULL,
  name TEXT,
  open REAL, close REAL, low REAL, high REAL, avg REAL,
  n INTEGER,
  close_price REAL,
  PRIMARY KEY (hour, ticker)
);
CREATE TABLE IF NOT EXISTS days (
  day TEXT NOT NULL,            -- datum in Amsterdamse tijd, JJJJ-MM-DD
  ticker TEXT NOT NULL,
  name TEXT,
  open REAL, close REAL, low REAL, high REAL, avg REAL,
  range REAL, range_pct REAL,
  n INTEGER,
  close_price REAL,
  PRIMARY KEY (day, ticker)
);
CREATE TABLE IF NOT EXISTS weeks (
  date TEXT PRIMARY KEY,        -- datum van de snapshot, JJJJ-MM-DD
  account_value REAL,
  net_deposits REAL,
  cash REAL,
  cost_basis REAL,
  source TEXT
);
CREATE TABLE IF NOT EXISTS positions (
  date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT,
  value REAL,
  unrealized REAL,
  qty REAL,
  PRIMARY KEY (date, ticker)
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_intraday_ticker ON intraday (ticker, ts);
CREATE INDEX IF NOT EXISTS idx_hours_ticker ON hours (ticker, hour);
CREATE INDEX IF NOT EXISTS idx_days_ticker ON days (ticker, day);
