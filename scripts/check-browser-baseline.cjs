// One mandatory entrypoint, explicit modules, one shared Chromium process, no retries.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {adapter,root}=require('./browser/harness.cjs');
const {assertComplete}=require('./browser/policy.cjs');
async function run(){
  const results=[],started=Date.now();let browser;
  const dir=path.join(root,'.build/browser-baseline');fs.mkdirSync(dir,{recursive:true});
  const modules={
    'network-policy':require('./browser/network-policy.cjs'),
    storefront:require('./browser/storefront.cjs'),
    account:async b=>{for(const width of [390,1710])await require('./check-customer-account.cjs')(adapter(b),{width});return 2},
    'order-refresh':async b=>{for(const width of [390,1710])await require('./check-customer-account.cjs')(adapter(b),{width,mode:'order-refresh'});return 2},
    'success-dialog':require('./browser/success-dialog.cjs'),
    marketing:async b=>{for(const width of [390,1710])await require('./check-referral-marketing.cjs')(adapter(b),{width});return 2},
    cache:require('./browser/cache.cjs'),
  };
  try{
    browser=await chromium.launch({headless:true});
    for(const [name,execute] of Object.entries(modules)){
      const start=Date.now();console.log(`BEGIN browser suite ${name}`);
      try{const cases=await execute(browser);results.push({name,status:'PASS',cases,ms:Date.now()-start});console.log('BROWSER_RESULT '+JSON.stringify(results.at(-1)))}
      catch(e){results.push({name,status:'FAIL',cases:0,ms:Date.now()-start,error:e.message});throw new Error(`Browser suite ${name}: ${e.stack}`,{cause:e})}
    }
    assertComplete(results);
  }finally{
    if(browser)await browser.close();
    const report={results,ms:Date.now()-started,retries:0};
    fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2));
    console.log('BROWSER_BASELINE '+JSON.stringify(report));
  }
}
module.exports={run};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
