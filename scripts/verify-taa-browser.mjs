// Requires a root-built served site. Does not start a server or build.
// node --import tsx scripts/verify-taa-browser.mjs
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {PerspectiveCamera} from 'three';
import {defaultTAAState,encodeTAAState} from '../src/lib/taa/state.ts';
import {cameraAt,frameJitter,jitterProjection,historyColorUv,objectOffset,projectPoint} from '../src/lib/taa/math.ts';
const base=process.env.TEST_URL||'http://127.0.0.1:4321';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const passed=[],evidence=[],errors=[];
const page=await browser.newPage({viewport:{width:1280,height:950}});page.setDefaultTimeout(30000);
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.addInitScript(()=>{window.__taaTools={};Object.defineProperty(document,'modelContext',{value:{registerTool(t){window.__taaTools[t.name]=t;}}});});
const read=()=>page.evaluate(()=>window.__taaTools.read_taa_experiment.execute({}));
const canvas=()=>page.locator('.taa-viewport canvas');
async function ready(frame){await canvas().waitFor({state:'attached'});await canvas().scrollIntoViewIfNeeded();await page.waitForFunction(frame=>{const t=window.__taaTools?.read_taa_experiment;if(!t)return false;const r=t.execute({});return r.ready&&!r.pending&&r.replay<0&&(frame===undefined||r.frame===frame);},frame,{timeout:120000});return read();}
async function range(label,value){await page.getByLabel(label,{exact:true}).evaluate((e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(v));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function pick(u=.5,v=.5){const r=await read(),box=await canvas().boundingBox(),cols=r.state.compare?2:1;await canvas().click({position:{x:box.width*u/cols,y:box.height*(1-v)/cols}});return (await read()).inspection;}
async function test(name,fn){await fn();passed.push(name);await writeFile('test-results/taa-browser.json',JSON.stringify({passed,evidence,errors},null,2));console.log('PASS',name);}
const near=(a,b,e=2e-4)=>assert.ok(Math.abs(a-b)<e,a+' differs from '+b);
async function goto(state){await page.goto(base+'/labs/taa/'+encodeTAAState(state));return ready(state.frame);}
async function reference(){await page.getByRole('button',{name:'生成同帧 64 样本参考',exact:true}).click();await page.waitForFunction(()=>window.__taaTools.read_taa_experiment.execute({}).referenceReady,undefined,{timeout:120000});return read();}
try{
 await mkdir('test-results',{recursive:true});
 await goto({...defaultTAAState(),quality:'low'});
 await test('initial frame is a real raster sample, and presentation never advances history',async()=>{
  const a=await pick(.5,.38);assert.ok(a&&a.objectId>0);assert.equal(a.reason,1);assert.equal(a.age,1);assert.equal(a.weight,0);
  const count=(await read()).renderCount;
  await page.getByLabel('TAA 视图',{exact:true}).selectOption('velocity');await range('TAA 曝光',1);await ready(0);
  assert.equal((await read()).renderCount,count);near((await pick(.5,.38)).final[0],a.final[0]);
  await range('TAA 曝光',0);
 });
 await test('one step advances exactly one frame; actual geometry and history UVs obey separate conventions',async()=>{
  await page.getByRole('button',{name:'下一帧',exact:true}).click();await ready(1);
  const i=await pick(.5,.3),s=(await read()).state,w=160,h=100,prev=cameraAt(s,0),c=new PerspectiveCamera(45,1.6,.1,40);
  c.position.set(...prev.position);c.lookAt(...prev.target);c.updateMatrixWorld();const vp=jitterProjection(c.projectionMatrix,frameJitter(0,s.jitter),w,h).multiply(c.matrixWorldInverse),expected=projectPoint(i.position,vp);
  expected.uv.forEach((v,a)=>near(v,i.previousUv[a]));const hc=historyColorUv(i.previousUv,i.jitter,i.previousJitter,w,h);hc.forEach((v,a)=>near(v,i.historyUv[a]));hc.forEach((v,a)=>near(v,i.uv[a]));
  const count=(await read()).renderCount;await page.waitForTimeout(160);assert.equal((await read()).renderCount,count);evidence.push({staticInspection:i});
 });
 await test('deterministic seek and share rebuild the same history instead of reusing arbitrary buffers',async()=>{
  await range('TAA 帧号',18);await ready(18);const a=await pick(.47,.33),s=(await read()).state;
  await range('TAA 帧号',7);await ready(7);await range('TAA 帧号',18);await ready(18);const b=await pick(.47,.33);a.final.forEach((v,i)=>near(v,b.final[i],1e-6));assert.equal(a.age,b.age);
  await page.getByRole('button',{name:'分享 TAA 实验',exact:true}).click();const url=await page.locator('.taa-share input').inputValue();await page.goto(url);await ready(18);const c=await pick(.47,.33);a.final.forEach((v,i)=>near(v,c.final[i],1e-6));assert.deepEqual((await read()).state,s);
 });
 await test('fixed-frame reference produces finite errors and does not add temporal frames',async()=>{
  await page.getByLabel('TAA RGB 约束',{exact:true}).uncheck();await ready(18);
  const before=await read(),r=await reference();assert.equal(r.renderCount,before.renderCount);assert.equal(r.frame,18);assert.equal(r.metrics.samples,64);assert.ok(r.metrics.coverage>.1);assert.ok([r.metrics.currentMAE,r.metrics.taaMAE,r.metrics.taaRMSE,r.metrics.convergence].every(Number.isFinite));assert.ok(r.metrics.currentMAE>0);
  evidence.push({sameFrameReference:r.metrics});await page.getByLabel('TAA 四格对照',{exact:true}).check();await ready(18);await canvas().screenshot({path:'test-results/taa-static-reference.png'});
 });
 await test('reference cancellation and resuming playback cannot publish a stale reference',async()=>{
  await page.getByRole('button',{name:'生成同帧 64 样本参考',exact:true}).click();await page.getByRole('button',{name:'取消 TAA 参考',exact:true}).waitFor();await page.getByRole('button',{name:'取消 TAA 参考',exact:true}).click();await page.waitForTimeout(150);assert.equal((await read()).referenceReady,false);
  await page.getByRole('button',{name:'生成同帧 64 样本参考',exact:true}).click();await page.getByRole('button',{name:'取消 TAA 参考',exact:true}).waitFor();await page.getByRole('button',{name:'播放序列',exact:true}).click();await page.getByRole('button',{name:'暂停播放',exact:true}).click();const r=await read();assert.equal(r.referenceReady,false);assert.equal(r.referenceProgress,0);
 });
 await test('moving object uses its previous world transform',async()=>{
  await goto({...defaultTAAState(),quality:'low',motion:'object',frame:25});
  const s=(await read()).state;let hit=null;
  for(const u of [.55,.6,.65,.7,.5,.45]){const i=await pick(u,.48);if(i?.objectId===18){hit=i;break;}}
  assert.ok(hit,'a raster pixel on moving object 18');const point=[...hit.position];point[0]+=objectOffset(s,24)-objectOffset(s,25);
  const cam=cameraAt(s,24),c=new PerspectiveCamera(45,1.6,.1,40);c.position.set(...cam.position);c.lookAt(...cam.target);c.updateMatrixWorld();
  const expected=projectPoint(point,jitterProjection(c.projectionMatrix,frameJitter(24),160,100).multiply(c.matrixWorldInverse));expected.uv.forEach((v,i)=>near(v,hit.previousUv[i]));near(expected.depth,hit.previousClip[3],.001);evidence.push({movingInspection:hit});
 });
 await test('same-frame moving comparisons expose validation and clipping tradeoffs without a monotonic-error claim',async()=>{
  const records=[];
  for(const variant of [{name:'unvalidated',validation:false,clipping:false},{name:'validated',validation:true,clipping:false},{name:'clipped',validation:true,clipping:true}]){
   await goto({...defaultTAAState(),quality:'low',motion:'object',frame:50,weight:.95,validation:variant.validation,clipping:variant.clipping,compare:true});
   const inspection=await pick(.59,.44),r=await reference();assert.equal(r.metrics.frame,50);assert.equal(r.metrics.invalidPixels,0);assert.ok(Number.isFinite(r.metrics.taaMAE));
   records.push({variant:variant.name,metrics:r.metrics,inspection});await canvas().screenshot({path:'test-results/taa-motion-'+variant.name+'.png'});
  }
  assert.ok(new Set(records.map(r=>r.metrics.taaMAE.toPrecision(10))).size>1,'the strategies must actually alter the estimate');
  evidence.push({motionComparisons:records});
 });
 await test('camera cut rejects all history for the first new view and frame 120 stops',async()=>{
  await goto({...defaultTAAState(),quality:'low',motion:'cut',frame:60});const i=await pick(.5,.4);assert.ok(i.objectId>0);assert.equal(i.reason,1);assert.equal(i.weight,0);assert.equal(i.age,1);
  await range('TAA 帧号',119);await ready(119);await page.getByRole('button',{name:'播放序列',exact:true}).click();await ready(120);assert.equal((await read()).playing,false);assert.ok(await page.getByRole('button',{name:'下一帧',exact:true}).isDisabled());
 });
 await test('offscreen display suspends sequence work',async()=>{
  await goto({...defaultTAAState(),quality:'low',frame:2,motion:'object'});await pick();await page.getByRole('button',{name:'播放序列',exact:true}).click();await page.evaluate(()=>{const spacer=document.createElement('div');spacer.id='taa-test-spacer';spacer.style.height='1600px';document.body.append(spacer);window.scrollTo({top:document.body.scrollHeight,behavior:'instant'});});await page.waitForFunction(()=>document.querySelector('.taa-viewport').getBoundingClientRect().bottom<0);await page.waitForTimeout(200);const a=await read();await page.waitForTimeout(200);const b=await read();assert.equal(b.renderCount,a.renderCount);await canvas().scrollIntoViewIfNeeded();await page.getByRole('button',{name:'暂停播放',exact:true}).click();await ready();await page.evaluate(()=>document.getElementById('taa-test-spacer')?.remove());
 });
 await test('task presets wait for ready and reset restores the selected exact task',async()=>{
  await page.goto(base+'/articles/taa/');await page.locator('.taa-viewport').scrollIntoViewIfNeeded();await canvas().waitFor({state:'attached'});await page.getByRole('button',{name:'3 · 权重与颜色约束',exact:true}).click();await page.getByRole('button',{name:'下一帧',exact:true}).waitFor();await page.waitForTimeout(300);
  await range('TAA 历史权重',.3);await page.getByRole('button',{name:'恢复当前任务',exact:true}).click();await page.waitForTimeout(300);near(Number(await page.getByLabel('TAA 历史权重',{exact:true}).inputValue()),.95);assert.equal(await page.getByLabel('TAA 运动',{exact:true}).inputValue(),'object');
 });
 await test('390px live controls and actual GPU inspection remain reachable without horizontal overflow',async()=>{
  await page.setViewportSize({width:390,height:844});await goto({...defaultTAAState(),quality:'low',frame:3});
  const i=await pick(.5,.38);assert.ok(i&&i.final.every(Number.isFinite));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.getByLabel('TAA 视图',{exact:true}).selectOption('reject');await ready(3);await page.screenshot({path:'test-results/taa-mobile-live.png',fullPage:true});await page.setViewportSize({width:1280,height:950});
 });
 await test('390px without JavaScript preserves article, formulas and runtime source without overflow',async()=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}),mobile=await context.newPage();await mobile.goto(base+'/articles/taa/');assert.ok(await mobile.locator('.ray-task').count()===3);assert.ok(await mobile.locator('.katex').count()>=4);assert.ok(await mobile.locator('pre').count()>=2);assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mobile.screenshot({path:'test-results/taa-mobile-nojs.png',fullPage:true});await context.close();
 });
 assert.deepEqual(errors,[]);await writeFile('test-results/taa-browser.json',JSON.stringify({passed,evidence,errors},null,2));console.log('PASS '+passed.length+' TAA browser workflows');
}finally{await browser.close();}
