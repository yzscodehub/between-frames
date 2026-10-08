import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1200,height:1000}}),records=[];
await page.addInitScript(()=>{window.__tools={};Object.defineProperty(document,'modelContext',{value:{registerTool(t){window.__tools[t.name]=t}}});});
try{for(const kind of ['ibl','transparency']){await page.goto('http://127.0.0.1:4321/labs/'+kind+'/');await page.locator('.lighting-viewport').scrollIntoViewIfNeeded();await page.waitForFunction(k=>window.__tools?.['read_'+k+'_experiment']?.execute({}).ready,kind,{timeout:60000});await page.locator('.lighting-viewport canvas').screenshot({path:'public/images/reading/'+kind+'.png'});records.push({kind,...await page.evaluate(k=>window.__tools['read_'+k+'_experiment'].execute({}),kind)});}await writeFile('public/images/reading/lighting-provenance.json',JSON.stringify({date:'2026-10-07',purpose:'实际默认 GPU 阅读预览，不是基准参考',records},null,2));}finally{await browser.close();}
