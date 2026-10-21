/**
 * SEC filing history for quarterly earnings dates.
 *
 * SEC's primary submissions JSON only keeps the most recent 1,000 filings
 * (or at least one year). Older filings are in filings.files archives.
 * Missing archives must fail visibly; they must not masquerade as a company
 * having no historical earnings announcements.
 */

const isoDate = s =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s+'T00:00:00Z'));

const days = (start,end) =>
  (Date.parse(end+'T00:00:00Z') - Date.parse(start+'T00:00:00Z')) / 86400000;

export function filingRows(rec) {
  if (!rec || !Array.isArray(rec.form)) return [];
  const filings = [];
  for (let i=0;i<rec.form.length;i++) {
    if (!isoDate(rec.filingDate?.[i])) continue;
    filings.push({
      form:rec.form[i],
      filed:rec.filingDate[i],
      end:rec.reportDate?.[i] || '',
      items:rec.items?.[i] || '',
      accession:rec.accessionNumber?.[i] || ''
    });
  }
  return filings;
}

/**
 * Retrieve EVERY SEC submissions archive overlapping the available quarter
 * history, without a company-specific date cutoff or arbitrary file count.
 * This is done per request and benefits from the SEC fetch cache.
 */
export async function fullQuarterFilingHistory(sub,quarters,cik,fetchJSON) {
  const oldest = quarters.map(r=>r.fiscalPeriodEnd)
    .filter(isoDate).sort()[0];
  const recent = filingRows(sub?.filings?.recent);
  if (!oldest) return {filings:recent,archivesScanned:0};

  const archives = (sub?.filings?.files || [])
    .filter(file=>
      file &&
      file.name?.startsWith('CIK'+cik+'-submissions-') &&
      /^CIK\d{10}-submissions-\d{3}\.json$/.test(file.name) &&
      isoDate(file.filingTo) &&
      file.filingTo >= oldest
    )
    .sort((a,b)=>b.filingTo.localeCompare(a.filingTo));

  const all = [...recent];
  for (let i=0;i<archives.length;i+=3) {
    const batch=archives.slice(i,i+3);
    const results=await Promise.all(batch.map(async file=>{
      let payload;
      try {
        payload=await fetchJSON(
          'https://data.sec.gov/submissions/'+file.name
        );
      } catch(error) {
        throw Error(
          'SEC earnings-history archive unavailable ('+file.name+'): '+
          String(error?.message||error)
        );
      }
      if (!Array.isArray(payload?.form) ||
          !Array.isArray(payload?.filingDate) ||
          !Array.isArray(payload?.accessionNumber)) {
        throw Error(
          'SEC earnings-history archive has invalid format: '+file.name
        );
      }
      return filingRows(payload);
    }));
    for (const group of results) all.push(...group);
  }

  // Archives may overlap the recent section; one accession is one filing.
  const unique=new Map();
  for (const row of all) {
    const key=row.accession ||
      [row.form,row.filed,row.end,row.items].join('|');
    if (!unique.has(key)) unique.set(key,row);
  }
  return {filings:[...unique.values()],archivesScanned:archives.length};
}

/**
 * Preserve the existing conservative matching rule:
 * - the SEC periodic report must match the exact fiscal period end;
 * - the 8-K must identify Item 2.02 and precede that periodic filing;
 * - no dates are inferred from fiscal quarter end or unverified news.
 */
export function assignQuarterDates(rows,filings) {
  for (const r of rows) {
    const forms=r.fiscalQuarter===4
      ? ['10-K','10-K/A'] : ['10-Q','10-Q/A'];

    const report=filings.filter(f=>
      forms.includes(f.form) &&
      f.end===r.fiscalPeriodEnd
    ).sort((a,b)=>a.filed.localeCompare(b.filed))[0];

    r.secFilingDate=report?.filed || null;
    r._accession=report?.accession || null;
    r.earningsDisclosureDate=null;
    if (!report) continue;

    const earnings=filings.filter(f=>
      f.form==='8-K' &&
      /(?:^|[^\d])2\.02(?:$|[^\d])/.test(f.items) &&
      days(r.fiscalPeriodEnd,f.filed)>=0 &&
      days(r.fiscalPeriodEnd,f.filed)<=105 &&
      days(f.filed,report.filed)>=0 &&
      days(f.filed,report.filed)<=35
    ).sort((a,b)=>b.filed.localeCompare(a.filed));

    r.earningsDisclosureDate=earnings[0]?.filed || null;
  }
}

export function earningsDateCoverage(rows,archivesScanned) {
  return {
    quarters:rows.length,
    secReportsFound:rows.filter(r=>r.secFilingDate).length,
    verifiedItem202Dates:rows.filter(r=>r.earningsDisclosureDate).length,
    missingItem202ForFiledQuarters:rows
      .filter(r=>r.secFilingDate && !r.earningsDisclosureDate)
      .map(r=>r.fiscalPeriodEnd),
    archivesScanned,
    dateMeaning:'SEC 8-K Item 2.02 filing date, not necessarily the first earnings announcement'
  };
}
