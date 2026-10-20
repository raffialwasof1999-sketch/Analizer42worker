/**
 * Free SEC CompanyFacts-only split adjustment, independent of filing HTML.
 *
 * Determine the multiplicative *share basis* between two SEC filings by
 * comparing the SAME historical period's diluted shares and diluted EPS.
 * A true split rescales denominator shares and EPS reciprocally, but leaves
 * total earnings unaffected.
 *
 * A non-unit factor needs TWO separately reported overlapping periods with
 * consistent numerator/denominator ratios. Accounting restatements and
 * missing disclosure are not silently interpreted as stock splits.
 */
function isNumber(n){return typeof n==='number'&&Number.isFinite(n)}
function days(a,b){return (Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000}
function median(a){const sorted=[...a].sort((x,y)=>x-y);return sorted[Math.floor(sorted.length/2)]}
function close(a,b,relative=0.02){return Math.abs(a-b)<=relative*Math.max(Math.abs(a),Math.abs(b),1e-10)}

export function buildSECShareBasisGraph(companyFacts) {
  const gaap=companyFacts?.facts?.['us-gaap']||{};
  const eps=gaap.EarningsPerShareDiluted?.units?.['USD/shares']||[];
  const shares=gaap.WeightedAverageNumberOfDilutedSharesOutstanding?.units?.shares||[];
  const valid=r=>r && r.accn && r.filed && r.start && r.end &&
    ['10-K','10-K/A','10-Q','10-Q/A'].includes(r.form) &&
    isNumber(r.val) && days(r.start,r.end)>=60 && days(r.start,r.end)<=385;
  const periods=new Map();
  const records=new Map();
  for(const [kind,list] of [['eps',eps],['shares',shares]]){
    for(const r of list.filter(valid)){
      const key=r.start+'|'+r.end;
      if(!periods.has(key))periods.set(key,new Map());
      const perFiling=periods.get(key);
      if(!perFiling.has(r.accn))perFiling.set(r.accn,{
        accn:r.accn,filed:r.filed,form:r.form,start:r.start,end:r.end
      });
      const f=perFiling.get(r.accn);
      f[kind]=r.val; // identical period+accession repeated facts are equivalent
      if(!records.has(r.accn))records.set(r.accn,{filed:r.filed,annual:false});
      if(days(r.start,r.end)>330)records.get(r.accn).annual=true;
    }
  }
  const pairs=new Map();
  for(const group of periods.values()) {
    const rows=[...group.values()].filter(x=>isNumber(x.shares)&&x.shares>0 && isNumber(x.eps));
    rows.sort((a,b)=>a.filed.localeCompare(b.filed)||a.accn.localeCompare(b.accn));
    for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++){
      const a=rows[i],b=rows[j];
      if(a.accn===b.accn || a.filed===b.filed)continue;
      const factor=b.shares/a.shares;
      if(!isNumber(factor)||factor<0.001||factor>1000)continue;
      const material=Math.abs(Math.log(factor))>Math.log(1.025);
      // EPS matching matters for nontrivial share rescaling; allow reported
      // EPS rounding to the nearest cent (and very small absolute EPS).
      if(material){
        if(a.eps===0||b.eps===0||Math.sign(a.eps)!==Math.sign(b.eps))continue;
        if(Math.abs(a.eps/factor-b.eps)>Math.max(0.035,Math.abs(b.eps)*0.06))continue;
      } else if(!close(factor,1,0.025))continue;
      const key=a.accn+'|'+b.accn;
      if(!pairs.has(key))pairs.set(key,{a:a.accn,b:b.accn,ratios:[],periods:new Set()});
      const pair=pairs.get(key);
      pair.ratios.push(factor);
      pair.periods.add(a.start+'|'+a.end);
    }
  }
  const edges=[],adjacency=new Map();
  for(const item of pairs.values()){
    const factor=median(item.ratios);
    if(!item.ratios.every(n=>close(n,factor,0.025)))continue;
    const material=Math.abs(Math.log(factor))>Math.log(1.025);
    if(material && item.periods.size<2)continue;
    const proven=material?factor:1;
    edges.push({from:item.a,to:item.b,shareFactor:proven,
      evidencePeriods:item.periods.size,
      status:material?'cross-period-split-evidence':'same-share-basis'});
    if(!adjacency.has(item.a))adjacency.set(item.a,[]);
    if(!adjacency.has(item.b))adjacency.set(item.b,[]);
    adjacency.get(item.a).push({to:item.b,ratio:proven});
    adjacency.get(item.b).push({to:item.a,ratio:1/proven});
  }
  const annual=[...records].filter(([,v])=>v.annual);
  annual.sort((a,b)=>b[1].filed.localeCompare(a[1].filed));
  const anchor=annual[0]?.[0] || [...records].sort((a,b)=>b[1].filed.localeCompare(a[1].filed))[0]?.[0] || null;
  const factors=new Map();
  const conflicts=[];
  if(anchor){
    factors.set(anchor,1);
    const queue=[anchor];
    for(let i=0;i<queue.length;i++){
      const from=queue[i],basis=factors.get(from);
      for(const edge of adjacency.get(from)||[]){
        const proposed=basis/edge.ratio;
        if(!isNumber(proposed)||proposed<=0)continue;
        if(!factors.has(edge.to)){factors.set(edge.to,proposed);queue.push(edge.to);}
        else if(!close(factors.get(edge.to),proposed,0.025)){
          conflicts.push({from,to:edge.to});
        }
      }
    }
  }
  const inconsistent=conflicts.length>0;
  const shareFactors=inconsistent?{}:Object.fromEntries(factors);
  return {
    method:'SEC overlapping reported EPS and diluted weighted-average shares',
    anchorAccession:anchor,
    anchorFiled:anchor?records.get(anchor).filed:null,
    filingCount:records.size,
    connectedFilings:inconsistent?0:factors.size,
    changedBasisEdges:edges.filter(e=>e.status==='cross-period-split-evidence'),
    evidenceEdges:edges.length,
    conflicts,
    shareFactors,
    complete:!inconsistent && factors.size===records.size && records.size>0,
    status:inconsistent?'conflicting-SEC-share-basis-evidence':
      !anchor?'no-per-share-SEC-observations':
      factors.size<records.size?'partial-companyfacts-basis-coverage':'share-basis-graph-connected',
    note:'Inferred factors require matching historical EPS and share-count changes. Unconnected or contradictory observations are not normalized.'
  };
}

