// Full UI regression after the root-owned build/preview. TEST_URL may override.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const base=process.env.TEST_URL||'http://127.0.0.1:4321';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),passed=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{window.__tools={};Object.defineProperty(document,'modelContext',{value:{registerTool(tool,options){window.__tools[tool.name]=tool;options?.signal?.addEventListener('abort',()=>delete window.__tools[tool.name]);}}});});
const read=()=>page.evaluate(()=>window.__tools.read_pbr_experiment.execute({}));
await mkdir('test-results',{recursive:true});
const ready=()=>page.waitForFunction(()=>window.__tools?.read_pbr_experiment?.execute({}).ready&&!window.__tools.read_pbr_experiment.execute({}).pending);
const change=async(label,value)=>{await page.getByLabel(label,{exact:true}).evaluate((input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);};
const pick=async()=>{await page.getByRole('button',{name:'检查材质球示例点',exact:true}).click();await page.locator('.pbr-inspection').waitFor();};
async function test(name,action){await action();passed.push(name);console.log('PASS',name);}
try{
 await page.goto(base+'/labs/materials/');await ready();
 await test('actual GPU pixel and independent CPU oracle agree',async()=>{await pick();const r=await read();assert.ok(r.inspection.valid);assert.ok(r.inspection.maxRelativeError<.005);assert.equal(r.inspection.objectId,2);});
 await test('all three tasks load and reset their own starting conditions',async()=>{
  for(const [index,label]of ['粗糙度与反射瓣','视角与金属度','拆开 D、F、G'].entries()){
   await page.getByRole('button',{name:(index+1)+' · '+label,exact:true}).click();await ready();const start=(await read()).state;
   await change('材质粗糙度',.91);await ready();await page.getByRole('button',{name:'恢复本节示例',exact:true}).click();await ready();assert.deepEqual((await read()).state,start);
  }
 });
 await test('dielectric F0 stays neutral and metal removes diffuse',async()=>{
  await change('材质金属度',0);await ready();await pick();assert.ok((await read()).inspection.terms.f0.every(v=>Math.abs(v-.04)<1e-7));
  await change('材质金属度',1);await ready();await pick();const hit=(await read()).inspection;assert.deepEqual(hit.terms.diffuse,[0,0,0]);hit.terms.f0.forEach((v,i)=>assert.ok(Math.abs(v-hit.material.baseColor[i])<1e-7));
 });
 await test('exposure alters display only, without corrupting linear inspection',async()=>{
  await pick();const before=(await read()).inspection;await change('材质显示曝光',2);const after=(await read()).inspection;assert.deepEqual(after.radiance,before.radiance);assert.deepEqual(after.terms,before.terms);
 });
 await test('paused parameter edits hide old readback until explicit step',async()=>{
  await page.getByRole('button',{name:'暂停更新',exact:true}).click();await change('材质粗糙度',.48);await page.waitForTimeout(120);let r=await read();assert.ok(r.paused&&r.pending);assert.equal(r.inspection,null);
  await page.getByRole('button',{name:'单步计算',exact:true}).click();await ready();r=await read();assert.ok(r.paused);assert.ok(r.inspection.valid);assert.ok(Math.abs(r.inspection.material.roughness-.48)<1e-6);
  await page.getByRole('button',{name:'恢复更新',exact:true}).click();
 });
 await test('hemisphere integration completes and cancels without stale results',async()=>{
  await page.getByRole('button',{name:'计算 8192 样本半球积分',exact:true}).click();await page.waitForFunction(()=>window.__tools.read_pbr_experiment.execute({}).integralProgress===1);
  const result=(await read()).integral;assert.equal(result.samples,8192);assert.ok(result.total.every(Number.isFinite));result.total.forEach((v,i)=>assert.ok(Math.abs(v-result.diffuse[i]-result.specular[i])<1e-12));
  await page.getByRole('button',{name:'计算 8192 样本半球积分',exact:true}).click();await page.getByRole('button',{name:'取消积分',exact:true}).waitFor();await page.getByRole('button',{name:'取消积分',exact:true}).click();await page.waitForTimeout(200);assert.equal((await read()).integral,null);assert.equal((await read()).integralProgress,0);
 });
 await test('share roundtrip preserves camera, material and selected task',async()=>{
  const before=(await read()).state;await page.getByRole('button',{name:'分享材质实验',exact:true}).click();const url=await page.getByLabel('材质实验分享链接').inputValue();await page.goto(url);await ready();assert.deepEqual((await read()).state,{...before,learning:before.learning??{article:'pbr',chapter:'lab'}});
 });
 await test('offscreen updates wait and resume when the viewport returns',async()=>{
  await page.evaluate(()=>{const spacer=document.createElement('div');spacer.dataset.pbrTestSpacer='1';spacer.style.height='1200px';document.body.append(spacer);window.scrollTo({top:document.body.scrollHeight,behavior:'instant'});});await page.waitForFunction(()=>document.querySelector('.pbr-viewport').getBoundingClientRect().bottom<0);await page.waitForTimeout(150);await change('材质粗糙度',.63);await page.waitForTimeout(150);assert.ok((await read()).pending);
  await page.locator('.pbr-viewport').scrollIntoViewIfNeeded();await ready();assert.equal((await read()).state.roughness,.63);await page.evaluate(()=>document.querySelector('[data-pbr-test-spacer]')?.remove());
 });
 await test('component diagnostics, mobile layout and old-state fallback',async()=>{
  for(const view of ['d','f','g','diffuse','specular','beauty']){await page.getByLabel('材质显示分量').selectOption(view);await page.locator('.pbr-viewport').scrollIntoViewIfNeeded();await ready();}
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'test-results/pbr-lab-mobile.png',fullPage:true});
  await page.goto(base+'/labs/materials/#pbr='+encodeURIComponent(JSON.stringify({version:0})));await ready();assert.equal((await read()).state.version,1);assert.ok((await page.locator('.pbr-notice').innerText()).includes('不兼容'));
 });
 await test('no-JavaScript article and failed-WebGPU fallback remain usable',async()=>{
  const staticContext=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}),staticPage=await staticContext.newPage();await staticPage.goto(base+'/articles/pbr/');assert.equal(await staticPage.locator('.ray-task').count(),3);assert.ok(await staticPage.locator('.katex').count());assert.ok(await staticPage.locator('article pre').count());assert.ok(await staticPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await staticContext.close();
  const fallback=await browser.newContext(),fallbackPage=await fallback.newPage();await fallbackPage.addInitScript(()=>{Object.defineProperty(navigator,'gpu',{value:undefined});});await fallbackPage.goto(base+'/labs/materials/');await fallbackPage.getByRole('button',{name:'重试材质实验',exact:true}).waitFor();assert.ok(await fallbackPage.locator('.pbr-fallback').innerText());await fallback.close();
 });
 assert.deepEqual(errors,[]);await mkdir('test-results',{recursive:true});await writeFile('test-results/pbr-browser-results.json',JSON.stringify({passed,errors},null,2));console.log('ALL',passed.length,'PBR browser scenarios passed');
}catch(error){await mkdir('test-results',{recursive:true});await writeFile('test-results/pbr-browser-results.json',JSON.stringify({passed,errors,failure:String(error)},null,2));await page.screenshot({path:'test-results/pbr-failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await context.close();await browser.close();}
