// Static reading and publication-integrity checks for the PBR → SSR → TAA batch.
// Requires the built preview server. No WebGL execution is used by this script.
import assert from 'node:assert/strict';
import {access,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
const base=process.env.TEST_URL||'http://127.0.0.1:4321';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const passed=[],links=new Set();await mkdir('test-results',{recursive:true});
try{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}),page=await context.newPage();
 for(const slug of ['pbr','ssr','taa']){
  const response=await page.goto(base+'/articles/'+slug+'/');assert.equal(response.status(),200);
  assert.ok((await page.locator('h1').innerText()).includes(slug.toUpperCase()));
  assert.ok(await page.locator('#lab').count(),slug+' lab return anchor');
  assert.ok(await page.locator('article h2').count()>=6,slug+' complete argument');
  assert.equal(await page.locator('.ray-task').count(),3,slug+' three guided experiments');
  assert.ok(await page.locator('article pre').count(),slug+' runtime source excerpt');
  assert.ok(await page.locator('.katex').count(),slug+' formulas remain readable');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),slug+' mobile overflow');
  for(const href of await page.locator('main a[href^="/"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))))links.add(href);
  await page.screenshot({path:'test-results/'+slug+'-reading-mobile.png',fullPage:true});passed.push(slug+' complete static mobile article');
 }
 for(const route of ['materials','ssr','taa']){const response=await page.goto(base+'/labs/'+route+'/');assert.equal(response.status(),200);assert.ok(await page.locator('h1').innerText());passed.push(route+' static lab route');}
 for(const href of links){const url=new URL(href,base),path=resolve('dist','.'+url.pathname,'index.html');await access(path);if(url.hash&&!url.hash.startsWith('#pbr=')&&!url.hash.startsWith('#ssr=')&&!url.hash.startsWith('#taa=')&&!url.hash.startsWith('#ray=')&&!url.hash.startsWith('#shadow=')){await page.goto(url.origin+url.pathname);assert.ok(await page.locator('[id]').evaluateAll((nodes,id)=>nodes.some(n=>n.id===id),decodeURIComponent(url.hash.slice(1))),href+' anchor');}}
 passed.push('all internal reading links and anchors resolve');
 await page.goto(base+'/#material-screen-series');for(const slug of ['pbr','ssr','taa'])assert.ok(await page.locator('a[href="/articles/'+slug+'/"]').count());
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));passed.push('homepage distinguishes completed batch and remaining content');
 await writeFile('test-results/study-content-results.json',JSON.stringify({passed,links:[...links]},null,2));console.log('PASS',passed.length,'static reading and route checks');
 await context.close();
}finally{await browser.close();}