export function normalizeUsingSECShareGraph(rows,graph,findSource) {
  if(!Array.isArray(rows)||!graph||typeof findSource!=='function')throw Error('Bad graph normalization inputs');
  const output=[],issues=[],adjustments=[];
  const bad=graph.conflicts?.length>0;
  for(const row of rows){
    const adjusted={...row};
    for(const metric of ['dilutedEPS','basicEPS','dilutedShares']){
      if(!isNumber(row[metric]))continue;
      const possible=findSource(row,metric);
      const options=Array.isArray(possible)?possible:[possible];
      const same=r=>r?.accn && isNumber(r.val) &&
        Math.abs(r.val-row[metric])<=Math.max(1e-8,Math.abs(row[metric])*1e-7);
      const source=options.find(r=>same(r) && isNumber(graph.shareFactors[r.accn])) ||
        options.find(same) || options[0];
      const factor=!bad && same(source) ? graph.shareFactors[source.accn] : undefined;
      if(!isNumber(factor)||factor<=0){
        adjusted[metric]=null;
        issues.push({periodEnd:row.fiscalPeriodEnd,metric,status:'SEC-share-basis-unconnected',accn:source?.accn||null});
      }else{
        adjusted[metric]=metric==='dilutedShares'?row[metric]*factor:row[metric]/factor;
        adjustments.push({periodEnd:row.fiscalPeriodEnd,metric,sourceAccession:source.accn,shareFactor:factor});
      }
    }
    output.push(adjusted);
  }
  return {rows:output,issues,adjustments,complete:issues.length===0};
}
