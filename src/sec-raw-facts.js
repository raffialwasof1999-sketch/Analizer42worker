/**
 * Read-only views of SEC Company Facts, deliberately separate from
 * the Active Analyzer's interpreted financial rows.
 *
 * IMPORTANT: Company Facts includes standardized taxonomies only.
 * Issuer extension facts and narrative notes require filing-level
 * ingestion; these views do not claim otherwise or persist SEC data.
 */

const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj||{},key);

const validPage = (n,max) =>
  Number.isSafeInteger(n) && n >= 1 && n <= max;

function allConcepts(companyFacts) {
  return Object.entries(companyFacts?.facts || {}).flatMap(([taxonomy,concepts]) =>
    Object.entries(concepts || {}).map(([tag,concept]) => ({
      taxonomy, tag,
      label:concept?.label ?? null,
      description:concept?.description ?? null,
      units:Object.keys(concept?.units || {}),
      reportedFacts:Object.values(concept?.units || {})
        .reduce((sum,unit)=>sum+(Array.isArray(unit)?unit.length:0),0)
    }))
  );
}

/** Paginated source concept inventory. Names and definitions stay as filed. */
export function secFactsCatalog(companyFacts,{page=1,pageSize=100,search=''}={}) {
  if(!validPage(page,100000) || !validPage(pageSize,200) ||
     typeof search !== 'string' || search.length > 100)
    throw new RangeError('Invalid catalog pagination or search.');

  const concepts=allConcepts(companyFacts);
  const needle=search.toLowerCase().trim();
  const filtered=needle
    ? concepts.filter(x=>[x.taxonomy,x.tag,x.label,x.description]
        .some(v=>typeof v==='string'&&v.toLowerCase().includes(needle)))
    : concepts;

  filtered.sort((a,b)=>
    a.taxonomy.localeCompare(b.taxonomy) || a.tag.localeCompare(b.tag));
  const offset=(page-1)*pageSize;
  return {
    scope:'SEC Company Facts standardized taxonomies only',
    includesIssuerExtensions:false,
    persistentArchive:false,
    source:'https://data.sec.gov/api/xbrl/companyfacts/',
    conceptsTotal:concepts.length,
    conceptsMatching:filtered.length,
    page,pageSize,hasMore:offset+pageSize<filtered.length,
    concepts:filtered.slice(offset,offset+pageSize)
  };
}

/** 
 * Retain exact SEC fact objects, including period, units, frame, filing,
 * accession, fiscal period, and original numeric value. This route never
 * normalizes alternative concepts or labels missing records as zero.
 */
export function secRawConcept(companyFacts,{selector,offset=0,limit=100}={}) {
  if(typeof selector!=='string'||!selector.includes(':'))
    throw new TypeError('Select a concept as taxonomy:tag.');
  if(!Number.isSafeInteger(offset)||offset<0 ||
     !validPage(limit,200))
    throw new RangeError('Invalid concept pagination.');

  const colon=selector.indexOf(':');
  const taxonomy=selector.slice(0,colon);
  const tag=selector.slice(colon+1);
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(taxonomy) ||
     !/^[a-zA-Z0-9_-]{1,160}$/.test(tag))
    throw new TypeError('Invalid SEC concept selector.');
  const bucket=companyFacts?.facts?.[taxonomy];
  if(!own(bucket,tag))return null;
  const concept=bucket[tag];
  const entries=Object.entries(concept.units||{}).flatMap(([unit,records])=>
    (Array.isArray(records)?records:[]).map(record=>({unit,reported:record}))
  );

  return {
    scope:'Original SEC Company Facts observations; no computed or normalized values',
    includesIssuerExtensions:false,
    persistentArchive:false,
    taxonomy,tag,
    label:concept.label??null,
    description:concept.description??null,
    offset,limit,total:entries.length,
    hasMore:offset+limit<entries.length,
    observations:entries.slice(offset,offset+limit)
  };
}

/**
 * Source-first view of ALL observations in Company Facts. Tag matching is
 * deliberately not used to filter the source data. The supplied record is
 * preserved byte-for-byte as an object, including SEC filing metadata.
 *
 * Paginate rather than adding tens of thousands of records to the dashboard
 * response. This is a live, nonpersistent view of the SEC data fetched for
 * the selected ticker, not a company-specific storage cache.
 */
export function secRawFactsPage(companyFacts,{offset=0,limit=100}={}) {
  if(!Number.isSafeInteger(offset)||offset<0||offset>100_000_000 ||
     !validPage(limit,200))
    throw new RangeError('Invalid SEC facts page.');

  const taxonomies=Object.keys(companyFacts?.facts||{}).sort();
  const observations=[];
  let total=0;
  let concepts=0;
  for(const taxonomy of taxonomies) {
    const tags=companyFacts.facts[taxonomy]||{};
    for(const tag of Object.keys(tags).sort()) {
      concepts++;
      const concept=tags[tag]||{};
      for(const unit of Object.keys(concept.units||{}).sort()) {
        const records=concept.units[unit];
        if(!Array.isArray(records))continue;
        const start=total,end=total+records.length;
        if(end>offset && start<offset+limit) {
          const a=Math.max(0,offset-start);
          const b=Math.min(records.length,offset+limit-start);
          for(const reported of records.slice(a,b)) {
            observations.push({
              taxonomy,tag,unit,
              label:concept.label??null,
              description:concept.description??null,
              reported
            });
          }
        }
        total=end;
      }
    }
  }
  return {
    scope:'All SEC Company Facts observations, prior to metric matching',
    source:'https://data.sec.gov/api/xbrl/companyfacts/',
    includesIssuerExtensions:false,
    includesDimensionalFacts:false,
    persistentArchive:false,
    offset,limit,concepts,totalObservations:total,
    hasMore:offset+limit<total,observations
  };
}

/**
 * Report coverage of the raw inputs compared with the current *known* tag
 * aliases. An unmapped concept remains available; it is never dropped from
 * the source collection or incorrectly treated as absent.
 */
export function secSourceSummary(companyFacts,mapping={}) {
  const taxonomies=Object.keys(companyFacts?.facts||{});
  const all=allConcepts(companyFacts);
  const gaapTags=new Set(Object.keys(companyFacts?.facts?.['us-gaap']||{}));
  const known=new Set(Object.values(mapping).flat());
  const mapped=[...gaapTags].filter(tag=>known.has(tag));
  return {
    stage:'raw-sec-companyfacts-retrieved-before-metric-mapping',
    source:'https://data.sec.gov/api/xbrl/companyfacts/',
    taxonomies,
    rawConcepts:all.length,
    rawObservations:all.reduce((sum,concept)=>sum+concept.reportedFacts,0),
    gaapConcepts:gaapTags.size,
    knownGaapTagConcepts:mapped.length,
    otherGaapConcepts:gaapTags.size-mapped.length,
    otherConceptsPreserved:true,
    includesIssuerExtensions:false,
    includesDimensionalFacts:false,
    persistentArchive:false,
    note:'Counts describe the source response, not financial metric coverage. Custom and dimensional facts require original filing inspection.'
  };
}
