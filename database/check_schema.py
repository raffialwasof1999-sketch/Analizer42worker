"""Validate the D1 foundation locally without touching Cloudflare or Sheets."""
import sqlite3
from pathlib import Path

sql = (Path(__file__).parent / 'migrations/0001_foundation.sql').read_text()
c = sqlite3.connect(':memory:')
c.execute('PRAGMA foreign_keys=ON')
c.executescript(sql)
c.executescript(sql)
c.executescript("""
INSERT INTO companies(company_id,cik,name) VALUES
(1,'0001652044','Alphabet'),(2,'0001065280','Netflix');
INSERT INTO instruments(company_id,ticker,exchange,share_class) VALUES
(1,'GOOG','NASDAQ','C'),(1,'GOOGL','NASDAQ','A');
INSERT INTO financial_periods(period_id,company_id,period_type,fiscal_year,
fiscal_quarter,period_start,period_end) VALUES
(1,1,'quarter',2026,3,'2026-07-01','2026-09-30');
INSERT INTO filings(filing_id,company_id,accession,form,filed_on,source_url) VALUES
(1,1,'first','10-Q','2026-10-29','https://www.sec.gov/first'),
(2,2,'other-issuer','10-Q','2026-10-29','https://www.sec.gov/other'),
(3,1,'restated','10-Q/A','2026-10-30','https://www.sec.gov/restated');
""")
insert = '''INSERT INTO financial_facts(company_id,period_id,filing_id,
metric_code,value,unit,source_tag,context_end) VALUES(?,?,?,?,?,?,?,?)'''
c.execute(insert, (1,1,1,'revenue',100,'USD','us-gaap:Revenues','2026-09-30'))
c.execute(insert, (1,1,3,'revenue',110,'USD','us-gaap:Revenues','2026-09-30'))
for args in [
    (1,1,2,'revenue',100,'USD','us-gaap:Revenues','2026-09-30'),
    (1,1,1,'revenue',100,'USD','us-gaap:Revenues','2026-09-30'),
]:
    try:
        c.execute(insert,args)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError('Cross-issuer or duplicate observation accepted')
assert c.execute('SELECT count(*) FROM instruments WHERE company_id=1').fetchone()[0] == 2
assert c.execute('SELECT count(*) FROM financial_facts').fetchone()[0] == 2
assert not c.execute('PRAGMA foreign_key_check').fetchall()
assert c.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print('PASS: repeat migration, multiple share classes, cross-issuer isolation, '
      'duplicate rejection, restatement preservation, foreign keys, integrity')
