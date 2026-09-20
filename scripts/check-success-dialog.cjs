// Compatibility entrypoint: all success checks live in one maintained module.
const {chromium}=require('playwright');
const run=require('./browser/success-dialog.cjs');
module.exports=run;
if(require.main===module)(async()=>{const browser=await chromium.launch({headless:true});try{await run(browser)}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
