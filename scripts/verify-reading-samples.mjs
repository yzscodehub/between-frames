import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const base=process.env.TEST_URL||'http://127.0.0.1:4321';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const passed=[];await mkdir('test-results/reading-samples',{recursive:true});
try{
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}),page=await context.newPage();
 for(const id of ['csm','hdr','ibl','transparency','gtao','shadow-mapping','pbr','pcf-pcss','ssr','taa','ray-intersections','ray-bvh','ray-shadows','ray-reflections','path-tracing','ray-mis','ray-denoising']){
  await page.goto(base+'/articles/'+id+'/');assert.ok(await page.locator('.reading-orientation img').evaluate(img=>img.complete&&img.naturalWidth>0));
  assert.equal(await page.locator('.reading-evolution>section').count(),3);assert.ok(await page.locator('#diagnosis').count());
  await page.locator('.reading-diagnostic-list summary').first().click();assert.ok(await page.locator('.reading-diagnostic-list details').first().evaluate(el=>el.open));
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:950});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),id+' overflow at '+width);await page.locator('.reading-orientation').screenshot({path:`test-results/reading-samples/${id}-${width}.png`});}
  passed.push(id+' static image, evolution, native diagnosis and three viewport widths');
 }
 await page.goto(base+'/learn/first-frame/');const links=await page.locator('.path-stops h2 a').evaluateAll(els=>els.map(el=>el.getAttribute('href')));assert.deepEqual(links.slice(0,4),['/foundations/spaces/','/foundations/depth/','/articles/shadow-mapping/','/articles/pbr/']);assert.equal(await page.getByText('可选分支',{exact:true}).count(),3);passed.push('four-step foundation and three optional branches');await context.close();
 const interactive=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];interactive.on('pageerror',e=>errors.push(e.message));
 await interactive.addInitScript(()=>{window.__tools={};Object.defineProperty(document,'modelContext',{value:{registerTool(t){window.__tools[t.name]=t}}});});
 await interactive.goto(base+'/labs/materials/');await interactive.waitForFunction(()=>window.__tools?.read_pbr_experiment?.execute({}).ready);
 const before=await interactive.evaluate(()=>window.__tools.read_pbr_experiment.execute({}).state);
 const summary=interactive.locator('.observation-guide summary');await summary.focus();await interactive.keyboard.press('Enter');assert.ok(await interactive.locator('.observation-guide details').evaluate(el=>el.open));assert.deepEqual(await interactive.evaluate(()=>window.__tools.read_pbr_experiment.execute({}).state),before);
 await interactive.getByRole('button',{name:'2 · 视角与金属度',exact:true}).click();assert.match(await interactive.locator('.observation-guide').innerText(),/F₀/);assert.equal(await interactive.locator('.observation-guide details').evaluate(el=>el.open),false);passed.push('keyboard prediction reveal preserves state; task change updates and closes explanation');
 await interactive.goto(base+'/articles/pbr/');await interactive.locator('.pbr-lab').scrollIntoViewIfNeeded();await interactive.waitForFunction(()=>document.querySelector('.pbr-status')?.textContent.includes('就绪'));
 assert.equal(await interactive.locator('.pbr-options').evaluate(el=>el.open),false);await interactive.locator('.pbr-options summary').click();assert.ok(await interactive.getByLabel('材质方向光强',{exact:true}).isVisible());await interactive.locator('.pbr-lab').screenshot({path:'test-results/reading-samples/pbr-live.png'});assert.deepEqual(errors,[]);passed.push('embedded material controls progressively disclose working light controls');
 await writeFile('test-results/reading-samples/results.json',JSON.stringify({passed,errors},null,2));console.log(passed.join('\n'));
}finally{await browser.close();}
