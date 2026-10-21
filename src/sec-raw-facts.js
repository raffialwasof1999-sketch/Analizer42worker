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
