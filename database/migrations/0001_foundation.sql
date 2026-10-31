-- Shared, issuer-centric financial database. No ticker-specific tables.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS companies (
  company_id INTEGER PRIMARY KEY,
  cik TEXT NOT NULL UNIQUE CHECK(length(cik)=10 AND cik NOT GLOB '*[^0-9]*'),
  name TEXT NOT NULL,
  industry_group TEXT NOT NULL DEFAULT 'general'
    CHECK(industry_group IN ('general','bank','insurance')),
  reporting_currency TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS instruments (
  instrument_id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(company_id),
  ticker TEXT NOT NULL CHECK(ticker=upper(ticker) AND length(ticker)>0),
  exchange TEXT NOT NULL,
  share_class TEXT,
  ordinary_shares_per_instrument REAL NOT NULL DEFAULT 1
    CHECK(ordinary_shares_per_instrument>0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  UNIQUE(ticker,exchange)
);
CREATE INDEX IF NOT EXISTS instruments_company ON instruments(company_id);

CREATE TABLE IF NOT EXISTS financial_periods (
  period_id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(company_id),
  period_type TEXT NOT NULL CHECK(period_type IN ('quarter','annual','ytd','instant')),
  fiscal_year INTEGER NOT NULL,
  fiscal_quarter INTEGER NOT NULL DEFAULT 0 CHECK(fiscal_quarter BETWEEN 0 AND 4),
  period_start TEXT,
  period_end TEXT NOT NULL,
  CHECK(period_start IS NULL OR period_start<=period_end),
  CHECK(period_type NOT IN ('quarter','ytd') OR fiscal_quarter BETWEEN 1 AND 4),
  CHECK(period_type<>'annual' OR fiscal_quarter=0),
  UNIQUE(company_id,period_type,fiscal_year,fiscal_quarter,period_end),
  UNIQUE(period_id,company_id)
);

CREATE TABLE IF NOT EXISTS filings (
  filing_id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(company_id),
  accession TEXT NOT NULL,
  form TEXT NOT NULL,
  filed_on TEXT NOT NULL,
  report_end TEXT,
  source_url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(company_id,accession),
  UNIQUE(filing_id,company_id)
);

CREATE TABLE IF NOT EXISTS financial_facts (
  fact_id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  period_id INTEGER NOT NULL,
  filing_id INTEGER NOT NULL,
  metric_code TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT '',
  source_tag TEXT NOT NULL,
  context_start TEXT,
  context_end TEXT NOT NULL,
  dimensions_json TEXT NOT NULL DEFAULT '{}',
  share_basis TEXT NOT NULL DEFAULT 'not_applicable',
  share_basis_date TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(period_id,company_id) REFERENCES financial_periods(period_id,company_id),
  FOREIGN KEY(filing_id,company_id) REFERENCES filings(filing_id,company_id),
  UNIQUE(period_id,filing_id,metric_code,unit,currency,dimensions_json,share_basis,share_basis_date)
);
CREATE INDEX IF NOT EXISTS financial_facts_lookup ON financial_facts(company_id,metric_code,period_id);

CREATE TABLE IF NOT EXISTS bank_period_metrics (
  company_id INTEGER NOT NULL,
  period_id INTEGER NOT NULL,
  filing_id INTEGER NOT NULL,
  net_interest_income REAL,
  net_interest_margin REAL,
  loans_net REAL,
  deposits REAL,
  cet1_ratio REAL,
  currency TEXT NOT NULL,
  PRIMARY KEY(period_id,filing_id),
  FOREIGN KEY(period_id,company_id) REFERENCES financial_periods(period_id,company_id),
  FOREIGN KEY(filing_id,company_id) REFERENCES filings(filing_id,company_id)
);

CREATE TABLE IF NOT EXISTS insurance_period_metrics (
  company_id INTEGER NOT NULL,
  period_id INTEGER NOT NULL,
  filing_id INTEGER NOT NULL,
  premiums_earned REAL,
  claims_and_benefits REAL,
  underwriting_income REAL,
  policy_reserves REAL,
  combined_ratio REAL,
  currency TEXT NOT NULL,
  PRIMARY KEY(period_id,filing_id),
  FOREIGN KEY(period_id,company_id) REFERENCES financial_periods(period_id,company_id),
  FOREIGN KEY(filing_id,company_id) REFERENCES filings(filing_id,company_id)
);

CREATE TABLE IF NOT EXISTS project_documentation (
  document_key TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK(version>0),
  content_markdown TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO schema_migrations(version,description)
VALUES(1,'Unified company, instrument, financial-period and SEC-provenance foundation');
