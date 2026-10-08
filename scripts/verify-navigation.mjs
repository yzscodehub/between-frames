import assert from 'node:assert/strict';
import {readdir, mkdir, writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const base=process.env.TEST_URL||'http://127.0.0.1:4321';
const files=await readdir('dist',{recursive:true});
const routes=files.filter(f=>f.endsWith('index.html')).map(f=>'/'+f.replace(/index.html$/,''));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const passed=[],links=new Set();await mkdir('test-results/navigation',{recursive:true});
try {
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}),page=await context.newPage();
 for(const route of routes){
  assert.equal((await page.goto(base+route)).status(),200,route);
  assert.equal(await page.locator('h1').count(),1,route+' unique title');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' mobile overflow');
  if(route.startsWith('/articles/'))assert.ok(await page.locator('.reader-topic-links a[aria-current="page"]').count(),route+' primary topic');
  for(const href of await page.locator('a[href^="/"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))))links.add(href);
 }
 passed.push(routes.length+' routes readable on mobile without JavaScript');
 for(const href of links){const url=new URL(href,base);assert.ok(routes.includes(url.pathname),href+' destination');if(url.hash&&!/^#(?:state|ray|shadow|pbr|ssr|taa|ibl|transparency|csm|hdr)=/.test(url.hash)){await page.goto(base+url.pathname);assert.ok(await page.locator('[id]').evaluateAll((nodes,id)=>nodes.some(n=>n.id===id),decodeURIComponent(url.hash.slice(1))),href+' anchor');}}
 passed.push(links.size+' internal links and static anchors valid');
 const captures=[['/','home'],['/topics/visibility/','topic'],['/learn/ray-tracing/','path'],['/articles/shadow-mapping/','article'],['/labs/','labs']];
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});for(const [route,name] of captures){await page.goto(base+route);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' overflow at '+width);if(width!==320)await page.screenshot({path:`test-results/navigation/${name}-${width}.png`,fullPage:!route.startsWith('/articles/')});}}
 passed.push('desktop, mobile and 320px layout');await context.close();
 const interactive=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];interactive.on('pageerror',e=>errors.push(e.message));
 await interactive.goto(base+'/');await interactive.locator('a[href="/topics/visibility/"]').first().click();await interactive.locator('a[href="/articles/shadow-mapping/"]').first().click();await interactive.locator('.reader-toc [data-chapter]').nth(2).click();await interactive.waitForFunction(()=>document.querySelector('.reader-toc [aria-current="location"]'));assert.ok(interactive.url().includes('#'));assert.deepEqual(errors,[]);passed.push('topic → article → chapter navigation with active chapter');
 await writeFile('test-results/navigation/results.json',JSON.stringify({passed,routeCount:routes.length,linkCount:links.size},null,2));console.log(passed.join('\n'));
}finally{await browser.close();}
