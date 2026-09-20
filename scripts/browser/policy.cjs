// Offline browser policy. No production host or implicit external fallback.
const assert = require('node:assert/strict');
const WIDTHS = Object.freeze([320,390,768,780,781,782,1023,1024,1710]);
const SUITES = Object.freeze(['network-policy','storefront','account','order-refresh','success-dialog','marketing','cache']);
function options(width) { return {viewport:{width,height:1180},isMobile:width<=780,hasTouch:width<=780,serviceWorkers:'block'}; }
function assertComplete(results) {
  assert.deepEqual(results.map(r=>r.name).sort(), [...SUITES].sort(), 'Each mandatory suite must execute exactly once');
  for (const r of results) assert.ok(r.status==='PASS' && Number.isInteger(r.cases) && r.cases>0, `Missing/zero/failed suite: ${r.name}`);
}
function allowedURL(raw, origins, mocks) {
  try {const u=new URL(raw); return ['http:','https:'].includes(u.protocol) && (origins.includes(u.origin) || mocks.includes(u.href));} catch {return false;}
}
function matrixFor(deviceWidth, legacy) {
  const low=Math.min(...legacy),high=Math.max(...legacy);
  return [...new Set([...legacy,...WIDTHS.filter(w=>w>=low&&w<=high)])].sort((a,b)=>a-b).filter(w=>(w<=780)===(deviceWidth<=780));
}
module.exports={WIDTHS,SUITES,options,assertComplete,allowedURL,matrixFor};
