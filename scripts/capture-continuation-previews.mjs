import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {articles,articleLabHref} from '../src/lib/content/catalog.ts';
import {defaultRayState,encodeRayState} from '../src/lib/ray/state.ts';
const base=process.env.TEST_URL||'http://127.0.0.1:4321';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:960,height:900},deviceScaleFactor:1});const records=[];
await page.addInitScript(()=>{window.__tools={};Object.defineProperty(document,'modelContext',{value:{registerTool(t){window.__tools[t.name]=t}}});});
try{await mkdir('public/images/reading',{recursive:true});for(const a of articles.filter(a=>a.rayLesson||['pcf-pcss','ssr','taa'].includes(a.id))){
 let href=articleLabHref(a);const kind=a.rayLesson?'ray':a.id==='pcf-pcss'?'shadow':a.id;
 if(a.rayLesson){const state={...defaultRayState(a.rayLesson),targetSpp:16,quality:'low'};if(['rays','bvh'].includes(a.rayLesson))state.quality='standard';href=href.split('#')[0]+encodeRayState(state);}
 await page.goto(base+href);await page.locator('.'+kind+'-viewport').scrollIntoViewIfNeeded();
 if(kind==='ray'){await page.waitForFunction(()=>document.querySelector('.ray-status')?.textContent.includes('就绪'),null,{timeout:60000});if(['shadows','path','mis'].includes(a.rayLesson))await page.waitForFunction(()=>window.__tools.read_ray_experiment.execute({}).progress.samples>=16,null,{timeout:60000});}
 else await page.waitForFunction(kind=>window.__tools?.['read_'+kind+'_experiment']?.execute({}).ready,kind,{timeout:60000});
 await page.locator('.'+kind+'-viewport canvas').first().screenshot({path:`public/images/reading/${a.id}.png`});
 const report=await page.evaluate(kind=>window.__tools['read_'+kind+'_experiment'].execute({}),kind);
 records.push({article:a.id,href,state:report.state,progress:report.progress??null,purpose:'真实 GPU 静态阅读预览；不是高样本参考或性能证据'});console.log('captured',a.id);
}await writeFile('public/images/reading/continuation-provenance.json',JSON.stringify({date:'2026-10-07',device:'Chrome / SwiftShader',records},null,2));}finally{await browser.close();}
